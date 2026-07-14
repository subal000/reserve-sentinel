use anchor_lang::prelude::*;

use crate::errors::ReserveSentinelError;
use crate::state::AssetScore;

/// Writes fresh risk signals for an already-initialized asset.
///
/// Authority-gated: only `asset_score.authority` may sign. Anyone may *read*
/// the account off-chain, which is the whole point — the score is a public,
/// composable feed.
#[derive(Accounts)]
pub struct UpdateScore<'info> {
    #[account(
        mut,
        seeds = [AssetScore::SEED_PREFIX, asset_score.mint.as_ref()],
        bump = asset_score.bump,
        // Belt-and-suspenders: the seeds derivation already binds this PDA to
        // the mint, and `has_one` enforces the signer matches the stored
        // authority. Either alone would do; both make the intent explicit.
        has_one = authority @ ReserveSentinelError::UnauthorizedAuthority,
    )]
    pub asset_score: Account<'info, AssetScore>,

    /// Must equal `asset_score.authority` (enforced by `has_one`).
    pub authority: Signer<'info>,
}

pub fn update_score_handler(
    ctx: Context<UpdateScore>,
    score: u8,
    premium_bps: i32,
    liquidity_depth_usd: u64,
    mint_burn_z: i32,
) -> Result<()> {
    require!(score <= 100, ReserveSentinelError::ScoreOutOfRange);

    let asset = &mut ctx.accounts.asset_score;
    asset.score = score;
    asset.premium_bps = premium_bps;
    asset.liquidity_depth_usd = liquidity_depth_usd;
    asset.mint_burn_z = mint_burn_z;
    // Use the cluster clock so the timestamp is trustless, not client-supplied.
    asset.last_updated = Clock::get()?.unix_timestamp;

    msg!(
        "Updated {} -> score={} premium_bps={} depth_usd={} z={}",
        asset.mint,
        score,
        premium_bps,
        liquidity_depth_usd,
        mint_burn_z
    );
    Ok(())
}
