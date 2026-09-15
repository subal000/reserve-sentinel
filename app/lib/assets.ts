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
    hasPriceFeed: true,
    note: "SpaceX (private) via Backpack/Sunrise. Reference is Backpack's published mark (via Jupiter), not an independent market.",
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
  // PreStocks: private-company tokens backed by SPV exposure. The premium is
  // measured against PreStocks' own published mark, not an independent market.
  {
    symbol: "SPACEX",
    mint: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
    hasPriceFeed: true,
    note: "SpaceX via PreStocks. Same company as SPCX on a different issuer. Reference is PreStocks' own mark.",
  },
  {
    symbol: "OPENAI",
    mint: "PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF",
    hasPriceFeed: true,
    note: "OpenAI via PreStocks. Reference is PreStocks' own mark.",
  },
  {
    symbol: "ANTHROPIC",
    mint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
    hasPriceFeed: true,
    note: "Anthropic via PreStocks. Reference is PreStocks' own mark.",
  },
  {
    symbol: "ANDURIL",
    mint: "PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB",
    hasPriceFeed: true,
    note: "Anduril via PreStocks. Reference is PreStocks' own mark.",
  },
  {
    symbol: "NEURALINK",
    mint: "PrekqLJvJ3qVdXmBGDiexvwUTF4rLFDa6HWS4HJbw9S",
    hasPriceFeed: true,
    note: "Neuralink via PreStocks. Reference is PreStocks' own mark.",
  },
  {
    symbol: "POLYMARKET",
    mint: "Pre8AREmFPtoJFT8mQSXQLh56cwJmM7CFDRuoGBZiUP",
    hasPriceFeed: true,
    note: "Polymarket via PreStocks. Reference is PreStocks' own mark.",
  },
  {
    symbol: "FIGUREAI",
    mint: "PreZad18qfPtbxNpMtMuAuX2zVpvkEU8DnJx56faCWd",
    hasPriceFeed: true,
    note: "Figure AI via PreStocks. Reference is PreStocks' own mark.",
  },
  {
    symbol: "KALSHI",
    mint: "PreLWGkkeqG1s4HEfFZSy9moCrJ7btsHuUtfcCeoRua",
    hasPriceFeed: true,
    note: "Kalshi via PreStocks. Reference is PreStocks' own mark.",
  },
];

export function metaByMint(mint: string): AssetMeta | undefined {
  return ASSETS.find((a) => a.mint === mint);
}
