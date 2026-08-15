#!/usr/bin/env node
// Publish the Plugin Directory v2 catalog/signature pair through the atomic
// staged pipeline (contract 8):
//
//   1. validate the source catalog against strict schema v2;
//   2. validate every release's JAR binding (artifact hash/size, exact
//      META-INF/turboism/plugin.json schema-v3 descriptor, identity,
//      category/ordered-tags equality, normalized capabilities);
//   3. emit canonical deterministic catalog bytes;
//   4. sign the exact staged bytes with an Ed25519 private key;
//   5. verify the exact staged bytes against the trusted-keys allowlist
//      (production purpose only);
//   6. atomically publish the catalog/signature pair (tmp files, then rename).
//
// Usage:
//   node scripts/catalog-v2/publish.mjs \
//     --catalog <source.json> \
//     --jars <manifest.json> \
//     --key <private.pem> \
//     --key-id <key-id> \
//     --keys <allowlist.json> \
//     --out <dir> \
//     [--dry-run]
//
// The manifest maps "<pluginId>@<version>" to a local .jar path. Only .jar
// inputs are accepted (no .tplugin, no ZIP store input). Nothing is written
// to `--out` unless every stage passes; a torn or unverifiable pair is never
// published. The private key never enters this repository.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  checkJarBinding,
  loadTrustedKeys,
  signCatalogBytes,
  stringifyCanonical,
  validateCatalogBytes,
  verifyCatalogBytes,
} from "../../lib/catalog-v2/catalog.mjs";

const args = process.argv.slice(2);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 || index + 1 >= args.length ? null : args[index + 1];
};
const catalogPath = argValue("--catalog");
const jarsPath = argValue("--jars");
const keyPath = argValue("--key");
const keyId = argValue("--key-id");
const keysPath = argValue("--keys");
const outDir = argValue("--out");
const dryRun = args.includes("--dry-run");

if (!catalogPath || !jarsPath || !keyPath || !keyId || !keysPath || !outDir) {
  console.error(
    "usage: node scripts/catalog-v2/publish.mjs --catalog <source.json> --jars <manifest.json> --key <private.pem> --key-id <key-id> --keys <allowlist.json> --out <dir> [--dry-run]",
  );
  process.exit(2);
}

const fail = (stage, message) => {
  console.error(`publish failed at ${stage}: ${message}`);
  process.exit(1);
};

// Stage 1: strict schema v2 validation of the source catalog.
const sourceBytes = readFileSync(catalogPath);
const validated = validateCatalogBytes(sourceBytes);
if (!validated.ok) {
  for (const issue of validated.errors) {
    console.error(`catalog error: ${issue.path}: ${issue.message}`);
  }
  fail("validation", `${validated.errors.length} catalog issue(s)`);
}
const catalog = validated.catalog;

// Stage 2: JAR binding for every release (schema-v3 descriptor inspection).
let manifest;
try {
  manifest = JSON.parse(readFileSync(jarsPath, "utf8"));
} catch {
  fail("manifest", "JAR manifest must be a readable JSON file");
}
if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
  fail("manifest", "JAR manifest must map \"<pluginId>@<version>\" to a .jar path");
}
let bindings = 0;
for (const plugin of catalog.plugins) {
  for (const release of plugin.releases) {
    const jarPath = manifest[`${plugin.id}@${release.version}`];
    if (typeof jarPath !== "string") {
      fail("binding", `no JAR for ${plugin.id}@${release.version}`);
    }
    if (!/\.jar$/i.test(jarPath)) {
      fail("binding", `artifact for ${plugin.id}@${release.version} must be a .jar file, got "${jarPath}"`);
    }
    const bound = checkJarBinding(path.resolve(jarPath), release, plugin.id);
    if (!bound.ok) {
      for (const issue of bound.errors) {
        console.error(`binding error (${plugin.id}@${release.version}): ${issue.path}: ${issue.message}`);
      }
      fail("binding", `${bound.errors.length} binding issue(s) for ${plugin.id}@${release.version}`);
    }
    bindings += 1;
  }
}
console.log(`validated ${catalog.plugins.length} plugin(s), ${bindings} release binding(s)`);

// Stage 3: canonical deterministic catalog bytes.
const canonicalBytes = stringifyCanonical(catalog, "catalog");

// Stage 4: sign the exact staged bytes.
const privateKeyPem = readFileSync(keyPath, "utf8");
const signed = signCatalogBytes(Buffer.from(canonicalBytes, "utf8"), privateKeyPem, keyId);
if (!signed.ok) {
  for (const issue of signed.errors) {
    console.error(`sign error: ${issue.path}: ${issue.message}`);
  }
  fail("signing", "could not sign the staged catalog");
}
const envelopeBytes = stringifyCanonical(signed.envelope, "envelope");

// Stage 5: verify the exact staged bytes against the allowlist (production).
const keysCheck = loadTrustedKeys(keysPath);
if (!keysCheck.ok) {
  fail("verification", keysCheck.message);
}
const verified = verifyCatalogBytes(Buffer.from(canonicalBytes, "utf8"), Buffer.from(envelopeBytes, "utf8"), keysCheck.keys, {
  requireProduction: true,
});
if (!verified.ok) {
  for (const issue of verified.errors) {
    console.error(`verify error: ${issue.path}: ${issue.message}`);
  }
  fail("verification", "staged pair did not verify against the trusted allowlist");
}

if (dryRun) {
  console.log(`dry-run OK: ${canonicalBytes.length} canonical bytes, envelope for "${keyId}" verified; nothing written`);
  process.exit(0);
}

// Stage 6: atomic publish — tmp files first, then rename; no partial pair.
mkdirSync(outDir, { recursive: true });
const catalogFile = path.join(outDir, "catalog.json");
const sigFile = path.join(outDir, "catalog.json.sig");
const catalogTmp = `${catalogFile}.tmp`;
const sigTmp = `${sigFile}.tmp`;
writeFileSync(catalogTmp, canonicalBytes, "utf8");
writeFileSync(sigTmp, envelopeBytes, "utf8");
renameSync(sigTmp, sigFile);
renameSync(catalogTmp, catalogFile);
console.log(`published pair -> ${catalogFile} (${canonicalBytes.length} bytes) and ${sigFile} (${envelopeBytes.length} bytes)`);
