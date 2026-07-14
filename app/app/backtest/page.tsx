import { AlertTriangle } from "lucide-react";
import crclon from "@/lib/backtest-data/crclon.json";
import { BacktestChart } from "@/components/BacktestChart";
import { BacktestTable } from "@/components/BacktestTable";
import { RiskLabel } from "@/components/ScoreDial";
import { label as riskLabel, RISK_HSL, riskKey } from "@/lib/scoring";
import { explorerTx } from "@/lib/utils";

const ALERT_Z = 2;

export default function BacktestPage() {
  const data = crclon as {
    symbol: string;
    mint: string;
    bucketHours: number;
    generatedAt: number;
    series: {
      ts: number;
      date: string;
      netMint: number;
      mintVol: number;
      burnVol: number;
      z: number;
      procComp: number;
      sigs: string[];
    }[];
    peak: { z: number; at: string | null };
    firstAlertAt: string | null;
  };

  const peakBucket = data.series.find((s) => s.date === data.peak.at);
  const alerts = data.series.filter((s) => s.z >= ALERT_Z);
  const alertCount = alerts.length;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Backtest: procurement stress</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Reconstructed from real on-chain mint/burn history for <span className="font-mono">{data.symbol}</span> —
          would ReserveSentinel&apos;s procurement signal have flagged stress before it was public? Only the
          mint/burn-velocity component is backtestable this way: there&apos;s no historical Pyth premium or DEX
          depth to reconstruct, so this shows the procurement component alone, not the full composite score.
          Hover the chart or expand the table below for every bucket&apos;s exact numbers.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="History reconstructed" value={`${data.series.length} × ${data.bucketHours}h buckets`} />
        <Stat
          label="Peak velocity"
          value={`z = ${data.peak.z.toFixed(1)}`}
          sub={data.peak.at ?? undefined}
          accent
        />
        <Stat
          label="First 2σ alert"
          value={data.firstAlertAt ?? "none"}
          sub={data.firstAlertAt ? "would have fired here" : undefined}
        />
        <Stat
          label="Total 2σ alerts"
          value={String(alertCount)}
          sub={alertCount > 1 ? "distinct buckets, marked on chart" : undefined}
        />
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
              — a {peakBucket.z.toFixed(1)}σ velocity spike, dropping the procurement component to{" "}
              {peakBucket.procComp.toFixed(0)}. This is a genuine detected event, reconstructed from real on-chain
              data — not synthetic.
            </span>{" "}
            {peakBucket.sigs.length > 0 && (
              <a
                href={explorerTx(peakBucket.sigs[0])}
                target="_blank"
                rel="noreferrer"
                title={peakBucket.sigs.join("\n")}
                className="font-medium text-risk-warning underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                View {peakBucket.sigs.length} on-chain tx{peakBucket.sigs.length > 1 ? "s" : ""} ↗
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
                  {a.sigs.length > 0 && (
                    <a
                      href={explorerTx(a.sigs[0])}
                      target="_blank"
                      rel="noreferrer"
                      title={a.sigs.join("\n")}
                      className="text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {a.sigs.length}↗
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <BacktestChart series={data.series} peakAt={data.peak.at} />
        <p className="mt-3 text-xs text-muted-foreground">
          100 = no velocity anomaly · {peakBucket ? riskLabel(Math.round(peakBucket.procComp)) : ""} at the marked peak
          · hover any point for its exact numbers
        </p>
      </div>

      <BacktestTable series={data.series} />

      <p className="text-xs text-muted-foreground">
        Mint: <span className="font-mono">{data.mint}</span> · generated{" "}
        {new Date(data.generatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC · static snapshot from{" "}
        <span className="font-mono">scripts/backtest.ts</span>, not live.
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
