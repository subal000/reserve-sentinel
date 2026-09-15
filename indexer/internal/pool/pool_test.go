package pool

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"
)

// fakeJupiter quotes a token worth $86.41 whose price impact grows linearly
// with size: 1% at 1,000 tokens. That puts the true 1% depth near $86k,
// the shape measured live for CRCLx. failOn lists 1-based request numbers
// that answer with `failStatus` instead of a quote.
type fakeJupiter struct {
	mu         sync.Mutex
	calls      int
	failOn     map[int]bool
	failStatus int
	maxTokens  float64 // sizes above this have no route (0 = unlimited)
	// spread is a flat bid/ask cost on every sale, which Jupiter folds into
	// priceImpactPct even for dust (orderbook venues like Manifest).
	spread float64
}

const (
	fakeDecimals = 8
	fakePrice    = 86.41
)

func (f *fakeJupiter) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	f.mu.Lock()
	f.calls++
	n := f.calls
	f.mu.Unlock()

	if f.failOn[n] {
		w.WriteHeader(f.failStatus)
		return
	}
	amount, _ := strconv.ParseFloat(req.URL.Query().Get("amount"), 64)
	tokens := amount / 1e8
	if f.maxTokens > 0 && tokens > f.maxTokens {
		w.WriteHeader(http.StatusBadRequest)
		fmt.Fprint(w, `{"error":"No routes found","errorCode":"NO_ROUTES_FOUND"}`)
		return
	}
	impact := tokens / 100_000
	out := tokens * fakePrice * (1 - f.spread) * (1 - impact) * 1e6
	fmt.Fprintf(w, `{"outAmount":"%d","priceImpactPct":"%g"}`, uint64(out), impact+f.spread)
}

func newTestReader(url string) *Reader {
	return &Reader{
		http:          &http.Client{Timeout: 5 * time.Second},
		jupiterURL:    url,
		mints:         map[string]mintInfo{"MINT": {decimals: fakeDecimals}},
		quoteInterval: 0,
		backoff:       time.Millisecond,
	}
}

func TestDepthSurvivesRateLimitMidSearch(t *testing.T) {
	// Request 1 is the 1-token price quote, 2 the 8-token probe, 3 the
	// 64-token probe: the step that was rate-limited in the $700 reading.
	fake := &fakeJupiter{failOn: map[int]bool{3: true, 4: true}, failStatus: http.StatusTooManyRequests}
	srv := httptest.NewServer(fake)
	defer srv.Close()

	snap, err := newTestReader(srv.URL).ReadMarket(context.Background(), "jupiter", "MINT")
	if err != nil {
		t.Fatalf("ReadMarket: %v", err)
	}
	// The 1% point is 1,000 tokens (~$85.5k out). The search brackets it
	// between 512 and 4,096 tokens and refines 4 times, so the answer lands
	// within one refinement step below it.
	if snap.DepthUSD < 44_000 || snap.DepthUSD > 86_000 {
		t.Fatalf("depth = $%d, want roughly $44k-$86k (truncated searches read $691)", snap.DepthUSD)
	}
	if !snap.PriceReliable {
		t.Fatal("price flagged unreliable on a deep market")
	}
}

func TestDepthSearchFailsInsteadOfTruncating(t *testing.T) {
	// Every attempt at the 64-token probe fails: the read must error so the
	// engine keeps its previous value, never report the 8-token depth.
	fail := map[int]bool{}
	for i := 3; i < 3+quoteAttempts; i++ {
		fail[i] = true
	}
	srv := httptest.NewServer(&fakeJupiter{failOn: fail, failStatus: http.StatusBadGateway})
	defer srv.Close()

	snap, err := newTestReader(srv.URL).ReadMarket(context.Background(), "jupiter", "MINT")
	if err == nil {
		t.Fatalf("want error, got depth $%d", snap.DepthUSD)
	}
}

