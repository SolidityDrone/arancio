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
    CurveWindowLaunch, CurveYtBridge, LaunchYtReport, StripMarket, StripSeries, MAX_SYMBOL_LEN,
    LC_YT_MINT_SEED, PT_MINT_SEED, SERIES_SEED, SHARE_DECIMALS, STRIP_SEED, VAULT_SEED,
    YT_MINT_SEED, CURVE_BRIDGE_SEED, CURVE_LAUNCH_SEED,
};

declare_id!("A36nL7RVFp8KFWQdWmmS8wTnws1NoR3Vb4cbmChyhexz");

/// Keeps LaunchYtReport in the Anchor IDL for CRE WriteReportFromLaunchYtReport.
#[event]
pub struct YtLaunchRequested {
    pub mint: Pubkey,
    pub start_nonce: u32,
    pub target_nonce: u32,
    pub cum_y_start: u64,
    pub lock_nonces: u32,
    pub report: LaunchYtReport,
}

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
    /// `start_nonce` may be the tip or a future tip (`>= current_yield_nonce`) so
    /// desks can open forward strips (e.g. tip=4 → window 6→7).
    pub fn create_series(
        ctx: Context<CreateSeries>,
        start_nonce: u32,
        target_nonce: u32,
    ) -> Result<()> {
        require!(target_nonce > start_nonce, DivStripError::InvalidLockNonces);
        require!(
            target_nonce - start_nonce <= 32,
            DivStripError::InvalidLockNonces
        );
        require_keys_eq!(
            ctx.accounts.registry.mint,
            ctx.accounts.market.underlying_mint,
            DivStripError::RegistryMintMismatch
        );
        require!(
            start_nonce >= ctx.accounts.registry.current_yield_nonce,
            DivStripError::SeriesMismatch
        );

        // Tip windows pin cum_y now; forward windows resolve at redeem.
        let cum_y_start = if start_nonce == ctx.accounts.registry.current_yield_nonce {
            ctx.accounts
                .registry
                .find_yield_nonce(start_nonce)
                .ok_or(DivStripError::YieldNonceNotFound)?
                .cum_y
        } else {
            0
        };

        let series = &mut ctx.accounts.series;
        series.market = ctx.accounts.market.key();
        series.underlying_mint = ctx.accounts.market.underlying_mint;
        series.start_nonce = start_nonce;
        series.target_nonce = target_nonce;
        series.pt_mint = ctx.accounts.pt_mint.key();
        series.yt_mint = ctx.accounts.yt_mint.key();
        series.cum_y_start = cum_y_start;
        series.bump = ctx.bumps.series;
        Ok(())
    }

    /// Escrow underlying and mint PT + YT 1:1 for the series window.
    /// Allowed while tip is still at or before the series start (spot or forward).
    pub fn wrap(ctx: Context<Wrap>, amount: u64) -> Result<()> {
        require!(amount > 0, DivStripError::ZeroAmount);
        require_keys_eq!(
            ctx.accounts.registry.mint,
            ctx.accounts.market.underlying_mint,
            DivStripError::RegistryMintMismatch
        );
        require!(
            ctx.accounts.registry.current_yield_nonce <= ctx.accounts.series.start_nonce,
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

    /// CRE path (optional / unused by xstocks-ca-sync): emit `YtLaunchRequested`
    /// for `[current_yield_nonce, current + lock_nonces]`. Desk initializes
    /// Meteora DBC→DAMM directly; this receiver is kept for optional cranks.
    pub fn on_report(
        ctx: Context<OnReport>,
        _metadata: Vec<u8>,
        report: Vec<u8>,
    ) -> Result<()> {
        verify_forwarder_authority(&ctx)?;

        let launch = LaunchYtReport::try_from_slice(&report)
            .map_err(|_| error!(DivStripError::InvalidLaunchPayload))?;

        require_keys_eq!(
            launch.mint,
            ctx.accounts.registry.mint,
            DivStripError::LaunchMintMismatch
        );
        require_keys_eq!(
            launch.mint,
            ctx.accounts.market.underlying_mint,
            DivStripError::LaunchMintMismatch
        );

        let lock = if launch.lock_nonces == 0 {
            ctx.accounts.market.default_lock_nonces
        } else {
            launch.lock_nonces
        };
        require!(lock > 0, DivStripError::InvalidLockNonces);

        let start = ctx.accounts.registry.current_yield_nonce;
        let target = start.saturating_add(lock);
        let start_event = ctx
            .accounts
            .registry
            .find_yield_nonce(start)
            .ok_or(DivStripError::YieldNonceNotFound)?;

        emit_yt_launch_requested(
            launch.mint,
            start,
            target,
            start_event.cum_y,
            lock,
            launch,
        );

        Ok(())
    }

    /// Permissionless: request canonical curve-YT pool deployment for a strip window.
    /// Emits `YtLaunchRequested` for CRE log-trigger / launcher workflows.
    pub fn request_curve_launch(
        ctx: Context<RequestCurveLaunch>,
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
            start_nonce >= ctx.accounts.registry.current_yield_nonce,
            DivStripError::SeriesMismatch
        );

        let lock = target_nonce - start_nonce;
        let start_event = ctx
            .accounts
            .registry
            .find_yield_nonce(start_nonce)
            .ok_or(DivStripError::YieldNonceNotFound)?;

        let report = LaunchYtReport {
            mint: ctx.accounts.market.underlying_mint,
            lock_nonces: lock,
        };

        emit_yt_launch_requested(
            ctx.accounts.market.underlying_mint,
            start_nonce,
            target_nonce,
            start_event.cum_y,
            lock,
            report,
        );

        Ok(())
    }

    /// Market authority registers the canonical Meteora pool after policy launch.
    pub fn register_curve_launch(
        ctx: Context<RegisterCurveLaunch>,
        curve_yt_mint: Pubkey,
        pool: Pubkey,
        launch_fair_ppm: u32,
        initial_mcap_usd: u64,
        migration_mcap_usd: u64,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.registrar.key(),
            ctx.accounts.market.authority,
            DivStripError::UnauthorizedRegistrar
        );
        require!(
            launch_fair_ppm > 0 && launch_fair_ppm <= 1_000_000,
            DivStripError::InvalidLaunchPayload
        );

        let launch = &mut ctx.accounts.launch;
        launch.series = ctx.accounts.series.key();
        launch.curve_yt_mint = curve_yt_mint;
        launch.pool = pool;
        launch.launch_cum_y = ctx.accounts.series.cum_y_start;
        launch.launch_fair_ppm = launch_fair_ppm;
        launch.initial_mcap_usd = initial_mcap_usd;
        launch.migration_mcap_usd = migration_mcap_usd;
        launch.registered_by = ctx.accounts.registrar.key();
        launch.bump = ctx.bumps.launch;

        Ok(())
    }

    /// Link strip series to Meteora curve-YT mint and create curve-YT vault ATAs.
    pub fn init_curve_bridge(ctx: Context<InitCurveBridge>, curve_mint: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.launch.curve_yt_mint,
            curve_mint,
            DivStripError::BridgeMintMismatch
        );
        let bridge = &mut ctx.accounts.bridge;
        bridge.series = ctx.accounts.series.key();
        bridge.curve_yt_mint = curve_mint;
        bridge.lc_yt_mint = ctx.accounts.lc_yt_mint.key();
        bridge.bump = ctx.bumps.bridge;
        Ok(())
    }

    /// Deposit curve-YT into vault; mint liquid-curve-YT 1:1 (after Meteora buy in same tx).
    pub fn deposit_curve_yt_for_shares(
        ctx: Context<VaultShareAction>,
        curve_amount: u64,
    ) -> Result<()> {
        require!(curve_amount > 0, DivStripError::ZeroAmount);
        require_keys_eq!(
            ctx.accounts.curve_yt_mint.key(),
            ctx.accounts.bridge.curve_yt_mint,
            DivStripError::BridgeMintMismatch
        );
        require_keys_eq!(
            ctx.accounts.lc_yt_mint.key(),
            ctx.accounts.bridge.lc_yt_mint,
            DivStripError::BridgeMintMismatch
        );

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.user_curve_yt.to_account_info(),
                    mint: ctx.accounts.curve_yt_mint.to_account_info(),
                    to: ctx.accounts.vault_curve_yt.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            curve_amount,
            ctx.accounts.curve_yt_mint.decimals,
        )?;

        let series_key = ctx.accounts.series.key();
        let bump = [ctx.accounts.bridge.bump];
        let seeds: &[&[u8]] = &[CURVE_BRIDGE_SEED, series_key.as_ref(), &bump];

        token_interface::mint_to(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                MintTo {
                    mint: ctx.accounts.lc_yt_mint.to_account_info(),
                    to: ctx.accounts.user_lc_yt.to_account_info(),
                    authority: ctx.accounts.bridge.to_account_info(),
                },
            )
            .with_signer(&[seeds]),
            curve_amount,
        )?;

        Ok(())
    }

    /// Burn liquid-curve-YT; withdraw curve-YT 1:1 from vault (before Meteora sell in same tx).
    pub fn redeem_shares_for_curve_yt(
        ctx: Context<VaultShareAction>,
        curve_amount: u64,
    ) -> Result<()> {
        require!(curve_amount > 0, DivStripError::ZeroAmount);
        require_keys_eq!(
            ctx.accounts.curve_yt_mint.key(),
            ctx.accounts.bridge.curve_yt_mint,
            DivStripError::BridgeMintMismatch
        );
        require_keys_eq!(
            ctx.accounts.lc_yt_mint.key(),
            ctx.accounts.bridge.lc_yt_mint,
            DivStripError::BridgeMintMismatch
        );
        require!(
            ctx.accounts.vault_curve_yt.amount >= curve_amount,
            DivStripError::InsufficientCurveYt
        );

        token_interface::burn(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                Burn {
                    mint: ctx.accounts.lc_yt_mint.to_account_info(),
                    from: ctx.accounts.user_lc_yt.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            curve_amount,
        )?;

        let series_key = ctx.accounts.series.key();
        let bump = [ctx.accounts.bridge.bump];
        let seeds: &[&[u8]] = &[CURVE_BRIDGE_SEED, series_key.as_ref(), &bump];

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault_curve_yt.to_account_info(),
                    mint: ctx.accounts.curve_yt_mint.to_account_info(),
                    to: ctx.accounts.user_curve_yt.to_account_info(),
                    authority: ctx.accounts.bridge.to_account_info(),
                },
            )
            .with_signer(&[seeds]),
            curve_amount,
            ctx.accounts.curve_yt_mint.decimals,
        )?;

        Ok(())
    }

    /// Deposit strip YT; receive curve-YT at client-quoted DAMM spot (`curve_amount >= min_curve_out`).
    pub fn swap_strip_yt_for_curve_yt(
        ctx: Context<SwapCurveBridge>,
        strip_amount: u64,
        curve_amount: u64,
        min_curve_out: u64,
    ) -> Result<()> {
        require!(strip_amount > 0, DivStripError::ZeroAmount);
        require!(curve_amount > 0, DivStripError::ZeroAmount);
        require!(curve_amount >= min_curve_out, DivStripError::BridgeSlippage);
        require_keys_eq!(
            ctx.accounts.curve_yt_mint.key(),
            ctx.accounts.bridge.curve_yt_mint,
            DivStripError::BridgeMintMismatch
        );
        require_keys_eq!(
            ctx.accounts.strip_yt_mint.key(),
            ctx.accounts.series.yt_mint,
            DivStripError::SeriesMismatch
        );
        require!(
            ctx.accounts.vault_curve_yt.amount >= curve_amount,
            DivStripError::InsufficientCurveYt
        );

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.user_strip_yt.to_account_info(),
                    mint: ctx.accounts.strip_yt_mint.to_account_info(),
                    to: ctx.accounts.vault_strip_yt.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            strip_amount,
            ctx.accounts.strip_yt_mint.decimals,
        )?;

        let series_key = ctx.accounts.series.key();
        let bump = [ctx.accounts.bridge.bump];
        let seeds: &[&[u8]] = &[CURVE_BRIDGE_SEED, series_key.as_ref(), &bump];

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault_curve_yt.to_account_info(),
                    mint: ctx.accounts.curve_yt_mint.to_account_info(),
                    to: ctx.accounts.user_curve_yt.to_account_info(),
                    authority: ctx.accounts.bridge.to_account_info(),
                },
            )
            .with_signer(&[seeds]),
            curve_amount,
            ctx.accounts.curve_yt_mint.decimals,
        )?;

        Ok(())
    }

    /// Deposit curve-YT; receive strip YT (`strip_amount >= min_strip_out`).
    pub fn swap_curve_yt_for_strip_yt(
        ctx: Context<SwapCurveBridge>,
        curve_amount: u64,
        strip_amount: u64,
        min_strip_out: u64,
    ) -> Result<()> {
        require!(curve_amount > 0, DivStripError::ZeroAmount);
        require!(strip_amount > 0, DivStripError::ZeroAmount);
        require!(strip_amount >= min_strip_out, DivStripError::BridgeSlippage);
        require_keys_eq!(
            ctx.accounts.curve_yt_mint.key(),
            ctx.accounts.bridge.curve_yt_mint,
            DivStripError::BridgeMintMismatch
        );
        require_keys_eq!(
            ctx.accounts.strip_yt_mint.key(),
            ctx.accounts.series.yt_mint,
            DivStripError::SeriesMismatch
        );
        require!(
            ctx.accounts.vault_strip_yt.amount >= strip_amount,
            DivStripError::InsufficientStripYt
        );

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.user_curve_yt.to_account_info(),
                    mint: ctx.accounts.curve_yt_mint.to_account_info(),
                    to: ctx.accounts.vault_curve_yt.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            curve_amount,
            ctx.accounts.curve_yt_mint.decimals,
        )?;

        let series_key = ctx.accounts.series.key();
        let bump = [ctx.accounts.bridge.bump];
        let seeds: &[&[u8]] = &[CURVE_BRIDGE_SEED, series_key.as_ref(), &bump];

        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.vault_strip_yt.to_account_info(),
                    mint: ctx.accounts.strip_yt_mint.to_account_info(),
                    to: ctx.accounts.user_strip_yt.to_account_info(),
                    authority: ctx.accounts.bridge.to_account_info(),
                },
            )
            .with_signer(&[seeds]),
            strip_amount,
            ctx.accounts.strip_yt_mint.decimals,
        )?;

        Ok(())
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

    let cum_start = {
        let stored = ctx.accounts.series.cum_y_start;
        if stored > 0 {
            stored
        } else {
            // Forward series: resolve once the start nonce exists on registry.
            let start_event = registry
                .find_yield_nonce(ctx.accounts.series.start_nonce)
                .ok_or(DivStripError::YieldNonceNotFound)?;
            if start_event.cum_y == 0 {
                MULTIPLIER_SCALE
            } else {
                start_event.cum_y
            }
        }
    };
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

