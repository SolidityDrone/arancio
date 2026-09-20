import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../src/styles/global.css", import.meta.url), "utf8");
const heroRule = css.match(/\.hero\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

assert.match(
  heroRule,
  /overflow-x:\s*clip;/,
  "The hero must clip horizontal overflow without creating a nested scroll container",
);
assert.match(heroRule, /overflow-y:\s*visible;/);
