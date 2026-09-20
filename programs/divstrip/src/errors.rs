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
    #[msg("invalid forwarder authority")]
    InvalidForwarderAuthority,
    #[msg("launch report mint mismatch")]
    LaunchMintMismatch,
    #[msg("invalid launch report encoding")]
    InvalidLaunchPayload,
    #[msg("curve-YT mint does not match vault")]
    BridgeMintMismatch,
    #[msg("vault swap output below minimum")]
    BridgeSlippage,
    #[msg("curve-YT vault has insufficient curve-YT")]
    InsufficientCurveYt,
    #[msg("curve-YT vault has insufficient strip YT")]
    InsufficientStripYt,
    #[msg("curve-YT launch already registered for this series")]
    LaunchAlreadyRegistered,
    #[msg("registrar must be strip market authority")]
    UnauthorizedRegistrar,
    #[msg("canonical curve-YT launch not registered for this series")]
    LaunchNotRegistered,
}
