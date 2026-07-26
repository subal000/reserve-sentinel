/**
 * backtest_evm.ts — cross-chain version of the procurement-stress backtest.
 *
 * Same methodology as scripts/backtest.ts (mint/burn velocity z-score →
 * procurement component), but for an EVM chain instead of Solana. The whole
 * point: the signal is chain-agnostic. A tokenized stock's supply expanding or
 * contracting is the same risk whether it's a Solana SPL mint or an ERC-20.
 *
 * An ERC-20 mint is a Transfer event FROM the zero address; a burn is a Transfer
 * TO the zero address. We pull both via Etherscan's getLogs (works for any
 * Etherscan-family explorer via chainid), bucket by time, and replay the score.
 *
 * Usage:
 *   ETHERSCAN_API_KEY=... npx ts-node scripts/backtest_evm.ts \
 *     --address 0x3632dea96a953c11dac2f00b4a05a32cd1063fae --symbol CRCLon \
 *     --chainid 1 --bucket 24 --json app/lib/backtest-data/crclon-eth.json
 */
import * as fs from "fs";
import * as path from "path";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = "0x0000000000000000000000000000000000000000000000000000000000000000";

type Args = {
  address: string;
  symbol: string;
  chainId: number;
  bucketHours: number;
  decimals: number;
  apiKey: string;
  jsonOut: string;
};

function parseArgs(argv: string[]): Args {
  const a: Args = {
    address: "0x3632dea96a953c11dac2f00b4a05a32cd1063fae", // CRCLon on Ethereum
    symbol: "CRCLon",
    chainId: 1,
    bucketHours: 24,
    decimals: 0, // 0 = auto-detect via eth_call
    apiKey: process.env.ETHERSCAN_API_KEY || "",
    jsonOut: "",
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    if (argv[i] === "--address") a.address = v.toLowerCase();
    else if (argv[i] === "--symbol") a.symbol = v;
    else if (argv[i] === "--chainid") a.chainId = Number(v);
    else if (argv[i] === "--bucket") a.bucketHours = Number(v);
    else if (argv[i] === "--decimals") a.decimals = Number(v);
    else if (argv[i] === "--json") a.jsonOut = v;
  }
  return a;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function api(a: Args, params: Record<string, string>): string {
  const q = new URLSearchParams({ chainid: String(a.chainId), apikey: a.apiKey, ...params });
  return `https://api.etherscan.io/v2/api?${q.toString()}`;
}

async function etherscan(a: Args, params: Record<string, string>): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(api(a, params));
    const json = (await res.json()) as { status?: string; message?: string; result?: any };
    // Etherscan returns status "0" for both "no results" and rate-limit; the
    // message disambiguates.
    if (json.status === "1") return json.result;
    const msg = String(json.message ?? "") + " " + String(json.result ?? "");
    if (/rate limit|max .* rate/i.test(msg) && attempt < 5) {
      await sleep(1500 * attempt);
      continue;
    }
    if (/No records|No logs/i.test(msg)) return [];
    throw new Error(`etherscan: ${msg.slice(0, 160)}`);
  }
}

async function getDecimals(a: Args): Promise<number> {
  if (a.decimals > 0) return a.decimals;
  // The proxy module returns a raw JSON-RPC {result} shape, not the status
  // wrapper, so call it directly rather than through etherscan().
  const url = api(a, { module: "proxy", action: "eth_call", to: a.address, data: "0x313ce567", tag: "latest" });
  const json = (await (await fetch(url)).json()) as { result?: string };
  return parseInt(String(json.result ?? "0x12"), 16) || 18;
}

type Event = { ts: number; amount: number; tx: string; kind: "mint" | "burn" };

