/**
 * backtest.ts — retroactive mint/burn procurement-stress scoring.
 *
 * Reconstructs an asset's on-chain mint/burn history and replays the
 * procurement signal (mint/burn velocity z-score → procurement_component),
 * so we can check whether ReserveSentinel WOULD have flagged procurement
 * stress — e.g. the SpaceX (SPCX) case — before it became public.
 *
 * Scope: for SPCX only the mint/burn signal is backtestable. There's no Pyth
 * reference (SpaceX is private) so premium can't be reconstructed, and historical
 * DEX liquidity depth isn't recoverable from public data. Mint/burn velocity —
 * the signal the SpaceX procurement failure is actually about — IS recoverable:
 * mint/burn instructions touch the mint account, so getSignaturesForAddress on
 * the mint yields exactly that set (regular transfers touch token accounts, not
 * the mint, so they're excluded).
 *
 * Usage:
 *   yarn backtest -- --mint <MINT> --limit 800 --bucket 12
 *   yarn backtest                                   # defaults to SPCX
 *   SOLANA_RPC_URL=<helius-rpc> yarn backtest        # signature fetch (RPC)
 *   HELIUS_API_KEY=<key> yarn backtest               # bulk parse (REST, free-tier friendly)
 *
 * Signature listing uses the standard RPC (getSignaturesForAddress — works on
 * any RPC). Parsing uses Helius's Enhanced Transactions REST endpoint
 * (POST /v0/transactions) instead of JSON-RPC getParsedTransaction(s) — Helius's
 * free tier rejects JSON-RPC *batch* requests outright, but this REST endpoint
 * batches over plain HTTP POST and works fine on the free plan.
 */
import { Connection, PublicKey, type ParsedInstruction, type PartiallyDecodedInstruction } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const SPCX = "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb";

type Args = {
  mint: string;
  symbol: string;
  limit: number;
  bucketHours: number;
  rpc: string;
  heliusKey: string;
  jsonOut: string;
};

function parseArgs(argv: string[]): Args {
  const a: Args = {
    mint: SPCX,
    symbol: "SPCX",
    limit: 800,
    bucketHours: 12,
    rpc: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
    heliusKey: process.env.HELIUS_API_KEY || "",
    jsonOut: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === "--mint") a.mint = v;
    else if (argv[i] === "--symbol") a.symbol = v;
    else if (argv[i] === "--limit") a.limit = Number(v);
    else if (argv[i] === "--bucket") a.bucketHours = Number(v);
    else if (argv[i] === "--rpc") a.rpc = v;
    else if (argv[i] === "--helius-key") a.heliusKey = v;
    else if (argv[i] === "--json") a.jsonOut = v;
  }
  // A Helius RPC URL already carries the key; reuse it if --helius-key wasn't given.
  if (!a.heliusKey) {
    const m = a.rpc.match(/api-key=([^&]+)/);
    if (m) a.heliusKey = m[1];
  }
  return a;
}

