#!/usr/bin/env node
// Verify an exact catalog file against a detached Ed25519 signature envelope
// and a trusted-keys allowlist, following the normative verification order
// (contract 4). Also accepts a catalog alone for schema validation.
//
// Usage:
//   node scripts/catalog-v2/verify.mjs --catalog <file> [--sig <file>] [--keys <allowlist.json>] [--require-production] [--quiet]
//
// The allowlist maps keyId -> { pem, purpose: "production" | "test" }.
// The production allowlist lives at lib/catalog-v2/trusted-keys.json and
// carries the reviewed production public key (turboism-official-v1).
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadTrustedKeys, validateCatalogBytes, verifyCatalogBytes } from "../../lib/catalog-v2/catalog.mjs";

const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 || index + 1 >= args.length ? null : args[index + 1];
};
const catalogPath = argValue("--catalog");
const sigPath = argValue("--sig");
const keysPath = argValue("--keys") ?? path.join(process.cwd(), "lib", "catalog-v2", "trusted-keys.json");
const requireProduction = args.includes("--require-production");
const quiet = args.includes("--quiet");

if (!catalogPath) {
  console.error("usage: node scripts/catalog-v2/verify.mjs --catalog <file> [--sig <file>] [--keys <allowlist.json>] [--require-production] [--quiet]");
  process.exit(2);
}

const catalogBytes = readFileSync(catalogPath);
if (!sigPath) {
  // Schema-only validation.
  const check = validateCatalogBytes(catalogBytes);
  if (!check.ok) {
    for (const issue of check.errors) {
      console.error(`validation error: ${issue.path}: ${issue.message}`);
    }
    process.exit(1);
  }
  if (!quiet) console.log(`catalog schema OK: ${catalogPath} (${catalogBytes.byteLength} bytes)`);
  process.exit(0);
}

const keysCheck = loadTrustedKeys(keysPath);
if (!keysCheck.ok) {
  console.error(`verify error: ${keysCheck.message}`);
  process.exit(1);
}
const sigBytes = readFileSync(sigPath);
const verified = verifyCatalogBytes(catalogBytes, sigBytes, keysCheck.keys, { requireProduction });
if (!verified.ok) {
  for (const issue of verified.errors) {
    console.error(`verify error: ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}
if (!quiet) {
  console.log(
    `verify OK: ${catalogPath} (${catalogBytes.byteLength} bytes) matches ${sigPath} under key "${verified.envelope.keyId}" (sha256 ${verified.sha256})`,
  );
}
process.exit(0);
