"use client";

import { useMemo, useState } from "react";
import type { AssetScore } from "@/lib/anchor";
import { ScoreDial, RiskLabel } from "./ScoreDial";
import { riskKey, RISK_HSL, label } from "@/lib/scoring";

// Read-only basket demo: pick wrappers, see the blended risk — and the weakest
// link, because a basket is only as safe as its riskiest constituent.
export function BasketBuilder({ assets }: { assets: AssetScore[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set(assets.map((a) => a.mint)));

  const chosen = assets.filter((a) => selected.has(a.mint));

  const { avg, weakest } = useMemo(() => {
    if (chosen.length === 0) return { avg: 0, weakest: undefined as AssetScore | undefined };
    const sum = chosen.reduce((s, a) => s + a.score, 0);
    const weakest = chosen.reduce((w, a) => (a.score < w.score ? a : w), chosen[0]);
    return { avg: Math.round(sum / chosen.length), weakest };
  }, [chosen]);

  function toggle(mint: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mint)) next.delete(mint);
      else next.add(mint);
      return next;
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* Aggregate readout */}
      <div className="rounded-lg border border-border bg-card p-6">
        {chosen.length === 0 ? (
          <p className="text-sm text-muted-foreground">Select at least one asset to see a blended score.</p>
        ) : (
          <div className="flex flex-col items-center text-center">
            <ScoreDial score={avg} size={140} />
            <div className="mt-3">
              <RiskLabel score={avg} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Equal-weighted blend of {chosen.length} asset{chosen.length > 1 ? "s" : ""}
            </p>
            {weakest && (
              <div className="mt-5 w-full rounded-md border border-border bg-background p-3 text-left">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Weakest link</p>
                <p className="mt-1 text-sm">
                  <span className="font-mono font-medium">{weakest.symbol}</span>{" "}
                  <span style={{ color: RISK_HSL[riskKey(weakest.score)] }}>· {weakest.score}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{label(weakest.score)}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Constituent picker */}
      <div>
        <p className="mb-3 text-sm text-muted-foreground">
          Tap to include or exclude. {selected.size} of {assets.length} selected.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {assets.map((a) => {
            const on = selected.has(a.mint);
            const color = RISK_HSL[riskKey(a.score)];
            return (
              <li key={a.mint}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(a.mint)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    on ? "border-primary/50 bg-card" : "border-border bg-background opacity-60 hover:opacity-100"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        on ? "border-primary bg-primary" : "border-border"
                      }`}
                      aria-hidden="true"
                    >
                      {on && (
                        <svg viewBox="0 0 12 12" className="h-3 w-3 text-primary-foreground">
                          <path d="M2.5 6.5l2.5 2.5 4.5-5.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="font-mono text-sm font-medium">{a.symbol}</span>
                    {a.underlyingTicker && (
                      <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {a.underlyingTicker}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-sm tnum" style={{ color }}>
                    {a.score}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
