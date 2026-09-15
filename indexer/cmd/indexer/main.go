// Command indexer is the ReserveSentinel scoring engine.
//
// On startup it:
//  1. loads config/assets.json and verifies every tracked mint exists on mainnet,
//  2. starts an HTTP server on :8080 for Helius mint/burn webhooks,
//  3. on each webhook event: updates that asset's mint/burn window, recomputes
//     the score, writes to ClickHouse, and pushes update_score on-chain if the
//     score moved by more than the configured threshold,
//  4. runs a 60s ticker that refreshes price + liquidity for all assets even
//     when no mint/burn events arrive.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/reserve-sentinel/indexer/internal/alert"
	"github.com/reserve-sentinel/indexer/internal/anchor"
	"github.com/reserve-sentinel/indexer/internal/clickhouse"
	"github.com/reserve-sentinel/indexer/internal/config"
	"github.com/reserve-sentinel/indexer/internal/helius"
	"github.com/reserve-sentinel/indexer/internal/pool"
	"github.com/reserve-sentinel/indexer/internal/prestocks"
	"github.com/reserve-sentinel/indexer/internal/pyth"
	"github.com/reserve-sentinel/indexer/internal/pythpro"
	"github.com/reserve-sentinel/indexer/internal/scoring"
)

// assetState is the mutable per-asset working set held in memory.
type assetState struct {
	cfg      config.Asset
	velocity *scoring.VelocityWindow
	mu       sync.Mutex
	// last pushed on-chain score, for the change-threshold gate.
	lastPushedScore uint8
	hasPushed       bool
	// last risk band we alerted on, to fire only on band transitions.
	lastBand int
	hasBand  bool
	// Pyth Pro feed ids, resolved once from the configured symbols (0 = none).
	proUnderlyingID uint32
	proTokenID      uint32
	// refSource is where the last reference price came from; logged on change
	// so it's visible when Pyth Pro access switches on or off.
	refSource string
	// lastPythTokenUSD is Pyth's own price for this issuer's token. Not scored
	// yet — kept for the token-vs-share-vs-other-issuer comparison.
	lastPythTokenUSD float64
	// warnedPyth dedups the Hermes-unavailable log line. Only touched from the
	// refresh ticker goroutine (refreshAll is its sole caller), so no lock.
	warnedPyth bool
	// latest observed signals (refreshed by ticker + webhooks).
	lastPremiumBps int32
	lastDepthUSD   uint64
	// marketRead is set by the first successful market read. Until then depth
	// is an unmeasured zero, which scoring treats as "no exit market", so
	// scoring waits rather than publish a false High risk.
	marketRead bool
}

// engine wires the signal sources to scoring and the sinks.
type engine struct {
	cfg    *config.Config
	pyth   *pyth.Client
	pool   *pool.Reader
	ch     *clickhouse.Writer
	chain  *anchor.Client
	alert  *alert.Telegram
	byMint map[string]*assetState

	// pro serves authenticated Pyth Pro prices; proQuotes is this cycle's batch.
	pro       *pythpro.Client
	proMu     sync.RWMutex
	proQuotes map[uint32]pythpro.Quote

	// preStocks serves PreStocks' marks; preMarks is this cycle's list by mint.
	preStocks *prestocks.Client
	preMu     sync.RWMutex
	preMarks  map[string]prestocks.Mark

	// refPrices holds underlying stock prices fetched once per refresh cycle
	// (one batched Jupiter call for every mint) rather than per asset, which
	// is what kept the loop under the free-tier rate limit.
	refMu     sync.RWMutex
	refPrices map[string]float64
}

