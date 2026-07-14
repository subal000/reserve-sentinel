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