fn emit_yt_launch_requested(
    mint: Pubkey,
    start_nonce: u32,
    target_nonce: u32,
    cum_y_start: u64,
    lock_nonces: u32,
    report: LaunchYtReport,
) {
    emit!(YtLaunchRequested {
        mint,
        start_nonce,
        target_nonce,
        cum_y_start,
        lock_nonces,
        report,
    });
}

#[derive(Accounts)]
#[instruction(start_nonce: u32, target_nonce: u32)]
pub struct RequestCurveLaunch<'info> {
    pub payer: Signer<'info>,
    #[account(
        seeds = [STRIP_SEED, market.underlying_mint.as_ref()],
        bump = market.bump,
        constraint = market.registry == registry.key() @ DivStripError::RegistryMintMismatch
    )]
    pub market: Box<Account<'info, StripMarket>>,
    #[account(
        constraint = registry.mint == market.underlying_mint @ DivStripError::RegistryMintMismatch
    )]
    pub registry: Box<Account<'info, RegistryLog>>,
}

#[derive(Accounts)]
#[instruction(curve_yt_mint: Pubkey, pool: Pubkey, launch_fair_ppm: u32, initial_mcap_usd: u64, migration_mcap_usd: u64)]
pub struct RegisterCurveLaunch<'info> {
    #[account(mut)]
    pub registrar: Signer<'info>,
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
    #[account(
        init,
        payer = registrar,
        space = CurveWindowLaunch::SPACE,
        seeds = [CURVE_LAUNCH_SEED, series.key().as_ref()],
        bump
    )]
    pub launch: Box<Account<'info, CurveWindowLaunch>>,
    pub system_program: Program<'info, System>,
}

