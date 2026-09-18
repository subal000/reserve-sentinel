import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CLUSTER, type AssetScore } from "@/lib/anchor";
import { RiskPill } from "./ScoreDial";
import { IssuerBadge } from "./IssuerBadge";
import { noExitMarket } from "@/lib/components";
import { fmtBps, fmtUSD, fmtZ, relativeTime, shortAddr } from "@/lib/format";
import { explorerAccount } from "@/lib/utils";

// The headline number on this card is what can actually be sold — the figure
// a lending protocol would read to set a limit. The composite score is a
// small pill next to the symbol, not the focal point: a protocol integrates
// against the depth, not against a subjective 0-100 rating (see README).
export function ScoreCard({ asset, index = 0 }: { asset: AssetScore; index?: number }) {
  const href = `/compare/${asset.underlyingTicker || asset.symbol}`;
  const noExit = noExitMarket(asset.liquidityDepthUsd);

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
        {asset.initialized && asset.lastUpdated > 0 && <RiskPill score={asset.score} />}
      </div>

      {!asset.initialized ? (
        <p className="relative mt-6 text-sm text-muted-foreground">Not initialized on-chain yet.</p>
      ) : asset.lastUpdated === 0 ? (
        <p className="relative mt-6 text-sm text-muted-foreground">Awaiting first score from the indexer.</p>
      ) : (
        <>
          <div className="relative mt-4">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Sellable within 1%
            </p>
            <p
              className={`mt-1 font-mono text-3xl font-semibold tnum ${noExit ? "text-risk-high" : ""}`}
            >
              {fmtUSD(asset.liquidityDepthUsd)}
            </p>
            {noExit && (
              <p className="mt-0.5 text-xs font-medium text-risk-high">No exit market at this size</p>
            )}
            <div className="mt-2">
              <IssuerBadge issuer={asset.issuer} trustTier={asset.trustTier} />
            </div>
          </div>

          <dl className="relative mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
            <Signal label="Premium" value={asset.hasPriceFeed ? fmtBps(asset.premiumBps) : "n/a"} />
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

      <ArrowUpRight
        className="pointer-events-none absolute right-5 top-16 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        aria-hidden="true"
      />
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
