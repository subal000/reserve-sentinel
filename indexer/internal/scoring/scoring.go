// Package scoring turns the three raw signals (premium, liquidity depth,
// mint/burn velocity) plus a manual trust tier into a 0-100 composite score.
//
// This is the one piece of "intelligence" in the system and is implemented
// fully here (not a stub) so it can be unit-tested and reused by the backtest
// script. The on-chain program only stores the outputs.
package scoring

import "math"

// Signals are the raw inputs for one asset at one point in time.
type Signals struct {
	// PremiumBps is the signed premium/discount vs the reference price, in bps.
	PremiumBps int32
	// LiquidityDepthUSD is the USD notional to move the on-chain price ~1%.
	LiquidityDepthUSD uint64
	// MintBurnZ is the z-score of mint/burn velocity, scaled x100 (2.5σ -> 250).
	MintBurnZ int32
	// TrustTier is the manual custodial-trust tier, 0-3.
	TrustTier uint8
}

// Components breaks down the composite so the dashboard can explain the score.
type Components struct {
	Price       float64
	Liquidity   float64
	Procurement float64
	TrustTier   float64
	Composite   uint8
}

// Weights for the composite. Sum = 1.0.
const (
	wPrice       = 0.30
	wLiquidity   = 0.25
	wProcurement = 0.25
	wTrustTier   = 0.20
)

// Liquidity scaling anchors, on a LOG scale. Real 1%-depths observed across
// tracked assets span ~$40 to ~$560k (4 orders of magnitude), so a linear ramp
// buckets almost everything at the extremes. Log10 spreads them sensibly:
// <= liqFloorUSD scores 0 (no meaningful market), >= liqCapUSD scores 100.
const (
	liqFloorUSD = 1_000.0
	liqCapUSD   = 1_000_000.0
)

// Compute returns the four components and the rounded composite score.
func Compute(s Signals) Components {
	price := priceComponent(s.PremiumBps)
	liq := liquidityComponent(s.LiquidityDepthUSD)
	proc := procurementComponent(s.MintBurnZ)
	trust := trustTierComponent(s.TrustTier)

	composite := wPrice*price + wLiquidity*liq + wProcurement*proc + wTrustTier*trust

	return Components{
		Price:       price,
		Liquidity:   liq,
		Procurement: proc,
		TrustTier:   trust,
		Composite:   clampU8(math.Round(composite)),
	}
}

// price_component = 100 - min(100, abs(premium_bps)/10)
// A 1000bps (10%) deviation in either direction zeroes the component.
func priceComponent(premiumBps int32) float64 {
	abs := math.Abs(float64(premiumBps))
	return 100 - math.Min(100, abs/10)
}

// liquidity_component: log10 scale between liqFloorUSD and liqCapUSD.
func liquidityComponent(depthUSD uint64) float64 {
	d := float64(depthUSD)
	if d <= liqFloorUSD {
		return 0
	}
	if d >= liqCapUSD {
		return 100
	}
	lo, hi := math.Log10(liqFloorUSD), math.Log10(liqCapUSD)
	return (math.Log10(d) - lo) / (hi - lo) * 100
}

// procurement_component = 100 - min(100, max(0, mint_burn_z/100))
// MintBurnZ is scaled x100, so dividing by 100 recovers the raw z-score.
// Only positive z (velocity spike above baseline) penalizes the score.
func procurementComponent(mintBurnZ int32) float64 {
	z := float64(mintBurnZ) / 100.0
	return 100 - math.Min(100, math.Max(0, z))
}

// trust_tier_component = trust_tier * 25 (0, 25, 50, 75, or 100)
func trustTierComponent(tier uint8) float64 {
	if tier > 3 {
		tier = 3
	}
	return float64(tier) * 25
}

// Label maps a composite score to plain-English guidance for holders.
func Label(score uint8) string {
	switch {
	case score >= 80:
		return "Looks safe"
	case score >= 60:
		return "Watch this one"
	case score >= 40:
		return "Showing warning signs"
	default:
		return "High risk"
	}
}

func clampU8(v float64) uint8 {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return uint8(v)
}
