use anchor_lang::prelude::*;

#[error_code]
pub enum ReserveSentinelError {
    #[msg("Score must be within 0-100.")]
    ScoreOutOfRange,

    #[msg("Trust tier must be within 0-3.")]
    TrustTierOutOfRange,

    #[msg("Issuer code must be within 0-3.")]
    IssuerOutOfRange,

    #[msg("Signer is not the registered authority for this asset.")]
    UnauthorizedAuthority,

    #[msg("Underlying ticker must be ASCII uppercase/space, right-padded to 8 bytes.")]
    InvalidTicker,
}
