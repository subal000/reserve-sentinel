// Client-side re-derivation of the four score components from the raw on-chain
// signals — mirrors indexer/internal/scoring/scoring.go. Lets the UI explain
// *why* a score is what it is ("what's dragging this down?") without storing the
// breakdown on-chain.

// Must match indexer/internal/scoring/scoring.go — log10 scale.
const LIQ_FLOOR = 1_000;
const LIQ_CAP = 1_000_000;

export const WEIGHTS = { price: 0.3, liquidity: 0.25, procurement: 0.25, trust: 0.2 };

export function priceComponent(premiumBps: number): number {
  return 100 - Math.min(100, Math.abs(premiumBps) / 10);
}

export function liquidityComponent(depthUsd: number): number {
  if (depthUsd <= LIQ_FLOOR) return 0;
  if (depthUsd >= LIQ_CAP) return 100;
  const lo = Math.log10(LIQ_FLOOR);
  const hi = Math.log10(LIQ_CAP);
  return ((Math.log10(depthUsd) - lo) / (hi - lo)) * 100;
}

export function procurementComponent(mintBurnZ: number): number {
  const z = mintBurnZ / 100;
  return 100 - Math.min(100, Math.max(0, z));
}

export function trustComponent(tier: number): number {
  return Math.min(3, tier) * 25;
}

export type Breakdown = {
  key: "price" | "liquidity" | "procurement" | "trust";
  label: string;
  value: number; // 0-100
  weight: number;
  weighted: number; // contribution to composite
  hint: string;
};

export function breakdown(a: {
  premiumBps: number;
  liquidityDepthUsd: number;
  mintBurnZ: number;
  trustTier: number;
  hasPriceFeed: boolean;
}): Breakdown[] {
  const price = priceComponent(a.premiumBps);
  const liq = liquidityComponent(a.liquidityDepthUsd);
  const proc = procurementComponent(a.mintBurnZ);
  const trust = trustComponent(a.trustTier);
  return [
    {
      key: "price",
      label: "Peg / premium",
      value: price,
      weight: WEIGHTS.price,
      weighted: price * WEIGHTS.price,
      hint: a.hasPriceFeed ? "How far the token trades from its reference price" : "No reference price (private company)",
    },
    {
      key: "liquidity",
      label: "Liquidity depth",
      value: liq,
      weight: WEIGHTS.liquidity,
      weighted: liq * WEIGHTS.liquidity,
      hint: "USD needed to move the on-chain price 1%",
    },
    {
      key: "procurement",
      label: "Mint / burn velocity",
      value: proc,
      weight: WEIGHTS.procurement,
      weighted: proc * WEIGHTS.procurement,
      hint: "Sudden minting can signal procurement stress",
    },
    {
      key: "trust",
      label: "Issuer trust tier",
      value: trust,
      weight: WEIGHTS.trust,
      weighted: trust * WEIGHTS.trust,
      hint: "Custodial backing / redeemability (manual)",
    },
  ];
}
