/** How often shared on-chain desk state (pool, vault, chart) is refreshed. */
export const DESK_LIVE_POLL_MS = 5_000;

/** Registry tip / cum-Y — changes less often than DBC swaps. */
export const DESK_REGISTRY_POLL_MS = 12_000;

/** Skip a poll tick when the tab is in the background. */
export function shouldPollLiveState(): boolean {
  return typeof document === "undefined" || !document.hidden;
}
