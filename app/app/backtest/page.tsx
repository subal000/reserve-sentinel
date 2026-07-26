import crclonSol from "@/lib/backtest-data/crclon.json";
import crclonEth from "@/lib/backtest-data/crclon-eth.json";
import { BacktestView, type Dataset } from "@/components/BacktestView";
import type { BacktestPoint } from "@/components/BacktestChart";

// Solana backtest JSON uses `sigs` per bucket; the EVM one uses `txs`.
// Normalize both to `txs` so the shared components are chain-agnostic.
type RawBucket = {
  ts: number;
  date: string;
  netMint: number;
  mintVol: number;
  burnVol: number;
  z: number;
  procComp: number;
  sigs?: string[];
  txs?: string[];
};

function normalizeSeries(series: RawBucket[]): BacktestPoint[] {
  return series.map((s) => ({
    ts: s.ts,
    date: s.date,
    netMint: s.netMint,
    mintVol: s.mintVol,
    burnVol: s.burnVol,
    z: s.z,
    procComp: s.procComp,
    txs: s.txs ?? s.sigs ?? [],
  }));
}

export default function BacktestPage() {
  const sol = crclonSol as {
    symbol: string;
    mint: string;
    bucketHours: number;
    generatedAt: number;
    series: RawBucket[];
    peak: { z: number; at: string | null };
    firstAlertAt: string | null;
  };
  const eth = crclonEth as {
    symbol: string;
    address: string;
    bucketHours: number;
    generatedAt: number;
    series: RawBucket[];
    peak: { z: number; at: string | null };
    firstAlertAt: string | null;
  };

  const datasets: Dataset[] = [
    {
      chain: "solana",
      chainLabel: "Solana",
      symbol: sol.symbol,
      ref: sol.mint,
      refLabel: "Mint",
      bucketHours: sol.bucketHours,
      generatedAt: sol.generatedAt,
      scriptName: "scripts/backtest.ts",
      series: normalizeSeries(sol.series),
      peak: sol.peak,
      firstAlertAt: sol.firstAlertAt,
    },
    {
      chain: "ethereum",
      chainLabel: "Ethereum",
      symbol: eth.symbol,
      ref: eth.address,
      refLabel: "Contract",
      bucketHours: eth.bucketHours,
      generatedAt: eth.generatedAt,
      scriptName: "scripts/backtest_evm.ts",
      series: normalizeSeries(eth.series),
      peak: eth.peak,
      firstAlertAt: eth.firstAlertAt,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Backtest: mint/burn anomaly signal</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          The mint/burn-velocity signal replayed over real history for the <em>same</em> tokenized stock
          (Circle) on <em>two different chains</em> — same methodology, so it&apos;s chain-agnostic. It
          surfaces unusual supply spikes; note a spike on its own isn&apos;t a risk verdict (it can be
          demand, arbitrage/MEV, or genuine stress — the full composite adds premium + liquidity to tell
          them apart, and those can&apos;t be reconstructed historically).
        </p>
      </div>
      <BacktestView datasets={datasets} />
    </div>
  );
}