fn verify_forwarder_authority(ctx: &Context<OnReport>) -> Result<()> {
    let forwarder_program = ctx.accounts.state.owner;
    let (expected_authority, _bump) = Pubkey::find_program_address(
        &[
            b"forwarder",
            ctx.accounts.state.key.as_ref(),
            crate::ID.as_ref(),
        ],
        forwarder_program,
    );
    require_keys_eq!(
        ctx.accounts.forwarder_authority.key(),
        expected_authority,
        DivStripError::InvalidForwarderAuthority
    );
    Ok(())
}

#[derive(Accounts)]
#[instruction(curve_mint: Pubkey)]
pub struct InitCurveBridge<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
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
    #[account(
        seeds = [CURVE_LAUNCH_SEED, series.key().as_ref()],
        bump = launch.bump,
        constraint = launch.curve_yt_mint == curve_mint @ DivStripError::BridgeMintMismatch
    )]
    pub launch: Box<Account<'info, CurveWindowLaunch>>,
    #[account(
        init,
        payer = payer,
        space = CurveYtBridge::SPACE,
        seeds = [CURVE_BRIDGE_SEED, series.key().as_ref()],
        bump
    )]
    pub bridge: Box<Account<'info, CurveYtBridge>>,
    /// CHECK: bridge vault authority (same PDA as bridge state)
    #[account(seeds = [CURVE_BRIDGE_SEED, series.key().as_ref()], bump)]
    pub bridge_authority: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = strip_yt_mint,
        associated_token::authority = bridge_authority,
        associated_token::token_program = token_program
    )]
    pub vault_strip_yt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        associated_token::mint = curve_yt_mint,
        associated_token::authority = bridge_authority,
        associated_token::token_program = token_program
    )]
    pub vault_curve_yt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        init,
        payer = payer,
        seeds = [LC_YT_MINT_SEED, series.key().as_ref()],
        bump,
        mint::decimals = SHARE_DECIMALS,
        mint::authority = bridge,
    )]
    pub lc_yt_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(constraint = strip_yt_mint.key() == series.yt_mint)]
    pub strip_yt_mint: Box<InterfaceAccount<'info, Mint>>,
    pub curve_yt_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct VaultShareAction<'info> {
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
    #[account(
        seeds = [CURVE_BRIDGE_SEED, series.key().as_ref()],
        bump = bridge.bump,
        has_one = series
    )]
    pub bridge: Box<Account<'info, CurveYtBridge>>,
    /// CHECK: bridge vault authority
    #[account(
        seeds = [CURVE_BRIDGE_SEED, series.key().as_ref()],
        bump = bridge.bump
    )]
    pub bridge_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = curve_yt_mint.key() == bridge.curve_yt_mint @ DivStripError::BridgeMintMismatch
    )]
    pub curve_yt_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        constraint = lc_yt_mint.key() == bridge.lc_yt_mint @ DivStripError::BridgeMintMismatch
    )]
    pub lc_yt_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub user_curve_yt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub user_lc_yt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = curve_yt_mint,
        associated_token::authority = bridge_authority,
        associated_token::token_program = token_program
    )]
    pub vault_curve_yt: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SwapCurveBridge<'info> {
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
    #[account(
        seeds = [CURVE_BRIDGE_SEED, series.key().as_ref()],
        bump = bridge.bump,
        has_one = series
    )]
    pub bridge: Box<Account<'info, CurveYtBridge>>,
    /// CHECK: bridge vault authority
    #[account(
        seeds = [CURVE_BRIDGE_SEED, series.key().as_ref()],
        bump = bridge.bump
    )]
    pub bridge_authority: UncheckedAccount<'info>,
    #[account(mut, constraint = strip_yt_mint.key() == series.yt_mint)]
    pub strip_yt_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        mut,
        constraint = curve_yt_mint.key() == bridge.curve_yt_mint @ DivStripError::BridgeMintMismatch
    )]
    pub curve_yt_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut)]
    pub user_strip_yt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut)]
    pub user_curve_yt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = strip_yt_mint,
        associated_token::authority = bridge_authority,
        associated_token::token_program = token_program
    )]
    pub vault_strip_yt: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = curve_yt_mint,
        associated_token::authority = bridge_authority,
        associated_token::token_program = token_program
    )]
    pub vault_curve_yt: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct OnReport<'info> {
    /// CHECK: Keystone forwarder state; owner is the forwarder program.
    pub state: UncheckedAccount<'info>,
    pub forwarder_authority: Signer<'info>,
    #[account(
        constraint = registry.mint == market.underlying_mint @ DivStripError::RegistryMintMismatch
    )]
    pub registry: Box<Account<'info, RegistryLog>>,
    #[account(
        seeds = [STRIP_SEED, market.underlying_mint.as_ref()],
        bump = market.bump,
        constraint = market.registry == registry.key() @ DivStripError::RegistryMintMismatch
    )]
    pub market: Box<Account<'info, StripMarket>>,
}