// Bulk-parse signatures via Helius's Enhanced Transactions REST endpoint.
// Docs recommend batches of ~100; we use 100 and let withRetry handle 429s.
async function heliusParseBatch(apiKey: string, signatures: string[]): Promise<any[]> {
  const res = await fetch(`https://mainnet.helius-rpc.com/v0/transactions/?api-key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transactions: signatures }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err: any = new Error(`Helius parse ${res.status}: ${body.slice(0, 200)}`);
    err.code = res.status;
    throw err;
  }
  return (await res.json()) as any[];
}

// Sum signed mint/burn for OUR mint out of one Helius-enhanced transaction.
//
// Mirrors indexer/internal/helius/webhook.go's approach exactly: net every
// accountData[].tokenBalanceChanges entry for our mint across the whole tx.
// A mint nets positive (tokens created, no offsetting debit); a burn nets
// negative; an ordinary transfer nets to ~zero (one account -X, another +X)
// and is correctly ignored.
//
// Two things ruled out empirically before landing here: Helius's top-level
// `type` ("TOKEN_MINT"/"BURN") classifies the WHOLE transaction, not any one
// token in it (a tx tagged TOKEN_MINT for CRCLon actually minted a *different*
// token and only transferred CRCLon). And `tokenTransfers` doesn't represent
// pure mint/burn at all — only `accountData.tokenBalanceChanges` does.
function extractMintBurnEnhanced(tx: any, mint: string): { mint: number; burn: number } {
  let net = 0;
  for (const acct of tx?.accountData ?? []) {
    for (const tbc of acct?.tokenBalanceChanges ?? []) {
      if (tbc.mint !== mint) continue;
      const raw = parseFloat(tbc.rawTokenAmount?.tokenAmount ?? "0");
      const decimals = tbc.rawTokenAmount?.decimals ?? 0;
      net += raw / 10 ** decimals;
    }
  }
  if (Math.abs(net) < 1e-9) return { mint: 0, burn: 0 };
  return net > 0 ? { mint: net, burn: 0 } : { mint: 0, burn: -net };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry with exponential backoff on rate-limit (429) errors.
async function withRetry<T>(fn: () => Promise<T>, tries = 5): Promise<T> {
  let delay = 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fn();
      await sleep(600); // steady pacing between successful calls
      return r;
    } catch (e: any) {
      const is429 = e?.code === 429 || String(e?.message ?? "").includes("Too many requests");
      if (!is429 || attempt >= tries) throw e;
      await sleep(delay);
      delay = Math.min(delay * 2, 15000);
    }
  }
}

// Pull up to `limit` signatures that touch the mint account, newest→oldest,
// paginating in pages of 1000.
async function fetchSignatures(conn: Connection, mint: PublicKey, limit: number) {
  const out: { signature: string; blockTime: number | null | undefined }[] = [];
  let before: string | undefined;
  while (out.length < limit) {
    const page = await conn.getSignaturesForAddress(mint, {
      before,
      limit: Math.min(1000, limit - out.length),
    });
    if (page.length === 0) break;
    for (const s of page) out.push({ signature: s.signature, blockTime: s.blockTime });
    before = page[page.length - 1].signature;
    await sleep(200);
  }
  return out;
}

type MintBurn = { ts: number; net: number; mintVol: number; burnVol: number; sig: string };

function isParsed(ix: ParsedInstruction | PartiallyDecodedInstruction): ix is ParsedInstruction {
  return (ix as ParsedInstruction).parsed !== undefined;
}

// Sum signed mint/burn for our mint out of one parsed transaction.
function extractMintBurn(tx: any, mint: string, decimals: number): { mint: number; burn: number } {
  let mintAmt = 0;
  let burnAmt = 0;
  const ixs = tx?.transaction?.message?.instructions ?? [];
  const inner = (tx?.meta?.innerInstructions ?? []).flatMap((g: any) => g.instructions ?? []);
  for (const ix of [...ixs, ...inner]) {
    if (!isParsed(ix)) continue;
    if (ix.program !== "spl-token" && ix.program !== "spl-token-2022") continue;
    const info: any = ix.parsed?.info;
    if (!info || info.mint !== mint) continue;
    const type = ix.parsed?.type;
    const raw =
      info.tokenAmount?.uiAmount ??
      (info.amount != null ? Number(info.amount) / 10 ** decimals : 0);
    if (type === "mintTo" || type === "mintToChecked") mintAmt += raw;
    else if (type === "burn" || type === "burnChecked") burnAmt += raw;
  }
  return { mint: mintAmt, burn: burnAmt };
}

// procurement_component, mirroring indexer/internal/scoring/scoring.go.
function procurementComponent(zX100: number): number {
  const z = zX100 / 100;
  return 100 - Math.min(100, Math.max(0, z));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const conn = new Connection(args.rpc, "confirmed");
  const mint = new PublicKey(args.mint);

  const decInfo: any = await conn.getParsedAccountInfo(mint);
  const decimals = decInfo?.value?.data?.parsed?.info?.decimals ?? 0;
  console.log(`backtest ${args.mint} (decimals=${decimals}) via ${args.rpc}`);

  const sigs = await fetchSignatures(conn, mint, args.limit);
  console.log(`fetched ${sigs.length} mint-account signatures`);
  if (sigs.length === 0) {
    console.log("no history found.");
    return;
  }

  const events: MintBurn[] = [];
  const bySig = new Map(sigs.map((s) => [s.signature, s.blockTime]));

  if (args.heliusKey) {
    // Fast path: bulk-parse via Helius Enhanced Transactions REST (100/batch).
    console.log("parsing via Helius Enhanced Transactions API (bulk REST)...");
    const batchSize = 100;
    for (let i = 0; i < sigs.length; i += batchSize) {
      const batch = sigs.slice(i, i + batchSize).map((s) => s.signature);
      const parsed = await withRetry(() => heliusParseBatch(args.heliusKey, batch));
      for (const tx of parsed) {
        const ts = tx?.timestamp ?? bySig.get(tx?.signature) ?? null;
        if (!ts) continue;
        const { mint: m, burn: b } = extractMintBurnEnhanced(tx, args.mint);
        if (m !== 0 || b !== 0) events.push({ ts, net: m - b, mintVol: m, burnVol: b, sig: tx.signature });
      }
      process.stderr.write(`  parsed ${Math.min(i + batchSize, sigs.length)}/${sigs.length}\r`);
    }
  } else {
    // Fallback: one getParsedTransaction call per signature (works on any RPC,
    // but Helius's free tier rejects the batched getParsedTransactions form).
    console.log("parsing via RPC getParsedTransaction (no HELIUS_API_KEY set — slower)...");
    for (let i = 0; i < sigs.length; i++) {
      const tx = await withRetry(() =>
        conn.getParsedTransaction(sigs[i].signature, { maxSupportedTransactionVersion: 0 })
      );
      const ts = tx?.blockTime ?? sigs[i].blockTime;
      if (ts) {
        const { mint: m, burn: b } = extractMintBurn(tx, args.mint, decimals);
        if (m !== 0 || b !== 0) events.push({ ts, net: m - b, mintVol: m, burnVol: b, sig: sigs[i].signature });
      }
      process.stderr.write(`  parsed ${i + 1}/${sigs.length}\r`);
    }
  }
  console.error("");
  if (events.length === 0) {
    console.log("no mint/burn events parsed.");
    return;
  }

  // Bucket chronologically. Each bucket keeps the signatures of every
  // contributing mint/burn tx, so the UI can link back to on-chain proof.
  events.sort((a, b) => a.ts - b.ts);
  const bucketSecs = args.bucketHours * 3600;
  const buckets = new Map<number, MintBurn & { sigs: string[] }>();
  for (const e of events) {
    const key = Math.floor(e.ts / bucketSecs) * bucketSecs;
    const cur = buckets.get(key) ?? { ts: key, net: 0, mintVol: 0, burnVol: 0, sig: "", sigs: [] };
    cur.net += e.net;
    cur.mintVol += e.mintVol;
    cur.burnVol += e.burnVol;
    cur.sigs.push(e.sig);
    buckets.set(key, cur);
  }
  const series = [...buckets.values()].sort((a, b) => a.ts - b.ts);

  // Expanding-window z-score of net mint vs prior buckets (mirrors the live
  // VelocityWindow: only positive z — a spike above baseline — penalizes).
  // MIN_BASELINE guards against the early-window artifact: with only 1-2 prior
  // buckets, variance is near-zero and the very next bit of activity produces
  // an absurd z (seen empirically: z=7447 on bucket #4). Buckets before the
  // baseline is established report z=0 rather than a meaningless spike.
  const MIN_BASELINE = 8;
  console.log("\nbucket (UTC)          netMint      mintVol     burnVol     z      procComp");
  console.log("-".repeat(78));
  let firstAlert: string | null = null;
  let maxZ = -Infinity;
  let maxZAt = "";
  const outSeries: {
    ts: number;
    date: string;
    netMint: number;
    mintVol: number;
    burnVol: number;
    z: number;
    procComp: number;
    sigs: string[];
  }[] = [];
  for (let i = 0; i < series.length; i++) {
    const prior = series.slice(0, i).map((s) => s.net);
    let z = 0;
    if (prior.length >= MIN_BASELINE) {
      const mean = prior.reduce((s, x) => s + x, 0) / prior.length;
      const varr = prior.reduce((s, x) => s + (x - mean) ** 2, 0) / prior.length;
      const std = Math.sqrt(varr);
      if (std > 0) z = (series[i].net - mean) / std;
    }
    const zX100 = Math.round(z * 100);
    const proc = procurementComponent(zX100);
    const date = new Date(series[i].ts * 1000).toISOString().slice(0, 16).replace("T", " ");
    console.log(
      `${date}   ${fmt(series[i].net)} ${fmt(series[i].mintVol)} ${fmt(series[i].burnVol)}  ${z
        .toFixed(2)
        .padStart(6)}  ${proc.toFixed(0).padStart(6)}`
    );
    outSeries.push({
      ts: series[i].ts,
      date,
      netMint: series[i].net,
      mintVol: series[i].mintVol,
      burnVol: series[i].burnVol,
      z,
      procComp: proc,
      sigs: series[i].sigs,
    });
    if (prior.length >= MIN_BASELINE && z > maxZ) {
      maxZ = z;
      maxZAt = date;
    }
    if (prior.length >= MIN_BASELINE && !firstAlert && z >= 2) firstAlert = date;
  }

  console.log("-".repeat(78));
  console.log(`buckets: ${series.length}  window: ${args.bucketHours}h`);
  console.log(`peak velocity z = ${maxZ.toFixed(2)} at ${maxZAt} (procComp ${procurementComponent(Math.round(maxZ * 100)).toFixed(0)})`);
  console.log(
    firstAlert
      ? `⚠️  procurement signal first crossed 2σ at ${firstAlert} — ReserveSentinel would have flagged it here.`
      : `no bucket crossed 2σ in this window (no procurement-velocity spike detected).`
  );

  if (args.jsonOut) {
    const out = {
      symbol: args.symbol,
      mint: args.mint,
      bucketHours: args.bucketHours,
      generatedAt: Date.now(),
      series: outSeries,
      peak: { z: maxZ === -Infinity ? 0 : maxZ, at: maxZAt || null },
      firstAlertAt: firstAlert,
    };
    fs.mkdirSync(path.dirname(args.jsonOut), { recursive: true });
    fs.writeFileSync(args.jsonOut, JSON.stringify(out, null, 2));
    console.log(`\nwrote ${args.jsonOut}`);
  }
}

function fmt(n: number): string {
  const s = n >= 1000 || n <= -1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
  return s.padStart(11);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
