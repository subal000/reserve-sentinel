import { fetchAllScores } from "@/lib/anchor";
import { BasketBuilder } from "@/components/BasketBuilder";

export const dynamic = "force-dynamic";

export default async function BasketPage() {
  const all = await fetchAllScores();
  const live = all.filter((a) => a.initialized && a.lastUpdated > 0);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Basket risk</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Compose a read-only basket of tokenized stocks and see the blended risk. Useful for DeFi
          protocols weighing these as collateral — the same on-chain scores, aggregated.
        </p>
      </div>

      {live.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scored assets available yet.</p>
      ) : (
        <BasketBuilder assets={live} />
      )}
    </div>
  );
}
