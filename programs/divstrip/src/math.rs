use anchor_lang::prelude::*;

use crate::errors::DivStripError;

pub fn shares_for_deposit(assets: u128, supply: u128, total_assets: u128) -> Result<u128> {
    if supply == 0 {
        return Ok(assets);
    }
    require!(total_assets > 0, DivStripError::DivisionByZero);
    assets
        .checked_mul(supply)
        .ok_or_else(|| error!(DivStripError::Overflow))?
        .checked_div(total_assets)
        .ok_or_else(|| error!(DivStripError::DivisionByZero))
}

pub fn assets_for_shares(shares: u128, supply: u128, total_assets: u128) -> Result<u128> {
    require!(supply > 0, DivStripError::DivisionByZero);
    shares
        .checked_mul(total_assets)
        .ok_or_else(|| error!(DivStripError::Overflow))?
        .checked_div(supply)
        .ok_or_else(|| error!(DivStripError::DivisionByZero))
}

pub fn shares_for_assets_up(assets: u128, supply: u128, total_assets: u128) -> Result<u128> {
    if supply == 0 {
        return Ok(assets);
    }
    require!(total_assets > 0, DivStripError::DivisionByZero);
    let num = assets
        .checked_mul(supply)
        .ok_or_else(|| error!(DivStripError::Overflow))?;
    // ceil div for withdraw-by-assets
    Ok(num
        .checked_add(total_assets.saturating_sub(1))
        .ok_or_else(|| error!(DivStripError::Overflow))?
        / total_assets)
}
