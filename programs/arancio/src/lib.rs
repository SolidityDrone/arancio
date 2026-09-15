use anchor_lang::prelude::*;

mod errors;
pub mod instructions;
pub mod math;
pub mod state;

pub use instructions::config::{
    FreezeAddressBook, InitializeAddressBook, InitializeGlobalConfig, UpdateAddressBook,
};
pub(crate) use instructions::config::{
    __client_accounts_freeze_address_book, __client_accounts_initialize_address_book,
    __client_accounts_initialize_global_config, __client_accounts_update_address_book,
};
pub use instructions::deposit::Deposit;
pub(crate) use instructions::deposit::__client_accounts_deposit;
pub use instructions::vault::CreateVault;
pub(crate) use instructions::vault::__client_accounts_create_vault;

declare_id!("FwYP85cYksB7gHWe67CEUcYEFokikEUYGmf9ZGt8Qqgf");

#[program]
pub mod arancio {
    use super::*;

    pub fn initialize_global_config(
        ctx: Context<InitializeGlobalConfig>,
        address_book: Pubkey,
        max_components: u8,
    ) -> Result<()> {
        instructions::config::initialize_global_config(ctx, address_book, max_components)
    }

    pub fn initialize_address_book(
        ctx: Context<InitializeAddressBook>,
        program_ids: state::AddressBookInput,
    ) -> Result<()> {
        instructions::config::initialize_address_book(ctx, program_ids)
    }

    pub fn update_address_book(
        ctx: Context<UpdateAddressBook>,
        program_ids: state::AddressBookInput,
    ) -> Result<()> {
        instructions::config::update_address_book(ctx, program_ids)
    }

    pub fn freeze_address_book(ctx: Context<FreezeAddressBook>) -> Result<()> {
        instructions::config::freeze_address_book(ctx)
    }

    pub fn create_vault(
        ctx: Context<CreateVault>,
        name: Vec<u8>,
        input_mint: Pubkey,
        components: Vec<state::ComponentInput>,
    ) -> Result<()> {
        instructions::vault::create_vault(ctx, name, input_mint, components)
    }

    /// ERC-4626-style deposit of the vault `input_mint`; mints proportional shares.
    pub fn deposit(ctx: Context<Deposit>, assets: u64, min_shares: u64) -> Result<()> {
        instructions::deposit::deposit(ctx, assets, min_shares)
    }
}
