#!/usr/bin/env node
// Sync IDL artifacts from BracketChain-Programs/target/ → src/idl/
// Run after `anchor build`: pnpm run sync-idl
//
// Copies:
//   ../bracket-chain-programs/target/idl/bracket_chain.json
//   ../bracket-chain-programs/target/types/bracket_chain.ts
// Into:
//   src/idl/bracket_chain.json
//   src/idl/bracket_chain.ts

import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDK_ROOT = resolve(__dirname, "..");
const PROGRAMS_ROOT = resolve(SDK_ROOT, "..", "bracket-chain-programs");

const SRC = {
  json: join(PROGRAMS_ROOT, "target", "idl", "bracket_chain.json"),
  ts: join(PROGRAMS_ROOT, "target", "types", "bracket_chain.ts"),
};
const DST_DIR = join(SDK_ROOT, "src", "idl");
const DST = {
  json: join(DST_DIR, "bracket_chain.json"),
  ts: join(DST_DIR, "bracket_chain.ts"),
};

for (const [label, path] of Object.entries(SRC)) {
  if (!existsSync(path)) {
    console.error(`✗ Missing IDL ${label} at ${path}`);
    console.error(`  Run \`anchor build\` in BracketChain-Programs first.`);
    process.exit(1);
  }
}

if (!existsSync(DST_DIR)) mkdirSync(DST_DIR, { recursive: true });

copyFileSync(SRC.json, DST.json);
copyFileSync(SRC.ts, DST.ts);

console.log(`✓ Synced IDL → ${DST.json}`);
console.log(`✓ Synced IDL → ${DST.ts}`);
