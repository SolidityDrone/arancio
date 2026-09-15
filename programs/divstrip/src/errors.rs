use anchor_lang::prelude::*;

#[error_code]
pub enum DivStripError {
    #[msg("symbol must be 1-8 ASCII characters")]
    InvalidSymbol,
    #[msg("lock_nonces must be greater than zero")]
    InvalidLockNonces,
    #[msg("registry mint does not match strip underlying")]
    RegistryMintMismatch,
    #[msg("series window does not match")]
    SeriesMismatch,
    #[msg("yield window has not matured yet")]
    WindowNotMature,
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("yield nonce not found in registry")]
    YieldNonceNotFound,
    #[msg("token program mismatch")]
    InvalidTokenProgram,
}
