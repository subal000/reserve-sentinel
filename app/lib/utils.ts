import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Cluster-aware Solana explorer link (devnet build must not link to mainnet).
export function explorerAccount(address: string, cluster: string): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}

// Backtest data is always reconstructed from real MAINNET history regardless
// of which cluster the app is currently pointed at — so this is never
// cluster-parameterized like explorerAccount above.
export function explorerTx(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}`;
}
