// Package pool derives on-chain token price and liquidity depth.
//
// RESEARCH FINDING (2026-07): the tracked tokens are canonical SPL mints whose
// liquidity is spread across MANY AMM pools (Meteora-dominant) and aggregated
// by Jupiter — there is no single pool to read. So instead of decoding one
// Raydium account, we derive:
//   - price  = Jupiter quote of 1 token -> USDC, and
//   - 1% depth = binary-search the sell size at which each token fetches 1%
//     less than a single token does (a true multi-venue executable depth
//     number, computed from quoted amounts only).
package pool

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"

	"github.com/gagliardetto/solana-go"
	"github.com/gagliardetto/solana-go/rpc"
)

// usdcMint is the quote asset for pricing/depth (6 decimals).
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"

const (
	// targetSlippage is the per-token shortfall vs a 1-token sale that
	// defines "depth" (1%).
	targetSlippage = 0.01
	// rampFactor grows the probe size each step while bracketing the 1% point.
	// Larger factor = fewer HTTP calls (the free Jupiter endpoint rate-limits).
	rampFactor = 8
	// maxRampSteps caps the exponential ramp (guards against runaway sizes).
	maxRampSteps = 12
	// refineIters is the binary-search refinement once the point is bracketed.
	refineIters = 4
	// minQuoteInterval spaces Jupiter calls to stay under the public rate limit.
	// 450ms held for 6 assets but drew 429s past retries at 14, and 700ms still
	// hit the limit ~100 quotes into a cycle (Sept 2026).
	minQuoteInterval = time.Second
	// quoteAttempts bounds retries of a throttled or transiently failing quote.
	quoteAttempts = 4
	// retryBackoff is the first retry delay; it doubles on each further attempt.
	retryBackoff = 5 * time.Second
)

// BUG FIX (2026-09): a single rate-limited (429) quote mid-search used to end
// the ramp and return the last size that had succeeded. CRCLx read $700 of 1%
// depth (the 8-token probe) against a real ~$100k+, and because $700 sits under
// priceReliableFloorUSD its -2% discount to CRCL was dropped too. Transient
// failures are now retried, and a search that still cannot finish returns an
// error, so the engine keeps its previous reading instead of storing a
// truncated one. Only Jupiter's NO_ROUTES_FOUND counts as "the market ends here".

// priceReliableFloorUSD: below this 1%-depth, the DEX has too little liquidity
// to price the token meaningfully — a 1-token quote returns near-zero, which
// would otherwise read as a bogus ~-100% "premium". When depth is under this
// floor we flag the price unreliable so the engine skips the premium signal
// (the liquidity component already captures the "no market" risk).
const priceReliableFloorUSD = 1_000

// Snapshot is a single read of an asset's market state.
type Snapshot struct {
	// TokenPriceUSD is the current token price (Jupiter quote of 1 token).
	TokenPriceUSD float64
	// DepthUSD is the USD realizable selling the size at which each token
	// fetches ~1% less than a single token (executable, across all venues via
	// Jupiter). This is the liquidity signal into scoring.
	DepthUSD uint64
	// PriceReliable is false when the DEX is too thin to trust the price.
	PriceReliable bool
}

// Reader derives price + depth for a mint.
type Reader struct {
	rpc        *rpc.Client
	http       *http.Client
	jupiterURL string

	mu    sync.Mutex
	mints map[string]mintInfo // mint -> decimals + UI multiplier cache

	throttleMu sync.Mutex
	lastQuote  time.Time

	// quoteInterval and backoff default to the constants above; tests shrink them.
	quoteInterval time.Duration
	backoff       time.Duration
}

// NewReader takes the Solana RPC URL (used to look up token decimals).
func NewReader(rpcURL string) *Reader {
	return &Reader{
		rpc:           rpc.New(rpcURL),
		http:          &http.Client{Timeout: 15 * time.Second},
		jupiterURL:    "https://lite-api.jup.ag",
		mints:         make(map[string]mintInfo),
		quoteInterval: minQuoteInterval,
		backoff:       retryBackoff,
	}
}

type jupQuote struct {
	OutAmount string `json:"outAmount"`
	ErrorCode string `json:"errorCode"`
	err       error
	noRoute   bool
}

