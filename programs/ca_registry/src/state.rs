use anchor_lang::prelude::*;

pub const MAX_SYMBOL_LEN: usize = 8;
pub const MAX_EVENTS: usize = 64;
pub const MULTIPLIER_SCALE: u64 = 1_000_000_000_000;
pub const KIND_YIELD: u8 = 0;
pub const KIND_SUPPLY: u8 = 1;
pub const KIND_OTHER: u8 = 2;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Debug, PartialEq, Eq)]
pub struct CaEvent {
    pub event_id: [u8; 16],
    pub ca_type: u8,
    pub kind: u8,
    pub effective_ts: i64,
    pub multiplier_old: u64,
    pub multiplier_new: u64,
    pub cum_y: u64,
    pub cum_s: u64,
    pub yield_nonce: u32,
}

#[account]
#[derive(InitSpace)]
pub struct RegistryLog {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub forwarder_state: Pubkey,
    pub symbol: [u8; MAX_SYMBOL_LEN],
    pub symbol_len: u8,
    pub bump: u8,
    pub current_cum_y: u64,
    pub current_cum_s: u64,
    pub current_yield_nonce: u32,
    pub event_count: u32,
    #[max_len(MAX_EVENTS)]
    pub events: Vec<CaEvent>,
}

impl RegistryLog {
    pub fn find_at_or_before(&self, ts: i64) -> Option<(u32, CaEvent)> {
        if self.events.is_empty() {
            return None;
        }

        let mut lo = 0usize;
        let mut hi = self.events.len();
        while lo < hi {
            let mid = lo + (hi - lo) / 2;
            if self.events[mid].effective_ts <= ts {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }

        if lo == 0 {
            return None;
        }

        let idx = lo - 1;
        Some((idx as u32, self.events[idx]))
    }

    /// Resolve the Yield event at `nonce`.
    /// `nonce == 0` returns a synthetic genesis checkpoint.
    pub fn find_yield_nonce(&self, nonce: u32) -> Option<CaEvent> {
        if nonce == 0 {
            return Some(CaEvent {
                event_id: [0u8; 16],
                ca_type: 0,
                kind: KIND_YIELD,
                effective_ts: 0,
                multiplier_old: MULTIPLIER_SCALE,
                multiplier_new: MULTIPLIER_SCALE,
                cum_y: MULTIPLIER_SCALE,
                cum_s: MULTIPLIER_SCALE,
                yield_nonce: 0,
            });
        }

        self.events
            .iter()
            .find(|event| event.kind == KIND_YIELD && event.yield_nonce == nonce)
            .copied()
    }

    pub fn contains_event_id(&self, event_id: &[u8; 16]) -> bool {
        self.events.iter().any(|event| &event.event_id == event_id)
    }

    pub fn push_unique(&mut self, event: CaEvent) -> Result<()> {
        if self.events.len() >= MAX_EVENTS {
            return err!(crate::errors::CaRegistryError::CapacityExceeded);
        }
        self.events.push(event);
        self.event_count = self.events.len() as u32;
        Ok(())
    }

    pub fn sort_by_effective_ts(&mut self) {
        self.events.sort_by_key(|event| event.effective_ts);
    }
}
