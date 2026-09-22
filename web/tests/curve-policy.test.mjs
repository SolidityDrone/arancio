import assert from "node:assert/strict";

// Mirror TS policy constants for a lightweight node test (no vite bundler).
const PER_NONCE = 100_000;
const MIN_GRAD = 30_000;
const MAX_GRAD = 120_000;

function computePolicy(avg) {
  const fair = Math.max(5_000, Math.round(PER_NONCE * avg));
  let initial = Math.max(5_000, Math.round(fair * 0.6));
  let migration = Math.round(fair * 0.8);
  if (migration < MIN_GRAD) migration = MIN_GRAD;
  if (migration > MAX_GRAD) migration = MAX_GRAD;
  if (migration <= initial) {
    initial = Math.max(5_000, migration - 1_000);
  }
  return { fair, initial, migration };
}

const kox = computePolicy(0.522);
assert.equal(kox.initial, 31_320);
assert.equal(kox.migration, 41_760);

const floor = computePolicy(0.25);
assert.equal(floor.migration, MIN_GRAD);

const cap = computePolicy(2.0);
assert.equal(cap.migration, MAX_GRAD);
assert.ok(cap.initial < cap.migration);

console.log("curve-policy.test.mjs: ok");
