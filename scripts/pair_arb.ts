/**
 * pair_arb.ts — is there risk-free yield in prediction-market pairs?
 *
 * THE THESIS BEING TESTED
 * A YES contract and its matching NO contract are worth exactly $1.00 together
 * at resolution, whatever the outcome. So a YES+NO pair is a zero-coupon bond
 * maturing on the resolution date: zero directional risk, zero jump risk, no
 * liquidation possible. If a pair can be bought for less than $1.00, that
 * difference is risk-free yield — and every harvest of it is on-chain volume.
 *
 * The thesis has two legs, and they have very different answers.
 *
 * LEG 1 — ON-BOOK (Kalshi's own orderbook).  Runs unauthenticated. DEAD.
 *   Kalshi does not run separate YES and NO books. Buying NO at p IS selling
 *   YES at 1-p; they are the same resting order viewed from two sides. So the
 *   NO quotes are mirrors of the YES book, by construction:
 *       no_bid == 1 - yes_ask        no_ask == 1 - yes_bid
 *   Substitute and the arb evaporates:
 *       cost to BUY a pair  = yes_ask + no_ask = 1 + (yes_ask - yes_bid) >= $1
 *       yield to SELL a pair = yes_bid + no_bid = 1 - (yes_ask - yes_bid) <= $1
 *   The pair always costs $1 PLUS the spread and always sells for $1 MINUS it.
 *   You pay the spread; you never earn it. This is an identity, not a market
 *   condition, so it cannot be waited out or screened for. Measured 2026-09-03:
 *   14,688 two-sided markets, ZERO violations, ZERO pairs under $1.00 (cheapest
 *   1.0010, median 1.0700) — and that is before Kalshi's trading fee.
 *   This leg re-runs the measurement so the kill stays reproducible.
 *
 * LEG 2 — CROSS-VENUE (Kalshi book vs DFlow's on-chain SPL tokens). OPEN.
 *   DFlow tokenizes each outcome into a real SPL token that routes through
 *   Solana AMMs. Once YES and NO are separate tokens with their own on-chain
 *   liquidity, nothing enforces the mirror identity against the Kalshi book —
 *   the on-chain price is set by Solana-side flow and inventory. Divergence
 *   there is a genuine, directionally-flat basis trade. That is the leg worth
 *   measuring, and this script measures it when it can reach the mints.
 *
 * WHERE THE EDGE WOULD SIT (leg 2 economics)
 *   Kalshi's fee is  0.07 * C * P * (1-P)  per side, maximised at P=0.50 and
 *   collapsing toward the tails. Round-tripping a pair costs roughly
 *   0.14 * P * (1-P): ~3.5c at even odds, ~1.3c at 0.90, ~0.3c at 0.98. So any
 *   basis trade is cheapest to run on lopsided markets, not coin-flips — the
 *   opposite of where the volume is. The script reports fee-adjusted edge so
 *   this is priced in rather than assumed away.
 *
 * Usage:
 *   yarn pair-arb                          # leg 1 (no credentials needed)
 *   DFLOW_API_KEY=<key> yarn pair-arb      # leg 1 + leg 2
 *   yarn pair-arb -- --pages 20 --top 25
 *
 * Get a DFlow key at pond.dflow.net/build/api-key. The metadata API needs it
 * (it 403s without one); the quote API's dev host does not.
 */

const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const DFLOW_META = "https://prediction-markets-api.dflow.net";
const DFLOW_QUOTE = "https://dev-quote-api.dflow.net";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Kalshi per-contract fee: 0.07 * P * (1-P), charged on each side. */
const feePerContract = (p: number) => 0.07 * p * (1 - p);

type KalshiMarket = {
  ticker: string;
  title: string;
  close_time: string;
  yes_bid_dollars: string;
  yes_ask_dollars: string;
  no_bid_dollars: string;
  no_ask_dollars: string;
  open_interest_fp?: string;
  volume_24h_fp?: string;
};

type Pair = {
  ticker: string;
  title: string;
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  buyPair: number; // yes_ask + no_ask
  sellPair: number; // yes_bid + no_bid
  spread: number;
  openInterest: number;
  volume24h: number;
  daysToClose: number;
};

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

async function getJSON(
  url: string,
  headers: Record<string, string> = {},
): Promise<any> {
  const res = await fetch(url, { headers });
  if (!res.ok)
    throw new Error(
      `HTTP ${res.status} ${res.statusText} :: ${url.split("?")[0]}`,
    );
  return res.json();
}

