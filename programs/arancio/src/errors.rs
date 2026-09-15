use anchor_lang::prelude::*;

#[error_code]
pub enum ArancioError {
    #[msg("weights must not be empty")]
    EmptyWeights,
    #[msg("weights must sum to 10000 basis points")]
    InvalidWeightTotal,
    #[msg("division by zero")]
    DivisionByZero,
    #[msg("arithmetic overflow")]
    ArithmeticOverflow,
    #[msg("vault name is too long")]
    NameTooLong,
    #[msg("vault name must not be empty")]
    EmptyName,
    #[msg("vault must have at least one component")]
    NoComponents,
    #[msg("component count exceeds the configured maximum")]
    TooManyComponents,
    #[msg("address book is not frozen")]
    AddressBookNotFrozen,
    #[msg("address book is already frozen")]
    AddressBookFrozen,
    #[msg("address book does not match the program PDA")]
    InvalidAddressBook,
    #[msg("token program does not match the frozen address book")]
    InvalidTokenProgram,
    #[msg("share mint does not match the vault config")]
    InvalidShareMint,
    #[msg("deposit amount must be greater than zero")]
    ZeroDepositAmount,
    #[msg("minted shares are below the requested minimum")]
    MinSharesNotMet,
    #[msg("component mint does not match the supplied accounts")]
    InvalidComponentMint,
}
