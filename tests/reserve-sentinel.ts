import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { ReserveSentinel } from "../target/types/reserve_sentinel";

// Right-pad an ASCII ticker to the fixed [u8; 8] on-chain layout.
function tickerBytes(s: string): number[] {
  const padded = s.toUpperCase().padEnd(8, " ");
  if (padded.length !== 8) throw new Error("ticker too long");
  return Array.from(Buffer.from(padded, "ascii"));
}

describe("reserve-sentinel", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.ReserveSentinel as Program<ReserveSentinel>;

  // Stand-in for a real tokenized-stock mint. The program never deserializes
  // it, so any pubkey works for testing the score-account lifecycle.
  const mint = Keypair.generate().publicKey;

  // The backend indexer keypair allowed to push scores.
  const authority = Keypair.generate();

  const [assetScorePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("asset_score"), mint.toBuffer()],
    program.programId
  );

  before(async () => {
    // Fund the authority so it can pay tx fees for update_score.
    const sig = await provider.connection.requestAirdrop(
      authority.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  });

  it("initializes an asset score PDA", async () => {
    await program.methods
      .initializeAsset(
        1, // issuer: Ondo
        tickerBytes("CRCL"),
        3, // trust_tier: redeemable/custodial
        authority.publicKey
      )
      .accountsPartial({
        mint,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const acct = await program.account.assetScore.fetch(assetScorePda);
    assert.ok(acct.mint.equals(mint));
    assert.equal(acct.issuer, 1);
    assert.equal(acct.trustTier, 3);
    assert.equal(acct.score, 0);
    assert.ok(acct.authority.equals(authority.publicKey));
    assert.equal(Buffer.from(acct.underlyingTicker).toString("ascii"), "CRCL    ");
  });

  it("lets the authority update the score", async () => {
    await program.methods
      .updateScore(72, -85, new anchor.BN(1_250_000), 240)
      .accounts({
        assetScore: assetScorePda,
        authority: authority.publicKey,
      })
      .signers([authority])
      .rpc();

    const acct = await program.account.assetScore.fetch(assetScorePda);
    assert.equal(acct.score, 72);
    assert.equal(acct.premiumBps, -85);
    assert.equal(acct.liquidityDepthUsd.toNumber(), 1_250_000);
    assert.equal(acct.mintBurnZ, 240);
    assert.ok(acct.lastUpdated.toNumber() > 0);
  });

  it("rejects a score above 100", async () => {
    try {
      await program.methods
        .updateScore(101, 0, new anchor.BN(0), 0)
        .accounts({ assetScore: assetScorePda, authority: authority.publicKey })
        .signers([authority])
        .rpc();
      assert.fail("expected ScoreOutOfRange");
    } catch (e: any) {
      assert.include(e.toString(), "ScoreOutOfRange");
    }
  });

  it("rejects an update from a non-authority signer", async () => {
    const imposter = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      imposter.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .updateScore(50, 0, new anchor.BN(0), 0)
        .accounts({ assetScore: assetScorePda, authority: imposter.publicKey })
        .signers([imposter])
        .rpc();
      assert.fail("expected UnauthorizedAuthority");
    } catch (e: any) {
      // has_one mismatch surfaces as the custom error we mapped it to.
      assert.include(e.toString(), "UnauthorizedAuthority");
    }
  });

  it("rejects a malformed (non-left-aligned) ticker on init", async () => {
    const badMint = Keypair.generate().publicKey;
    const [badPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("asset_score"), badMint.toBuffer()],
      program.programId
    );
    try {
      await program.methods
        .initializeAsset(0, tickerBytes(" CRCL"), 0, authority.publicKey)
        .accountsPartial({
          mint: badMint,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("expected InvalidTicker");
    } catch (e: any) {
      assert.include(e.toString(), "InvalidTicker");
    }
    // silence unused-var lint for badPda in case of future assertions
    void badPda;
  });
});