/** Page Kalshi's open events, flattening to markets that have a two-sided YES quote. */
async function fetchKalshiPairs(maxPages: number): Promise<Pair[]> {
  const out: Pair[] = [];
  let cursor: string | undefined;
  const now = Date.now();

  for (let page = 0; page < maxPages; page++) {
    const qs = new URLSearchParams({
      limit: "200",
      status: "open",
      with_nested_markets: "true",
      ...(cursor ? { cursor } : {}),
    });
    const data = await getJSON(`${KALSHI}/events?${qs}`);

    for (const ev of data.events ?? []) {
      for (const m of (ev.markets ?? []) as KalshiMarket[]) {
        const yesBid = Number(m.yes_bid_dollars);
        const yesAsk = Number(m.yes_ask_dollars);
        // One-sided books have no executable pair; skip rather than score them.
        if (!(yesBid > 0 && yesAsk > 0)) continue;
        const noBid = Number(m.no_bid_dollars);
        const noAsk = Number(m.no_ask_dollars);
        out.push({
          ticker: m.ticker,
          title: m.title,
          yesBid,
          yesAsk,
          noBid,
          noAsk,
          buyPair: yesAsk + noAsk,
          sellPair: yesBid + noBid,
          spread: yesAsk - yesBid,
          openInterest: Number(m.open_interest_fp ?? 0),
          volume24h: Number(m.volume_24h_fp ?? 0),
          daysToClose: (new Date(m.close_time).getTime() - now) / 86_400_000,
        });
      }
    }
    cursor = data.cursor;
    if (!cursor) break;
  }
  return out;
}

function reportOnBook(pairs: Pair[], top: number) {
  const EPS = 1e-9;
  const mirrorAsk = pairs.filter((p) => Math.abs(p.yesAsk + p.noBid - 1) > EPS);
  const mirrorBid = pairs.filter((p) => Math.abs(p.yesBid + p.noAsk - 1) > EPS);
  const discounts = pairs.filter((p) => p.buyPair < 1);
  const premiums = pairs.filter((p) => p.sellPair > 1);
  const med = (xs: number[]) =>
    xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  console.log("\n=== LEG 1: on-book (Kalshi) ===");
  console.log(`two-sided markets scanned      : ${pairs.length}`);
  console.log(`violations of yes_ask+no_bid=1 : ${mirrorAsk.length}`);
  console.log(`violations of yes_bid+no_ask=1 : ${mirrorBid.length}`);

  const mirrored = mirrorAsk.length === 0 && mirrorBid.length === 0;
  console.log(
    mirrored
      ? "  -> NO book is an exact mirror of the YES book. Pair arb is closed by identity."
      : "  -> mirror identity BROKEN. That is a real anomaly; inspect before trusting it.",
  );

  const buys = pairs.map((p) => p.buyPair);
  const sells = pairs.map((p) => p.sellPair);
  console.log(
    `\nBUY  a pair : cheapest $${Math.min(...buys).toFixed(4)}  median $${med(buys).toFixed(4)}  under $1.00 -> ${discounts.length}`,
  );
  console.log(
    `SELL a pair : richest  $${Math.max(...sells).toFixed(4)}  median $${med(sells).toFixed(4)}  over  $1.00 -> ${premiums.length}`,
  );

  if (!discounts.length && !premiums.length) {
    console.log(
      "\n  VERDICT: no risk-free pair yield exists on-book, as the identity predicts.",
    );
    console.log(
      "  The median pair costs $1 plus the spread — you pay it, you never earn it.",
    );
  }

  // Tightest spreads are where a cross-venue basis is cheapest to unwind, so
  // they are the markets leg 2 should look at first.
  const liquid = pairs
    .filter((p) => p.volume24h > 0 && p.daysToClose > 0)
    .sort((a, b) => a.spread - b.spread || b.volume24h - a.volume24h)
    .slice(0, top);

  if (liquid.length) {
    console.log(
      `\ntightest ${liquid.length} liquid markets (best candidates for leg 2):`,
    );
    console.log(
      [
        "ticker".padEnd(34),
        "spread".padStart(7),
        "mid".padStart(6),
        "rt fee".padStart(7),
        "24h vol".padStart(10),
        "days",
      ].join("  "),
    );
    for (const p of liquid) {
      const mid = (p.yesBid + p.yesAsk) / 2;
      const rtFee = 2 * feePerContract(mid);
      console.log(
        [
          p.ticker.slice(0, 34).padEnd(34),
          `${(p.spread * 100).toFixed(1)}c`.padStart(7),
          mid.toFixed(2).padStart(6),
          `${(rtFee * 100).toFixed(2)}c`.padStart(7),
          p.volume24h.toFixed(0).padStart(10),
          p.daysToClose.toFixed(0).padStart(5),
        ].join("  "),
      );
    }
  }
  return liquid;
}

