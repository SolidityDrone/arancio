use anchor_lang::prelude::*;

pub const GLOBAL_CONFIG_SEED: &[u8] = b"global-config";
pub const ADDRESS_BOOK_SEED: &[u8] = b"address-book";
pub const VAULT_SEED: &[u8] = b"vault";
pub const SHARE_MINT_SEED: &[u8] = b"share-mint";
pub const VAULT_AUTHORITY_SEED: &[u8] = b"vault-authority";
pub const MAX_VAULT_NAME_BYTES: usize = 32;
pub const MAX_COMPONENTS: usize = 16;
pub const SHARE_DECIMALS: u8 = 9;

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AddressBookInput {
    pub jupiter_program: Pubkey,
    pub token_program: Pubkey,
    pub token_2022_program: Pubkey,
    pub associated_token_program: Pubkey,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ComponentInput {
    pub mint: Pubkey,
    pub weight_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ComponentConfig {
    pub mint: Pubkey,
    pub weight_bps: u16,
}

impl ComponentConfig {
    pub const SPACE: usize = 32 + 2;
}

#[account]
pub struct GlobalConfig {
    pub authority: Pubkey,
    pub address_book: Pubkey,
    pub max_components: u8,
    pub bump: u8,
}

impl GlobalConfig {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 1;
}

#[account]
pub struct AddressBook {
    pub authority: Pubkey,
    pub jupiter_program: Pubkey,
    pub token_program: Pubkey,
    pub token_2022_program: Pubkey,
    pub associated_token_program: Pubkey,
    pub frozen: bool,
}

impl AddressBook {
    pub const SPACE: usize = 8 + 32 + 32 * 4 + 1;
}

#[account]
pub struct VaultConfig {
    pub creator: Pubkey,
    pub name: Vec<u8>,
    pub input_mint: Pubkey,
    pub components: Vec<ComponentConfig>,
    pub share_mint: Pubkey,
    pub vault_authority_bump: u8,
    pub bump: u8,
}

impl VaultConfig {
    pub const SPACE: usize = 8
        + 32
        + 4
        + MAX_VAULT_NAME_BYTES
        + 32
        + 4
        + MAX_COMPONENTS * ComponentConfig::SPACE
        + 32
        + 1
        + 1;
}
