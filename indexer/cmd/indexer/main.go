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
	"log"
	"net/http"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/reserve-sentinel/indexer/internal/anchor"
	"github.com/reserve-sentinel/indexer/internal/clickhouse"
	"github.com/reserve-sentinel/indexer/internal/config"
	"github.com/reserve-sentinel/indexer/internal/helius"
	"github.com/reserve-sentinel/indexer/internal/pool"
	"github.com/reserve-sentinel/indexer/internal/pyth"
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
	// latest observed signals (refreshed by ticker + webhooks).
	lastPremiumBps int32
	lastDepthUSD   uint64
}

// engine wires the signal sources to scoring and the sinks.
type engine struct {
	cfg    *config.Config
	pyth   *pyth.Client
	pool   *pool.Reader
	ch     *clickhouse.Writer
	chain  *anchor.Client
	byMint map[string]*assetState
}

func newEngine(cfg *config.Config) *engine {
	e := &engine{
		cfg:    cfg,
		pyth:   pyth.NewClient(cfg.HermesURL),
		pool:   pool.NewReader(cfg.DataRPCURL),
		ch:     clickhouse.NewWriter(cfg.ClickHouseDSN),
		chain:  anchor.NewClient(cfg.RPCURL, cfg.ProgramID, cfg.AuthorityKeypairPath),
		byMint: make(map[string]*assetState),
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
		ref, err := e.pyth.GetPrice(ctx, st.cfg.PythFeedID)
		if err != nil {
			log.Printf("refresh: %s pyth read: %v", st.cfg.Symbol, err)
		} else {
			premiumBps = pyth.PremiumBps(snap.TokenPriceUSD, ref.Price)
		}
	}

	st.mu.Lock()
	st.lastPremiumBps = premiumBps
	st.lastDepthUSD = snap.DepthUSD
	st.mu.Unlock()
}

// recompute scores the current state and pushes downstream if warranted.
func (e *engine) recompute(ctx context.Context, st *assetState) {
	st.mu.Lock()
	sig := scoring.Signals{
		PremiumBps:        st.lastPremiumBps,
		LiquidityDepthUSD: st.lastDepthUSD,
		MintBurnZ:         st.velocity.ZScoreX100(),
		TrustTier:         st.cfg.TrustTier,
	}
	st.mu.Unlock()

	comp := scoring.Compute(sig)

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

func main() {
	assetsPath := flag.String("assets", "config/assets.json", "path to assets.json")
	once := flag.Bool("once", false, "run a single scoring cycle for all assets, then exit")
	flag.Parse()

	cfg, err := config.Load(*assetsPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	log.Printf("loaded %d assets (cluster=%s)", len(cfg.Registry.Assets), cfg.Registry.Cluster)

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
