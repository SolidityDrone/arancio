use anchor_lang::prelude::*;

use crate::state::CaEvent;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct SyncEvent {
    pub event_id: [u8; 16],
    pub ca_type: u8,
    pub kind: u8,
    pub effective_ts: i64,
    pub multiplier_old: u64,
    pub multiplier_new: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub struct SyncPayload {
    pub mint: Pubkey,
    pub events: Vec<SyncEvent>,
}

impl SyncEvent {
    pub fn into_ca_event(self, cum_y: u64, cum_s: u64, yield_nonce: u32) -> CaEvent {
        CaEvent {
            event_id: self.event_id,
            ca_type: self.ca_type,
            kind: self.kind,
            effective_ts: self.effective_ts,
            multiplier_old: self.multiplier_old,
            multiplier_new: self.multiplier_new,
            cum_y,
            cum_s,
            yield_nonce,
        }
    }
}

pub fn decode_sync_payload(bytes: &[u8]) -> Result<SyncPayload> {
    SyncPayload::try_from_slice(bytes)
        .map_err(|_| error!(crate::errors::CaRegistryError::InvalidPayload))
}