func TestNoRouteEndsTheMarket(t *testing.T) {
	// Liquidity stops at 100 tokens: 64 fills, 512 has no route. Depth is
	// what the last fillable size returned, and that is not an error.
	srv := httptest.NewServer(&fakeJupiter{maxTokens: 100})
	defer srv.Close()

	snap, err := newTestReader(srv.URL).ReadMarket(context.Background(), "jupiter", "MINT")
	if err != nil {
		t.Fatalf("ReadMarket: %v", err)
	}
	if snap.DepthUSD < 5_000 || snap.DepthUSD > 8_700 {
		t.Fatalf("depth = $%d, want between the 64-token ($5.5k) and 100-token ($8.6k) fills", snap.DepthUSD)
	}
}

func TestNoRouteAtAnySizeIsZeroDepth(t *testing.T) {
	// CRCLon today: Jupiter has no route even for a sliver of a token.
	srv := httptest.NewServer(&fakeJupiter{maxTokens: 0.001})
	defer srv.Close()

	snap, err := newTestReader(srv.URL).ReadMarket(context.Background(), "jupiter", "MINT")
	if err != nil {
		t.Fatalf("ReadMarket: %v", err)
	}
	if snap.DepthUSD != 0 || snap.PriceReliable {
		t.Fatalf("got depth $%d reliable=%v, want $0 and unreliable", snap.DepthUSD, snap.PriceReliable)
	}
}

func TestSpreadDoesNotEraseDepth(t *testing.T) {
	// ANDURIL (Sept 2026): Jupiter reported 1.47% impact on a 0.01-token sale,
	// so an impact threshold of 1% was never met and depth read $158. A flat
	// spread costs every size equally; depth must still find the curve.
	srv := httptest.NewServer(&fakeJupiter{spread: 0.015})
	defer srv.Close()

	snap, err := newTestReader(srv.URL).ReadMarket(context.Background(), "jupiter", "MINT")
	if err != nil {
		t.Fatalf("ReadMarket: %v", err)
	}
	if snap.DepthUSD < 40_000 || snap.DepthUSD > 86_000 {
		t.Fatalf("depth = $%d with a 1.5%% spread, want roughly $40k-$86k", snap.DepthUSD)
	}
}

func TestUIMultiplier(t *testing.T) {
	// SPACEX's mint as read in Sept 2026: multiplier still "1", with a
	// scheduled 5x that took effect in June.
	spacex := mintInfo{multiplier: 1, newMultiplier: 5, newEffective: 1781065800}
	if got := spacex.uiMultiplier(time.Unix(1789503252, 0)); got != 5 {
		t.Fatalf("after the effective time: got %v, want 5", got)
	}
	if got := spacex.uiMultiplier(time.Unix(1781065799, 0)); got != 1 {
		t.Fatalf("before the effective time: got %v, want 1", got)
	}
	if got := (mintInfo{}).uiMultiplier(time.Now()); got != 1 {
		t.Fatalf("no extension: got %v, want 1", got)
	}
}

func TestPriceIsPerUIToken(t *testing.T) {
	// A raw token quotes $86.41; with a 5x multiplier a holder's token is
	// worth a fifth of that. Depth is USD, so it must not change.
	srv := httptest.NewServer(&fakeJupiter{})
	defer srv.Close()
	r := newTestReader(srv.URL)
	plain, err := r.ReadMarket(context.Background(), "jupiter", "MINT")
	if err != nil {
		t.Fatal(err)
	}

	r = newTestReader(srv.URL)
	r.mints["MINT"] = mintInfo{decimals: fakeDecimals, multiplier: 1, newMultiplier: 5, newEffective: 1}
	scaled, err := r.ReadMarket(context.Background(), "jupiter", "MINT")
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(scaled.TokenPriceUSD-plain.TokenPriceUSD/5) > 0.01 {
		t.Fatalf("scaled price $%.2f, want $%.2f", scaled.TokenPriceUSD, plain.TokenPriceUSD/5)
	}
	if scaled.DepthUSD != plain.DepthUSD {
		t.Fatalf("depth changed with multiplier: $%d vs $%d", scaled.DepthUSD, plain.DepthUSD)
	}
}
