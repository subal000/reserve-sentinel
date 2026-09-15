/**
 * basis_scan.ts — is there real carry in tokenized-equity basis?
 *
 * THE TRADE BEING TESTED
 * Buy a tokenized stock spot on Solana (xStocks: AAPLx, TSLAx, CRCLx…), short the
 * matching equity perp on Hyperliquid (Trade.xyz's HIP-3 `xyz` dex: xyz:AAPL,
 * xyz:TSLA, xyz:CRCL…). Equal notional, so the price legs cancel and you hold no
 * directional exposure. What's left is the hourly funding payment — and when
 * funding is positive, longs pay shorts, so the short leg earns it.
 *
 * Neither venue can do this alone: Hyperliquid has the equity perps but no equity
 * spot; Solana has the spot but no equity perps. The trade only exists across both.
 *
 * WHY EQUITIES SPECIFICALLY — the hypothesis this script exists to test
 * Crypto perps track an underlying that never closes. Equity perps do not: the NYSE
 * is open ~32 of the 168 hours in a week. For the other ~80% the oracle is pinned to
 * the last print while the perp keeps trading on news and positioning. Funding is
 * driven by the premium of mark over oracle, so the prediction is that equity-perp
 * funding is not uniformly distributed — it should concentrate in the CLOSED hours
 * (overnight, weekends) rather than during the cash session.
 *
 * If that holds, this is not a hold-forever carry; it's a position you put on before
 * the close and take off after the open, which is a different and much better trade.
 * So the script reports funding split by session, not just an average.
 *
 * WHAT KILLS IT, and what the numbers must clear
 *   - Round-tripping the perp costs ~9bps taker. Carry has to beat that before it's
 *     worth doing at all, which at typical rates takes days — hence `--fee-bps`.
 *   - Funding can be negative, in which case the short pays instead of earning.
 *   - The spot leg is thin (xStocks does ~$517M on DEXs), so size moves the price.
 *   - Margin is siloed: the short sits on Hyperliquid, the offsetting gain sits on
 *     Solana, and the path back is Solana → Arbitrum → Hyperliquid. A gap up at the
 *     open can liquidate a perfectly hedged position. This script does not model
 *     that; it only tells you whether the yield is there to begin with.
 *
 * PRIOR ART (checked against the Colosseum corpus before writing this)
 *   Arbor  — won $5k, Honorable Mention DeFi. Same shape, but Solana-native only
 *            (Drift/Zeta/Mango) and crypto funding, not equities.
 *   PiggyBank — carry-trade yield on xStocks. Did not place. Built at Cypherpunk in
 *            Sept 2025, before Hyperliquid's equity perps existed at any size.
 *   Neither touches the cross-venue equity basis, which is what this measures.
 *
 * Usage:
 *   yarn basis-scan                        # 30d lookback, all paired markets
 *   yarn basis-scan -- --days 60 --top 25
 *   yarn basis-scan -- --all               # every xyz market, not just ones with spot
 *   yarn basis-scan -- --fee-bps 12        # assume a worse round trip
 */
import * as fs from "fs";
import * as path from "path";

const HL = "https://api.hyperliquid.xyz/info";
const JUP = "https://lite-api.jup.ag/price/v3";
const DEX = "xyz"; // Trade.xyz's HIP-3 deployment — >90% of HIP-3 open interest
const HOURS_PER_YEAR = 24 * 365;

type Ctx = {
  funding: string;
  markPx: string;
  oraclePx: string;
  premium: string;
  openInterest: string;
  dayNtlVlm: string;
};
type FundingPoint = {
  coin: string;
  fundingRate: string;
  premium: string;
  time: number;
};

type Row = {
  coin: string;
  ticker: string;
  spotMint?: string;
  spotSymbol?: string;
  markPx: number;
  oraclePx: number;
  openInterestUsd: number;
  dayVolUsd: number;
  n: number;
  meanAll: number;
  meanOpen: number;
  meanClosed: number;
  nOpen: number;
  nClosed: number;
  pctPositive: number;
  aprAll: number;
  aprOpen: number;
  aprClosed: number;
  hoursToBreakEven: number;
};

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function info<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(HL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok)
    throw new Error(
      `Hyperliquid ${res.status} on ${JSON.stringify(body).slice(0, 60)}`,
    );
  return res.json() as Promise<T>;
}

