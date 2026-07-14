import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { fetchAllScores, type AssetScore } from "@/lib/anchor";
import { ScoreCard } from "@/components/ScoreCard";
import { RISK_HSL, label } from "@/lib/scoring";

// Read live from chain on every request — this is a monitoring board.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let assets: AssetScore[] = [];
  let error: string | null = null;
  try {
    assets = await fetchAllScores();
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to read on-chain scores";
  }

  // Riskiest first — a watch list surfaces problems, not alphabetical order.
  const sorted = [...assets].sort((a, b) => {
    const ai = a.initialized && a.lastUpdated > 0 ? a.score : 999;
    const bi = b.initialized && b.lastUpdated > 0 ? b.score : 999;
    return ai - bi;
  });
  const live = sorted.filter((a) => a.initialized && a.lastUpdated > 0);
  const worst = live[0];

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
          Is your tokenized stock safe?
        </h1>
        <p className="max-w-prose text-muted-foreground">
          Real-time risk scores for tokenized RWA stocks on Solana — peg deviation, on-chain
          liquidity, and mint/burn stress, combined into one number and published on-chain for
          anyone to read.
        </p>
        <p className="flex max-w-prose items-start gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-risk-warning" aria-hidden="true" />
          In June 2026, xStocks couldn&apos;t source enough real SpaceX shares to back demand —
          over $1B in customer orders got cancelled, with no public warning system. This is that
          warning system.
        </p>
      </section>

      {error ? (
        <ErrorState message={error} />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <SummaryStat label="Assets tracked" value={String(assets.length)} />
            <SummaryStat
              label="Highest risk"
              value={worst ? `${worst.symbol} · ${worst.score}` : "—"}
              accent={worst ? RISK_HSL[worstKey(worst.score)] : undefined}
              sub={worst ? label(worst.score) : undefined}
            />
            <Legend />
          </section>

          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((a, i) => (
              <ScoreCard key={a.mint} asset={a} index={i} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function worstKey(score: number) {
  return score >= 80 ? "safe" : score >= 60 ? "watch" : score >= 40 ? "warning" : "high";
}

function SummaryStat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xl font-semibold tnum" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Legend() {
  const bands = [
    { k: "safe" as const, range: "80+" },
    { k: "watch" as const, range: "60–79" },
    { k: "warning" as const, range: "40–59" },
    { k: "high" as const, range: "0–39" },
  ];
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Scale</p>
      <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {bands.map((b) => (
          <li key={b.k} className="flex items-center gap-1.5 text-xs">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: RISK_HSL[b.k] }} aria-hidden="true" />
            <span className="text-muted-foreground">{b.range}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-risk-high/40 bg-risk-high/10 p-6">
      <p className="font-medium text-foreground">Couldn&apos;t read scores from chain.</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <Link
        href="/"
        className="mt-4 inline-block rounded-md border border-border bg-muted px-3 py-2 text-sm transition-colors hover:bg-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        Retry
      </Link>
    </div>
  );
}
