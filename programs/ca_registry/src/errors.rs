use anchor_lang::prelude::*;

#[error_code]
pub enum CaRegistryError {
    #[msg("Events must be sorted by effective_ts ascending")]
    EventsNotSorted,
    #[msg("Duplicate event id")]
    DuplicateEvent,
    #[msg("Invalid forwarder authority")]
    InvalidForwarderAuthority,
    #[msg("Account hash mismatch")]
    AccountHashMismatch,
    #[msg("Registry event capacity exceeded")]
    CapacityExceeded,
    #[msg("No event at or before timestamp")]
    NotFound,
    #[msg("Invalid ca_type")]
    InvalidCaType,
    #[msg("Symbol must be 1-8 ASCII characters")]
    InvalidSymbol,
    #[msg("Payload mint does not match registry mint")]
    MintMismatch,
    #[msg("Invalid report payload encoding")]
    InvalidPayload,
    #[msg("Invalid kind")]
    InvalidKind,
    #[msg("Invalid multiplier")]
    InvalidMultiplier,
    #[msg("Arithmetic overflow")]
    Overflow,
}
