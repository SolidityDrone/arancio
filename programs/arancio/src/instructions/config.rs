use anchor_lang::prelude::*;

use crate::{
    errors::ArancioError,
    state::{
        AddressBook, AddressBookInput, GlobalConfig, ADDRESS_BOOK_SEED, GLOBAL_CONFIG_SEED,
        MAX_COMPONENTS,
    },
};

#[derive(Accounts)]
pub struct InitializeGlobalConfig<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = GlobalConfig::SPACE,
        seeds = [GLOBAL_CONFIG_SEED],
        bump
    )]
    pub global_config: Account<'info, GlobalConfig>,
    /// CHECK: the address book key is stored and validated when vaults are created.
    pub address_book: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_global_config(
    ctx: Context<InitializeGlobalConfig>,
    address_book: Pubkey,
    max_components: u8,
) -> Result<()> {
    let (expected_address_book, _) =
        Pubkey::find_program_address(&[ADDRESS_BOOK_SEED], ctx.program_id);
    require!(
        address_book == expected_address_book,
        ArancioError::InvalidAddressBook
    );
    require!(
        ctx.accounts.address_book.key() == address_book,
        ArancioError::InvalidAddressBook
    );
    require!(max_components > 0, ArancioError::NoComponents);
    require!(
        usize::from(max_components) <= MAX_COMPONENTS,
        ArancioError::TooManyComponents
    );

    let global_config = &mut ctx.accounts.global_config;
    global_config.authority = ctx.accounts.payer.key();
    global_config.address_book = address_book;
    global_config.max_components = max_components;
    global_config.bump = ctx.bumps.global_config;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeAddressBook<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = AddressBook::SPACE,
        seeds = [ADDRESS_BOOK_SEED],
        bump
    )]
    pub address_book: Account<'info, AddressBook>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_address_book(
    ctx: Context<InitializeAddressBook>,
    program_ids: AddressBookInput,
) -> Result<()> {
    let address_book = &mut ctx.accounts.address_book;
    address_book.authority = ctx.accounts.authority.key();
    set_program_ids(address_book, program_ids);
    address_book.frozen = false;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateAddressBook<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub address_book: Account<'info, AddressBook>,
}

pub fn update_address_book(
    ctx: Context<UpdateAddressBook>,
    program_ids: AddressBookInput,
) -> Result<()> {
    require!(
        !ctx.accounts.address_book.frozen,
        ArancioError::AddressBookFrozen
    );
    set_program_ids(&mut ctx.accounts.address_book, program_ids);
    Ok(())
}

#[derive(Accounts)]
pub struct FreezeAddressBook<'info> {
    pub authority: Signer<'info>,
    #[account(mut, has_one = authority)]
    pub address_book: Account<'info, AddressBook>,
}

pub fn freeze_address_book(ctx: Context<FreezeAddressBook>) -> Result<()> {
    require!(
        !ctx.accounts.address_book.frozen,
        ArancioError::AddressBookFrozen
    );
    ctx.accounts.address_book.frozen = true;
    Ok(())
}

fn set_program_ids(address_book: &mut AddressBook, program_ids: AddressBookInput) {
    address_book.kamino_program = program_ids.kamino_program;
    address_book.jupiter_program = program_ids.jupiter_program;
    address_book.token_program = program_ids.token_program;
    address_book.token_2022_program = program_ids.token_2022_program;
    address_book.associated_token_program = program_ids.associated_token_program;
}
