// Plain-English labels + risk-band mapping, mirroring the Go scoring package.

export type RiskKey = "safe" | "watch" | "warning" | "high";

export function riskKey(score: number): RiskKey {
  if (score >= 80) return "safe";
  if (score >= 60) return "watch";
  if (score >= 40) return "warning";
  return "high";
}

export function label(score: number): string {
  switch (riskKey(score)) {
    case "safe":
      return "Looks safe";
    case "watch":
      return "Watch this one";
    case "warning":
      return "Showing warning signs";
    case "high":
      return "High risk";
  }
}

// Tailwind color tokens per band (text / bg / border / ring / stroke).
export const RISK_COLOR: Record<RiskKey, { text: string; bg: string; border: string; stroke: string }> = {
  safe: { text: "text-risk-safe", bg: "bg-risk-safe", border: "border-risk-safe", stroke: "stroke-risk-safe" },
  watch: { text: "text-risk-watch", bg: "bg-risk-watch", border: "border-risk-watch", stroke: "stroke-risk-watch" },
  warning: { text: "text-risk-warning", bg: "bg-risk-warning", border: "border-risk-warning", stroke: "stroke-risk-warning" },
  high: { text: "text-risk-high", bg: "bg-risk-high", border: "border-risk-high", stroke: "stroke-risk-high" },
};

// Raw HSL for inline SVG strokes/fills (Tailwind class can't hit SVG stroke easily).
export const RISK_HSL: Record<RiskKey, string> = {
  safe: "hsl(152 58% 46%)",
  watch: "hsl(45 88% 55%)",
  warning: "hsl(26 88% 56%)",
  high: "hsl(0 74% 60%)",
};

export const ISSUER_NAME: Record<number, string> = {
  0: "xStocks",
  1: "Ondo",
  2: "Backpack/Sunrise",
  3: "Other",
};

// Trust tier -> short descriptor for the IssuerBadge tooltip.
export const TRUST_TIER_LABEL: Record<number, string> = {
  0: "Purely synthetic",
  1: "Partially backed",
  2: "Backed",
  3: "Redeemable / custodial",
};
