use anchor_lang::prelude::*;

/// One `AssetScore` PDA exists per tracked mint.
///
/// PDA seeds: [b"asset_score", mint.as_ref()]
///
/// The account is a *storage + authority* layer only. All scoring math runs
/// off-chain in the Go indexer; the program simply guarantees that:
///   - there is exactly one canonical account per mint (PDA uniqueness), and
///   - only the registered `authority` can mutate the score fields, while
///     anyone (dashboards, DeFi protocols) can read them for free.
///
/// `#[derive(InitSpace)]` lets Anchor compute the byte size at compile time so
/// we never hand-count and get rent wrong. See `AssetScore::INIT_SPACE`.
#[account]
#[derive(InitSpace, Debug)]
pub struct AssetScore {
    /// The tokenized-stock mint this score describes.
    pub mint: Pubkey,

    /// Issuer enum: 0=xStocks, 1=Ondo, 2=Backpack/Sunrise, 3=other.
    /// Kept as a raw u8 (not a Rust enum) so new issuers can be added without
    /// a program upgrade — the frontend owns the label mapping.
    pub issuer: u8,

    /// Right-padded ASCII ticker of the *underlying* equity, e.g. b"CRCL    ".
    /// This groups cross-issuer wrappers (CRCLx vs CRCLON both -> "CRCL")
    /// so the frontend can render side-by-side comparisons.
    pub underlying_ticker: [u8; 8],

    /// Manually assigned custodial-trust tier, 0-3:
    ///   3 = redeemable / custodial (real shares held, redeemable)
    ///   0 = purely synthetic
    /// Feeds the `trust_tier_component` of the composite score off-chain.
    pub trust_tier: u8,

    /// Composite risk score, 0-100. Higher = safer.
    pub score: u8,

    /// Signed premium/discount vs the reference (Pyth) price, in basis points.
    /// Positive = trading above the real stock, negative = below.
    pub premium_bps: i32,

    /// Estimated USD notional required to move the on-chain price 1%.
    /// A proxy for how thin the DEX liquidity is.
    pub liquidity_depth_usd: u64,

    /// Z-score of recent mint/burn velocity, scaled x100 (so 2.5σ -> 250).
    /// A spike signals procurement stress (issuer minting fast to meet demand).
    pub mint_burn_z: i32,

    /// Unix timestamp (seconds) of the last successful `update_score`.
    pub last_updated: i64,

    /// The only key permitted to call `update_score`. Typically the indexer's
    /// backend hot keypair. Reads are permissionless.
    pub authority: Pubkey,

    /// Stored PDA bump, so downstream CPIs / re-derivations are cheap and
    /// don't have to brute-force the canonical bump again.
    pub bump: u8,
}

impl AssetScore {
    /// Anchor account discriminator (8) + `INIT_SPACE` from the derive macro.
    pub const SPACE: usize = 8 + Self::INIT_SPACE;

    /// PDA seed prefix. Kept in one place so instructions and clients agree.
    pub const SEED_PREFIX: &'static [u8] = b"asset_score";
}
