// Package pool derives on-chain token price and liquidity depth.
//
// RESEARCH FINDING (2026-07): the tracked tokens are canonical SPL mints whose
// liquidity is spread across MANY AMM pools (Meteora-dominant) and aggregated
// by Jupiter — there is no single pool to read. So instead of decoding one
// Raydium account, we derive:
//   - price  = Jupiter quote of 1 token -> USDC, and
//   - 1% depth = binary-search the input size whose quoted priceImpactPct
//     crosses 1% (a true multi-venue executable depth number).
//
// Jupiter's priceImpactPct is a fraction (0.01 == 1%), calibrated live.
package pool

import (
	"context"
	"encoding/json"
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
	// targetImpact is the price-impact fraction that defines "depth" (1%).
	targetImpact = 0.01
	// rampFactor grows the probe size each step while bracketing the 1% point.
	// Larger factor = fewer HTTP calls (the free Jupiter endpoint rate-limits).
	rampFactor = 8
	// maxRampSteps caps the exponential ramp (guards against runaway sizes).
	maxRampSteps = 12
	// refineIters is the binary-search refinement once the point is bracketed.
	refineIters = 4
	// minQuoteInterval spaces Jupiter calls to stay under the public rate limit.
	minQuoteInterval = 450 * time.Millisecond
)

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
	// DepthUSD is the USD notional required to move the price ~1% (executable,
	// across all venues via Jupiter). This is the liquidity signal into scoring.
	DepthUSD uint64
	// PriceReliable is false when the DEX is too thin to trust the price.
	PriceReliable bool
}

// Reader derives price + depth for a mint.
type Reader struct {
	rpc        *rpc.Client
	http       *http.Client
	jupiterURL string

	mu       sync.Mutex
	decimals map[string]uint8 // mint -> decimals cache

	throttleMu sync.Mutex
	lastQuote  time.Time
}

// NewReader takes the Solana RPC URL (used to look up token decimals).
func NewReader(rpcURL string) *Reader {
	return &Reader{
		rpc:        rpc.New(rpcURL),
		http:       &http.Client{Timeout: 15 * time.Second},
		jupiterURL: "https://lite-api.jup.ag",
		decimals:   make(map[string]uint8),
	}
}

type jupQuote struct {
	OutAmount      string `json:"outAmount"`
	PriceImpactPct string `json:"priceImpactPct"`
	err            error
	noRoute        bool
}

// ReadMarket derives price + 1% depth for a mint. `venue` currently only
// supports "jupiter"; other venues fall through to the same path.
func (r *Reader) ReadMarket(ctx context.Context, venue, mint string) (Snapshot, error) {
	dec, err := r.getDecimals(ctx, mint)
	if err != nil {
		return Snapshot{}, fmt.Errorf("decimals: %w", err)
	}
	oneToken := uint64(math.Pow(10, float64(dec)))

	// Price = quote of exactly 1 token -> USDC (USDC has 6 decimals).
	q1 := r.quote(ctx, mint, oneToken)
	if q1.err != nil {
		return Snapshot{}, fmt.Errorf("price quote: %w", q1.err)
	}
	out1, _ := strconv.ParseFloat(q1.OutAmount, 64)
	price := out1 / 1e6

	// Reuse the 1-token quote as the depth search seed (saves a call).
	depthUSD := r.searchDepthUSD(ctx, mint, oneToken, out1)
	return Snapshot{
		TokenPriceUSD: price,
		DepthUSD:      depthUSD,
		PriceReliable: price > 0 && depthUSD >= priceReliableFloorUSD,
	}, nil
}

// searchDepthUSD finds the input size whose price impact ~= 1% and returns the
// USDC (~USD) realizable at that size. It first ramps the size up exponentially
// to bracket the 1% point (avoiding wasted probes at un-routable sizes), then
// binary-searches within the bracket. Seeded by the 1-token quote so the result
// is never spuriously zero.
func (r *Reader) searchDepthUSD(ctx context.Context, mint string, oneToken uint64, seedOut float64) uint64 {
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
			break
		}
		if q.noRoute {
			badSize = next
			break
		}
		impact, _ := strconv.ParseFloat(q.PriceImpactPct, 64)
		if impact < targetImpact {
			out, _ := strconv.ParseFloat(q.OutAmount, 64)
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
			if q.err != nil || q.noRoute {
				hi = mid
				continue
			}
			impact, _ := strconv.ParseFloat(q.PriceImpactPct, 64)
			if impact < targetImpact {
				lo = mid
				lastGoodOut, _ = strconv.ParseFloat(q.OutAmount, 64)
			} else {
				hi = mid
			}
		}
	}
	return uint64(lastGoodOut / 1e6)
}

// throttle spaces successive Jupiter requests to respect the free-tier limit.
func (r *Reader) throttle() {
	r.throttleMu.Lock()
	defer r.throttleMu.Unlock()
	if wait := minQuoteInterval - time.Since(r.lastQuote); wait > 0 {
		time.Sleep(wait)
	}
	r.lastQuote = time.Now()
}

// quote calls Jupiter's quote endpoint for `amount` base units of mint->USDC.
func (r *Reader) quote(ctx context.Context, mint string, amount uint64) jupQuote {
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
		return jupQuote{err: err}
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusBadRequest {
		// Jupiter returns 400 when no route can fill the requested size.
		return jupQuote{noRoute: true}
	}
	if resp.StatusCode != http.StatusOK {
		return jupQuote{err: fmt.Errorf("jupiter status %d", resp.StatusCode)}
	}
	var out jupQuote
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return jupQuote{err: err}
	}
	if out.OutAmount == "" {
		return jupQuote{noRoute: true}
	}
	return out
}

// getDecimals fetches (and caches) a mint's decimals via getTokenSupply.
func (r *Reader) getDecimals(ctx context.Context, mint string) (uint8, error) {
	r.mu.Lock()
	if d, ok := r.decimals[mint]; ok {
		r.mu.Unlock()
		return d, nil
	}
	r.mu.Unlock()

	pk, err := solana.PublicKeyFromBase58(mint)
	if err != nil {
		return 0, err
	}
	res, err := r.rpc.GetTokenSupply(ctx, pk, rpc.CommitmentConfirmed)
	if err != nil {
		return 0, err
	}
	dec := res.Value.Decimals

	r.mu.Lock()
	r.decimals[mint] = dec
	r.mu.Unlock()
	return dec, nil
}
