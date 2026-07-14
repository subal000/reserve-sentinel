"use client";

import { useRef, useState } from "react";
import { RISK_HSL, riskKey } from "@/lib/scoring";
import { explorerTx } from "@/lib/utils";

export type BacktestPoint = {
  ts: number;
  date: string;
  netMint: number;
  mintVol: number;
  burnVol: number;
  z: number;
  procComp: number;
  sigs: string[];
};

const MAX_TOOLTIP_SIGS = 5;

const ALERT_Z = 2; // matches scripts/backtest.ts's "first crossed 2σ" threshold

// Procurement-component-over-time chart. Fixed 0–100 y-scale (same convention
// as ScoreHistory), colored by band. Every bucket that crossed the 2σ alert
// threshold gets a marker (not just the single peak), and hovering/tapping any
// point shows its full bucket detail — this is the real 91-point dataset, not
// a static image, so it should be explorable.
export function BacktestChart({
  series,
  peakAt,
}: {
  series: BacktestPoint[];
  peakAt: string | null;
}) {
  const w = 900;
  const h = 240;
  const padL = 32;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const n = series.length;

  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (n < 2) return <p className="text-sm text-muted-foreground">Not enough history to chart.</p>;

  const x = (i: number) => padL + (i / (n - 1)) * (w - padL - padR);
  const y = (v: number) => padT + (1 - v / 100) * (h - padT - padB);

  const line = series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.procComp).toFixed(1)}`).join(" ");
  const peakIdx = peakAt ? series.findIndex((p) => p.date === peakAt) : -1;
  const alertIdxs = series.reduce<number[]>((acc, p, i) => (p.z >= ALERT_Z ? [...acc, i] : acc), []);

  const labelCount = 6;
  const labelIdxs = Array.from({ length: labelCount }, (_, k) => Math.round((k / (labelCount - 1)) * (n - 1)));

  function indexFromClientX(clientX: number): number {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const fracX = (clientX - rect.left) / rect.width;
    const viewBoxX = fracX * w;
    const i = Math.round(((viewBoxX - padL) / (w - padL - padR)) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  }

  const hovered = hoverIdx !== null ? series[hoverIdx] : null;
  // Position the tooltip as a left/right percentage so it never overflows the
  // container; flip to the left side once past the chart's midpoint.
  const tooltipLeftPct = hoverIdx !== null ? (x(hoverIdx) / w) * 100 : 0;
  const flip = tooltipLeftPct > 60;

  return (
    <div
      ref={containerRef}
      className="relative touch-none select-none"
      onMouseMove={(e) => setHoverIdx(indexFromClientX(e.clientX))}
      onMouseLeave={() => setHoverIdx(null)}
      onTouchMove={(e) => {
        if (e.touches[0]) setHoverIdx(indexFromClientX(e.touches[0].clientX));
      }}
      onTouchEnd={() => setHoverIdx(null)}
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Procurement component over time, hoverable">
        {[40, 60, 80].map((v) => (
          <line key={v} x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="hsl(var(--border))" strokeWidth="1" />
        ))}
        {[0, 40, 60, 80, 100].map((v) => (
          <text key={v} x={4} y={y(v) + 3} className="fill-muted-foreground" fontSize="10">
            {v}
          </text>
        ))}

        <path d={line} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />

        {/* every bucket that crossed the alert threshold gets a permanent guide
            line + marker, not just the peak — small dips are otherwise easy to
            miss against a 0-100 axis, since a 2-5σ event only shaves a few
            points off the score while the peak can shave 35. */}
        {alertIdxs.map((i) => {
          const color = RISK_HSL[riskKey(series[i].procComp)];
          const isPeak = i === peakIdx;
          return (
            <g key={i}>
              <line
                x1={x(i)}
                x2={x(i)}
                y1={padT}
                y2={h - padB}
                stroke={color}
                strokeWidth="1"
                strokeDasharray="3,3"
                opacity={isPeak ? 0.9 : 0.4}
              />
              <circle cx={x(i)} cy={y(series[i].procComp)} r={isPeak ? 4.5 : 3} fill={color} opacity={isPeak ? 1 : 0.85} />
            </g>
          );
        })}

        {hoverIdx !== null && (
          <g>
            <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={padT} y2={h - padB} stroke="hsl(var(--muted-foreground))" strokeWidth="1" strokeDasharray="2,2" />
            <circle cx={x(hoverIdx)} cy={y(series[hoverIdx].procComp)} r="5" fill="hsl(var(--background))" stroke={RISK_HSL[riskKey(series[hoverIdx].procComp)]} strokeWidth="2" />
          </g>
        )}

        {labelIdxs.map((i) => (
          <text key={i} x={x(i)} y={h - 6} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
            {series[i].date.slice(5, 10)}
          </text>
        ))}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-1 z-10 w-48 rounded-md border border-border bg-popover p-2.5 text-xs shadow-md"
          style={flip ? { right: `${100 - tooltipLeftPct}%`, marginRight: 8 } : { left: `${tooltipLeftPct}%`, marginLeft: 8 }}
        >
          <p className="font-mono text-[11px] text-muted-foreground">{hovered.date} UTC</p>
          <dl className="mt-1.5 space-y-0.5 font-mono tnum">
            <Row label="proc" value={hovered.procComp.toFixed(0)} color={RISK_HSL[riskKey(hovered.procComp)]} />
            <Row label="z-score" value={`${hovered.z.toFixed(2)}σ`} />
            <Row label="net mint" value={fmtTok(hovered.netMint)} />
            <Row label="minted" value={fmtTok(hovered.mintVol)} />
            <Row label="burned" value={fmtTok(hovered.burnVol)} />
          </dl>
          {hovered.sigs.length > 0 && (
            <div className="mt-2 border-t border-border pt-1.5">
              <p className="text-[10px] text-muted-foreground">
                {hovered.sigs.length} on-chain tx{hovered.sigs.length > 1 ? "s" : ""}
              </p>
              {/* pointer-events-auto: the tooltip itself ignores the mouse (so
                  chart hover-tracking isn't disrupted), but these links need
                  to be clickable within it. */}
              <div className="mt-1 flex flex-wrap gap-1 pointer-events-auto">
                {hovered.sigs.slice(0, MAX_TOOLTIP_SIGS).map((sig, i) => (
                  <a
                    key={sig}
                    href={explorerTx(sig)}
                    target="_blank"
                    rel="noreferrer"
                    title={sig}
                    className="rounded bg-muted px-1 font-mono text-[10px] text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    #{i + 1}↗
                  </a>
                ))}
                {hovered.sigs.length > MAX_TOOLTIP_SIGS && (
                  <span className="text-[10px] text-muted-foreground">+{hovered.sigs.length - MAX_TOOLTIP_SIGS} more</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd style={color ? { color } : undefined}>{value}</dd>
    </div>
  );
}

function fmtTok(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(abs < 1 ? 3 : 0);
}
