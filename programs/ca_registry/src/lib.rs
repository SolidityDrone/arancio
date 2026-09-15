use anchor_lang::prelude::*;

mod errors;
pub mod payload;
pub mod state;

use errors::CaRegistryError;
use payload::decode_sync_payload;
use state::{
    RegistryLog, KIND_OTHER, KIND_SUPPLY, KIND_YIELD, MAX_SYMBOL_LEN, MULTIPLIER_SCALE,
};

declare_id!("2WSNFu4xuaH55gpMRBN1p64YuiUXZzyze38ERXEy1U1z");

pub use payload::{SyncEvent, SyncPayload};
pub use state::CaEvent;

/// Keeps SyncPayload in the Anchor IDL so CRE can generate WriteReportFromSyncPayload.
#[event]
pub struct SyncPayloadReceived {
    pub mint: Pubkey,
    pub inserted: u32,
    pub payload: SyncPayload,
}

#[program]
pub mod ca_registry {
    use super::*;

    pub fn initialize_registry(
        ctx: Context<InitializeRegistry>,
        symbol: String,
        forwarder_state: Pubkey,
    ) -> Result<()> {
        require!(
            !symbol.is_empty() && symbol.len() <= MAX_SYMBOL_LEN,
            CaRegistryError::InvalidSymbol
        );

        let registry = &mut ctx.accounts.registry;
        registry.mint = ctx.accounts.mint.key();
        registry.authority = ctx.accounts.authority.key();
        registry.forwarder_state = forwarder_state;
        registry.symbol_len = symbol.len() as u8;
        registry.symbol.fill(0);
        registry.symbol[..symbol.len()].copy_from_slice(symbol.as_bytes());
        registry.bump = ctx.bumps.registry;
        registry.current_cum_y = MULTIPLIER_SCALE;
        registry.current_cum_s = MULTIPLIER_SCALE;
        registry.current_yield_nonce = 0;
        registry.event_count = 0;
        registry.events = Vec::new();
        Ok(())
    }

    /// Authority-only path used in local tests and Surfpool simulations.
    pub fn sync_events(ctx: Context<SyncEvents>, payload: Vec<u8>) -> Result<u32> {
        apply_sync_payload(&mut ctx.accounts.registry, &payload)
    }

    /// Chainlink Keystone forwarder delivery path.
    ///
    /// Account layout matches CRE Solana Write: the forwarder CPIs with
    /// `state` + `forwarder_authority` (signer), then receiver-specific accounts.
    /// The `report` bytes are the Borsh-encoded SyncPayload (forwarder unwraps the outer report).
    pub fn on_report(ctx: Context<OnReport>, _metadata: Vec<u8>, report: Vec<u8>) -> Result<u32> {
        verify_forwarder_authority(&ctx)?;

        let payload = decode_sync_payload(&report)?;
        let mint = payload.mint;
        let inserted = apply_decoded_payload(&mut ctx.accounts.registry, payload.clone())?;

        emit!(SyncPayloadReceived {
            mint,
            inserted,
            payload,
        });

        Ok(inserted)
    }

    pub fn lookup_at(ctx: Context<LookupAt>, timestamp: i64) -> Result<CaEvent> {
        let registry = &ctx.accounts.registry;
        let (_idx, event) = registry
            .find_at_or_before(timestamp)
            .ok_or(CaRegistryError::NotFound)?;
        Ok(event)
    }

    pub fn event_at_yield_nonce(ctx: Context<LookupAt>, nonce: u32) -> Result<CaEvent> {
        let registry = &ctx.accounts.registry;
        registry
            .find_yield_nonce(nonce)
            .ok_or(error!(CaRegistryError::NotFound))
    }
}

fn apply_sync_payload(registry: &mut Account<RegistryLog>, payload_bytes: &[u8]) -> Result<u32> {
    let payload = decode_sync_payload(payload_bytes)?;
    apply_decoded_payload(registry, payload)
}

fn apply_decoded_payload(
    registry: &mut Account<RegistryLog>,
    payload: SyncPayload,
) -> Result<u32> {
    require_keys_eq!(payload.mint, registry.mint, CaRegistryError::MintMismatch);

    let mut inserted = 0u32;
    for sync_event in payload.events {
        if registry.contains_event_id(&sync_event.event_id) {
            continue;
        }

        require!(
            sync_event.multiplier_old > 0,
            CaRegistryError::InvalidMultiplier
        );

        let ratio = (sync_event.multiplier_new as u128)
            .checked_mul(MULTIPLIER_SCALE as u128)
            .ok_or(CaRegistryError::Overflow)?
            / (sync_event.multiplier_old as u128);

        let mut cum_y = registry.current_cum_y;
        let mut cum_s = registry.current_cum_s;
        let mut yield_nonce = registry.current_yield_nonce;

        match sync_event.kind {
            KIND_YIELD => {
                cum_y = ((cum_y as u128)
                    .checked_mul(ratio)
                    .ok_or(CaRegistryError::Overflow)?
                    / (MULTIPLIER_SCALE as u128)) as u64;
                yield_nonce = yield_nonce.saturating_add(1);
            }
            KIND_SUPPLY => {
                cum_s = ((cum_s as u128)
                    .checked_mul(ratio)
                    .ok_or(CaRegistryError::Overflow)?
                    / (MULTIPLIER_SCALE as u128)) as u64;
            }
            KIND_OTHER => {}
            _ => return err!(CaRegistryError::InvalidKind),
        }

        let ca_event = sync_event.into_ca_event(cum_y, cum_s, yield_nonce);
        registry.push_unique(ca_event)?;
        registry.current_cum_y = cum_y;
        registry.current_cum_s = cum_s;
        registry.current_yield_nonce = yield_nonce;
        inserted = inserted.saturating_add(1);
    }
    registry.sort_by_effective_ts();

    Ok(inserted)
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
        CaRegistryError::InvalidForwarderAuthority
    );

    if ctx.accounts.registry.forwarder_state != Pubkey::default() {
        require_keys_eq!(
            ctx.accounts.state.key(),
            ctx.accounts.registry.forwarder_state,
            CaRegistryError::InvalidForwarderAuthority
        );
    }

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeRegistry<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: xStock mint tracked by this registry
    pub mint: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + RegistryLog::INIT_SPACE,
        seeds = [b"registry", mint.key().as_ref()],
        bump
    )]
    pub registry: Account<'info, RegistryLog>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SyncEvents<'info> {
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"registry", registry.mint.as_ref()],
        bump = registry.bump,
        has_one = authority
    )]
    pub registry: Account<'info, RegistryLog>,
}

#[derive(Accounts)]
pub struct OnReport<'info> {
    /// CHECK: Keystone forwarder state; owner is the forwarder program.
    pub state: UncheckedAccount<'info>,
    /// PDA signer supplied by the forwarder CPI.
    pub forwarder_authority: Signer<'info>,
    #[account(
        mut,
        seeds = [b"registry", registry.mint.as_ref()],
        bump = registry.bump
    )]
    pub registry: Account<'info, RegistryLog>,
}

#[derive(Accounts)]
pub struct LookupAt<'info> {
    #[account(
        seeds = [b"registry", registry.mint.as_ref()],
        bump = registry.bump
    )]
    pub registry: Account<'info, RegistryLog>,
}
