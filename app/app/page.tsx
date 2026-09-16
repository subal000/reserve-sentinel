import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { fetchAllScores, type AssetScore } from "@/lib/anchor";
import { PLEDGE_ROWS, STUDY } from "@/lib/research";
import { RISK_HSL, label, riskKey } from "@/lib/scoring";
import { fmtBps, fmtUSD, relativeTime } from "@/lib/format";
import { UnwindMark } from "@/components/UnwindMark";

// The live strip reads chain on every request; the study numbers are a dated
// snapshot committed with the research that produced them.
export const dynamic = "force-dynamic";

const GITHUB = "https://github.com/subal000/reserve-sentinel";
const RESEARCH = `${GITHUB}/tree/main/research/2026-09-16-cross-lender-exit`;

export default async function HomePage() {
  let assets: AssetScore[] = [];
  try {
    assets = await fetchAllScores();
  } catch {
    // The page is the pitch; live data is evidence. Missing evidence must not
    // take the page down.
  }
  const live = assets
    .filter((a) => a.initialized && a.lastUpdated > 0)
    .sort((a, b) => a.score - b.score);

  return (
    <>
      <Hero />
      <Findings />
      <Blindspot />
      {live.length > 0 && <LiveStrip assets={live} total={assets.length} />}
      <HowItWorks />
      <Audience />
      <ClosingCta />
    </>
  );
}

/* ---------------------------------------------------------------- hero ---- */

function Hero() {
  const t = STUDY.totals;
  return (
    <section className="relative overflow-hidden border-b border-border/70">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_0%,hsl(172_60%_16%/0.55),transparent_70%)]"
      />
      <div className="container relative grid gap-12 py-16 md:py-24 lg:grid-cols-[1.05fr_minmax(0,0.95fr)] lg:items-center">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
            Exit-liquidity oracle for tokenized stocks
          </p>
          <h1 className="mt-6 max-w-[16ch] font-display text-4xl font-semibold leading-[1.05] tracking-tight text-balance sm:text-5xl lg:text-6xl">
            The price you see isn&apos;t the price you get.
          </h1>
          <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-muted-foreground">
            Tokenized stocks show one price and sell for another. Unwind quotes real sales, at real
            size, all day — then publishes what you&apos;d actually get, on-chain, where any program
            can read it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/scores"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              See live scores
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <a
              href={RESEARCH}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Read the measurement
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>

        {/* The single most important number on the site. */}
        <div className="rounded-2xl border border-border bg-card/80 p-6 shadow-[0_1px_0_0_hsl(var(--border))] sm:p-8">
          <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
            Tokenized stocks held as loan collateral
          </p>
          <p className="mt-4 font-mono text-4xl font-semibold tnum sm:text-5xl">
            {usdCompact(t.pledged)}
          </p>
          <p className="text-sm text-muted-foreground">
            pledged across Kamino and Jupiter Lend
          </p>

          <div className="mt-8">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-mono text-2xl font-semibold tnum text-primary">
                {usdCompact(t.sellable5)}
              </p>
              <p className="font-mono text-sm tnum text-muted-foreground">
                {(t.coverage * 100).toFixed(0)}% of it
              </p>
            </div>
            <p className="text-sm text-muted-foreground">can be sold within 5% of its price</p>
            <Bar fraction={t.coverage} className="mt-4" />
          </div>

          <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            Measured {studyDate()} with US markets closed, when depth is thinnest.{" "}
            <a href={RESEARCH} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">
              Method and caveats
            </a>
            .
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ findings ---- */