func newEngine(cfg *config.Config) *engine {
	e := &engine{
		cfg:       cfg,
		pyth:      pyth.NewClient(cfg.HermesURL),
		pro:       pythpro.New(cfg.PythProURL, cfg.PythProSymbolsURL, cfg.PythProAPIKey),
		proQuotes: make(map[uint32]pythpro.Quote),
		preStocks: prestocks.New(cfg.PreStocksURL),
		preMarks:  make(map[string]prestocks.Mark),
		pool:      pool.NewReader(cfg.DataRPCURL),
		ch:        clickhouse.NewWriter(cfg.ClickHouseDSN),
		chain:     anchor.NewClient(cfg.RPCURL, cfg.ProgramID, cfg.AuthorityKeypairPath),
		alert:     alert.NewTelegram(cfg.TelegramBotToken, cfg.TelegramChatID),
		byMint:    make(map[string]*assetState),
		refPrices: make(map[string]float64),
	}
	for _, a := range cfg.Registry.Assets {
		if a.HasTODO() {
			log.Printf("engine: SKIP %s — config still has TODO placeholders", a.Symbol)
			continue
		}
		e.byMint[a.Mint] = &assetState{
			cfg: a,
			// 60 one-minute buckets = 1h baseline for the velocity z-score.
			velocity: scoring.NewVelocityWindow(60),
		}
	}
	return e
}

// HandleMintBurn implements helius.Handler.
func (e *engine) HandleMintBurn(ev helius.Event) {
	st, ok := e.byMint[ev.Mint]
	if !ok {
		return
	}
	net := ev.Amount
	if ev.Kind == helius.KindBurn {
		net = -net
	}
	st.velocity.Add(net)
	log.Printf("event: %s %s amount=%.4f sig=%s", st.cfg.Symbol, ev.Kind, ev.Amount, ev.Signature)

	// Recompute immediately so procurement spikes surface without waiting for
	// the ticker.
	e.recompute(context.Background(), st)
}

// refreshAll re-reads price + liquidity for every ready asset (ticker path).
func (e *engine) refreshAll(ctx context.Context) {
	e.prefetchPythPro(ctx)
	e.prefetchPreStocks(ctx)
	e.prefetchReferences(ctx)
	for _, st := range e.byMint {
		e.refreshSignals(ctx, st)
		e.recompute(ctx, st)
	}
}

// refreshSignals pulls fresh price + liquidity data into the asset state.
func (e *engine) refreshSignals(ctx context.Context, st *assetState) {
	snap, err := e.pool.ReadMarket(ctx, st.cfg.PrimaryDex, st.cfg.Mint)
	if err != nil {
		log.Printf("refresh: %s market read: %v", st.cfg.Symbol, err)
		return
	}

	// Premium is only meaningful when a reference feed exists (SPCX has none)
	// AND the DEX price is reliable (thin markets like CRCLon price 1 token at
	// ~$0, which would read as a bogus -100% premium — skip it there).
	premiumBps := int32(0)
	if st.cfg.HasPriceFeed() && snap.PriceReliable {
		if ref, ok := e.referenceUSD(ctx, st); ok {
			premiumBps = pyth.PremiumBps(snap.TokenPriceUSD, ref)
		}
	}

	var tokenUSD float64
	if st.proTokenID != 0 {
		e.proMu.RLock()
		if q, ok := e.proQuotes[st.proTokenID]; ok {
			tokenUSD = q.Price
		}
		e.proMu.RUnlock()
	}

	st.mu.Lock()
	st.lastPremiumBps = premiumBps
	st.lastDepthUSD = snap.DepthUSD
	st.lastPythTokenUSD = tokenUSD
	st.marketRead = true
	st.mu.Unlock()
}

// referenceUSD resolves the underlying stock's price, preferring Pyth and
// falling back to Jupiter.
//
// Pyth's public Hermes host began returning 401 in Sept 2026 (both
// /v2/updates/price/latest and /api/latest_price_feeds, on the main host and on
// hermes-beta), which silently zeroed the premium component for every asset.
// Jupiter's price v3 carries the underlying share price for all tracked mints
// in one unauthenticated call, so it stands in unless an authenticated
// HERMES_URL is configured. The Hermes failure is logged once per asset rather
// than on every refresh, so a gated key doesn't drown the log.
func (e *engine) referenceUSD(ctx context.Context, st *assetState) (float64, bool) {
	// PreStocks tokens track private companies no oracle prices, so their only
	// reference is the issuer's published mark, read from PreStocks directly.
	// No fallback: Jupiter's stockData for these mints (id "prestocks") is the
	// same mark relayed, so it adds a hop without adding a second opinion.
	if st.cfg.PreStocks {
		e.preMu.RLock()
		m, ok := e.preMarks[st.cfg.Mint]
		e.preMu.RUnlock()
		if ok {
			e.noteSource(st, "prestocks-mark")
		}
		return m.MarkPrice, ok
	}
	// 1. Pyth Pro: the real share's price from first-party publishers.
	if st.proUnderlyingID != 0 {
		e.proMu.RLock()
		q, ok := e.proQuotes[st.proUnderlyingID]
		e.proMu.RUnlock()
		if ok && q.Price > 0 {
			e.noteSource(st, "pyth-pro ("+q.Session+")")
			return q.Price, true
		}
	}
	// 2. Hermes, if an authenticated HERMES_URL is configured.
	if st.cfg.PythFeedID != "" {
		if p, err := e.pyth.GetPrice(ctx, st.cfg.PythFeedID); err == nil {
			e.noteSource(st, "hermes")
			return p.Price, true
		} else if !st.warnedPyth {
			log.Printf("refresh: %s hermes unavailable (%v)", st.cfg.Symbol, err)
			st.warnedPyth = true
		}
	}
	// 3. Jupiter's stockData price.
	e.refMu.RLock()
	ref, ok := e.refPrices[st.cfg.Mint]
	e.refMu.RUnlock()
	if ok {
		e.noteSource(st, "jupiter")
	}
	return ref, ok
}

