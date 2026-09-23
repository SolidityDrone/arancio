use anchor_lang::prelude::*;

pub const RESERVE_SEED: &[u8] = b"cusdc-reserve";
pub const CUSDC_MINT_SEED: &[u8] = b"cusdc-mint";
pub const VAULT_SEED: &[u8] = b"cusdc-vault";

#[account]
pub struct CusdcReserve {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub cusdc_mint: Pubkey,
    pub bump: u8,
    pub mint_bump: u8,
}

impl CusdcReserve {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 1 + 1;
}