/** Map Kalshi tickers -> on-chain YES/NO mints. Requires DFLOW_API_KEY. */
async function fetchDflowMints(
  apiKey: string,
): Promise<Map<string, { yesMint: string; noMint: string }>> {
  const mints = new Map<string, { yesMint: string; noMint: string }>();
  const data = await getJSON(
    `${DFLOW_META}/api/v1/events?status=active&withNestedMarkets=true`,
    {
      "x-api-key": apiKey,
    },
  );
  for (const ev of data.events ?? []) {
    for (const m of ev.markets ?? []) {
      // Mints are keyed by settlement mint; USDC is the one we price against.
      const acct = m.accounts?.[USDC];
      if (acct?.yesMint && acct?.noMint)
        mints.set(m.ticker, { yesMint: acct.yesMint, noMint: acct.noMint });
    }
  }
  return mints;
}

/**
 * Executable on-chain price of one outcome token, in USDC.
 * Quotes a real notional so the number includes routing and price impact —
 * a mid-price would flatter the basis and hide exactly the cost that kills it.
 */
async function onChainPrice(
  outMint: string,
  notionalUsdc: number,
): Promise<number | null> {
  const qs = new URLSearchParams({
    inputMint: USDC,
    outputMint: outMint,
    amount: String(Math.round(notionalUsdc * 1e6)),
    slippageBps: "50",
  });
  try {
    const q = await getJSON(`${DFLOW_QUOTE}/quote?${qs}`);
    const tokens = Number(q.outAmount) / 1e6;
    return tokens > 0 ? notionalUsdc / tokens : null;
  } catch {
    return null; // no on-chain route for this outcome yet
  }
}

async function reportCrossVenue(
  candidates: Pair[],
  apiKey: string,
  notional: number,
) {
  console.log("\n=== LEG 2: cross-venue (Kalshi book vs DFlow on-chain) ===");

  let mints: Map<string, { yesMint: string; noMint: string }>;
  try {
    mints = await fetchDflowMints(apiKey);
  } catch (e) {
    console.log(`  metadata API unavailable: ${(e as Error).message}`);
    return;
  }
  console.log(`  tokenized markets with USDC settlement: ${mints.size}`);

  const rows: string[] = [];
  for (const p of candidates) {
    const mm = mints.get(p.ticker);
    if (!mm) continue;
    const onchain = await onChainPrice(mm.yesMint, notional);
    if (onchain === null) continue;

    // Buy the cheap venue, sell the rich one. Flat either way.
    const mid = (p.yesBid + p.yesAsk) / 2;
    const rtFee = 2 * feePerContract(mid);
    const buyOnchainSellKalshi = p.yesBid - onchain - rtFee;
    const buyKalshiSellOnchain = onchain - p.yesAsk - rtFee;
    const edge = Math.max(buyOnchainSellKalshi, buyKalshiSellOnchain);
    const dir =
      buyOnchainSellKalshi > buyKalshiSellOnchain
        ? "chain->kalshi"
        : "kalshi->chain";
    if (edge <= 0) continue;

    const apy =
      p.daysToClose > 0
        ? (edge / Math.max(onchain, 0.01)) * (365 / p.daysToClose) * 100
        : 0;
    rows.push(
      [
        p.ticker.slice(0, 30).padEnd(30),
        onchain.toFixed(4).padStart(8),
        `${p.yesBid.toFixed(2)}/${p.yesAsk.toFixed(2)}`.padStart(12),
        `${(edge * 100).toFixed(2)}c`.padStart(8),
        dir.padStart(14),
        `${apy.toFixed(0)}%`.padStart(7),
      ].join("  "),
    );
  }

  if (!rows.length) {
    console.log("  no fee-positive divergence found in this sample.");
    console.log(
      "  That is the honest result to want: it means the router is pricing off the book.",
    );
    return;
  }
  console.log(
    `\n  ${rows.length} fee-positive divergences (net of round-trip Kalshi fee):`,
  );
  console.log(
    [
      "ticker".padEnd(30),
      "on-chain".padStart(8),
      "kalshi b/a".padStart(12),
      "edge".padStart(8),
      "direction".padStart(14),
      "apy".padStart(7),
    ].join("  "),
  );
  rows.forEach((r) => console.log("  " + r));
}

async function main() {
  const pages = arg("pages", 12);
  const top = arg("top", 20);
  const notional = arg("notional", 100);

  console.log(`fetching Kalshi open markets (up to ${pages} pages)...`);
  const pairs = await fetchKalshiPairs(pages);
  const candidates = reportOnBook(pairs, top);

  const key = process.env.DFLOW_API_KEY;
  if (!key) {
    console.log("\n=== LEG 2: skipped ===");
    console.log(
      "  set DFLOW_API_KEY to price the on-chain leg (pond.dflow.net/build/api-key).",
    );
    console.log(
      "  the metadata API 403s without one; only it can map tickers -> SPL mints.",
    );
    return;
  }
  await reportCrossVenue(candidates, key, notional);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
