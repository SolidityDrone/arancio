use anchor_lang::prelude::*;
use anchor_spl::{
    token::{Mint, Token, TokenAccount},
};

use crate::{
    errors::YieldCusdcError,
    state::{CusdcReserve, CUSDC_MINT_SEED, RESERVE_SEED, VAULT_SEED},
};

declare_id!("7n7kW2mrLV8tSbriCChbTnggv1sA8nFwqGUamq65pNv8");

pub mod errors;
pub mod state;

/// Kamino-shaped local reserve: deposit USDC → mint cUSDC shares; rate rises when
/// interest USDC is donated. Wallet cUSDC balance does not rebase.
#[program]
pub mod yield_cusdc {
    use super::*;

    pub fn initialize_reserve(ctx: Context<InitializeReserve>) -> Result<()> {
        let reserve = &mut ctx.accounts.reserve;
        reserve.authority = ctx.accounts.authority.key();
        reserve.usdc_mint = ctx.accounts.usdc_mint.key();
        reserve.cusdc_mint = ctx.accounts.cusdc_mint.key();
        reserve.bump = ctx.bumps.reserve;
        reserve.mint_bump = ctx.bumps.cusdc_mint;
        Ok(())
    }

    /// Deposit USDC; mint cUSDC shares at current exchange rate (assets/supply).
    pub fn deposit(ctx: Context<DepositRedeem>, usdc_amount: u64) -> Result<()> {
        require!(usdc_amount > 0, YieldCusdcError::ZeroAmount);

        let vault_before = ctx.accounts.vault_usdc.amount;
        let supply = ctx.accounts.cusdc_mint.supply;
        let shares = shares_for_deposit(usdc_amount, supply, vault_before)?;

        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.user_usdc.to_account_info(),
                    to: ctx.accounts.vault_usdc.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            usdc_amount,
        )?;

        let usdc_mint_key = ctx.accounts.usdc_mint.key();
        let bump = [ctx.accounts.reserve.bump];
        let seeds: &[&[u8]] = &[RESERVE_SEED, usdc_mint_key.as_ref(), &bump];

        anchor_spl::token::mint_to(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                anchor_spl::token::MintTo {
                    mint: ctx.accounts.cusdc_mint.to_account_info(),
                    to: ctx.accounts.user_cusdc.to_account_info(),
                    authority: ctx.accounts.reserve.to_account_info(),
                },
            )
            .with_signer(&[seeds]),
            shares,
        )?;

        Ok(())
    }

    /// Burn cUSDC; withdraw proportional USDC (includes accrued interest share).
    pub fn redeem(ctx: Context<DepositRedeem>, cusdc_amount: u64) -> Result<()> {
        require!(cusdc_amount > 0, YieldCusdcError::ZeroAmount);

        let vault = ctx.accounts.vault_usdc.amount;
        let supply = ctx.accounts.cusdc_mint.supply;
        require!(supply > 0, YieldCusdcError::DivisionByZero);
        let usdc_out = proportional(vault, cusdc_amount, supply)?;
        require!(usdc_out > 0, YieldCusdcError::ZeroAmount);
        require!(
            vault >= usdc_out,
            YieldCusdcError::InsufficientLiquidity
        );

        anchor_spl::token::burn(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                anchor_spl::token::Burn {
                    mint: ctx.accounts.cusdc_mint.to_account_info(),
                    from: ctx.accounts.user_cusdc.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            cusdc_amount,
        )?;

        let usdc_mint_key = ctx.accounts.usdc_mint.key();
        let bump = [ctx.accounts.reserve.bump];
        let seeds: &[&[u8]] = &[RESERVE_SEED, usdc_mint_key.as_ref(), &bump];

        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.vault_usdc.to_account_info(),
                    to: ctx.accounts.user_usdc.to_account_info(),
                    authority: ctx.accounts.reserve.to_account_info(),
                },
            )
            .with_signer(&[seeds]),
            usdc_out,
        )?;

        Ok(())
    }

    /// Donate USDC as interest — raises USDC-per-cUSDC without minting shares.
    pub fn accrue_interest(ctx: Context<AccrueInterest>, usdc_amount: u64) -> Result<()> {
        require!(usdc_amount > 0, YieldCusdcError::ZeroAmount);
        require!(
            ctx.accounts.cusdc_mint.supply > 0,
            YieldCusdcError::DivisionByZero
        );

        anchor_spl::token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.payer_usdc.to_account_info(),
                    to: ctx.accounts.vault_usdc.to_account_info(),
                    authority: ctx.accounts.payer.to_account_info(),
                },
            ),
            usdc_amount,
        )?;
        Ok(())
    }
}

fn shares_for_deposit(assets: u64, supply: u64, total_assets: u64) -> Result<u64> {
    if supply == 0 {
        return Ok(assets);
    }
    require!(total_assets > 0, YieldCusdcError::DivisionByZero);
    let shares = (assets as u128)
        .checked_mul(supply as u128)
        .ok_or(YieldCusdcError::Overflow)?
        .checked_div(total_assets as u128)
        .ok_or(YieldCusdcError::DivisionByZero)?;
    u64::try_from(shares).map_err(|_| error!(YieldCusdcError::Overflow))
}

fn proportional(total: u64, shares: u64, supply: u64) -> Result<u64> {
    require!(supply > 0, YieldCusdcError::DivisionByZero);
    let out = (total as u128)
        .checked_mul(shares as u128)
        .ok_or(YieldCusdcError::Overflow)?
        .checked_div(supply as u128)
        .ok_or(YieldCusdcError::DivisionByZero)?;
    u64::try_from(out).map_err(|_| error!(YieldCusdcError::Overflow))
}

#[derive(Accounts)]
pub struct InitializeReserve<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        space = CusdcReserve::SPACE,
        seeds = [RESERVE_SEED, usdc_mint.key().as_ref()],
        bump
    )]
    pub reserve: Account<'info, CusdcReserve>,
    #[account(
        init,
        payer = authority,
        seeds = [CUSDC_MINT_SEED, usdc_mint.key().as_ref()],
        bump,
        mint::decimals = usdc_mint.decimals,
        mint::authority = reserve,
    )]
    pub cusdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, usdc_mint.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = reserve,
    )]
    pub vault_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct DepositRedeem<'info> {
    pub user: Signer<'info>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        seeds = [RESERVE_SEED, usdc_mint.key().as_ref()],
        bump = reserve.bump,
        has_one = usdc_mint,
        has_one = cusdc_mint,
    )]
    pub reserve: Account<'info, CusdcReserve>,
    #[account(mut)]
    pub cusdc_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [VAULT_SEED, usdc_mint.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = reserve,
    )]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, token::authority = user)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut, token::mint = cusdc_mint, token::authority = user)]
    pub user_cusdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct AccrueInterest<'info> {
    pub payer: Signer<'info>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        seeds = [RESERVE_SEED, usdc_mint.key().as_ref()],
        bump = reserve.bump,
        has_one = usdc_mint,
        has_one = cusdc_mint,
    )]
    pub reserve: Account<'info, CusdcReserve>,
    pub cusdc_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [VAULT_SEED, usdc_mint.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = reserve,
    )]
    pub vault_usdc: Account<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, token::authority = payer)]
    pub payer_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}
