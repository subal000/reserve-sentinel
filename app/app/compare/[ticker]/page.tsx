import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { fetchAllScores } from "@/lib/anchor";
import { fetchHistories } from "@/lib/clickhouse";
import { CrossIssuerView } from "@/components/CrossIssuerView";

export const dynamic = "force-dynamic";

export default async function ComparePage({ params }: { params: { ticker: string } }) {
  const ticker = decodeURIComponent(params.ticker).toUpperCase();
  const all = await fetchAllScores();
  const matches = all.filter(
    (a) => (a.underlyingTicker || a.symbol).toUpperCase() === ticker
  );
  if (matches.length === 0) notFound();

  const histories = await fetchHistories(matches.map((a) => a.mint));
  const multi = matches.length > 1;

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All assets
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {ticker}
          {multi && <span className="text-muted-foreground"> · cross-issuer</span>}
        </h1>
        <p className="text-sm text-muted-foreground">
          {multi
            ? `${matches.length} issuers wrap the same underlying stock. Compare how each scores.`
            : "On-chain risk detail."}
        </p>
      </div>

      <CrossIssuerView ticker={ticker} assets={matches} histories={histories} />
    </div>
  );
}
