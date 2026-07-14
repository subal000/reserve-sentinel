import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CLUSTER, type AssetScore } from "@/lib/anchor";
import { ScoreDial, RiskLabel } from "./ScoreDial";
import { IssuerBadge } from "./IssuerBadge";
import { fmtBps, fmtUSD, fmtZ, relativeTime, shortAddr } from "@/lib/format";
import { explorerAccount } from "@/lib/utils";

export function ScoreCard({ asset, index = 0 }: { asset: AssetScore; index?: number }) {
  const href = `/compare/${asset.underlyingTicker || asset.symbol}`;

  return (
    <div
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
      className="group relative animate-fade-in-up rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/50"
    >
      {/* Stretched click target for the whole card; the explorer link below
          sits on top (later in DOM) and intercepts its own clicks. */}
      <Link
        href={href}
        className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`View ${asset.symbol} comparison`}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg font-semibold">{asset.symbol}</span>
          {asset.underlyingTicker && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
              {asset.underlyingTicker}
            </span>
          )}
        </div>
        <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />
      </div>

      {!asset.initialized ? (
        <p className="relative mt-6 text-sm text-muted-foreground">Not initialized on-chain yet.</p>
      ) : asset.lastUpdated === 0 ? (
        <p className="relative mt-6 text-sm text-muted-foreground">Awaiting first score from the indexer.</p>
      ) : (
        <>
          <div className="relative mt-4 flex items-center gap-4">
            <ScoreDial score={asset.score} size={112} />
            <div className="min-w-0 space-y-2">
              <RiskLabel score={asset.score} />
              <IssuerBadge issuer={asset.issuer} trustTier={asset.trustTier} />
            </div>
          </div>

          <dl className="relative mt-5 grid grid-cols-3 gap-3 border-t border-border pt-4">
            <Signal label="Premium" value={asset.hasPriceFeed ? fmtBps(asset.premiumBps) : "n/a"} />
            <Signal label="1% depth" value={fmtUSD(asset.liquidityDepthUsd)} />
            <Signal label="Mint/burn" value={fmtZ(asset.mintBurnZ)} />
          </dl>
          <div className="relative mt-3 flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">Updated {relativeTime(asset.lastUpdated)}</p>
            <a
              href={explorerAccount(asset.pda, CLUSTER)}
              target="_blank"
              rel="noreferrer"
              title={`AssetScore PDA: ${asset.pda}`}
              // -my-2 py-2 grows the tap target to ~40px tall without pushing
              // surrounding layout (negative margin cancels the added space).
              className="relative z-10 -my-2 -mr-2 inline-block rounded-sm px-2 py-2 font-mono text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {shortAddr(asset.pda)} ↗
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm tnum">{value}</dd>
    </div>
  );
}
