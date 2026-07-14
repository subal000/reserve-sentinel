import { breakdown } from "@/lib/components";
import type { AssetScore } from "@/lib/anchor";

// "Why this score" — the four weighted components derived from raw on-chain
// signals. A higher bar = healthier that dimension.
export function ScoreBreakdown({ asset }: { asset: AssetScore }) {
  const rows = breakdown(asset);
  return (
    <div className="space-y-4">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="mb-1.5 flex items-baseline justify-between gap-2">
            <span className="text-sm text-foreground">{r.label}</span>
            <span className="font-mono text-xs text-muted-foreground tnum">
              {Math.round(r.value)}
              <span className="text-muted-foreground/60"> × {r.weight.toFixed(2)}</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(2, r.value)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{r.hint}</p>
        </div>
      ))}
    </div>
  );
}