// noteSource logs when an asset's reference price changes provider.
func (e *engine) noteSource(st *assetState, src string) {
	if st.refSource != src {
		log.Printf("refresh: %s reference price source: %s", st.cfg.Symbol, src)
		st.refSource = src
	}
}

// prefetchPythPro resolves feed symbols on first use, then reads every
// entitled feed in one batch per cycle. Feeds the key isn't entitled to are
// skipped quietly and re-probed later by the client, so access granted mid-run
// takes effect on its own.
func (e *engine) prefetchPythPro(ctx context.Context) {
	if !e.pro.Enabled() {
		return
	}
	var ids []uint32
	for _, st := range e.byMint {
		for _, pair := range []struct {
			sym string
			dst *uint32
		}{{st.cfg.PythProUnderlying, &st.proUnderlyingID}, {st.cfg.PythProToken, &st.proTokenID}} {
			if pair.sym == "" {
				continue
			}
			if *pair.dst == 0 {
				id, err := e.pro.Resolve(ctx, pair.sym)
				if err != nil {
					log.Printf("pyth pro: %s %q: %v", st.cfg.Symbol, pair.sym, err)
					continue
				}
				*pair.dst = id
			}
			ids = append(ids, *pair.dst)
		}
	}
	if len(ids) == 0 {
		return
	}
	quotes, err := e.pro.Latest(ctx, ids)
	if err != nil {
		log.Printf("pyth pro: latest: %v (keeping previous)", err)
		return
	}
	readable := 0
	for _, id := range ids {
		if e.pro.Entitled(id) {
			readable++
		}
	}
	if readable < len(ids) {
		log.Printf("pyth pro: key entitled to %d of %d configured feeds; the rest fall back to Hermes/Jupiter", readable, len(ids))
	}
	e.proMu.Lock()
	e.proQuotes = quotes
	e.proMu.Unlock()
}

// prefetchReferences pulls every tracked mint's underlying stock price in a
// single Jupiter call at the start of each refresh cycle. On failure the
// previous cycle's map is kept rather than cleared, so one transient error
// doesn't zero the premium component across the board.
// prefetchPreStocks reads PreStocks' mark list once per cycle, and only when a
// PreStocks token is configured. On failure the previous marks are kept, so a
// blip doesn't zero the premium for every private-company token at once.
func (e *engine) prefetchPreStocks(ctx context.Context) {
	var want []*assetState
	for _, st := range e.byMint {
		if st.cfg.PreStocks {
			want = append(want, st)
		}
	}
	if len(want) == 0 {
		return
	}
	marks, err := e.preStocks.Marks(ctx)
	if err != nil {
		log.Printf("refresh: prestocks marks: %v (keeping previous)", err)
		return
	}
	for _, st := range want {
		if _, ok := marks[st.cfg.Mint]; !ok {
			log.Printf("refresh: %s not in PreStocks list (delisted or wrong mint?)", st.cfg.Symbol)
		}
	}
	e.preMu.Lock()
	e.preMarks = marks
	e.preMu.Unlock()
}

