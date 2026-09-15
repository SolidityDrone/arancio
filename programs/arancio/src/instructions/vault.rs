use anchor_lang::prelude::*;
use anchor_spl::{
    token::Mint,
    token_interface::{self, InitializeMint2},
};

use crate::{
    errors::ArancioError,
    math::validate_weights,
    state::{
        AddressBook, ComponentConfig, ComponentInput, GlobalConfig, VaultConfig, MAX_COMPONENTS,
        MAX_VAULT_NAME_BYTES, SHARE_DECIMALS, SHARE_MINT_SEED, VAULT_AUTHORITY_SEED, VAULT_SEED,
    },
};

#[derive(Accounts)]
#[instruction(name: Vec<u8>)]
pub struct CreateVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        constraint = global_config.address_book == address_book.key()
    )]
    pub global_config: Account<'info, GlobalConfig>,
    #[account(constraint = address_book.frozen @ ArancioError::AddressBookNotFrozen)]
    pub address_book: Account<'info, AddressBook>,
    #[account(
        init,
        payer = payer,
        space = VaultConfig::SPACE,
        seeds = [VAULT_SEED, name.as_slice()],
        bump
    )]
    pub vault_config: Account<'info, VaultConfig>,
    #[account(
        mut,
        seeds = [SHARE_MINT_SEED, vault_config.key().as_ref()],
        bump
    )]
    /// CHECK: created and initialized as a standard SPL mint below using the
    /// token program selected by the frozen address book.
    pub share_mint: UncheckedAccount<'info>,
    /// CHECK: this PDA is the share mint authority and is not initialized here.
    #[account(seeds = [VAULT_AUTHORITY_SEED, vault_config.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: checked against the frozen address book before it is used as a
    /// CPI program.
    pub token_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_vault(
    ctx: Context<CreateVault>,
    name: Vec<u8>,
    input_mint: Pubkey,
    components: Vec<ComponentInput>,
) -> Result<()> {
    require!(
        ctx.accounts.token_program.key() == ctx.accounts.address_book.token_program,
        ArancioError::InvalidTokenProgram
    );
    require!(!name.is_empty(), ArancioError::EmptyName);
    require!(
        name.len() <= MAX_VAULT_NAME_BYTES,
        ArancioError::NameTooLong
    );
    require!(!components.is_empty(), ArancioError::NoComponents);
    require!(
        components.len() <= MAX_COMPONENTS,
        ArancioError::TooManyComponents
    );
    require!(
        components.len() <= usize::from(ctx.accounts.global_config.max_components),
        ArancioError::TooManyComponents
    );

    let weights: Vec<u16> = components
        .iter()
        .map(|component| component.weight_bps)
        .collect();
    validate_weights(&weights)?;

    let vault_config_key = ctx.accounts.vault_config.key();
    let share_mint_bump = [ctx.bumps.share_mint];
    let share_mint_seeds: &[&[u8]] =
        &[SHARE_MINT_SEED, vault_config_key.as_ref(), &share_mint_bump];
    let create_mint_accounts = anchor_lang::system_program::CreateAccount {
        from: ctx.accounts.payer.to_account_info(),
        to: ctx.accounts.share_mint.to_account_info(),
    };
    anchor_lang::system_program::create_account(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            create_mint_accounts,
        )
        .with_signer(&[share_mint_seeds]),
        Rent::get()?.minimum_balance(Mint::LEN),
        Mint::LEN as u64,
        &ctx.accounts.token_program.key(),
    )?;

    token_interface::initialize_mint2(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            InitializeMint2 {
                mint: ctx.accounts.share_mint.to_account_info(),
            },
        ),
        SHARE_DECIMALS,
        &ctx.accounts.vault_authority.key(),
        None,
    )?;

    let vault_config = &mut ctx.accounts.vault_config;
    vault_config.creator = ctx.accounts.payer.key();
    vault_config.name = name;
    vault_config.input_mint = input_mint;
    vault_config.components = components
        .into_iter()
        .map(|component| ComponentConfig {
            mint: component.mint,
            reserve: component.reserve,
            collateral_mint: component.collateral_mint,
            oracle: component.oracle,
            weight_bps: component.weight_bps,
        })
        .collect();
    vault_config.share_mint = ctx.accounts.share_mint.key();
    vault_config.vault_authority_bump = ctx.bumps.vault_authority;
    vault_config.bump = ctx.bumps.vault_config;
    Ok(())
}