/**
 * Is this timestamp inside a US cash session? NYSE runs 09:30–16:00 ET weekdays,
 * which is 13:30–20:00 UTC while daylight time is in force. We deliberately do NOT
 * chase exact DST boundaries or market holidays — the split only needs to be good
 * enough to show whether funding clusters outside the session, and a handful of
 * misclassified hours across a month cannot manufacture that signal.
 */
function isMarketOpen(ms: number): boolean {
  const d = new Date(ms);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= 13 * 60 + 30 && mins < 20 * 60;
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

/** Tokenized-equity spot legs we hold mints for, keyed by underlying ticker. */
function loadSpotLegs(): Map<string, { symbol: string; mint: string }> {
  const out = new Map<string, { symbol: string; mint: string }>();
  const p = path.join(__dirname, "..", "config", "assets.json");
  if (!fs.existsSync(p)) return out;
  for (const a of JSON.parse(fs.readFileSync(p, "utf8")).assets ?? []) {
    // Placeholder rows carry TODO mints; they have no tradeable spot leg.
    if (!a.mint || String(a.mint).startsWith("TODO")) continue;
    const t = String(a.underlying_ticker ?? "").toUpperCase();
    if (t && !out.has(t)) out.set(t, { symbol: a.symbol, mint: a.mint });
  }
  return out;
}

async function spotPrices(mints: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!mints.length) return out;
  try {
    const res = await fetch(`${JUP}?ids=${mints.join(",")}`);
    if (!res.ok) return out;
    const data = (await res.json()) as Record<string, { usdPrice?: number }>;
    for (const [mint, v] of Object.entries(data ?? {})) {
      if (v?.usdPrice) out.set(mint, v.usdPrice);
    }
  } catch {
    /* spot pricing is a nice-to-have; funding is the measurement that matters */
  }
  return out;
}

