//! ReserveSentinel — on-chain risk scores for tokenized RWA stocks on Solana.
//!
//! The program is deliberately thin: it stores one `AssetScore` PDA per tracked
//! mint and enforces that only a registered authority can write scores, while
//! reads stay permissionless. All scoring intelligence (Pyth premium, liquidity
//! depth, mint/burn velocity) lives in the off-chain Go indexer, which pushes
//! results here via `update_score`.

use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

// Locally-generated program ID (target/deploy/reserve_sentinel-keypair.json).
// Run `anchor keys sync` after generating a dedicated mainnet keypair.
declare_id!("BVkkMMqDuFRgzNtwy9Uc87cJu574YDU6j4us9i7EYMba");

#[program]
pub mod reserve_sentinel {
    use super::*;

    /// Create the canonical score PDA for a mint and set its metadata.
    /// Admin-only in practice (whoever pays); called once per tracked mint.
    pub fn initialize_asset(
        ctx: Context<InitializeAsset>,
        issuer: u8,
        underlying_ticker: [u8; 8],
        trust_tier: u8,
        authority: Pubkey,
    ) -> Result<()> {
        instructions::initialize_asset::initialize_asset_handler(
            ctx,
            issuer,
            underlying_ticker,
            trust_tier,
            authority,
        )
    }

    /// Push fresh risk signals. Authority-gated; reads are free.
    pub fn update_score(
        ctx: Context<UpdateScore>,
        score: u8,
        premium_bps: i32,
        liquidity_depth_usd: u64,
        mint_burn_z: i32,
    ) -> Result<()> {
        instructions::update_score::update_score_handler(
            ctx,
            score,
            premium_bps,
            liquidity_depth_usd,
            mint_burn_z,
        )
    }
}
