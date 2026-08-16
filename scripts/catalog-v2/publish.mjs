#!/usr/bin/env node
// Publish the Plugin Directory v2 catalog/signature pair through the atomic
// staged pipeline (contract 8):
//
//   1. validate the source catalog against strict schema v2;
//   2. validate every release's JAR binding (artifact hash/size, exact
//      META-INF/turboism/plugin.json schema-v3 descriptor, identity,
//      category/ordered-tags equality, normalized capabilities);
//   3. emit canonical deterministic catalog bytes;
//   3.5. enforce the frozen catalogVersion publication invariant (contract
//      8): production-verify an existing current pair, allow idempotent
//      no-op or same-version key rotation only for identical bytes, require
//      exactly current + 1 for changed bytes, and never treat a malformed
//      partial root as a first launch;
//   4. sign the exact staged bytes with an Ed25519 private key;
//   5. verify the exact staged bytes against the trusted-keys allowlist
//      (production purpose only);
//   6. stage BOTH exact bytes into a fresh immutable generation directory and
//      verify them on disk;
//   7. commit the current pointer with ONE atomic rename.
//
// A fault before the pointer commit leaves the previously committed
// generation served; a mixed or partial pair can never become current.
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
// to `--out` unless every stage passes. The private key never enters this
// repository.
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  checkJarBinding,
  loadTrustedKeys,
  signCatalogBytes,
  stringifyCanonical,
  validateCatalogBytes,
  verifyCatalogBytes,
} from "../../lib/catalog-v2/catalog.mjs";
import { POINTER_FILE, commitPointer, loadCurrentGeneration, nextGenerationId, stageGeneration } from "../../lib/catalog-v2/storage.mjs";

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

/**
 * Frozen catalogVersion publication invariant (contract 8, section 8).
 * Runs BEFORE any signing or staging when a current generation is present:
 *  1. the current pair must load and production-verify against the trusted
 *     allowlist; any missing/torn/invalid pair fails closed and is never
 *     overwritten around;
 *  2. identical canonical bytes + same keyId => idempotent success, no new
 *     generation, no write;
 *  3. different bytes => the source catalogVersion must be exactly
 *     current + 1; equal, lower, or skipped versions fail;
 *  4. identical bytes + different keyId => key rotation is allowed at the
 *     SAME catalogVersion with a new signed generation; identical catalog
 *     bytes never increment catalogVersion;
 *  5. no current pointer => initial publication is allowed ONLY on an absent
 *     or empty root; a malformed partial publication root is not treated as
 *     initial.
 * @param {string} outDir
 * @param {Buffer} canonicalBuf canonical source bytes
 * @param {string} keyId requested signing key id
 * @param {object} trustedKeys allowlist { keyId: { pem, purpose } }
 * @param {number} sourceVersion source catalog catalogVersion
 * @returns {{ ok: true, idempotent?: boolean, generationId?: string } | { ok: false, message: string }}
 */
function checkPublicationInvariant(outDir, canonicalBuf, keyId, trustedKeys, sourceVersion) {
  const pointerPath = path.join(outDir, POINTER_FILE);
  let pointerPresent = true;
  try {
    lstatSync(pointerPath);
  } catch {
    pointerPresent = false;
  }
  if (!pointerPresent) {
    // Initial publication is allowed only when the root is absent or empty.
    let entries = null;
    try {
      entries = readdirSync(outDir);
    } catch {
      entries = null;
    }
    if (entries !== null && entries.length > 0) {
      return {
        ok: false,
        message: `malformed partial publication root: no current pointer but "${outDir}" is not empty; initial publication is not allowed`,
      };
    }
    return { ok: true };
  }
  const loaded = loadCurrentGeneration(outDir);
  if (!loaded.ok) {
    return { ok: false, message: `the current pair is missing or torn (${loaded.message}); refusing to publish around it` };
  }
  const verified = verifyCatalogBytes(loaded.catalogBytes, loaded.sigBytes, trustedKeys, { requireProduction: true });
  if (!verified.ok) {
    return {
      ok: false,
      message: "the current pair failed production verification against the trusted allowlist; refusing to publish around it",
    };
  }
  if (canonicalBuf.equals(loaded.catalogBytes)) {
    if (verified.envelope.keyId === keyId) {
      // Identical bytes under the same key: idempotent, no new generation.
      return { ok: true, idempotent: true, generationId: loaded.generationId };
    }
    // Identical bytes under a different key: rotation at the SAME
    // catalogVersion with a new signed generation.
    return { ok: true };
  }
  // Semantic change: the source must advance catalogVersion by exactly one.
  const currentVersion = verified.catalog.catalogVersion;
  if (sourceVersion !== currentVersion + 1) {
    return {
      ok: false,
      message: `source catalogVersion ${sourceVersion} is not exactly current + 1 (${currentVersion} + 1); equal, lower, or skipped versions fail before signing`,
    };
  }
  return { ok: true };
}

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
const canonicalBuf = Buffer.from(canonicalBytes, "utf8");

// Stage 3.5: load the trusted allowlist once, then enforce the frozen
// catalogVersion publication invariant (contract 8) BEFORE any signing or
// staging. Idempotent runs exit successfully without writing anything.
const keysCheck = loadTrustedKeys(keysPath);
if (!keysCheck.ok) {
  fail("verification", keysCheck.message);
}
const invariant = checkPublicationInvariant(outDir, canonicalBuf, keyId, keysCheck.keys, catalog.catalogVersion);
if (!invariant.ok) {
  fail("invariant", invariant.message);
}
if (invariant.idempotent) {
  console.log(
    `idempotent: generation ${invariant.generationId} already carries these exact bytes under key "${keyId}"; no new generation, nothing written`,
  );
  process.exit(0);
}

// Stage 4: sign the exact staged bytes.
const privateKeyPem = readFileSync(keyPath, "utf8");
const signed = signCatalogBytes(canonicalBuf, privateKeyPem, keyId);
if (!signed.ok) {
  for (const issue of signed.errors) {
    console.error(`sign error: ${issue.path}: ${issue.message}`);
  }
  fail("signing", "could not sign the staged catalog");
}
const envelopeBytes = stringifyCanonical(signed.envelope, "envelope");

// Stage 5: verify the exact staged bytes against the allowlist (production).
const verified = verifyCatalogBytes(canonicalBuf, Buffer.from(envelopeBytes, "utf8"), keysCheck.keys, {
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

// Stage 6+7: stage the immutable generation, then commit the pointer once.
const next = nextGenerationId(outDir);
if (!next.ok) {
  fail("staging", next.message);
}
const staged = stageGeneration(outDir, next.id, Buffer.from(canonicalBytes, "utf8"), Buffer.from(envelopeBytes, "utf8"));
if (!staged.ok) {
  fail("staging", staged.message);
}
const committed = commitPointer(outDir, next.id);
if (!committed.ok) {
  fail("pointer", committed.message);
}
console.log(
  `published generation ${next.id} -> ${path.join(outDir, "generations", next.id)} (${canonicalBytes.length} catalog bytes, ${envelopeBytes.length} signature bytes); pointer committed`,
);
