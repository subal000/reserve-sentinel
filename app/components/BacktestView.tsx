"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { BacktestChart, type BacktestPoint } from "./BacktestChart";
import { BacktestTable } from "./BacktestTable";
import { RiskLabel } from "./ScoreDial";
import { label as riskLabel, RISK_HSL, riskKey } from "@/lib/scoring";
import { explorerTxFor } from "@/lib/utils";

const ALERT_Z = 2;

export type Dataset = {
  chain: string; // "solana" | "ethereum"
  chainLabel: string;
  symbol: string;
  ref: string; // mint or contract address
  refLabel: string; // "Mint" | "Contract"
  bucketHours: number;
  generatedAt: number;
  scriptName: string;
  series: BacktestPoint[];
  peak: { z: number; at: string | null };
  firstAlertAt: string | null;
};

// Same-asset, two-chain backtest with a chain toggle. The point it makes
// visually: the mint/burn signal is chain-agnostic — identical methodology,
// Solana SPL mints or Ethereum ERC-20 mints, same detector.
export function BacktestView({ datasets }: { datasets: Dataset[] }) {
  const [idx, setIdx] = useState(0);
  const data = datasets[idx];

  const peakBucket = data.series.find((s) => s.date === data.peak.at);
  const alerts = data.series.filter((s) => s.z >= ALERT_Z);

  return (
    <div className="space-y-6">
      {datasets.length > 1 && (
        <div className="inline-flex rounded-lg border border-border bg-card p-1" role="tablist" aria-label="Chain">
          {datasets.map((d, i) => (
            <button
              key={d.chain}
              role="tab"
              aria-selected={i === idx}
              onClick={() => setIdx(i)}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                i === idx ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {d.chainLabel}
            </button>
          ))}
        </div>
      )}

      <p className="max-w-prose text-sm text-muted-foreground">
        Reconstructed from real on-chain mint/burn history for{" "}
        <span className="font-mono">{data.symbol}</span> on{" "}
        <span className="text-foreground">{data.chainLabel}</span> — the{" "}
        <em>same tokenized asset</em> across both chains, run through the identical velocity signal. Only
        mint/burn is backtestable this way (no historical premium/depth to reconstruct), so this shows the
        procurement component alone. Hover the chart or expand the table for every bucket.
      </p>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="History reconstructed" value={`${data.series.length} × ${data.bucketHours}h buckets`} />
        <Stat label="Peak velocity" value={`z = ${data.peak.z.toFixed(1)}`} sub={data.peak.at ?? undefined} accent />
        <Stat label="First 2σ alert" value={data.firstAlertAt ?? "none"} sub={data.firstAlertAt ? "would have fired here" : undefined} />
        <Stat label="Total 2σ alerts" value={String(alerts.length)} sub={alerts.length > 1 ? "distinct buckets, marked on chart" : undefined} />
      </div>

      {peakBucket && peakBucket.z >= 2 && (
        <div className="flex items-start gap-3 rounded-lg border border-risk-warning/40 bg-risk-warning/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-risk-warning" aria-hidden="true" />
          <p className="text-sm">
            <span className="font-medium text-foreground">
              {peakBucket.date} UTC: net +{Math.round(peakBucket.netMint).toLocaleString()} tokens minted in{" "}
              {data.bucketHours}h
            </span>{" "}
            <span className="text-muted-foreground">
              — a {peakBucket.z.toFixed(1)}σ velocity spike vs the recent baseline, dropping the procurement
              component to {peakBucket.procComp.toFixed(0)}. Genuine detected event, reconstructed from real
              on-chain data — not synthetic.
            </span>{" "}
            {peakBucket.txs.length > 0 && (
              <a
                href={explorerTxFor(data.chain, peakBucket.txs[0])}
                target="_blank"
                rel="noreferrer"
                title={peakBucket.txs.join("\n")}
                className="font-medium text-risk-warning underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                View on-chain tx ↗
              </a>
            )}
          </p>
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-medium">Procurement component over time</p>
          {peakBucket && <RiskLabel score={Math.round(peakBucket.procComp)} />}
        </div>

        {alerts.length > 0 && (
          <ul className="mb-4 flex flex-wrap gap-2">
            {alerts.map((a) => {
              const isPeak = a.date === data.peak.at;
              const color = RISK_HSL[riskKey(a.procComp)];
              return (
                <li
                  key={a.ts}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-[11px]"
                  title={`net ${a.netMint >= 0 ? "+" : ""}${Math.round(a.netMint).toLocaleString()} tokens`}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
                  <span className="font-mono">{a.date}</span>
                  <span className="text-muted-foreground">{a.z.toFixed(1)}σ</span>
                  {isPeak && <span className="font-medium text-risk-warning">· peak</span>}
                  {a.txs.length > 0 && (
                    <a
                      href={explorerTxFor(data.chain, a.txs[0])}
                      target="_blank"
                      rel="noreferrer"
                      title={a.txs.join("\n")}
                      className="text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {a.txs.length}↗
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <BacktestChart series={data.series} peakAt={data.peak.at} chain={data.chain} />
        <p className="mt-3 text-xs text-muted-foreground">
          100 = no velocity anomaly · {peakBucket ? riskLabel(Math.round(peakBucket.procComp)) : ""} at the marked
          peak · hover any point for its exact numbers
        </p>
      </div>

      <BacktestTable series={data.series} chain={data.chain} />

      <p className="text-xs text-muted-foreground">
        {data.refLabel}: <span className="font-mono">{data.ref}</span> · generated{" "}
        {new Date(data.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC · static snapshot from{" "}
        <span className="font-mono">{data.scriptName}</span>, not live.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-xl font-semibold tnum ${accent ? "text-risk-warning" : ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
