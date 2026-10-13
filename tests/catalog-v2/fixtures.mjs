// Deterministic test fixtures for the v2 provider: Ed25519 keypairs, a minimal
// ZIP/JAR writer (node:zlib only), schema-v3 descriptor and catalog builders,
// and a deployment helper that provisions a signed pair in a temp directory.
// Test key material exists only here — never in production resources.
import { generateKeyPairSync } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { signCatalogBytes, stringifyCanonical } from "../../lib/catalog-v2/catalog.mjs";
import { commitPointer, stageGeneration } from "../../lib/catalog-v2/storage.mjs";

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

/**
 * Build a real-shaped Turboism schema-v3 descriptor object: format
 * turboism.plugin.meta with entrypoints and runtime-facing fields, plus every
 * field the v2 publication binding compares (id, version, category, ordered
 * tags, turboismApi, environment.requiresCubism, permissions, dependencies).
 */
export function makeDescriptor(overrides = {}) {
  return {
    format: "turboism.plugin.meta",
    schemaVersion: 3,
    id: "dev.turboism.plugin.project-inspector",
    version: "0.1.0",
    name: "Project Inspector",
    summary: "Inspect the active Cubism project and workspace.",
    turboismApi: "[0.1.0,0.2.0)",
    category: "development",
    tags: ["project", "inspection"],
    environment: { requiresCubism: true, cubismEditor: "5.3.02" },
    entrypoints: {
      main: "dev.turboism.plugin.projectinspector.ProjectInspectorPlugin",
      menu: "dev.turboism.plugin.projectinspector.MenuContributor",
    },
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
 * Build a multi-plugin populated catalog fixture covering 5 locales,
 * multiple versions (including yanked), official + reviewed-third-party trust,
 * and Cubism-bound + Editor-independent releases.
 */
export function makePopulatedDirectoryCatalog() {
  return makeCatalog({
    catalogVersion: 3,
    publishedAt: "2026-08-20T09:00:00Z",
    plugins: [
      makePlugin({
        id: "dev.turboism.plugin.mcp",
        slug: "mcp",
        name: "Turboism MCP Server",
        summary: "Expose Cubism workspace tools over a local MCP server.",
        trust: "official",
        author: "Turboism Contributors",
        license: "Project License",
        repository: "https://github.com/turboism/Turboism",
        support: "https://github.com/turboism/Turboism/issues",
        localizations: {
          "zh-Hans": { name: "Turboism MCP 服务", summary: "通过本地 MCP 服务暴露 Cubism 工作区工具。" },
          "zh-Hant": { name: "Turboism MCP 服務", summary: "透過本機 MCP 服務暴露 Cubism 工作區工具。" },
          ja: { name: "Turboism MCP サーバー", summary: "ローカル MCP サーバー経由で Cubism ワークスペースツールを公開します。" },
          ko: { name: "Turboism MCP 서버", summary: "로컬 MCP 서버를 통해 Cubism 작업 공간 도구를 노출합니다." },
        },
        releases: [
          makeRelease({
            version: "0.1.0",
            channel: "stable",
            status: "active",
            publishedAt: "2026-08-16T09:00:00Z",
            category: "integration",
            tags: ["mcp", "automation"],
            turboismApi: "[0.1.0,0.2.0)",
            requiresCubism: true,
            cubismVersions: ["5.3.00", "5.3.02"],
            releaseUrl: "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugin-mcp-v0.1.0",
            artifact: {
              mediaType: "application/java-archive",
              fileName: "mcp-0.1.0.jar",
              url: "https://github.com/turboism/turboism-plugin-directory/releases/download/plugin-mcp-v0.1.0/mcp-0.1.0.jar",
              sha256: "1111111111111111111111111111111111111111111111111111111111111111",
              descriptorSha256: "2222222222222222222222222222222222222222222222222222222222222222",
              size: 40960,
            },
          }),
          makeRelease({
            version: "0.2.0",
            channel: "stable",
            status: "active",
            publishedAt: "2026-08-20T09:00:00Z",
            category: "integration",
            tags: ["mcp", "automation", "agent"],
            turboismApi: "[0.1.0,0.2.0)",
            requiresCubism: true,
            cubismVersions: ["5.3.00", "5.3.02", "5.3.04"],
            releaseUrl: "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugin-mcp-v0.2.0",
            artifact: {
              mediaType: "application/java-archive",
              fileName: "mcp-0.2.0.jar",
              url: "https://github.com/turboism/turboism-plugin-directory/releases/download/plugin-mcp-v0.2.0/mcp-0.2.0.jar",
              sha256: "3333333333333333333333333333333333333333333333333333333333333333",
              descriptorSha256: "4444444444444444444444444444444444444444444444444444444444444444",
              size: 49152,
            },
          }),
        ],
      }),
      makePlugin({
        id: "dev.turboism.plugin.webdav",
        slug: "webdav-backup",
        name: "WebDAV Auto-Backup",
        summary: "Sync Cubism project backups to a WebDAV endpoint.",
        trust: "official",
        author: "Turboism Contributors",
        license: "Project License",
        repository: "https://github.com/turboism/Turboism",
        support: "https://github.com/turboism/Turboism/issues",
        localizations: {
          "zh-Hans": { name: "WebDAV 自动备份", summary: "将 Cubism 项目备份同步至 WebDAV 端点。" },
          ja: { name: "WebDAV 自動バックアップ", summary: "Cubism プロジェクトのバックアップを WebDAV に同期します。" },
        },
        releases: [
          makeRelease({
            version: "0.1.0",
            channel: "stable",
            status: "active",
            publishedAt: "2026-08-18T09:00:00Z",
            category: "workflow",
            tags: ["backup", "webdav"],
            turboismApi: "[0.1.0,0.2.0)",
            requiresCubism: false,
            cubismVersions: [],
            releaseUrl: "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugin-webdav-backup-v0.1.0",
            artifact: {
              mediaType: "application/java-archive",
              fileName: "webdav-backup-0.1.0.jar",
              url: "https://github.com/turboism/turboism-plugin-directory/releases/download/plugin-webdav-backup-v0.1.0/webdav-backup-0.1.0.jar",
              sha256: "5555555555555555555555555555555555555555555555555555555555555555",
              descriptorSha256: "6666666666666666666666666666666666666666666666666666666666666666",
              size: 32768,
            },
          }),
          makeRelease({
            version: "0.2.0",
            channel: "preview",
            status: "yanked",
            publishedAt: "2026-08-19T09:00:00Z",
            category: "workflow",
            tags: ["backup", "webdav"],
            turboismApi: "[0.1.0,0.2.0)",
            requiresCubism: false,
            cubismVersions: [],
            releaseUrl: "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugin-webdav-backup-v0.2.0",
            artifact: {
              mediaType: "application/java-archive",
              fileName: "webdav-backup-0.2.0.jar",
              url: "https://github.com/turboism/turboism-plugin-directory/releases/download/plugin-webdav-backup-v0.2.0/webdav-backup-0.2.0.jar",
              sha256: "7777777777777777777777777777777777777777777777777777777777777777",
              descriptorSha256: "8888888888888888888888888888888888888888888888888888888888888888",
              size: 33000,
            },
          }),
        ],
      }),
    ],
  });
}

/**
 * Provision a signed pair plus allowlist in a temp directory (the HTTP test
 * seam). Returns the dir paths and key material.
 */
export function deployPair(dir, { catalog = makeCatalog(), keyId = "turboism-test-v2", purpose = "production", plugins = null, generationId = "00000001" } = {}) {
  const object = plugins === null ? catalog : { ...catalog, plugins };
  const bytes = stringifyCanonical(object, "catalog");
  const keys = makeKeyPair();
  const allowlist = makeAllowlist(keyId, keys.publicKey, purpose);
  const signed = signCatalogBytes(Buffer.from(bytes, "utf8"), keys.privateKey, keyId);
  if (!signed.ok) throw new Error(`fixture signing failed: ${signed.errors[0].message}`);
  const sigBytes = stringifyCanonical(signed.envelope, "envelope");
  mkdirSync(dir, { recursive: true });
  const staged = stageGeneration(dir, generationId, Buffer.from(bytes, "utf8"), Buffer.from(sigBytes, "utf8"));
  if (!staged.ok) throw new Error(`fixture staging failed: ${staged.message}`);
  const committed = commitPointer(dir, generationId);
  if (!committed.ok) throw new Error(`fixture pointer commit failed: ${committed.message}`);
  writeFileSync(path.join(dir, "trusted-keys.json"), JSON.stringify(allowlist), "utf8");
  writeFileSync(path.join(dir, "private.pem"), keys.privateKey, "utf8");
  return { dir, catalogBytes: Buffer.from(bytes, "utf8"), sigBytes: Buffer.from(sigBytes, "utf8"), keys, allowlist, keyId, generationId };
}