// ReadMarket derives price + 1% depth for a mint. `venue` currently only
// supports "jupiter"; other venues fall through to the same path.
func (r *Reader) ReadMarket(ctx context.Context, venue, mint string) (Snapshot, error) {
	info, err := r.getMintInfo(ctx, mint)
	if err != nil {
		return Snapshot{}, fmt.Errorf("mint info: %w", err)
	}
	oneToken := uint64(math.Pow(10, float64(info.decimals)))

	// Price = quote of exactly 1 raw token -> USDC (USDC has 6 decimals),
	// divided by the UI multiplier so it's per token as holders and issuers
	// count them.
	//
	// BUG FIX (2026-09): PreStocks mints carry scheduled multipliers (SPACEX
	// 5 from June 2026, OPENAI 1.4861347 from July 2026). Unscaled, SPACEX
	// read $553 against a $143 mark (+286%) and OPENAI +71%; per UI token
	// they trade at $110.6 (-23%) and ~$1,098 (+15%). Depth is unaffected: it
	// is USD out, and every size is quoted in the same raw units.
	q1 := r.quote(ctx, mint, oneToken)
	if q1.err != nil {
		return Snapshot{}, fmt.Errorf("price quote: %w", q1.err)
	}
	out1, _ := strconv.ParseFloat(q1.OutAmount, 64)
	price := out1 / 1e6 / info.uiMultiplier(time.Now())

	// Reuse the 1-token quote as the depth search seed (saves a call).
	depthUSD, err := r.searchDepthUSD(ctx, mint, oneToken, out1)
	if err != nil {
		return Snapshot{}, fmt.Errorf("depth search: %w", err)
	}
	return Snapshot{
		TokenPriceUSD: price,
		DepthUSD:      depthUSD,
		PriceReliable: price > 0 && depthUSD >= priceReliableFloorUSD,
	}, nil
}

// searchDepthUSD finds the sell size at which each token fetches ~1% less than
// a single token does, and returns the USDC (~USD) realizable at that size. It
// first ramps the size up exponentially to bracket the 1% point (avoiding
// wasted probes at un-routable sizes), then binary-searches within the bracket.
// Seeded by the 1-token quote so the result is never spuriously zero. A quote
// that fails even after retries aborts the search with an error rather than
// returning a truncated depth.
//
// METHOD CHANGE (2026-09): slippage is measured from quoted amounts against
// the 1-token sale, not from Jupiter's priceImpactPct. priceImpactPct includes
// the venue's bid/ask spread, so on orderbook-routed tokens it never drops
// under 1%: ANDURIL (PreStocks) reported 1.47% "impact" selling 0.01 tokens
// and read as $158 of depth, while 512 tokens ($75k) sold only 7% below the
// 1-token price. The spread is still counted where it belongs, in the price
// the premium signal compares against the reference.
func (r *Reader) searchDepthUSD(ctx context.Context, mint string, oneToken uint64, seedOut float64) (uint64, error) {
	if seedOut <= 0 {
		// Not even one token sells: there is no market to measure.
		return 0, nil
	}
	unitOut := seedOut / float64(oneToken)
	slippage := func(size uint64, out float64) float64 {
		return 1 - (out/float64(size))/unitOut
	}

	// Seed with the caller's known-good 1-token quote (avoids a redundant call).
	lastGoodOut := seedOut
	lastGoodSize := oneToken

	// Ramp up until impact crosses the target or the router can't fill it.
	var badSize uint64
	size := oneToken
	for i := 0; i < maxRampSteps; i++ {
		next := size * rampFactor
		q := r.quote(ctx, mint, next)
		if q.err != nil {
			return 0, q.err
		}
		if q.noRoute {
			badSize = next
			break
		}
		out, _ := strconv.ParseFloat(q.OutAmount, 64)
		if slippage(next, out) < targetSlippage {
			lastGoodSize, lastGoodOut = next, out
			size = next
			continue
		}
		badSize = next
		break
	}

	// Refine within [lastGoodSize, badSize] if we bracketed the crossing.
	if badSize > lastGoodSize {
		lo, hi := lastGoodSize, badSize
		for i := 0; i < refineIters; i++ {
			mid := lo + (hi-lo)/2
			if mid <= lo {
				break
			}
			q := r.quote(ctx, mint, mid)
			if q.err != nil {
				return 0, q.err
			}
			if q.noRoute {
				hi = mid
				continue
			}
			out, _ := strconv.ParseFloat(q.OutAmount, 64)
			if slippage(mid, out) < targetSlippage {
				lo = mid
				lastGoodOut = out
			} else {
				hi = mid
			}
		}
	}
	return uint64(lastGoodOut / 1e6), nil
}

// throttle spaces successive Jupiter requests to respect the free-tier limit.
func (r *Reader) throttle() {
	r.throttleMu.Lock()
	defer r.throttleMu.Unlock()
	if wait := r.quoteInterval - time.Since(r.lastQuote); wait > 0 {
		time.Sleep(wait)
	}
	r.lastQuote = time.Now()
}

// quote calls Jupiter's quote endpoint for `amount` base units of mint->USDC,
// retrying rate limits (429), server errors and network failures with
// exponential backoff. A definitive answer (a quote or no route) returns at once.
func (r *Reader) quote(ctx context.Context, mint string, amount uint64) jupQuote {
	delay := r.backoff
	var last jupQuote
	for attempt := 1; attempt <= quoteAttempts; attempt++ {
		last = r.quoteOnce(ctx, mint, amount)
		if last.err == nil || !last.retryable() {
			return last
		}
		if attempt < quoteAttempts {
			select {
			case <-ctx.Done():
				return jupQuote{err: ctx.Err()}
			case <-time.After(delay):
			}
			delay *= 2
		}
	}
	last.err = fmt.Errorf("after %d attempts: %w", quoteAttempts, last.err)
	return last
}

// errRetryable marks failures worth another attempt.
var errRetryable = errors.New("retryable")

