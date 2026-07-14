// On-chain read layer. Reads AssetScore PDAs directly via @coral-xyz/anchor.
// Runs in Server Components (Node) — no separate backend API, no browser
// polyfills. This is the "scores live on-chain, read them directly" promise.

import { AnchorProvider, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import idl from "./idl/reserve_sentinel.json";
import { ASSETS, type AssetMeta } from "./assets";

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";
export const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? "devnet";
const PROGRAM_ID = new PublicKey((idl as { address: string }).address);

export type AssetScore = {
  symbol: string;
  mint: string;
  pda: string;
  issuer: number;
  underlyingTicker: string;
  trustTier: number;
  score: number;
  premiumBps: number;
  liquidityDepthUsd: number;
  mintBurnZ: number;
  lastUpdated: number;
  authority: string;
  hasPriceFeed: boolean;
  note: string;
  initialized: boolean;
};

function getProgram(): Program {
  const connection = new Connection(RPC_URL, "confirmed");
  // Read-only provider: a minimal wallet-shaped object whose signing methods
  // are never called (we only fetch accounts). Avoids depending on anchor's
  // `Wallet` export, which isn't resolvable in the Next build.
  const wallet = {
    publicKey: Keypair.generate().publicKey,
    signTransaction: async <T>(tx: T) => tx,
    signAllTransactions: async <T>(txs: T[]) => txs,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider = new AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  // anchor 0.30+: programId comes from idl.address.
  return new Program(idl as never, provider);
}

export function pdaForMint(mint: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("asset_score"), new PublicKey(mint).toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

function tickerToString(t: number[] | Uint8Array): string {
  return Buffer.from(t as Uint8Array).toString("ascii").replace(/\0/g, "").trim();
}

function bnToNumber(v: { toString(): string } | number): number {
  return typeof v === "number" ? v : Number(v.toString());
}

function emptyScore(meta: AssetMeta, pda: string): AssetScore {
  return {
    symbol: meta.symbol,
    mint: meta.mint,
    pda,
    issuer: 0,
    underlyingTicker: "",
    trustTier: 0,
    score: 0,
    premiumBps: 0,
    liquidityDepthUsd: 0,
    mintBurnZ: 0,
    lastUpdated: 0,
    authority: "",
    hasPriceFeed: meta.hasPriceFeed,
    note: meta.note,
    initialized: false,
  };
}

/** Fetch every tracked asset's on-chain score in one round-trip. */
export async function fetchAllScores(): Promise<AssetScore[]> {
  const program = getProgram();
  const pdas = ASSETS.map((a) => pdaForMint(a.mint));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const accounts = await (program.account as any).assetScore.fetchMultiple(pdas);

  return ASSETS.map((meta, i) => {
    const acc = accounts[i];
    const pda = pdas[i].toBase58();
    if (!acc) return emptyScore(meta, pda);
    return {
      symbol: meta.symbol,
      mint: meta.mint,
      pda,
      issuer: acc.issuer,
      underlyingTicker: tickerToString(acc.underlyingTicker),
      trustTier: acc.trustTier,
      score: acc.score,
      premiumBps: acc.premiumBps,
      liquidityDepthUsd: bnToNumber(acc.liquidityDepthUsd),
      mintBurnZ: acc.mintBurnZ,
      lastUpdated: bnToNumber(acc.lastUpdated),
      authority: acc.authority.toBase58(),
      hasPriceFeed: meta.hasPriceFeed,
      note: meta.note,
      initialized: true,
    };
  });
}
