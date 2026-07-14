import { riskKey, RISK_HSL } from "@/lib/scoring";
import type { HistoryPoint } from "@/lib/clickhouse";

// Sparkline of the score over time, from the ClickHouse time series. Fixed
// 0–100 y-scale so the line's height is comparable across assets. Colored by
// the latest band. Degrades to a short note when there's not enough history.
export function ScoreHistory({
  points,
  className = "",
}: {
  points: HistoryPoint[];
  className?: string;
}) {
  if (points.length < 2) {
    return (
      <p className={`text-xs text-muted-foreground ${className}`}>
        Trend accrues as the indexer runs.
      </p>
    );
  }

  const w = 320;
  const h = 44;
  const pad = 3;
  const n = points.length;
  const last = points[n - 1].score;
  const color = RISK_HSL[riskKey(last)];

  const x = (i: number) => pad + (i / (n - 1)) * (w - 2 * pad);
  const y = (s: number) => pad + (1 - s / 100) * (h - 2 * pad);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${h - pad} L${x(0).toFixed(1)},${h - pad} Z`;
  const gid = `spark-${last}-${n}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={`h-11 w-full ${className}`}
      role="img"
      aria-label={`Score trend, currently ${last}`}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