function Findings() {
  // The damning case is a route that ends below what's pledged against it.
  // Ladder ceilings above the pledged amount aren't cliffs, they're where we
  // stopped asking.
  const worst = PLEDGE_ROWS.filter((r) => r.routeEndsAt !== null && r.routeEndsAt < r.pledged).sort(
    (a, b) => (a.routeEndsAt ?? 0) / a.pledged - (b.routeEndsAt ?? 0) / b.pledged
  )[0];
  return (
    <section className="border-b border-border/70">
      <div className="container py-16 md:py-20">
        <div className="max-w-[60ch]">
          <SectionLabel>What the market looks like underneath</SectionLabel>
          <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Every lender prices how far a stock can fall. None of them check whether it can be sold.
          </h2>
          <p className="mt-5 text-muted-foreground">
            Both lenders liquidate into the same Solana pools, so the depth below isn&apos;t
            doubled — it&apos;s shared. Each bar is what one token can absorb before the price it
            fetches drops 5%.
          </p>
        </div>

        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[42rem] border-separate border-spacing-y-1 text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 pb-2 font-normal">Token</th>
                <th className="px-3 pb-2 text-right font-normal">Pledged</th>
                <th className="px-3 pb-2 text-right font-normal">Sellable within 5%</th>
                <th className="w-[38%] px-3 pb-2 font-normal">Covered</th>
              </tr>
            </thead>
            <tbody>
              {PLEDGE_ROWS.map((r) => {
                const cov = r.sellable5 / r.pledged;
                return (
                  <tr key={r.mint} className="bg-card/60">
                    <td className="rounded-l-lg px-3 py-3 font-mono font-medium">{r.symbol}</td>
                    <td className="px-3 py-3 text-right font-mono tnum text-muted-foreground">
                      {fmtUSD(r.pledged)}
                    </td>
                    <td className="px-3 py-3 text-right font-mono tnum">{fmtUSD(r.sellable5)}</td>
                    <td className="rounded-r-lg px-3 py-3">
                      <div className="flex items-center gap-3">
                        <Bar fraction={cov} className="flex-1" />
                        <span className="w-12 shrink-0 text-right font-mono text-xs tnum text-muted-foreground">
                          {(cov * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {worst && (
          <p className="mt-8 max-w-[62ch] border-l-2 border-risk-high/70 pl-5 text-lg leading-relaxed">
            <span className="font-mono font-semibold">{worst.symbol}</span> has{" "}
            <span className="text-risk-high">no route at all</span> above{" "}
            <span className="font-mono tnum">{fmtUSD(worst.routeEndsAt ?? 0)}</span> — against{" "}
            <span className="font-mono tnum">{fmtUSD(worst.pledged)}</span> sitting behind loans
            right now.
          </p>
        )}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- blindspot ---- */

function Blindspot() {
  const points = [
    {
      title: "A quote is one trade, right now",
      body: "Any exchange will quote your sale at the moment you make it. None of them keep the record, so nobody can check what was sellable on the day a loan was written against it.",
    },
    {
      title: "Lenders can't see each other",
      body: "Kamino knows its own book. Jupiter Lend knows its own. Neither knows they're queued for the same exit, and in a crash they sell into it at the same moment.",
    },
    {
      title: "Programs can't call an API",
      body: "A lending protocol's code can't ask a website whether something is sellable. It can only read what's already on-chain. So we put it there.",
    },
  ];
  return (
    <section className="border-b border-border/70 bg-card/30">
      <div className="container py-16 md:py-20">
        <SectionLabel>Why this stays invisible</SectionLabel>
        <div className="mt-8 grid gap-10 md:grid-cols-3">
          {points.map((p) => (
            <div key={p.title}>
              <h3 className="font-display text-lg font-semibold tracking-tight">{p.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- live strip ---- */

function LiveStrip({ assets, total }: { assets: AssetScore[]; total: number }) {
  const shown = assets.slice(0, 6);
  return (
    <section className="border-b border-border/70">
      <div className="container py-16 md:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-[52ch]">
            <SectionLabel>Live, on-chain</SectionLabel>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {total} tokens scored right now
            </h2>
            <p className="mt-4 text-muted-foreground">
              Riskiest first. Each score is written to a Solana account any wallet or program can
              read.
            </p>
          </div>
          <Link
            href="/scores"
            className="inline-flex items-center gap-1.5 rounded-md text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            All {total} scores
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((a) => (
            <li key={a.mint}>
              <Link
                href={`/compare/${a.underlyingTicker || a.symbol}`}
                className="flex items-center gap-4 rounded-xl border border-border bg-card/60 p-4 transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <span
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border font-mono text-base font-semibold tnum"
                  style={{ color: RISK_HSL[riskKey(a.score)], borderColor: RISK_HSL[riskKey(a.score)] }}
                >
                  {a.score}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate font-mono text-sm font-medium">{a.symbol}</span>
                    <span className="text-xs text-muted-foreground">{label(a.score)}</span>
                  </span>
                  <span className="mt-1 flex gap-4 font-mono text-xs tnum text-muted-foreground">
                    <span>{a.hasPriceFeed ? fmtBps(a.premiumBps) : "no ref"}</span>
                    <span>{fmtUSD(a.liquidityDepthUsd)} deep</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          Updated {relativeTime(Math.max(...shown.map((a) => a.lastUpdated)))}
        </p>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- how it works --- */

function HowItWorks() {
  const steps = [
    {
      k: "Quote",
      title: "We try to sell, without selling",
      body: "All day, for every tracked token, we ask the market what $1,000 fetches, then $10,000, then $250,000 — until the price breaks. Real routes, real sizes.",
    },
    {
      k: "Score",
      title: "Four signals, one number",
      body: "How much can be sold, how far the token trades from the real share, how fast the issuer is minting, and how it's backed. Combined into 0–100.",
    },
    {
      k: "Publish",
      title: "Written on-chain, free to read",
      body: "Each score lands in a Solana account. Wallets, dashboards and lending programs read it directly — no key, no API, no permission.",
    },
  ];
  return (
    <section className="border-b border-border/70 bg-card/30">
      <div className="container py-16 md:py-20">
        <SectionLabel>How it works</SectionLabel>
        <ol className="mt-8 grid gap-8 md:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.k} className="border-t border-border pt-6">
              <p className="font-mono text-xs uppercase tracking-wide text-primary">
                {String(i + 1).padStart(2, "0")} · {s.k}
              </p>
              <h3 className="mt-3 font-display text-lg font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- audience --- */

function Audience() {
  const who = [
    {
      title: "Lenders and vault curators",
      body: "Set borrowing limits against what the collateral can actually be sold for, not only how much it might fall.",
    },
    {
      title: "Traders",
      body: "See the real cost of getting out of a position before you get into it.",
    },
    {
      title: "Issuers",
      body: "Show that your token holds up at size — and see how it compares with the same stock wrapped by someone else.",
    },
  ];
  return (
    <section className="border-b border-border/70">
      <div className="container py-16 md:py-20">
        <SectionLabel>Who it&apos;s for</SectionLabel>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {who.map((w) => (
            <div key={w.title} className="rounded-xl border border-border bg-card/60 p-6">
              <h3 className="font-display text-lg font-semibold tracking-tight">{w.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{w.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ close cta --- */

function ClosingCta() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-[-12rem] h-[24rem] bg-[radial-gradient(50%_60%_at_50%_100%,hsl(172_60%_16%/0.5),transparent_70%)]"
      />
      <div className="container relative flex flex-col items-center gap-6 py-20 text-center md:py-28">
        <UnwindMark size={56} id="cta" />
        <h2 className="max-w-[20ch] font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Check the exit before you need it.
        </h2>
        <p className="max-w-[52ch] text-muted-foreground">
          Every score, every measurement and every script behind the numbers above is open.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/scores"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            See live scores
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <a
            href={GITHUB}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            Read the code
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- bits ---- */

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs uppercase tracking-[0.14em] text-primary">{children}</p>
  );
}

// A filled proportion of a track. Tiny fractions still show a sliver, so a
// near-zero coverage never reads as "no data".
function Bar({ fraction, className = "" }: { fraction: number; className?: string }) {
  const pct = Math.max(1.5, Math.min(100, fraction * 100));
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-muted ${className}`}>
      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}

function usdCompact(n: number): string {
  return n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : fmtUSD(n);
}

function studyDate(): string {
  return new Date(STUDY.measuredAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