func (e *engine) prefetchReferences(ctx context.Context) {
	mints := make([]string, 0, len(e.byMint))
	for mint := range e.byMint {
		mints = append(mints, mint)
	}
	prices, err := e.pool.ReferencePricesUSD(ctx, mints)
	if err != nil {
		log.Printf("refresh: reference prices: %v (keeping previous)", err)
		return
	}
	e.refMu.Lock()
	e.refPrices = prices
	e.refMu.Unlock()
}

// recompute scores the current state and pushes downstream if warranted.
func (e *engine) recompute(ctx context.Context, st *assetState) {
	st.mu.Lock()
	if !st.marketRead {
		st.mu.Unlock()
		return
	}
	sig := scoring.Signals{
		PremiumBps:        st.lastPremiumBps,
		LiquidityDepthUSD: st.lastDepthUSD,
		MintBurnZ:         st.velocity.ZScoreX100(),
		TrustTier:         st.cfg.TrustTier,
	}
	st.mu.Unlock()

	comp := scoring.Compute(sig)

	// Log every computation, not just pushed ones. Previously the only score
	// line fired after a successful on-chain push, so a correctly-running
	// indexer with no authority keypair (or a score that simply hadn't moved)
	// looked identical to a broken one.
	exit := ""
	if scoring.NoExitMarket(sig.LiquidityDepthUSD) {
		exit = "  [no exit market: capped]"
	}
	log.Printf("scored: %-10s %3d (%s)  premium=%+dbps depth=$%d z=%.1f%s",
		st.cfg.Symbol, comp.Composite, scoring.Label(comp.Composite),
		sig.PremiumBps, sig.LiquidityDepthUSD, float64(sig.MintBurnZ)/100, exit)

	// Persist time series (best-effort).
	row := clickhouse.ScoreRow{
		Timestamp:         time.Now().UTC(),
		Mint:              st.cfg.Mint,
		Symbol:            st.cfg.Symbol,
		Score:             comp.Composite,
		PremiumBps:        sig.PremiumBps,
		LiquidityDepthUSD: sig.LiquidityDepthUSD,
		MintBurnZ:         sig.MintBurnZ,
		PriceComponent:    comp.Price,
		LiquidityComp:     comp.Liquidity,
		ProcurementComp:   comp.Procurement,
		TrustTierComp:     comp.TrustTier,
	}
	if err := e.ch.Write(ctx, row); err != nil {
		log.Printf("recompute: %s clickhouse write: %v", st.cfg.Symbol, err)
	}

	// Alert on risk-band transitions (independent of the on-chain push gate — a
	// 60->59 move is only 1 point but crosses "Watch" -> "Warning", which a
	// holder wants to know about). First observation just sets the baseline.
	e.maybeAlert(ctx, st, comp.Composite, sig)

	// Push on-chain only if the score moved past the threshold.
	st.mu.Lock()
	changed := !st.hasPushed || absDiff(comp.Composite, st.lastPushedScore) > e.cfg.ScoreChangeThreshold
	st.mu.Unlock()
	if !changed {
		return
	}

	_, err := e.chain.UpdateScore(ctx, anchor.ScoreUpdate{
		Mint:              st.cfg.Mint,
		Score:             comp.Composite,
		PremiumBps:        sig.PremiumBps,
		LiquidityDepthUSD: sig.LiquidityDepthUSD,
		MintBurnZ:         sig.MintBurnZ,
	})
	if err != nil {
		log.Printf("recompute: %s update_score: %v", st.cfg.Symbol, err)
		return
	}
	st.mu.Lock()
	st.lastPushedScore = comp.Composite
	st.hasPushed = true
	st.mu.Unlock()
	log.Printf("pushed: %s score=%d (%s)", st.cfg.Symbol, comp.Composite, scoring.Label(comp.Composite))
}

func absDiff(a, b uint8) uint8 {
	if a > b {
		return a - b
	}
	return b - a
}