async function main() {
  const days = arg("days", 30);
  const top = arg("top", 20);
  const feeBps = arg("fee-bps", 9); // ~9bps round trip, taker both sides
  const startTime = Date.now() - days * 86_400_000;

  console.log(`fetching ${DEX} dex markets…`);
  const [meta, ctxs] = await info<[{ universe: { name: string }[] }, Ctx[]]>({
    type: "metaAndAssetCtxs",
    dex: DEX,
  });

  const spotLegs = loadSpotLegs();
  const paired = meta.universe
    .map((u, i) => ({ name: u.name, ctx: ctxs[i] }))
    .map((m) => ({ ...m, ticker: m.name.split(":")[1] ?? m.name }))
    .filter((m) => flag("all") || spotLegs.has(m.ticker));

  console.log(
    `${meta.universe.length} markets on ${DEX}; ${spotLegs.size} spot legs in config; scanning ${paired.length}\n`,
  );
  if (!paired.length) {
    console.log(
      "No overlap between xStocks config and xyz perps. Re-run with --all to scan everything.",
    );
    return;
  }

  const rows: Row[] = [];
  for (const m of paired) {
    let hist: FundingPoint[];
    try {
      hist = await info<FundingPoint[]>({
        type: "fundingHistory",
        coin: m.name,
        startTime,
      });
    } catch {
      continue;
    }
    if (!hist.length) continue;

    const all = hist.map((h) => Number(h.fundingRate));
    const open = hist
      .filter((h) => isMarketOpen(h.time))
      .map((h) => Number(h.fundingRate));
    const closed = hist
      .filter((h) => !isMarketOpen(h.time))
      .map((h) => Number(h.fundingRate));

    const mAll = mean(all);
    const leg = spotLegs.get(m.ticker);
    rows.push({
      coin: m.name,
      ticker: m.ticker,
      spotMint: leg?.mint,
      spotSymbol: leg?.symbol,
      markPx: Number(m.ctx.markPx),
      oraclePx: Number(m.ctx.oraclePx),
      openInterestUsd: Number(m.ctx.openInterest) * Number(m.ctx.markPx),
      dayVolUsd: Number(m.ctx.dayNtlVlm),
      n: all.length,
      meanAll: mAll,
      meanOpen: mean(open),
      meanClosed: mean(closed),
      nOpen: open.length,
      nClosed: closed.length,
      pctPositive: (all.filter((x) => x > 0).length / all.length) * 100,
      aprAll: mAll * HOURS_PER_YEAR * 100,
      aprOpen: mean(open) * HOURS_PER_YEAR * 100,
      aprClosed: mean(closed) * HOURS_PER_YEAR * 100,
      // Fees are paid once; funding accrues hourly. This is the carry break-even.
      hoursToBreakEven: mAll > 0 ? feeBps / 10_000 / mAll : Infinity,
    });
  }

  const prices = await spotPrices(
    rows.map((r) => r.spotMint).filter(Boolean) as string[],
  );
  rows.sort((a, b) => b.aprAll - a.aprAll);

  console.log(`=== CARRY, ${days}d lookback (short perp / long spot) ===`);
  console.log(
    [
      "market".padEnd(13),
      "apr".padStart(8),
      "pos%".padStart(6),
      "brkevn".padStart(7),
      "OI $m".padStart(7),
      "vol24 $m".padStart(9),
      "spot",
    ].join("  "),
  );
  for (const r of rows.slice(0, top)) {
    const be = Number.isFinite(r.hoursToBreakEven)
      ? `${r.hoursToBreakEven.toFixed(0)}h`
      : "never";
    const spot = r.spotSymbol
      ? `${r.spotSymbol}${prices.get(r.spotMint!) ? ` $${prices.get(r.spotMint!)!.toFixed(2)}` : ""}`
      : "—";
    console.log(
      [
        r.coin.slice(0, 13).padEnd(13),
        `${r.aprAll.toFixed(1)}%`.padStart(8),
        `${r.pctPositive.toFixed(0)}%`.padStart(6),
        be.padStart(7),
        (r.openInterestUsd / 1e6).toFixed(1).padStart(7),
        (r.dayVolUsd / 1e6).toFixed(1).padStart(9),
        spot,
      ].join("  "),
    );
  }

  // The actual hypothesis test: does funding concentrate outside the cash session?
  console.log(
    `\n=== SESSION SPLIT — does funding cluster when the NYSE is shut? ===`,
  );
  console.log(
    [
      "market".padEnd(13),
      "apr open".padStart(10),
      "apr closed".padStart(11),
      "closed/open".padStart(12),
      "hrs o/c",
    ].join("  "),
  );
  for (const r of rows.slice(0, top)) {
    const ratio =
      r.aprOpen !== 0 ? (r.aprClosed / r.aprOpen).toFixed(2) + "x" : "n/a";
    console.log(
      [
        r.coin.slice(0, 13).padEnd(13),
        `${r.aprOpen.toFixed(1)}%`.padStart(10),
        `${r.aprClosed.toFixed(1)}%`.padStart(11),
        ratio.padStart(12),
        `${r.nOpen}/${r.nClosed}`,
      ].join("  "),
    );
  }

  const withSpot = rows.filter((r) => r.spotMint);
  const profitable = withSpot.filter((r) => r.aprAll > 0);
  const closedBeatsOpen = rows.filter((r) => r.aprClosed > r.aprOpen).length;

  console.log(`\n=== VERDICT ===`);
  console.log(`pairs with a tradeable spot leg : ${withSpot.length}`);
  console.log(`of those, positive carry        : ${profitable.length}`);
  if (profitable.length) {
    const best = profitable[0];
    console.log(
      `best                            : ${best.coin} at ${best.aprAll.toFixed(1)}% APR, break-even ${best.hoursToBreakEven.toFixed(0)}h`,
    );
  }
  console.log(
    `markets where closed-hours funding exceeds open-hours: ${closedBeatsOpen}/${rows.length}`,
  );
  console.log(
    closedBeatsOpen > rows.length / 2
      ? "  -> hypothesis SUPPORTED: funding does concentrate outside the cash session.\n     That argues for a session-timed trade, not a permanent hold."
      : "  -> hypothesis NOT supported: funding is not concentrated in closed hours.\n     Without that structure this is ordinary carry, and Arbor already routes it on Solana.",
  );
  console.log(
    `\nfees assumed: ${feeBps}bps round trip on the perp leg. Spot slippage NOT modelled.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
