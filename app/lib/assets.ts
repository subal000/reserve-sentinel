// Static per-asset metadata (symbol + notes) that isn't on-chain. Everything
// else (issuer, ticker, trust_tier, score, signals) is read live from the PDA.
// Keep in sync with config/assets.json (non-placeholder entries).

export type AssetMeta = {
  symbol: string;
  mint: string;
  hasPriceFeed: boolean; // false => premium component disabled (e.g. SPCX)
  note: string;
};

export const ASSETS: AssetMeta[] = [
  {
    symbol: "CRCLx",
    mint: "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1",
    hasPriceFeed: true,
    note: "Circle stock via xStocks. Flagship cross-issuer comparison vs CRCLon.",
  },
  {
    symbol: "CRCLon",
    mint: "6xHEyem9hmkGtVq6XGCiQUGpPsHBaoYuYdFNZa5ondo",
    hasPriceFeed: true,
    note: "Circle stock via Ondo. Mint/redeem-first — thin on-chain DEX liquidity.",
  },
  {
    symbol: "SPCX",
    mint: "SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb",
    hasPriceFeed: false,
    note: "SpaceX (private) via Backpack/Sunrise. No reference price — premium disabled.",
  },
  {
    symbol: "AAPLx",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    hasPriceFeed: true,
    note: "Apple via xStocks. Deep liquidity — a control asset.",
  },
  {
    symbol: "TSLAx",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    hasPriceFeed: true,
    note: "Tesla via xStocks.",
  },
  {
    symbol: "MU",
    mint: "MUxEsUKSMACyw5fZf68wxf5FLnZVhtU9CwH8uNNGay1",
    hasPriceFeed: true,
    note: "Micron via Backpack/Sunrise. Market-hours equity reference feed.",
  },
];

export function metaByMint(mint: string): AssetMeta | undefined {
  return ASSETS.find((a) => a.mint === mint);
}
