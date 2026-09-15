use anchor_lang::prelude::*;

pub mod errors;
pub mod state;

use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{
        self, Burn, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
    },
};
use ca_registry::state::{RegistryLog, MULTIPLIER_SCALE};
use errors::DivStripError;
use state::{
    StripMarket, StripSeries, MAX_SYMBOL_LEN, PT_MINT_SEED, SERIES_SEED, SHARE_DECIMALS,
    STRIP_SEED, VAULT_SEED, YT_MINT_SEED,
};

declare_id!("A36nL7RVFp8KFWQdWmmS8wTnws1NoR3Vb4cbmChyhexz");

#[program]
pub mod divstrip {
    use super::*;

    pub fn initialize_strip(
        ctx: Context<InitializeStrip>,
        symbol: String,
        default_lock_nonces: u32,
    ) -> Result<()> {
        require!(
            !symbol.is_empty() && symbol.len() <= MAX_SYMBOL_LEN,
            DivStripError::InvalidSymbol
        );
        require!(default_lock_nonces > 0, DivStripError::InvalidLockNonces);
        require_keys_eq!(
            ctx.accounts.registry.mint,
            ctx.accounts.underlying_mint.key(),
            DivStripError::RegistryMintMismatch
        );

        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.underlying_mint = ctx.accounts.underlying_mint.key();
        market.registry = ctx.accounts.registry.key();
        market.symbol_len = symbol.len() as u8;
        market.symbol.fill(0);
        market.symbol[..symbol.len()].copy_from_slice(symbol.as_bytes());
        market.default_lock_nonces = default_lock_nonces;
        market.bump = ctx.bumps.market;
        market.vault_bump = ctx.bumps.vault_authority;
        Ok(())
    }

    /// Create PT/YT mints for window `[start_nonce, target_nonce]`.
    pub fn create_series(
        ctx: Context<CreateSeries>,
        start_nonce: u32,
        target_nonce: u32,
    ) -> Result<()> {
        require!(target_nonce > start_nonce, DivStripError::InvalidLockNonces);
        require_keys_eq!(
            ctx.accounts.registry.mint,
            ctx.accounts.market.underlying_mint,
            DivStripError::RegistryMintMismatch
        );
        require!(
            start_nonce == ctx.accounts.registry.current_yield_nonce,
            DivStripError::SeriesMismatch
        );

        let start_event = ctx
            .accounts
            .registry
            .find_yield_nonce(start_nonce)
            .ok_or(DivStripError::YieldNonceNotFound)?;

        let series = &mut ctx.accounts.series;
        series.market = ctx.accounts.market.key();
        series.underlying_mint = ctx.accounts.market.underlying_mint;
        series.start_nonce = start_nonce;
        series.target_nonce = target_nonce;
        series.pt_mint = ctx.accounts.pt_mint.key();
        series.yt_mint = ctx.accounts.yt_mint.key();
        series.cum_y_start = start_event.cum_y;
        series.bump = ctx.bumps.series;
        Ok(())
    }

    /// Escrow underlying and mint PT + YT 1:1 for the series window.
    pub fn wrap(ctx: Context<Wrap>, amount: u64) -> Result<()> {
        require!(amount > 0, DivStripError::ZeroAmount);
        require_keys_eq!(
            ctx.accounts.registry.mint,
            ctx.accounts.market.underlying_mint,
            DivStripError::RegistryMintMismatch
        );
        require!(
            ctx.accounts.series.start_nonce == ctx.accounts.registry.current_yield_nonce,
            DivStripError::SeriesMismatch
        );

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.user_underlying.to_account_info(),
                    mint: ctx.accounts.underlying_mint.to_account_info(),
                    to: ctx.accounts.vault_underlying.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.underlying_mint.decimals,
        )?;

        let market_key = ctx.accounts.market.key();
        let start_bytes = ctx.accounts.series.start_nonce.to_le_bytes();
        let target_bytes = ctx.accounts.series.target_nonce.to_le_bytes();
        let series_bump = [ctx.accounts.series.bump];
        let seeds: &[&[u8]] = &[
            SERIES_SEED,
            market_key.as_ref(),
            &start_bytes,
            &target_bytes,
            &series_bump,
        ];

        token_interface::mint_to(
            CpiContext::new(
                ctx.accounts.pt_token_program.key(),
                MintTo {
                    mint: ctx.accounts.pt_mint.to_account_info(),
                    to: ctx.accounts.user_pt.to_account_info(),
                    authority: ctx.accounts.series.to_account_info(),
                },
            )
            .with_signer(&[seeds]),
            amount,
        )?;

