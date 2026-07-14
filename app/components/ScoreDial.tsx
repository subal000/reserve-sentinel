import { riskKey, RISK_HSL, label } from "@/lib/scoring";

// A circular score gauge. Static SVG (server-rendered) — the value doesn't
// animate on every render, which would be noise on a monitoring board.
export function ScoreDial({
  score,
  size = 132,
  showLabel = true,
}: {
  score: number;
  size?: number;
  showLabel?: boolean;
}) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = RISK_HSL[riskKey(score)];

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" role="img" aria-label={`Risk score ${score} of 100`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="hsl(var(--muted))"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-3xl font-semibold leading-none tnum" style={{ color }}>
          {score}
        </span>
        {showLabel && (
          <span className="mt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            / 100
          </span>
        )}
      </div>
    </div>
  );
}

// Small pill of the plain-English label, colored by band.
export function RiskLabel({ score, className = "" }: { score: number; className?: string }) {
  const color = RISK_HSL[riskKey(score)];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${className}`}
      style={{ color, backgroundColor: `${color.replace(")", " / 0.12)")}` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {label(score)}
    </span>
  );
}
