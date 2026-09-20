import assert from "node:assert/strict";

function fairCouponMultiplier(fairCoupon, launchFairCoupon) {
  return launchFairCoupon > 0 ? fairCoupon / launchFairCoupon : 1;
}

function rawToUiNumber(raw, decimals) {
  return Number(raw.toString()) / 10 ** decimals;
}

assert.equal(fairCouponMultiplier(0.02, 0.02), 1);
assert.equal(fairCouponMultiplier(0.03, 0.02), 1.5);
assert.equal(fairCouponMultiplier(0.02, 0), 1);
assert.ok(Math.abs(rawToUiNumber(1_000_000n, 6) - 1) < 1e-9);
assert.ok(Math.abs(rawToUiNumber("500000", 6) - 0.5) < 1e-9);

console.log("curve-yt-vault.test.mjs: ok");
