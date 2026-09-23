use anchor_lang::prelude::*;

#[error_code]
pub enum YieldCusdcError {
    #[msg("amount must be greater than zero")]
    ZeroAmount,
    #[msg("arithmetic overflow")]
    Overflow,
    #[msg("division by zero")]
    DivisionByZero,
    #[msg("insufficient vault USDC for redeem")]
    InsufficientLiquidity,
    #[msg("mint mismatch")]
    MintMismatch,
}