func (q jupQuote) retryable() bool { return errors.Is(q.err, errRetryable) }

func (r *Reader) quoteOnce(ctx context.Context, mint string, amount uint64) jupQuote {
	r.throttle()
	q := url.Values{}
	q.Set("inputMint", mint)
	q.Set("outputMint", usdcMint)
	q.Set("amount", strconv.FormatUint(amount, 10))
	q.Set("slippageBps", "100")
	endpoint := fmt.Sprintf("%s/swap/v1/quote?%s", r.jupiterURL, q.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return jupQuote{err: err}
	}
	resp, err := r.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return jupQuote{err: ctx.Err()}
		}
		return jupQuote{err: fmt.Errorf("%w: %v", errRetryable, err)}
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
		return jupQuote{err: fmt.Errorf("%w: jupiter status %d", errRetryable, resp.StatusCode)}
	}

	var out jupQuote
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return jupQuote{err: fmt.Errorf("jupiter status %d, decode: %w", resp.StatusCode, err)}
	}
	if resp.StatusCode == http.StatusBadRequest {
		// Jupiter answers 400 NO_ROUTES_FOUND when nothing can fill the size;
		// any other 400 is a malformed request, not a thin market.
		if out.ErrorCode == "NO_ROUTES_FOUND" {
			return jupQuote{noRoute: true}
		}
		return jupQuote{err: fmt.Errorf("jupiter 400 %s", out.ErrorCode)}
	}
	if resp.StatusCode != http.StatusOK {
		return jupQuote{err: fmt.Errorf("jupiter status %d", resp.StatusCode)}
	}
	if out.OutAmount == "" {
		return jupQuote{noRoute: true}
	}
	return out
}

// mintInfoTTL bounds how long a mint's decimals and UI multiplier are cached.
// Multipliers change on a schedule the issuer sets, so they can't be cached
// forever; an hour keeps RPC load negligible.
const mintInfoTTL = time.Hour

// mintInfo is what pricing needs from a mint account.
type mintInfo struct {
	decimals uint8
	// Token-2022 scaledUiAmountConfig. Wallets and issuers show balances as
	// raw amount x multiplier; Jupiter quotes raw amounts. Zero values mean
	// no extension (multiplier 1).
	multiplier    float64
	newMultiplier float64
	newEffective  int64 // unix seconds
	fetched       time.Time
}

// uiMultiplier is the multiplier in force at `now`. The chain doesn't rewrite
// `multiplier` when a scheduled change takes effect; readers apply
// newMultiplier once its timestamp has passed.
func (m mintInfo) uiMultiplier(now time.Time) float64 {
	mult := m.multiplier
	if m.newMultiplier > 0 && m.newEffective > 0 && now.Unix() >= m.newEffective {
		mult = m.newMultiplier
	}
	if mult <= 0 {
		return 1
	}
	return mult
}

type parsedMint struct {
	Value *struct {
		Data struct {
			Parsed struct {
				Info struct {
					Decimals   uint8 `json:"decimals"`
					Extensions []struct {
						Extension string `json:"extension"`
						State     struct {
							Multiplier                      string `json:"multiplier"`
							NewMultiplier                   string `json:"newMultiplier"`
							NewMultiplierEffectiveTimestamp int64  `json:"newMultiplierEffectiveTimestamp"`
						} `json:"state"`
					} `json:"extensions"`
				} `json:"info"`
			} `json:"parsed"`
		} `json:"data"`
	} `json:"value"`
}

// getMintInfo fetches (and caches) a mint's decimals and UI multiplier.
func (r *Reader) getMintInfo(ctx context.Context, mint string) (mintInfo, error) {
	r.mu.Lock()
	// A zero fetched time marks an entry seeded without RPC (tests); keep it.
	if m, ok := r.mints[mint]; ok && (m.fetched.IsZero() || time.Since(m.fetched) < mintInfoTTL) {
		r.mu.Unlock()
		return m, nil
	}
	r.mu.Unlock()

	if _, err := solana.PublicKeyFromBase58(mint); err != nil {
		return mintInfo{}, err
	}
	var res parsedMint
	params := []any{mint, map[string]any{"encoding": "jsonParsed", "commitment": "confirmed"}}
	if err := r.rpc.RPCCallForInto(ctx, &res, "getAccountInfo", params); err != nil {
		return mintInfo{}, err
	}
	if res.Value == nil {
		return mintInfo{}, fmt.Errorf("mint %s not found", mint)
	}
	info := res.Value.Data.Parsed.Info
	m := mintInfo{decimals: info.Decimals, fetched: time.Now()}
	for _, ext := range info.Extensions {
		if ext.Extension != "scaledUiAmountConfig" {
			continue
		}
		m.multiplier, _ = strconv.ParseFloat(ext.State.Multiplier, 64)
		m.newMultiplier, _ = strconv.ParseFloat(ext.State.NewMultiplier, 64)
		m.newEffective = ext.State.NewMultiplierEffectiveTimestamp
	}

	r.mu.Lock()
	r.mints[mint] = m
	r.mu.Unlock()
	return m, nil
}
