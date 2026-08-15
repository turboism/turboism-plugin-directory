// Deterministic test fixtures for the v2 provider: Ed25519 keypairs, a minimal
// ZIP/JAR writer (node:zlib only), schema-v3 descriptor and catalog builders,
// and a deployment helper that provisions a signed pair in a temp directory.
// Test key material exists only here — never in production resources.
import { generateKeyPairSync } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { signCatalogBytes, stringifyCanonical } from "../../lib/catalog-v2/catalog.mjs";

/** @returns {{ privateKey: string, publicKey: string }} PEM pair */
export function makeKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

/** Build a trusted-keys allowlist object (purpose is explicit so tests control requireProduction). */
export function makeAllowlist(keyId, publicKeyPem, purpose = "production") {
  return { [keyId]: { pem: publicKeyPem, purpose } };
}

/**
 * Deterministic minimal ZIP/JAR writer.
 * @param {Array<{ name: string, data: Uint8Array|string, method?: 0|8 }>} entries
 * @returns {Buffer}
 */
export function makeZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const method = entry.method === undefined ? 8 : entry.method;
    const compressed = method === 8 ? deflateRawSync(data) : method === 0 ? data : null;
    if (compressed === null) throw new Error(`unsupported fixture method ${method}`);
    const checksum = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12); // mod time
    central.writeUInt16LE(0, 14); // mod date
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(central, name);

    offset += 30 + name.length + compressed.length;
  }
  const localBuffer = Buffer.concat(localParts);
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(localBuffer.length, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localBuffer, centralBuffer, eocd]);
}

/** Build a schema-v3 descriptor object. Insertion order does not matter (JSON parsing). */
export function makeDescriptor(overrides = {}) {
  return {
    schemaVersion: 3,
    id: "dev.turboism.plugin.project-inspector",
    version: "0.1.0",
    name: "Project Inspector",
    category: "development",
    tags: ["project", "inspection"],
    turboismApi: "[0.1.0,0.2.0)",
    environment: { requiresCubism: true },
    permissions: [{ id: "dev.turboism.plugin.core", scope: "application", reason: "inspect project files" }],
    dependencies: [{ id: "dev.turboism.plugin.core", version: "[0.1.0,0.3.0)", type: "required", ordering: "none" }],
    ...overrides,
  };
}

const ARTIFACT_URL = "https://github.com/turboism/turboism-releases/releases/download/v0.1.0/turboism-plugin-project-inspector-0.1.0.jar";

/** Build a valid release object in canonical key order. */
export function makeRelease(overrides = {}) {
  return {
    version: "0.1.0",
    channel: "preview",
    status: "active",
    publishedAt: "2026-08-15T00:00:00Z",
    category: "development",
    tags: ["project", "inspection"],
    turboismApi: "[0.1.0,0.2.0)",
    requiresCubism: true,
    cubismVersions: ["5.3.02"],
    platforms: ["windows-x64"],
    dependencies: [{ id: "dev.turboism.plugin.core", version: "[0.1.0,0.3.0)", type: "required", ordering: "none" }],
    permissions: [{ id: "dev.turboism.plugin.core", scope: "application", reason: "inspect project files" }],
    releaseUrl: "https://github.com/turboism/turboism-releases/releases/tag/v0.1.0",
    artifact: {
      mediaType: "application/java-archive",
      fileName: "turboism-plugin-project-inspector-0.1.0.jar",
      url: ARTIFACT_URL,
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      descriptorSha256: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      size: 123456,
    },
    ...overrides,
  };
}

/** Build a valid plugin object in canonical key order. */
export function makePlugin(overrides = {}) {
  return {
    id: "dev.turboism.plugin.project-inspector",
    slug: "project-inspector",
    name: "Project Inspector",
    summary: "Inspect the active Cubism project and workspace.",
    trust: "official",
    author: "Turboism Contributors",
    license: "Project License",
    repository: "https://github.com/turboism/Turboism",
    support: "https://github.com/turboism/Turboism/issues",
    localizations: {},
    releases: [makeRelease()],
    ...overrides,
  };
}

/** Build a valid catalog object in canonical key order. */
export function makeCatalog(overrides = {}) {
  return {
    format: "turboism.plugin.catalog",
    schemaVersion: 2,
    catalogVersion: 1,
    publishedAt: "2026-08-15T00:00:00Z",
    plugins: [makePlugin()],
    ...overrides,
  };
}

/**
 * Provision a signed pair plus allowlist in a temp directory (the HTTP test
 * seam). Returns the dir paths and key material.
 */
export function deployPair(dir, { catalog = makeCatalog(), keyId = "turboism-test-v2", purpose = "production", plugins = null } = {}) {
  const object = plugins === null ? catalog : { ...catalog, plugins };
  const bytes = stringifyCanonical(object, "catalog");
  const keys = makeKeyPair();
  const allowlist = makeAllowlist(keyId, keys.publicKey, purpose);
  const signed = signCatalogBytes(Buffer.from(bytes, "utf8"), keys.privateKey, keyId);
  if (!signed.ok) throw new Error(`fixture signing failed: ${signed.errors[0].message}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "catalog.json"), bytes, "utf8");
  writeFileSync(path.join(dir, "catalog.json.sig"), stringifyCanonical(signed.envelope, "envelope"), "utf8");
  writeFileSync(path.join(dir, "trusted-keys.json"), JSON.stringify(allowlist), "utf8");
  writeFileSync(path.join(dir, "private.pem"), keys.privateKey, "utf8");
  return { dir, catalogBytes: Buffer.from(bytes, "utf8"), keys, allowlist, keyId };
}
