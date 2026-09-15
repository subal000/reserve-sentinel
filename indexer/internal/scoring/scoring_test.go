package scoring

import "testing"

func TestPriceComponent(t *testing.T) {
	// At par, price component is perfect.
	if got := priceComponent(0); got != 100 {
		t.Fatalf("premium 0: got %v want 100", got)
	}
	// 500 bps (5%) off -> 100 - 50 = 50.
	if got := priceComponent(500); got != 50 {
		t.Fatalf("premium 500: got %v want 50", got)
	}
	// Symmetric for discounts, and clamps at 0 beyond 1000 bps.
	if got := priceComponent(-2000); got != 0 {
		t.Fatalf("premium -2000: got %v want 0", got)
	}
}

func TestLiquidityComponent(t *testing.T) {
	if got := liquidityComponent(0); got != 0 {
		t.Fatalf("depth 0: got %v want 0", got)
	}
	if got := liquidityComponent(1_000_000); got != 100 {
		t.Fatalf("deep pool: got %v want 100", got)
	}
}

func TestProcurementComponent(t *testing.T) {
	// No spike -> full marks.
	if got := procurementComponent(0); got != 100 {
		t.Fatalf("z 0: got %v want 100", got)
	}
	// Negative z (burn-heavy) does not penalize.
	if got := procurementComponent(-500); got != 100 {
		t.Fatalf("z -5: got %v want 100", got)
	}
}

func TestBand(t *testing.T) {
	cases := []struct {
		score uint8
		want  int
	}{{85, 3}, {80, 3}, {79, 2}, {60, 2}, {59, 1}, {40, 1}, {39, 0}, {0, 0}}
	for _, c := range cases {
		if got := Band(c.score); got != c.want {
			t.Fatalf("Band(%d) = %d, want %d", c.score, got, c.want)
		}
	}
	// Band must be monotonic with Label boundaries: higher band = safer.
	if Band(81) <= Band(70) || Band(70) <= Band(50) || Band(50) <= Band(20) {
		t.Fatal("Band not monotonically safer with higher score")
	}
}

func TestNoExitMarket(t *testing.T) {
	// CRCLon on Solana (Sept 2026): no route at any size, so depth is $0 and
	// the unpriceable premium arrives as 0. Top issuer tier, quiet mint/burn.
	c := Compute(Signals{PremiumBps: 0, LiquidityDepthUSD: 0, MintBurnZ: 0, TrustTier: 3})
	if c.Price != 0 {
		t.Fatalf("unpriceable market got price credit %.0f", c.Price)
	}
	if Label(c.Composite) != "High risk" {
		t.Fatalf("no-exit asset scored %d (%s), want High risk", c.Composite, Label(c.Composite))
	}

	// Just under the floor is still no market; at the floor the usual math applies.
	if got := Compute(Signals{LiquidityDepthUSD: 999, TrustTier: 3}).Composite; got > noExitMaxScore {
		t.Fatalf("$999 depth scored %d, want <= %d", got, noExitMaxScore)
	}
	at := Compute(Signals{LiquidityDepthUSD: 1_000, TrustTier: 3})
	if at.Price != 100 || at.Composite != 70 {
		t.Fatalf("$1,000 depth: price %.0f composite %d, want 100 and 70", at.Price, at.Composite)
	}
}

func TestCompositeAndLabel(t *testing.T) {
	// Healthy custodial asset: at par, deep pool, no spike, tier 3.
	c := Compute(Signals{PremiumBps: 0, LiquidityDepthUSD: 1_000_000, MintBurnZ: 0, TrustTier: 3})
	if c.Composite < 80 {
		t.Fatalf("healthy asset composite too low: %d", c.Composite)
	}
	if Label(c.Composite) != "Looks safe" {
		t.Fatalf("healthy label: got %q", Label(c.Composite))
	}

	// Stressed synthetic: big premium, thin pool, minting spike, tier 0.
	s := Compute(Signals{PremiumBps: 1500, LiquidityDepthUSD: 2_000, MintBurnZ: 400, TrustTier: 0})
	if s.Composite >= 40 {
		t.Fatalf("stressed asset composite too high: %d", s.Composite)
	}
	if Label(s.Composite) != "High risk" {
		t.Fatalf("stressed label: got %q", Label(s.Composite))
	}
}