        token_interface::mint_to(
            CpiContext::new(
                ctx.accounts.yt_token_program.key(),
                MintTo {
                    mint: ctx.accounts.yt_mint.to_account_info(),
                    to: ctx.accounts.user_yt.to_account_info(),
                    authority: ctx.accounts.series.to_account_info(),
                },
            )
            .with_signer(&[seeds]),
            amount,
        )?;

        Ok(())
    }

    /// Burn equal PT + YT; return underlying 1:1.
    pub fn unwrap(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
        require!(amount > 0, DivStripError::ZeroAmount);

        token_interface::burn(
            CpiContext::new(
                ctx.accounts.pt_token_program.key(),
                Burn {
                    mint: ctx.accounts.pt_mint.to_account_info(),
                    from: ctx.accounts.user_pt.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        token_interface::burn(
            CpiContext::new(
                ctx.accounts.yt_token_program.key(),
                Burn {
                    mint: ctx.accounts.yt_mint.to_account_info(),
                    from: ctx.accounts.user_yt.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let market_key = ctx.accounts.market.key();
        let vault_bump = [ctx.accounts.market.vault_bump];
        let vault_seeds: &[&[u8]] = &[VAULT_SEED, market_key.as_ref(), &vault_bump];

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault_underlying.to_account_info(),
                    mint: ctx.accounts.underlying_mint.to_account_info(),
                    to: ctx.accounts.user_underlying.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
            )
            .with_signer(&[vault_seeds]),
            amount,
            ctx.accounts.underlying_mint.decimals,
        )?;

        Ok(())
    }

    pub fn redeem_capital(ctx: Context<RedeemLeg>, amount: u64) -> Result<()> {
        redeem_leg(ctx, amount, true)
    }

    pub fn redeem_yield(ctx: Context<RedeemLeg>, amount: u64) -> Result<()> {
        redeem_leg(ctx, amount, false)
    }
}

fn redeem_leg(ctx: Context<RedeemLeg>, amount: u64, is_capital: bool) -> Result<()> {
    require!(amount > 0, DivStripError::ZeroAmount);
    let registry = &ctx.accounts.registry;
    require!(
        registry.current_yield_nonce >= ctx.accounts.series.target_nonce,
        DivStripError::WindowNotMature
    );

    if is_capital {
        require_keys_eq!(
            ctx.accounts.leg_mint.key(),
            ctx.accounts.series.pt_mint,
            DivStripError::SeriesMismatch
        );
    } else {
        require_keys_eq!(
            ctx.accounts.leg_mint.key(),
            ctx.accounts.series.yt_mint,
            DivStripError::SeriesMismatch
        );
    }

    let cum_start = ctx.accounts.series.cum_y_start;
    let target_event = registry
        .find_yield_nonce(ctx.accounts.series.target_nonce)
        .ok_or(DivStripError::YieldNonceNotFound)?;
    let cum_target = if target_event.cum_y == 0 {
        MULTIPLIER_SCALE
    } else {
        target_event.cum_y
    };
    require!(cum_target > 0, DivStripError::Overflow);

    let capital_out = (u128::from(amount))
        .checked_mul(u128::from(cum_start))
        .ok_or(DivStripError::Overflow)?
        .checked_div(u128::from(cum_target))
        .ok_or(DivStripError::Overflow)?;
    let coupon_out = u128::from(amount)
        .checked_sub(capital_out)
        .ok_or(DivStripError::Overflow)?;
    let out = if is_capital { capital_out } else { coupon_out };
    let out_u64 = u64::try_from(out).map_err(|_| error!(DivStripError::Overflow))?;

    token_interface::burn(
        CpiContext::new(
            ctx.accounts.leg_token_program.key(),
            Burn {
                mint: ctx.accounts.leg_mint.to_account_info(),
                from: ctx.accounts.user_leg.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    if out_u64 > 0 {
        let market_key = ctx.accounts.market.key();
        let vault_bump = [ctx.accounts.market.vault_bump];
        let vault_seeds: &[&[u8]] = &[VAULT_SEED, market_key.as_ref(), &vault_bump];
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault_underlying.to_account_info(),
                    mint: ctx.accounts.underlying_mint.to_account_info(),
                    to: ctx.accounts.user_underlying.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
            )
            .with_signer(&[vault_seeds]),
            out_u64,
            ctx.accounts.underlying_mint.decimals,
        )?;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeStrip<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(constraint = registry.mint == underlying_mint.key() @ DivStripError::RegistryMintMismatch)]
    pub registry: Box<Account<'info, RegistryLog>>,
    #[account(
        init,
        payer = authority,
        space = StripMarket::SPACE,
        seeds = [STRIP_SEED, underlying_mint.key().as_ref()],
        bump
    )]
    pub market: Box<Account<'info, StripMarket>>,
    /// CHECK: vault authority PDA
    #[account(seeds = [VAULT_SEED, market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(start_nonce: u32, target_nonce: u32)]
pub struct CreateSeries<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [STRIP_SEED, market.underlying_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, StripMarket>>,
    #[account(
        constraint = registry.key() == market.registry @ DivStripError::RegistryMintMismatch,
        constraint = registry.mint == market.underlying_mint @ DivStripError::RegistryMintMismatch
    )]
    pub registry: Box<Account<'info, RegistryLog>>,
    #[account(
        init,
        payer = payer,
        space = StripSeries::SPACE,
        seeds = [
            SERIES_SEED,
            market.key().as_ref(),
            &start_nonce.to_le_bytes(),
            &target_nonce.to_le_bytes()
        ],
        bump
    )]
    pub series: Box<Account<'info, StripSeries>>,
    #[account(
        init,
        payer = payer,
        seeds = [
            PT_MINT_SEED,
            market.key().as_ref(),
            &start_nonce.to_le_bytes(),
            &target_nonce.to_le_bytes()
        ],
        bump,
        mint::decimals = SHARE_DECIMALS,
        mint::authority = series
    )]
    pub pt_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = payer,
        seeds = [
            YT_MINT_SEED,
            market.key().as_ref(),
            &start_nonce.to_le_bytes(),
            &target_nonce.to_le_bytes()
        ],
        bump,
        mint::decimals = SHARE_DECIMALS,
        mint::authority = series
    )]
    pub yt_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Wrap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        seeds = [STRIP_SEED, market.underlying_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, StripMarket>>,
    #[account(
        constraint = registry.key() == market.registry,
        constraint = registry.mint == market.underlying_mint @ DivStripError::RegistryMintMismatch
    )]
    pub registry: Box<Account<'info, RegistryLog>>,
    #[account(
        mut,
        seeds = [
            SERIES_SEED,
            market.key().as_ref(),
            &series.start_nonce.to_le_bytes(),
            &series.target_nonce.to_le_bytes()
        ],
        bump = series.bump,
        has_one = market,
        has_one = underlying_mint
    )]
    pub series: Box<Account<'info, StripSeries>>,
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, constraint = pt_mint.key() == series.pt_mint)]
    pub pt_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, constraint = yt_mint.key() == series.yt_mint)]
    pub yt_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub user_underlying: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub user_pt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub user_yt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = underlying_mint,
        associated_token::authority = vault_authority,
        associated_token::token_program = token_program
    )]
    pub vault_underlying: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: vault authority
    #[account(seeds = [VAULT_SEED, market.key().as_ref()], bump = market.vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub pt_token_program: Interface<'info, TokenInterface>,
    pub yt_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unwrap<'info> {
    pub user: Signer<'info>,
    #[account(
        seeds = [STRIP_SEED, market.underlying_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, StripMarket>>,
    #[account(
        seeds = [
            SERIES_SEED,
            market.key().as_ref(),
            &series.start_nonce.to_le_bytes(),
            &series.target_nonce.to_le_bytes()
        ],
        bump = series.bump,
        has_one = market
    )]
    pub series: Box<Account<'info, StripSeries>>,
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, constraint = pt_mint.key() == series.pt_mint)]
    pub pt_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, constraint = yt_mint.key() == series.yt_mint)]
    pub yt_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub user_underlying: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub user_pt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub user_yt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub vault_underlying: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: vault authority
    #[account(seeds = [VAULT_SEED, market.key().as_ref()], bump = market.vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub pt_token_program: Interface<'info, TokenInterface>,
    pub yt_token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct RedeemLeg<'info> {
    pub user: Signer<'info>,
    #[account(
        seeds = [STRIP_SEED, market.underlying_mint.as_ref()],
        bump = market.bump
    )]
    pub market: Box<Account<'info, StripMarket>>,
    #[account(
        constraint = registry.key() == market.registry,
        constraint = registry.mint == market.underlying_mint
    )]
    pub registry: Box<Account<'info, RegistryLog>>,
    #[account(
        seeds = [
            SERIES_SEED,
            market.key().as_ref(),
            &series.start_nonce.to_le_bytes(),
            &series.target_nonce.to_le_bytes()
        ],
        bump = series.bump,
        has_one = market
    )]
    pub series: Box<Account<'info, StripSeries>>,
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub leg_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub user_leg: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub user_underlying: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub vault_underlying: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: vault authority
    #[account(seeds = [VAULT_SEED, market.key().as_ref()], bump = market.vault_bump)]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub leg_token_program: Interface<'info, TokenInterface>,
}
