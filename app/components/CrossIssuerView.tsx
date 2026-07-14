import { AlertTriangle } from "lucide-react";
import type { AssetScore } from "@/lib/anchor";
import type { HistoryPoint } from "@/lib/clickhouse";
import { ScoreDial, RiskLabel } from "./ScoreDial";
import { IssuerBadge } from "./IssuerBadge";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { ScoreHistory } from "./ScoreHistory";
import { fmtBps, fmtUSD, fmtZ, relativeTime, shortAddr } from "@/lib/format";
import { explorerAccount } from "@/lib/utils";
import { CLUSTER } from "@/lib/anchor";

export function CrossIssuerView({
  ticker,
  assets,
  histories = {},
}: {
  ticker: string;
  assets: AssetScore[];
  histories?: Record<string, HistoryPoint[]>;
}) {
  const live = assets.filter((a) => a.initialized && a.lastUpdated > 0);
  const scores = live.map((a) => a.score);
  const gap = scores.length >= 2 ? Math.max(...scores) - Math.min(...scores) : 0;

  return (
    <div className="space-y-6">
      {gap >= 10 && (
        <div className="flex items-start gap-3 rounded-lg border border-risk-warning/40 bg-risk-warning/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-risk-warning" aria-hidden="true" />
          <p className="text-sm">
            <span className="font-medium text-foreground">Same underlying stock, {gap}-point risk gap.</span>{" "}
            <span className="text-muted-foreground">
              Wrappers of {ticker} score differently across issuers — the reason this feed groups them.
            </span>
          </p>
        </div>
      )}

      <div className={`grid gap-4 ${assets.length > 1 ? "md:grid-cols-2" : "max-w-md"}`}>
        {assets.map((a) => (
          <article key={a.mint} className="rounded-lg border border-border bg-card p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-mono text-xl font-semibold">{a.symbol}</h2>
                <div className="mt-2">
                  <IssuerBadge issuer={a.issuer} trustTier={a.trustTier} />
                </div>
              </div>
              {a.initialized && a.lastUpdated > 0 && <ScoreDial score={a.score} size={96} />}
            </div>

            {!a.initialized || a.lastUpdated === 0 ? (
              <p className="mt-6 text-sm text-muted-foreground">
                {a.initialized ? "Awaiting first score." : "Not initialized on-chain."}
              </p>
            ) : (
              <>
                <div className="mt-4">
                  <RiskLabel score={a.score} />
                </div>

                <dl className="mt-5 grid grid-cols-3 gap-3 border-y border-border py-4">
                  <Stat label="Premium" value={a.hasPriceFeed ? fmtBps(a.premiumBps) : "n/a"} />
                  <Stat label="1% depth" value={fmtUSD(a.liquidityDepthUsd)} />
                  <Stat label="Mint/burn" value={fmtZ(a.mintBurnZ)} />
                </dl>

                <div className="mt-5">
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    Score trend (24h)
                  </p>
                  <ScoreHistory points={histories[a.mint] ?? []} />
                </div>

                <div className="mt-5">
                  <ScoreBreakdown asset={a} />
                </div>

                <p className="mt-4 text-xs text-muted-foreground">{a.note}</p>

                <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                  <a
                    href={explorerAccount(a.pda, CLUSTER)}
                    target="_blank"
                    rel="noreferrer"
                    className="-my-2 -ml-2 inline-block rounded-sm px-2 py-2 font-mono hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    title={`AssetScore PDA: ${a.pda}`}
                  >
                    {shortAddr(a.pda)} ↗
                  </a>
                  <span>Updated {relativeTime(a.lastUpdated)}</span>
                </div>
              </>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm tnum">{value}</dd>
    </div>
  );
}