// maybeAlert fires a Telegram notification when an asset crosses a risk band.
func (e *engine) maybeAlert(ctx context.Context, st *assetState, score uint8, sig scoring.Signals) {
	if !e.alert.Enabled() {
		return
	}
	band := scoring.Band(score)

	st.mu.Lock()
	prevBand, had := st.lastBand, st.hasBand
	st.lastBand, st.hasBand = band, true
	st.mu.Unlock()

	if !had || band == prevBand {
		return // baseline, or no band change
	}

	worsened := band < prevBand
	arrow := "🟢"
	verb := "recovered to"
	if worsened {
		arrow = "🔻"
		verb = "dropped to"
	}
	premium := "n/a"
	if st.cfg.HasPriceFeed() && !scoring.NoExitMarket(sig.LiquidityDepthUSD) {
		premium = fmt.Sprintf("%+.2f%%", float64(sig.PremiumBps)/100)
	}
	msg := fmt.Sprintf(
		"%s *%s* %s *%s* (%d/100)\nwas _%s_\n\npremium %s · 1%% depth $%s · mint/burn %.2fσ\n\n[open dashboard](%s)",
		arrow, st.cfg.Symbol, verb, scoring.Label(score), score,
		scoring.Label(bandFloor(prevBand)),
		premium, fmtUSDShort(sig.LiquidityDepthUSD), float64(sig.MintBurnZ)/100,
		e.cfg.DashboardURL,
	)
	if err := e.alert.Send(ctx, msg); err != nil {
		log.Printf("alert: %s send: %v", st.cfg.Symbol, err)
		return
	}
	log.Printf("alert: %s %s->%s band %d->%d", st.cfg.Symbol, verb, scoring.Label(score), prevBand, band)
}

// bandFloor returns a representative score for a band (for labeling the prior band).
func bandFloor(band int) uint8 {
	switch band {
	case 3:
		return 80
	case 2:
		return 60
	case 1:
		return 40
	default:
		return 0
	}
}

func fmtUSDShort(n uint64) string {
	switch {
	case n >= 1_000_000:
		return fmt.Sprintf("%.1fM", float64(n)/1_000_000)
	case n >= 1_000:
		return fmt.Sprintf("%.1fk", float64(n)/1_000)
	default:
		return fmt.Sprintf("%d", n)
	}
}

func main() {
	assetsPath := flag.String("assets", "config/assets.json", "path to assets.json")
	once := flag.Bool("once", false, "run a single scoring cycle for all assets, then exit")
	flag.Parse()

	cfg, err := config.Load(*assetsPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	log.Printf("loaded %d assets (cluster=%s)", len(cfg.Registry.Assets), cfg.Registry.Cluster)
	if cfg.TelegramBotToken != "" && cfg.TelegramChatID != "" {
		log.Printf("telegram alerts: enabled")
	} else {
		log.Printf("telegram alerts: disabled (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)")
	}

	eng := newEngine(cfg)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Connect ClickHouse (no-op if CLICKHOUSE_DSN unset). Non-fatal: the engine
	// still scores and pushes on-chain without the time series.
	if err := eng.ch.Connect(ctx); err != nil {
		log.Printf("startup: clickhouse connect failed (continuing without time series): %v", err)
	}
	defer func() { _ = eng.ch.Close() }()

	// --once: run a single scoring cycle across all ready assets, then exit.
	// Used to seed/refresh scores on demand (e.g. staging the devnet demo).
	if *once {
		log.Println("running single scoring cycle (--once)")
		eng.refreshAll(ctx)
		log.Println("single cycle complete")
		return
	}

	// Step 1: verify tracked mints exist on-chain.
	for mint, st := range eng.byMint {
		if err := eng.chain.VerifyMintExists(ctx, mint); err != nil {
			log.Printf("startup: could not verify mint %s (%s): %v", st.cfg.Symbol, mint, err)
		}
	}

	// Step 2: webhook server.
	mux := http.NewServeMux()
	trackedMints := make([]string, 0, len(eng.byMint))
	for m := range eng.byMint {
		trackedMints = append(trackedMints, m)
	}
	mux.Handle("/webhook", helius.NewWebhookServer(cfg.HeliusWebhookSecret, eng, trackedMints))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		log.Printf("webhook server listening on %s", cfg.ListenAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server: %v", err)
		}
	}()

	// Step 3: 60s refresh ticker + velocity-bucket roll.
	interval := time.Duration(cfg.RefreshIntervalSecs) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				eng.refreshAll(ctx)
				for _, st := range eng.byMint {
					st.velocity.Roll()
				}
			}
		}
	}()

	<-ctx.Done()
	log.Println("shutting down...")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	os.Exit(0)
}