// Pull all Transfer logs where `zeroTopicPos` (1=from/mint, 2=to/burn) is the
// zero address, paginating by advancing fromBlock.
async function fetchMintBurn(a: Args, zeroTopicPos: 1 | 2, decimals: number): Promise<Event[]> {
  const kind = zeroTopicPos === 1 ? "mint" : "burn";
  const topicKey = zeroTopicPos === 1 ? "topic1" : "topic2";
  const oprKey = zeroTopicPos === 1 ? "topic0_1_opr" : "topic0_2_opr";
  const out: Event[] = [];
  const seen = new Set<string>();
  let fromBlock = 0;

  for (let page = 0; page < 200; page++) {
    const logs: any[] = await etherscan(a, {
      module: "logs",
      action: "getLogs",
      address: a.address,
      topic0: TRANSFER_TOPIC,
      [topicKey]: ZERO_TOPIC,
      [oprKey]: "and",
      fromBlock: String(fromBlock),
      toBlock: "latest",
      page: "1",
      offset: "1000",
    });
    if (logs.length === 0) break;
    let maxBlock = fromBlock;
    for (const l of logs) {
      const id = `${l.transactionHash}:${l.logIndex}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const amount = parseInt(l.data, 16) / 10 ** decimals;
      const ts = parseInt(l.timeStamp, 16);
      const bn = parseInt(l.blockNumber, 16);
      if (bn > maxBlock) maxBlock = bn;
      if (amount > 0) out.push({ ts, amount, tx: l.transactionHash, kind });
    }
    process.stderr.write(`  ${kind}s: ${out.length}\r`);
    if (logs.length < 1000) break;
    fromBlock = maxBlock; // continue from the last block (dedup handles overlap)
    await sleep(250);
  }
  process.stderr.write("\n");
  return out;
}

function procurementComponent(zX100: number): number {
  const z = zX100 / 100;
  return 100 - Math.min(100, Math.max(0, z));
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.apiKey) {
    console.error("set ETHERSCAN_API_KEY");
    process.exit(2);
  }
  const decimals = await getDecimals(a);
  console.log(`backtest ${a.symbol} @ ${a.address} (chainid=${a.chainId}, decimals=${decimals})`);

  const mints = await fetchMintBurn(a, 1, decimals);
  const burns = await fetchMintBurn(a, 2, decimals);
  const events = [...mints, ...burns].sort((x, y) => x.ts - y.ts);
  console.log(`fetched ${mints.length} mints + ${burns.length} burns = ${events.length} events`);
  if (events.length === 0) {
    console.log("no mint/burn history.");
    return;
  }

  // Bucket, keeping the contributing tx hashes for on-chain proof.
  const bucketSecs = a.bucketHours * 3600;
  const buckets = new Map<number, { ts: number; net: number; mintVol: number; burnVol: number; txs: string[] }>();
  for (const e of events) {
    const key = Math.floor(e.ts / bucketSecs) * bucketSecs;
    const cur = buckets.get(key) ?? { ts: key, net: 0, mintVol: 0, burnVol: 0, txs: [] };
    if (e.kind === "mint") {
      cur.net += e.amount;
      cur.mintVol += e.amount;
    } else {
      cur.net -= e.amount;
      cur.burnVol += e.amount;
    }
    if (cur.txs.length < 25) cur.txs.push(e.tx);
    buckets.set(key, cur);
  }
  const series = [...buckets.values()].sort((x, y) => x.ts - y.ts);

  // Rolling-window z-score — mirrors the live indexer's fixed-size
  // VelocityWindow (velocity.go). A trailing baseline (vs. an expanding one)
  // stays sensitive over a long history and doesn't get blown up by the
  // low-variance launch period. Each bucket is scored against the prior WINDOW.
  const WINDOW = 30;
  const MIN_BASELINE = 8;
  console.log("\nbucket (UTC)          netMint      mintVol     burnVol     z      procComp");
  console.log("-".repeat(78));
  let firstAlert: string | null = null;
  let maxZ = -Infinity;
  let maxZAt = "";
  const outSeries: any[] = [];
  for (let i = 0; i < series.length; i++) {
    const prior = series.slice(Math.max(0, i - WINDOW), i).map((s) => s.net);
    const nonZero = prior.filter((x) => Math.abs(x) > 1).length;
    let z = 0;
    // Need a real baseline: enough prior buckets AND enough of them active.
    // The launch ramp is near-zero-variance, which would otherwise inflate z on
    // the first bit of activity (a tiny 1.2k mint reading as 600σ).
    if (prior.length >= MIN_BASELINE && nonZero >= 10) {
      const mean = prior.reduce((s, x) => s + x, 0) / prior.length;
      const varr = prior.reduce((s, x) => s + (x - mean) ** 2, 0) / prior.length;
      const std = Math.sqrt(varr);
      if (std > 0) z = (series[i].net - mean) / std;
    }
    const proc = procurementComponent(Math.round(z * 100));
    const date = new Date(series[i].ts * 1000).toISOString().slice(0, 16).replace("T", " ");
    console.log(`${date}   ${fmt(series[i].net)} ${fmt(series[i].mintVol)} ${fmt(series[i].burnVol)}  ${z.toFixed(2).padStart(6)}  ${proc.toFixed(0).padStart(6)}`);
    outSeries.push({ ts: series[i].ts, date, netMint: series[i].net, mintVol: series[i].mintVol, burnVol: series[i].burnVol, z, procComp: proc, txs: series[i].txs });
    if (prior.length >= MIN_BASELINE && z > maxZ) {
      maxZ = z;
      maxZAt = date;
    }
    if (prior.length >= MIN_BASELINE && !firstAlert && z >= 2) firstAlert = date;
  }

  console.log("-".repeat(78));
  console.log(`buckets: ${series.length}  window: ${a.bucketHours}h  span: ${outSeries[0].date} → ${outSeries[outSeries.length - 1].date}`);
  console.log(`peak velocity z = ${maxZ.toFixed(2)} at ${maxZAt} (procComp ${procurementComponent(Math.round(maxZ * 100)).toFixed(0)})`);
  console.log(firstAlert ? `⚠️  first crossed 2σ at ${firstAlert} — would have flagged it here.` : `no bucket crossed 2σ.`);

  if (a.jsonOut) {
    const out = {
      symbol: a.symbol,
      chain: a.chainId === 1 ? "ethereum" : `evm-${a.chainId}`,
      address: a.address,
      bucketHours: a.bucketHours,
      generatedAt: Date.now(),
      series: outSeries,
      peak: { z: maxZ === -Infinity ? 0 : maxZ, at: maxZAt || null },
      firstAlertAt: firstAlert,
    };
    fs.mkdirSync(path.dirname(a.jsonOut), { recursive: true });
    fs.writeFileSync(a.jsonOut, JSON.stringify(out, null, 2));
    console.log(`\nwrote ${a.jsonOut}`);
  }
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(abs < 1 ? 3 : 0);
  return s.padStart(11);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
