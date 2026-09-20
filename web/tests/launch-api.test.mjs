import assert from "node:assert/strict";

function unwrapCreBody(body) {
  const nested = body.output ?? body.result ?? body.data;
  if (nested && typeof nested === "object") return { ok: true, ...nested };
  return body;
}

const flat = unwrapCreBody({ pool: "abc", baseMint: "def" });
assert.equal(flat.pool, "abc");

const nested = unwrapCreBody({
  output: { pool: "p1", baseMint: "m1", launchSignature: "sig" },
});
assert.equal(nested.pool, "p1");
assert.equal(nested.baseMint, "m1");

console.log("launch-api.test.mjs: ok");
