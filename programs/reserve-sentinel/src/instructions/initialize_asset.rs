use anchor_lang::prelude::*;

use crate::errors::ReserveSentinelError;
use crate::state::AssetScore;

/// Creates the canonical `AssetScore` PDA for a given mint and stamps its
/// immutable-ish metadata (issuer, underlying ticker, trust tier, authority).
///
/// Called once per tracked mint by the project's admin (the `payer`). The
/// scoring fields (score/premium/liquidity/z) start zeroed and are filled in
/// by the first `update_score` call.
#[derive(Accounts)]
#[instruction(issuer: u8, underlying_ticker: [u8; 8], trust_tier: u8, authority: Pubkey)]
pub struct InitializeAsset<'info> {
    /// The tokenized-stock mint this score account tracks.
    ///
    /// Typed as `UncheckedAccount` on purpose: we do NOT deserialize it as an
    /// SPL/Token-2022 mint here because tokenized stocks live behind several
    /// token programs and we only need its pubkey as a PDA seed. The indexer
    /// verifies the mint actually exists on mainnet before ever calling this.
    /// CHECK: used only as a PDA seed; not read or written.
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = payer,
        space = AssetScore::SPACE,
        seeds = [AssetScore::SEED_PREFIX, mint.key().as_ref()],
        bump,
    )]
    pub asset_score: Account<'info, AssetScore>,

    /// Pays rent and signs the init. The project admin.
    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_asset_handler(
    ctx: Context<InitializeAsset>,
    issuer: u8,
    underlying_ticker: [u8; 8],
    trust_tier: u8,
    authority: Pubkey,
) -> Result<()> {
    require!(issuer <= 3, ReserveSentinelError::IssuerOutOfRange);
    require!(trust_tier <= 3, ReserveSentinelError::TrustTierOutOfRange);
    validate_ticker(&underlying_ticker)?;

    let asset = &mut ctx.accounts.asset_score;
    asset.mint = ctx.accounts.mint.key();
    asset.issuer = issuer;
    asset.underlying_ticker = underlying_ticker;
    asset.trust_tier = trust_tier;
    asset.authority = authority;

    // Scoring fields start empty; first update_score populates them.
    asset.score = 0;
    asset.premium_bps = 0;
    asset.liquidity_depth_usd = 0;
    asset.mint_burn_z = 0;
    asset.last_updated = 0;

    asset.bump = ctx.bumps.asset_score;

    msg!(
        "Initialized AssetScore for mint {} (issuer={}, trust_tier={})",
        asset.mint,
        issuer,
        trust_tier
    );
    Ok(())
}

/// Ticker must be printable ASCII uppercase letters/digits, space-padded on the
/// right (e.g. b"CRCL    "). This keeps the on-chain grouping key clean and
/// prevents junk bytes that would break frontend string decoding.
fn validate_ticker(ticker: &[u8; 8]) -> Result<()> {
    let mut seen_pad = false;
    for &b in ticker.iter() {
        match b {
            b' ' => seen_pad = true,
            b'A'..=b'Z' | b'0'..=b'9' => {
                // No non-space characters allowed after padding has begun,
                // i.e. the ticker must be left-aligned.
                require!(!seen_pad, ReserveSentinelError::InvalidTicker);
            }
            _ => return err!(ReserveSentinelError::InvalidTicker),
        }
    }
    Ok(())
}
