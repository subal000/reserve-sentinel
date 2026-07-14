/**
 * init_assets.ts — one-time bootstrap.
 *
 * Reads config/assets.json and calls `initialize_asset` for every asset whose
 * fields are fully populated (no TODO_ placeholders). Idempotent: assets whose
 * PDA already exists are skipped.
 *
 * Usage:
 *   ANCHOR_PROVIDER_URL=<rpc> ANCHOR_WALLET=~/.config/solana/id.json \
 *   AUTHORITY_PUBKEY=<indexer authority> \
 *   npm run init-assets
 */
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { ReserveSentinel } from "../target/types/reserve_sentinel";

type Asset = {
  symbol: string;
  mint: string;
  issuer: number;
  underlying_ticker: string;
  trust_tier: number;
};

function tickerBytes(s: string): number[] {
  const padded = s.toUpperCase().padEnd(8, " ");
  if (padded.length !== 8) throw new Error(`ticker too long: ${s}`);
  return Array.from(Buffer.from(padded, "ascii"));
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.ReserveSentinel as anchor.Program<ReserveSentinel>;

  // The backend keypair allowed to call update_score. Reads are permissionless,
  // so this only needs to be a pubkey here.
  const authorityStr = process.env.AUTHORITY_PUBKEY;
  if (!authorityStr) throw new Error("set AUTHORITY_PUBKEY to the indexer's signer pubkey");
  const authority = new PublicKey(authorityStr);

  const cfgPath = path.resolve(__dirname, "../config/assets.json");
  const registry = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as { assets: Asset[] };

  for (const a of registry.assets) {
    if ([a.mint, a.symbol, a.underlying_ticker].some((v) => v.startsWith("TODO"))) {
      console.log(`skip ${a.symbol}: config still has TODO placeholders`);
      continue;
    }

    const mint = new PublicKey(a.mint);
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("asset_score"), mint.toBuffer()],
      program.programId
    );

    const existing = await program.account.assetScore.fetchNullable(pda);
    if (existing) {
      console.log(`skip ${a.symbol}: already initialized at ${pda.toBase58()}`);
      continue;
    }

    const sig = await program.methods
      .initializeAsset(a.issuer, tickerBytes(a.underlying_ticker), a.trust_tier, authority)
      // accountsPartial: Anchor 0.32 auto-resolves system_program + the PDA;
      // we only must supply `mint` (a seed input) and the payer.
      .accountsPartial({
        mint,
        payer: provider.wallet.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    console.log(`init ${a.symbol} -> ${pda.toBase58()} (tx ${sig})`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
