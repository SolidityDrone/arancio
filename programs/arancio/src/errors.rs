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
}
