use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{self, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked},
};

use crate::{
    errors::ArancioError,
    math::shares_for_deposit,
    state::{AddressBook, VaultConfig, VAULT_AUTHORITY_SEED, VAULT_SEED},
};

/// ERC-4626-style deposit: pull `input_mint` into vault custody and mint shares.
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,
    #[account(
        seeds = [VAULT_SEED, vault_config.name.as_slice()],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,
    #[account(constraint = address_book.frozen @ ArancioError::AddressBookNotFrozen)]
    pub address_book: Account<'info, AddressBook>,
    /// CHECK: vault authority PDA; owns custody and is share mint authority.
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, vault_config.key().as_ref()],
        bump = vault_config.vault_authority_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = share_mint.key() == vault_config.share_mint @ ArancioError::InvalidShareMint
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        token::mint = share_mint,
        token::authority = depositor
    )]
    pub depositor_shares: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = depositor_assets.mint == vault_config.input_mint @ ArancioError::InvalidComponentMint
    )]
    pub depositor_assets: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = depositor,
        associated_token::mint = asset_mint,
        associated_token::authority = vault_authority,
        associated_token::token_program = asset_token_program
    )]
    pub vault_assets: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(constraint = asset_mint.key() == vault_config.input_mint @ ArancioError::InvalidComponentMint)]
    pub asset_mint: Box<InterfaceAccount<'info, Mint>>,
    pub asset_token_program: Interface<'info, TokenInterface>,
    /// CHECK: share mint always uses the frozen address-book token program.
    #[account(address = address_book.token_program)]
    pub share_token_program: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn deposit(ctx: Context<Deposit>, assets: u64, min_shares: u64) -> Result<()> {
    require!(assets > 0, ArancioError::ZeroDepositAmount);

    let total_assets_before = ctx.accounts.vault_assets.amount;
    let supply = ctx.accounts.share_mint.supply;
    let shares = shares_for_deposit(
        u128::from(assets),
        u128::from(supply),
        u128::from(total_assets_before),
    )?;
    let shares_u64 = u64::try_from(shares).map_err(|_| error!(ArancioError::ArithmeticOverflow))?;
    require!(shares_u64 >= min_shares, ArancioError::MinSharesNotMet);

    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.asset_token_program.key(),
            TransferChecked {
                from: ctx.accounts.depositor_assets.to_account_info(),
                mint: ctx.accounts.asset_mint.to_account_info(),
                to: ctx.accounts.vault_assets.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        assets,
        ctx.accounts.asset_mint.decimals,
    )?;

    let vault_config_key = ctx.accounts.vault_config.key();
    let authority_bump = [ctx.accounts.vault_config.vault_authority_bump];
    let signer_seeds: &[&[u8]] = &[
        VAULT_AUTHORITY_SEED,
        vault_config_key.as_ref(),
        &authority_bump,
    ];

    token_interface::mint_to(
        CpiContext::new(
            ctx.accounts.share_token_program.key(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.depositor_shares.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
        )
        .with_signer(&[signer_seeds]),
        shares_u64,
    )?;

    Ok(())
}
