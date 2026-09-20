use anchor_lang::prelude::*;

pub const STRIP_SEED: &[u8] = b"strip";
pub const SERIES_SEED: &[u8] = b"series";
pub const VAULT_SEED: &[u8] = b"vault";
pub const PT_MINT_SEED: &[u8] = b"pt-mint";
pub const YT_MINT_SEED: &[u8] = b"yt-mint";
pub const CURVE_BRIDGE_SEED: &[u8] = b"curve-bridge";
pub const CURVE_LAUNCH_SEED: &[u8] = b"curve-launch";
pub const LC_YT_MINT_SEED: &[u8] = b"lc-yt-mint";
pub const MAX_SYMBOL_LEN: usize = 8;
pub const SHARE_DECIMALS: u8 = 6;
pub const COUPON_SCALE: u128 = 1_000_000_000_000;

/// CRE WriteReport payload: after a Yield CA sync, request a YT window launch.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct LaunchYtReport {
    pub mint: Pubkey,
    pub lock_nonces: u32,
}

#[account]
pub struct StripMarket {
    pub authority: Pubkey,
    pub underlying_mint: Pubkey,
    pub registry: Pubkey,
    pub symbol: [u8; MAX_SYMBOL_LEN],
    pub symbol_len: u8,
    pub default_lock_nonces: u32,
    pub bump: u8,
    pub vault_bump: u8,
}

impl StripMarket {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + MAX_SYMBOL_LEN + 1 + 4 + 1 + 1;
}

#[account]
pub struct StripSeries {
    pub market: Pubkey,
    pub underlying_mint: Pubkey,
    pub start_nonce: u32,
    pub target_nonce: u32,
    pub pt_mint: Pubkey,
    pub yt_mint: Pubkey,
    pub cum_y_start: u64,
    /// Frozen at series creation from registry tip (updated on first wrap if 0 events).
    pub bump: u8,
}

impl StripSeries {
    pub const SPACE: usize = 8 + 32 + 32 + 4 + 4 + 32 + 32 + 8 + 1;
}

/// Curve-YT vault: links a strip series to its Meteora curve-YT mint; vault ATAs hold escrow liquidity for strip exits.
#[account]
pub struct CurveYtBridge {
    pub series: Pubkey,
    pub curve_yt_mint: Pubkey,
    /// liquid-curve-YT receipt mint (1:1 with curve-YT in vault).
    pub lc_yt_mint: Pubkey,
    pub bump: u8,
}

impl CurveYtBridge {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 1;
}

/// Canonical Meteora curve-YT pool registered for a strip series window.
#[account]
pub struct CurveWindowLaunch {
    pub series: Pubkey,
    pub curve_yt_mint: Pubkey,
    pub pool: Pubkey,
    pub launch_cum_y: u64,
    /// Fair coupon at registration in parts-per-million (2% = 20_000).
    pub launch_fair_ppm: u32,
    pub initial_mcap_usd: u64,
    pub migration_mcap_usd: u64,
    pub registered_by: Pubkey,
    pub bump: u8,
}

impl CurveWindowLaunch {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 4 + 8 + 8 + 32 + 1;
}
