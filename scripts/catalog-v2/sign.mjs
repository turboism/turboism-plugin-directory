#!/usr/bin/env node
// Sign an exact catalog file with an Ed25519 private key, producing a detached
// signature envelope (contract 4). The catalog file must already be canonical
// (deterministic key order) and pass strict schema v2 validation; the exact
// file bytes are what get hashed and signed.
//
// Usage:
//   node scripts/catalog-v2/sign.mjs --catalog <file.json> --key <private.pem> --key-id <id> --out <envelope.json>
//
// The private key is read from a file path only; it is never read from
// environment variables, logs, or committed resources. Production key material
// must never enter this repository.
import { readFileSync, writeFileSync } from "node:fs";
import { signCatalogBytes, stringifyCanonical } from "../../lib/catalog-v2/catalog.mjs";

const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 || index + 1 >= args.length ? null : args[index + 1];
};
const catalogPath = argValue("--catalog");
const keyPath = argValue("--key");
const keyId = argValue("--key-id");
const outPath = argValue("--out");

if (!catalogPath || !keyPath || !keyId || !outPath) {
  console.error("usage: node scripts/catalog-v2/sign.mjs --catalog <file.json> --key <private.pem> --key-id <id> --out <envelope.json>");
  process.exit(2);
}

const catalogBytes = readFileSync(catalogPath);
const privateKeyPem = readFileSync(keyPath, "utf8");
const signed = signCatalogBytes(catalogBytes, privateKeyPem, keyId);
if (!signed.ok) {
  for (const issue of signed.errors) {
    console.error(`sign error: ${issue.path}: ${issue.message}`);
  }
  process.exit(1);
}
const envelopeBytes = stringifyCanonical(signed.envelope, "envelope");
writeFileSync(outPath, envelopeBytes, "utf8");
console.log(`signed ${catalogPath} (${catalogBytes.byteLength} bytes) with key "${keyId}" -> ${outPath}`);
