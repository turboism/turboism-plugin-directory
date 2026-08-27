// Provider ingest/update lane tests: source-run proof + artifact extraction,
// strict bundle validation, public Release create/resume (no-clobber),
// deterministic catalog ingestion, JAR hydration, and a full local
// end-to-end first-publish/update/retry/rollback cycle. Every network
// boundary is a local HTTP stub; nothing touches GitHub. Test key material
// exists only here — never in production resources.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { deflateRawSync, crc32 } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { loadTrustedKeys, signCatalogBytes, stringifyCanonical, validateCatalogBytes, verifyCatalogBytes } from "../../lib/catalog-v2/catalog.mjs";
import { checkTentativeCapacity, redirectSafeFetch } from "../../scripts/catalog-v2/ingest-official-release.mjs";
import { makeAllowlist, makeKeyPair, makeZip, makeCatalog, makePlugin, makeRelease } from "./fixtures.mjs";

const ROOT = path.join(process.cwd());
const INGEST = path.join(ROOT, "scripts", "catalog-v2", "ingest-official-release.mjs");
const PUBLISH = path.join(ROOT, "scripts", "catalog-v2", "publish.mjs");

const SOURCE_SHA = "5a3c66d2ff23af471600d8f7f65248e35df81226";
const CONVENTIONAL_ARTIFACT = `turboism-market-release-${SOURCE_SHA}-123-1`;
const PUBLIC_REPO = "turboism/turboism-plugin-directory";
const PUBLISHED_AT = "2026-08-16T09:00:00Z";

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "catalog-v2-ingest-"));
}

/**
 * Run the ingest CLI asynchronously: the local HTTP stub server needs the
 * event loop, so a synchronous spawn would deadlock against it.
 */
function runIngest(args, { env = {}, expectFailure = false } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [INGEST, ...args], { encoding: "utf8", env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      if (error) {
        if (!expectFailure) {
          const wrapped = new Error(`ingest CLI failed (${error.code ?? error.message}): ${(stderr ?? "").slice(0, 300)}`);
          wrapped.stdout = stdout ?? "";
          wrapped.stderr = stderr ?? "";
          resolve(Promise.reject(wrapped));
          return;
        }
        resolve({ ok: false, stdout: stdout ?? "", stderr: stderr ?? "", status: typeof error.code === "number" ? error.code : 1 });
        return;
      }
      resolve({ ok: true, stdout: stdout ?? "" });
    });
  });
}

function runPublish(args) {
  return execFileSync(process.execPath, [PUBLISH, ...args], { encoding: "utf8", cwd: ROOT });
}

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function emptyCatalog(catalogVersion, publishedAt = "2026-08-16T08:48:40Z") {
  return { format: "turboism.plugin.catalog", schemaVersion: 2, catalogVersion, publishedAt, plugins: [] };
}

const DESCRIPTOR_SUBSET_KEYS = ["id", "version", "name", "description", "author", "license", "category", "tags", "turboismApi", "environment", "dependencies", "permissions"];

function subset(descriptor) {
  const out = {};
  for (const key of DESCRIPTOR_SUBSET_KEYS) out[key] = descriptor[key];
  return out;
}

function makeEmbeddedDescriptor(overrides = {}) {
  return {
    format: "turboism.plugin.meta",
    schemaVersion: 3,
    id: "dev.turboism.plugin.backup",
    version: "0.1.0",
    name: "WebDAV Auto-Backup Sync Plugin",
    description: "Uploads Cubism auto-backup artifacts to a WebDAV endpoint.",
    author: "Turboism Contributors",
    license: "Project License",
    category: "workflow",
    tags: ["backup", "webdav", "automation"],
    turboismApi: "[0.1.0,0.2.0)",
    environment: { requiresCubism: true, ui: "swing" },
    dependencies: [],
    permissions: [
      { id: "turboism.config.plugin.read", scope: "application", reason: "Reads the backup configuration." },
      { id: "turboism.event.subscribe", scope: "application", reason: "Subscribes to backup events." },
    ],
    entrypoints: { main: "dev.turboism.plugin.backup.BackupPlugin" },
    ...overrides,
  };
}

function makeLocalizations(name, description) {
  return {
    en: { name, description },
    "zh-Hans": { name: `同步${name}`, description: `中文${description}` },
    ja: { name: `${name}同期`, description: `日本語${description}` },
  };
}

function makePolicy(overrides = {}) {
  return {
    channel: "preview",
    cubismVersions: ["5.3.02"],
    repository: "https://github.com/turboism/turboism-plugin-directory",
    support: "https://github.com/turboism/turboism-plugin-directory/issues",
    ...overrides,
  };
}

function buildBundle(dir, artifacts, { revision = SOURCE_SHA } = {}) {
  const bundleDir = path.join(dir, "bundle");
  mkdirSync(bundleDir, { recursive: true });
  rmSync(bundleDir, { recursive: true, force: true });
  mkdirSync(bundleDir, { recursive: true });
  const sidecarArtifacts = [];
  for (const { module, descriptor, policy, localizations } of artifacts) {
    const jarBytes = makeZip([
      { name: "META-INF/turboism/plugin.json", data: JSON.stringify(descriptor) },
      { name: `dev/turboism/plugin/${module}/Entry.class`, data: Buffer.from([0xca, 0xfe, 0xba, 0xbe]) },
    ]);
    const asset = `${module}-${descriptor.version}.jar`;
    writeFileSync(path.join(bundleDir, asset), jarBytes);
    sidecarArtifacts.push({
      project: `:plugins:${module}`,
      module,
      asset,
      sha256: sha256Hex(jarBytes),
      size: jarBytes.byteLength,
      descriptorSha256: sha256Hex(Buffer.from(JSON.stringify(descriptor), "utf8")),
      policy,
      descriptor: subset(descriptor),
      localizations,
      jarBytes,
    });
  }
  const sidecar = {
    format: "turboism.market-release",
    schemaVersion: 1,
    source: { revision },
    artifacts: sidecarArtifacts.map((entry) => {
      const copy = { ...entry };
      delete copy.jarBytes;
      return copy;
    }),
  };
  writeFileSync(path.join(bundleDir, "market-release.json"), JSON.stringify(sidecar));
  return { bundleDir, sidecarPath: path.join(bundleDir, "market-release.json"), artifacts: sidecarArtifacts, sidecar };
}

function backupArtifact(overrides = {}) {
  return {
    module: "backup",
    descriptor: makeEmbeddedDescriptor(),
    policy: makePolicy(),
    localizations: makeLocalizations("WebDAV Auto-Backup Sync Plugin", "backup"),
    ...overrides,
  };
}

function mcpArtifact(overrides = {}) {
  return {
    module: "mcp",
    descriptor: makeEmbeddedDescriptor({ id: "dev.turboism.plugin.mcp", name: "Turboism MCP Server", description: "Loopback MCP server.", category: "integration", tags: ["mcp", "automation"] }),
    policy: makePolicy(),
    localizations: makeLocalizations("Turboism MCP Server", "mcp"),
    ...overrides,
  };
}

/** Canonical release metadata file exactly as sync-releases writes it. */
function writeReleaseMeta(dir, entries) {
  const file = path.join(dir, "releases.json");
  const releases = {};
  for (const entry of entries) {
    const { module, version } = entry;
    const tag = `plugin-${module}-v${version}`;
    const assetName = `${module}-${version}.jar`;
    releases[`${module}@${version}`] = {
      module,
      version,
      tag,
      releaseUrl: `https://github.com/${PUBLIC_REPO}/releases/tag/${tag}`,
      publishedAt: PUBLISHED_AT,
      artifactUrl: `https://github.com/${PUBLIC_REPO}/releases/download/${tag}/${assetName}`,
      assetName,
      sha256: entry.sha256,
      size: entry.size,
      ...entry.overrides,
    };
  }
  writeFileSync(file, JSON.stringify({ format: "turboism.market-release.meta", schemaVersion: 1, releases }));
  return file;
}

function snapshotDir(dir) {
  const snapshot = new Map();
  const walk = (base) => {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const full = path.join(base, entry.name);
      if (entry.isSymbolicLink()) snapshot.set(path.relative(dir, full), `SYMLINK->${readFileSync(full)}`);
      else if (entry.isDirectory()) walk(full);
      else snapshot.set(path.relative(dir, full), readFileSync(full));
    }
  };
  if (existsSync(dir)) walk(dir);
  return snapshot;
}

/** Minimal ZIP writer with full control (method, flags, external attrs, declared sizes). */
function makeRawZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const method = entry.method === undefined ? 8 : entry.method;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const checksum = crc32(data) >>> 0;
    const declaredComp = entry.declaredComp ?? compressed.length;
    const declaredUncomp = entry.declaredUncomp ?? data.length;
    const externalAttrs = entry.externalAttrs ?? 0;
    const flags = entry.flags ?? 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(declaredComp, 18);
    local.writeUInt32LE(declaredUncomp, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(declaredComp, 20);
    central.writeUInt32LE(declaredUncomp, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(externalAttrs, 38);
    central.writeUInt32LE(offset, 42);
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

// ---------------------------------------------------------------------------
// GitHub API stub (local http server; every route is configurable)
// ---------------------------------------------------------------------------

class ApiStub {
  constructor() {
    this.runs = new Map();
    this.artifacts = new Map(); // id -> { name, expired, size_in_bytes, zip, archive_download_url }
    this.releases = new Map(); // tag -> release object
    this.assetBytes = new Map(); // `${tag}/${asset}` -> Buffer
    this.redirectDownload = null; // { from: tag/asset, to: url } for redirect-failure tests
    this.redirects = new Map(); // path -> { status, location }
    this.rawResponses = new Map(); // path -> { status, headers, body }
    this.log = []; // { method, path, auth, contentType }
    this.nextId = 100;
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  async start() {
    this.server.listen(0, "127.0.0.1");
    await once(this.server, "listening");
    this.port = this.server.address().port;
    this.base = `http://127.0.0.1:${this.port}`;
    return this.base;
  }

  async stop() {
    this.server.close();
    await once(this.server, "close");
  }

  json(res, status, value) {
    const bytes = Buffer.from(JSON.stringify(value), "utf8");
    res.writeHead(status, { "Content-Type": "application/json", "Content-Length": bytes.length });
    res.end(bytes);
  }

  releaseObject(tag, { draft = false, publishedAt = PUBLISHED_AT, assets = [] } = {}) {
    return {
      id: ++this.nextId,
      tag_name: tag,
      name: tag,
      body: "Public plugin release",
      draft,
      prerelease: false,
      html_url: `https://github.com/${PUBLIC_REPO}/releases/tag/${tag}`,
      published_at: publishedAt,
      upload_url: `${this.base}/repos/${PUBLIC_REPO}/releases/${this.nextId}/assets{?name,label}`,
      assets,
    };
  }

  assetObject(tag, assetName) {
    const bytes = this.assetBytes.get(`${tag}/${assetName}`);
    return {
      id: ++this.nextId,
      name: assetName,
      size: bytes?.byteLength ?? 0,
      browser_download_url: `https://github.com/${PUBLIC_REPO}/releases/download/${tag}/${assetName}`,
    };
  }

  handle(req, res) {
    const url = new URL(req.url, this.base);
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      this.log.push({ method: req.method, path: url.pathname + url.search, auth: req.headers.authorization ?? null, contentType: req.headers["content-type"] ?? null });
      this.route(req.method, url, body, res);
    });
  }

  route(method, url, body, res) {
    const p = url.pathname;
    let match;

    const raw = this.rawResponses.get(p);
    if (raw !== undefined) {
      const bytes = Buffer.isBuffer(raw.body) ? raw.body : Buffer.from(raw.body ?? "", "utf8");
      res.writeHead(raw.status ?? 200, { "Content-Length": bytes.length, ...(raw.headers ?? {}) });
      return res.end(bytes);
    }
    const redirect = this.redirects.get(p);
    if (redirect !== undefined) {
      res.writeHead(redirect.status ?? 302, { Location: redirect.location });
      return res.end();
    }

    if (method === "GET" && (match = /^\/repos\/turboism\/Turboism\/actions\/runs\/(\d+)$/.exec(p))) {
      const run = this.runs.get(match[1]);
      return run ? this.json(res, 200, run) : this.json(res, 404, { message: "Not Found" });
    }
    if (method === "GET" && (match = /^\/repos\/turboism\/Turboism\/actions\/runs\/(\d+)\/artifacts$/.exec(p))) {
      const artifacts = [...this.artifacts.values()].filter((artifact) => artifact.runId === match[1]);
      return this.json(res, 200, { total_count: artifacts.length, artifacts });
    }
    if (method === "GET" && (match = /^\/repos\/turboism\/Turboism\/actions\/artifacts\/(\d+)\/zip$/.exec(p))) {
      const artifact = this.artifacts.get(match[1]);
      if (!artifact || !artifact.zip) return this.json(res, 404, { message: "Not Found" });
      res.writeHead(200, { "Content-Type": "application/zip", "Content-Length": artifact.zip.length });
      return res.end(artifact.zip);
    }
    if (method === "GET" && (match = /^\/repos\/turboism\/turboism-plugin-directory\/releases\/tags\/([^/]+)$/.exec(p))) {
      const tag = decodeURIComponent(match[1]);
      const release = this.releases.get(tag);
      return release ? this.json(res, 200, release) : this.json(res, 404, { message: "Not Found" });
    }
    if (method === "POST" && p === "/repos/turboism/turboism-plugin-directory/releases") {
      const payload = JSON.parse(body.toString("utf8"));
      const release = this.releaseObject(payload.tag_name, { draft: payload.draft ?? false });
      if (this.onCreate) this.onCreate(release);
      this.releases.set(payload.tag_name, release);
      return this.json(res, 201, release);
    }
    if (method === "POST" && (match = /^\/repos\/turboism\/turboism-plugin-directory\/releases\/(\d+)\/assets$/.exec(p))) {
      const release = [...this.releases.values()].find((entry) => String(entry.id) === match[1]);
      if (!release) return this.json(res, 404, { message: "Not Found" });
      const assetName = url.searchParams.get("name");
      this.assetBytes.set(`${release.tag_name}/${assetName}`, body);
      const asset = this.assetObject(release.tag_name, assetName);
      release.assets = release.assets.filter((entry) => entry.name !== assetName).concat(asset);
      return this.json(res, 201, asset);
    }
    if (method === "GET" && (match = /^\/turboism\/turboism-plugin-directory\/releases\/download\/([^/]+)\/([^/]+)$/.exec(p))) {
      const tag = decodeURIComponent(match[1]);
      const assetName = decodeURIComponent(match[2]);
      if (this.redirectDownload && this.redirectDownload.from === `${tag}/${assetName}`) {
        res.writeHead(302, { Location: this.redirectDownload.to });
        return res.end();
      }
      const bytes = this.assetBytes.get(`${tag}/${assetName}`);
      if (!bytes) return this.json(res, 404, { message: "Not Found" });
      res.writeHead(200, { "Content-Type": "application/java-archive", "Content-Length": bytes.length });
      return res.end(bytes);
    }
    return this.json(res, 404, { message: `no stub route for ${method} ${p}` });
  }
}

// ---------------------------------------------------------------------------
// verify-run: source run proof + artifact download + safe extraction
// ---------------------------------------------------------------------------

function makeRun(overrides = {}) {
  return {
    id: 123,
    name: "Selected plugin publication",
    path: ".github/workflows/publish-selected-plugins.yml",
    head_branch: "main",
    head_sha: SOURCE_SHA,
    event: "push",
    status: "completed",
    conclusion: "success",
    run_attempt: 1,
    repository: { full_name: "turboism/Turboism", private: true },
    ...overrides,
  };
}

function makeArtifact({ id = 77, name = CONVENTIONAL_ARTIFACT, zip = null, runId = "123", expired = false, sizeInBytes = null } = {}) {
  return { id, name, expired, runId, zip, size_in_bytes: sizeInBytes ?? zip?.byteLength ?? 0, archive_download_url: "" };
}

function verifyArgs(base, { runId = "123", sha = SOURCE_SHA, artifactName = CONVENTIONAL_ARTIFACT, out = null } = {}) {
  return [
    "verify-run",
    "--run-id", runId,
    "--sha", sha,
    "--artifact-name", artifactName,
    "--out", out ?? path.join(mkdtempSync(path.join(tmpdir(), "verify-out-"))),
    "--api-url", base,
    "--poll-interval", "1",
    "--poll-timeout", "2",
    "--token-env", "TURBOISM_RELEASE_ARTIFACT_READ_TOKEN",
  ];
}

test("verify-run proves the source run identity, polls to completion, and extracts exactly the artifact", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const bundle = buildBundle(dir, [backupArtifact()]);
    const zip = makeRawZip([
      { name: "market-release.json", data: readFileSync(bundle.sidecarPath), externalAttrs: 0o100644 * 0x10000 },
      { name: "backup-0.1.0.jar", data: readFileSync(path.join(bundle.bundleDir, "backup-0.1.0.jar")), externalAttrs: 0o100644 * 0x10000 },
    ]);
    const inProgress = makeRun({ status: "in_progress" });
    const done = makeRun();
    stub.runs.set("123", inProgress);
    stub.artifacts.set("77", makeArtifact({ zip }));
    let polls = 0;
    const originalRoute = stub.route.bind(stub);
    stub.route = (method, url, body, res) => {
      if (method === "GET" && /\/actions\/runs\/123$/.test(url.pathname)) {
        polls += 1;
        stub.runs.set("123", polls >= 2 ? done : inProgress);
      }
      return originalRoute(method, url, body, res);
    };
    const outDir = path.join(dir, "extracted");
    const result = await runIngest(verifyArgs(base, { out: outDir }), { env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "source-read-token" } });
    assert.ok(result.ok, result.stderr);
    assert.ok(polls >= 2, "the run must be polled until it settles");
    assert.ok(result.stdout.includes(`verified source run 123 (${SOURCE_SHA})`));
    assert.deepEqual(readdirSync(outDir).sort(), ["backup-0.1.0.jar", "market-release.json"]);
    assert.deepEqual(readFileSync(path.join(outDir, "backup-0.1.0.jar")), readFileSync(path.join(bundle.bundleDir, "backup-0.1.0.jar")));
    // The private-source token rides only as a bearer header; the body is never echoed.
    const runCalls = stub.log.filter((entry) => entry.method === "GET" && /actions\/runs/.test(entry.path));
    assert.ok(runCalls.length >= 2);
    for (const call of runCalls) assert.equal(call.auth, "Bearer source-read-token");
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify-run fails closed on forged run identity (repo/path/event/branch/SHA)", async () => {
  const stub = new ApiStub();
  const base = await stub.start();
  const cases = [
    { repository: { full_name: "evil/turboism" } },
    { path: ".github/workflows/other.yml" },
    { event: "workflow_dispatch" },
    { head_branch: "dev" },
    { head_sha: "1111111111111111111111111111111111111111" },
  ];
  try {
    for (const overrides of cases) {
      stub.runs.set("123", makeRun(overrides));
      const result = await runIngest(verifyArgs(base), { env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "t" }, expectFailure: true });
      assert.equal(result.ok, false);
      assert.match(result.stderr, /identity proof|does not equal the claimed source SHA/);
    }
  } finally {
    await stub.stop();
  }
});

test("verify-run fails on failed conclusion, missing artifact, ambiguity, and timeout", async () => {
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    stub.runs.set("123", makeRun({ conclusion: "failure" }));
    let result = await runIngest(verifyArgs(base), { env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "t" }, expectFailure: true });
    assert.match(result.stderr, /conclusion "failure"/);

    stub.runs.set("123", makeRun());
    stub.artifacts.set("77", makeArtifact({ name: "different-name" }));
    result = await runIngest(verifyArgs(base, { artifactName: "different-name" }), { env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "t" }, expectFailure: true });
    assert.match(result.stderr, /does not match the accepted source convention/);

    stub.artifacts.set("77", makeArtifact({ name: CONVENTIONAL_ARTIFACT, expired: true }));
    result = await runIngest(verifyArgs(base), { env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "t" }, expectFailure: true });
    assert.match(result.stderr, /no non-expired artifact named/);

    stub.artifacts.clear();
    stub.artifacts.set("77", makeArtifact({ name: CONVENTIONAL_ARTIFACT, id: 77 }));
    stub.artifacts.set("78", makeArtifact({ name: CONVENTIONAL_ARTIFACT, id: 78 }));
    result = await runIngest(verifyArgs(base), { env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "t" }, expectFailure: true });
    assert.match(result.stderr, /more than one non-expired artifact/);

    stub.artifacts.clear();
    stub.artifacts.set("77", makeArtifact({ name: CONVENTIONAL_ARTIFACT, sizeInBytes: 2 * 1024 * 1024 * 1024 }));
    result = await runIngest(verifyArgs(base), { env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "t" }, expectFailure: true });
    assert.match(result.stderr, /exceeding the/);

    stub.artifacts.clear();
    stub.runs.set("123", makeRun({ status: "in_progress" }));
    result = await runIngest(verifyArgs(base), { env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "t" }, expectFailure: true });
    assert.match(result.stderr, /did not complete within/);
  } finally {
    await stub.stop();
  }
});

test("verify-run follows only bounded same-approved-host redirects and rejects unapproved hops", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const bundle = buildBundle(dir, [backupArtifact()]);
    const zip = makeRawZip([
      { name: "market-release.json", data: readFileSync(bundle.sidecarPath), externalAttrs: 0o100644 * 0x10000 },
      { name: "backup-0.1.0.jar", data: readFileSync(path.join(bundle.bundleDir, "backup-0.1.0.jar")), externalAttrs: 0o100644 * 0x10000 },
    ]);
    stub.runs.set("123", makeRun());
    const artifact = makeArtifact({ zip });
    artifact.archive_download_url = `${base}/artifact-entry`;
    stub.artifacts.set("77", artifact);
    stub.redirects.set("/artifact-entry", { status: 302, location: "/artifact-final" });
    stub.rawResponses.set("/artifact-final", { status: 200, headers: { "Content-Type": "application/zip" }, body: zip });

    let result = await runIngest(verifyArgs(base, { out: path.join(dir, "redirect-ok") }), {
      env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "source-read-token" },
    });
    assert.ok(result.ok, result.stderr);
    assert.ok(stub.log.some((entry) => entry.path === "/artifact-entry"));
    assert.ok(stub.log.some((entry) => entry.path === "/artifact-final"));

    stub.redirects.set("/artifact-entry", { status: 302, location: "http://127.0.0.1:1/unapproved" });
    result = await runIngest(verifyArgs(base, { out: path.join(dir, "redirect-bad") }), {
      env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "source-read-token" },
      expectFailure: true,
    });
    assert.match(result.stderr, /redirect target host .* is not approved/);
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify-run enforces the redirect hop cap", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    stub.runs.set("123", makeRun());
    const artifact = makeArtifact({ zip: Buffer.from("unused") });
    artifact.archive_download_url = `${base}/hop-0`;
    stub.artifacts.set("77", artifact);
    for (let index = 0; index <= 5; index += 1) {
      stub.redirects.set(`/hop-${index}`, { status: 302, location: `/hop-${index + 1}` });
    }
    const result = await runIngest(verifyArgs(base, { out: path.join(dir, "redirect-cap") }), {
      env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "source-read-token" },
      expectFailure: true,
    });
    assert.match(result.stderr, /exceeded the 5-redirect cap/);
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("redirect-safe fetch forbids an HTTPS downgrade before the downgraded request", async (context) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response(null, { status: 302, headers: { Location: "http://localhost/final" } });
  };
  await assert.rejects(
    redirectSafeFetch("https://localhost/start", {
      approvedHosts: new Set(["localhost"]),
      allowHttp: true,
    }),
    /downgrades HTTPS/,
  );
  assert.deepEqual(calls, ["https://localhost/start"]);
});

test("verify-run rejects traversal, absolute-path, symlink, and oversize zip entries", async () => {
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    stub.runs.set("123", makeRun());
    const hostile = [
      { name: "../evil.jar", data: "x" },
      { name: "/evil.jar", data: "x" },
      { name: "a\\b.jar", data: "x" },
      { name: "link.jar", data: "x", externalAttrs: 0o120777 * 0x10000 },
      { name: "big.jar", data: "small", declaredUncomp: 17 * 1024 * 1024 },
    ];
    for (const entry of hostile) {
      stub.artifacts.clear();
      stub.artifacts.set("77", makeArtifact({ zip: makeRawZip([entry]) }));
      const result = await runIngest(verifyArgs(base), { env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "t" }, expectFailure: true });
      assert.equal(result.ok, false, `entry ${entry.name} must be rejected`);
      assert.match(result.stderr, /safe relative path|symbolic link|exceeds \d+ uncompressed bytes|not a regular file/);
    }
  } finally {
    await stub.stop();
  }
});

// ---------------------------------------------------------------------------
// validate-bundle
// ---------------------------------------------------------------------------

test("validate-bundle accepts the canonical bundle and writes a normalized manifest", async () => {
  const dir = tempDir();
  try {
    const bundle = buildBundle(dir, [backupArtifact(), mcpArtifact()]);
    const outFile = path.join(dir, "normalized.json");
    const result = await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", outFile]);
    assert.ok(result.ok, result.stderr);
    const normalized = JSON.parse(readFileSync(outFile, "utf8"));
    assert.equal(normalized.format, "turboism.market-release");
    assert.equal(normalized.source.revision, SOURCE_SHA);
    assert.deepEqual(normalized.artifacts.map((entry) => entry.module), ["backup", "mcp"]);
    for (const entry of normalized.artifacts) {
      assert.ok(path.isAbsolute(entry.jarPath));
      assert.ok(entry.jarPath.startsWith(path.resolve(bundle.bundleDir) + path.sep));
      assert.equal(entry.asset, `${entry.module}-${entry.version}.jar`);
      assert.equal(entry.pluginId, entry.descriptor.id);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate-bundle rejects malformed, unknown-field, and duplicated sidecars", async () => {
  const dir = tempDir();
  try {
    const base = buildBundle(dir, [backupArtifact()]);
    const mutate = async (fn, label) => {
      const sidecar = JSON.parse(readFileSync(base.sidecarPath, "utf8"));
      fn(sidecar);
      const file = path.join(dir, `sidecar-${label}.json`);
      writeFileSync(file, JSON.stringify(sidecar));
      const result = await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", file, "--bundle-dir", base.bundleDir, "--out", path.join(dir, `out-${label}.json`)], { expectFailure: true });
      return result;
    };
    const cases = [
      [(s) => (s.extra = 1), "unknown top-level field"],
      [(s) => (s.format = "turboism.other"), "wrong format"],
      [(s) => (s.schemaVersion = 2), "wrong schema version"],
      [(s) => (s.source.revision = "short"), "bad revision"],
      [(s) => (s.artifacts[0].extra = true), "unknown artifact field"],
      [(s) => (s.artifacts[0].module = "backupx"), "non-canonical asset"],
      [(s) => (s.artifacts[0].project = ":plugins:other"), "project mismatch"],
      [(s) => (s.artifacts[0].policy.repository = "http://insecure.example"), "policy url"],
      [(s) => (s.artifacts[0].policy.channel = "nightly"), "invalid channel"],
      [(s) => (s.artifacts[0].policy.cubismVersions = []), "empty cubism"],
      [(s) => (s.artifacts[0].policy.cubismVersions = ["5.3.02", "5.3.02"]), "duplicate cubism"],
      [(s) => (s.artifacts[0].descriptor.category = "uncategorized"), "unregistered category"],
      [(s) => (s.artifacts[0].descriptor.tags = []), "empty tags"],
      [(s) => (s.artifacts[0].descriptor.tags = ["dup", "dup"]), "duplicate tags"],
      [(s) => (s.artifacts[0].descriptor.version = "0.1.00"), "non-strict version"],
      [(s) => (s.artifacts[0].descriptor.permissions[0].reason = ""), "blank permission reason"],
      [(s) => (s.artifacts[0].descriptor.environment.ui = 5), "bad environment ui"],
      [(s) => (s.artifacts[0].localizations.en = undefined), "missing locale"],
      [(s) => (s.artifacts[0].localizations.fr = { name: "x", description: "y" }), "extra locale"],
      [(s) => (s.artifacts[0].localizations.en.name = ""), "blank localized name"],
      [(s) => (s.artifacts[0].localizations.en.description = "x".repeat(501)), "oversized description"],
      [(s) => (s.artifacts[0].sha256 = "f".repeat(64)), "hash mismatch"],
      [(s) => (s.artifacts[0].size = 1), "size mismatch"],
      [(s) => (s.artifacts[0].descriptorSha256 = "e".repeat(64)), "descriptor hash mismatch"],
    ];
    for (const [mutator, label] of cases) {
      const result = await mutate(mutator, label.replace(/[^a-z0-9]+/gi, "-"));
      assert.equal(result.ok, false, label);
      assert.match(result.stderr, /error:/, label);
    }
    // Duplicate keys are rejected by the strict parser.
    const dupText = readFileSync(base.sidecarPath, "utf8").replace('"format":"turboism.market-release"', '"format":"turboism.market-release","format":"turboism.market-release"');
    const dupFile = path.join(dir, "sidecar-dup.json");
    writeFileSync(dupFile, dupText);
    const dup = await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", dupFile, "--bundle-dir", base.bundleDir, "--out", path.join(dir, "out-dup.json")], { expectFailure: true });
    assert.match(dup.stderr, /duplicate key|strict UTF-8 JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate-bundle rejects duplicate modules, plugin ids, and versions in one bundle", async () => {
  const dir = tempDir();
  try {
    const bundle = buildBundle(dir, [backupArtifact(), backupArtifact()]);
    const result = await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", path.join(dir, "out.json")], { expectFailure: true });
    assert.match(result.stderr, /duplicate module|duplicate version/);
    // Same version under two different module names but one plugin id.
    const bundle2 = buildBundle(dir, [backupArtifact(), { ...mcpArtifact(), descriptor: makeEmbeddedDescriptor() }]);
    const result2 = await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle2.sidecarPath, "--bundle-dir", bundle2.bundleDir, "--out", path.join(dir, "out2.json")], { expectFailure: true });
    assert.match(result2.stderr, /duplicate plugin id/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate-bundle rejects symlink, missing, oversize, and extra bundle files, and sidecar/descriptor drift", async () => {
  const dir = tempDir();
  try {
    const bundle = buildBundle(dir, [backupArtifact()]);
    // Missing JAR.
    const missingDir = path.join(dir, "missing");
    mkdirSync(missingDir);
    writeFileSync(path.join(missingDir, "market-release.json"), readFileSync(bundle.sidecarPath));
    let result = await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", path.join(missingDir, "market-release.json"), "--bundle-dir", missingDir, "--out", path.join(dir, "out-missing.json")], { expectFailure: true });
    assert.match(result.stderr, /not readable/);

    // Symlinked JAR.
    const linkDir = path.join(dir, "links");
    mkdirSync(linkDir);
    for (const file of readdirSync(bundle.bundleDir)) {
      if (file === "backup-0.1.0.jar") symlinkSync(path.join(bundle.bundleDir, file), path.join(linkDir, file));
      else writeFileSync(path.join(linkDir, file), readFileSync(path.join(bundle.bundleDir, file)));
    }
    result = await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", path.join(linkDir, "market-release.json"), "--bundle-dir", linkDir, "--out", path.join(dir, "out-link.json")], { expectFailure: true });
    assert.match(result.stderr, /must not be a symbolic link/);

    // Extra file in the bundle root.
    const extraDir = path.join(dir, "extra");
    mkdirSync(extraDir);
    for (const file of readdirSync(bundle.bundleDir)) writeFileSync(path.join(extraDir, file), readFileSync(path.join(bundle.bundleDir, file)));
    writeFileSync(path.join(extraDir, "stray.txt"), "junk");
    result = await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", path.join(extraDir, "market-release.json"), "--bundle-dir", extraDir, "--out", path.join(dir, "out-extra.json")], { expectFailure: true });
    assert.match(result.stderr, /unexpected file/);

    // Sidecar descriptor drifts from the embedded descriptor.
    const drifted = buildBundle(dir, [backupArtifact()]);
    const driftSidecar = path.join(dir, "drift-sidecar.json");
    const driftDoc = JSON.parse(readFileSync(drifted.sidecarPath, "utf8"));
    driftDoc.artifacts[0].descriptor.name = "Drifted Name";
    writeFileSync(driftSidecar, JSON.stringify(driftDoc));
    result = await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", driftSidecar, "--bundle-dir", drifted.bundleDir, "--out", path.join(dir, "out-drift.json")], { expectFailure: true });
    assert.match(result.stderr, /embedded descriptor market fields do not match/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// sync-releases: create/resume with no-clobber semantics
// ---------------------------------------------------------------------------

function syncArgs(base, normalizedFile, outFile, catalogFile) {
  return ["sync-releases", "--bundle", normalizedFile, "--out", outFile, "--catalog", catalogFile, "--api-url", base, "--asset-base", base];
}
async function normalizeBundle(dir) {
  const bundle = buildBundle(dir, [backupArtifact()]);
  const normalized = path.join(dir, "normalized.json");
  await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
  const catalogFile = path.join(dir, "catalog.json");
  writeFileSync(catalogFile, stringifyCanonical(emptyCatalog(1), "catalog"));
  return { bundle, normalized, catalogFile };
}

test("sync-releases creates a release and uploads the asset once when the tag is absent", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const { normalized, catalogFile } = await normalizeBundle(dir);
    const outFile = path.join(dir, "releases.json");
    const result = await runIngest(syncArgs(base, normalized, outFile, catalogFile), { env: { GITHUB_TOKEN: "provider-token" } });
    assert.ok(result.ok, result.stderr);
    assert.match(result.stdout, /created release plugin-backup-v0\.1\.0/);
    const posts = stub.log.filter((entry) => entry.method === "POST");
    assert.equal(posts.length, 2, "exactly one release creation and one asset upload");
    assert.equal(posts.filter((entry) => entry.path.endsWith("/assets?name=backup-0.1.0.jar")).length, 1);
    assert.equal(posts[0].auth, "Bearer provider-token");
    const meta = JSON.parse(readFileSync(outFile, "utf8"));
    const entry = meta.releases["backup@0.1.0"];
    assert.equal(entry.tag, "plugin-backup-v0.1.0");
    assert.equal(entry.publishedAt, PUBLISHED_AT);
    assert.equal(entry.releaseUrl, `https://github.com/${PUBLIC_REPO}/releases/tag/plugin-backup-v0.1.0`);
    assert.equal(entry.artifactUrl, `https://github.com/${PUBLIC_REPO}/releases/download/plugin-backup-v0.1.0/backup-0.1.0.jar`);
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync-releases resumes a byte-identical release without uploading, and uploads a missing asset", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const { bundle, normalized, catalogFile } = await normalizeBundle(dir);
    const jarBytes = readFileSync(path.join(bundle.bundleDir, "backup-0.1.0.jar"));
    const tag = "plugin-backup-v0.1.0";
    // Pre-existing release with the identical asset (bytes staged before the
    // asset object is created so its reported size is accurate).
    stub.assetBytes.set(`${tag}/backup-0.1.0.jar`, jarBytes);
    const release = stub.releaseObject(tag, { assets: [stub.assetObject(tag, "backup-0.1.0.jar")] });
    stub.releases.set(tag, release);
    const outFile = path.join(dir, "releases.json");
    let result = await runIngest(syncArgs(base, normalized, outFile, catalogFile), { env: { GITHUB_TOKEN: "provider-token" } });
    assert.ok(result.ok, result.stderr);
    assert.match(result.stdout, /resumed release plugin-backup-v0\.1\.0/);
    assert.equal(stub.log.filter((entry) => entry.method === "POST").length, 0, "no upload for a byte-identical asset");

    // Deleted asset (previous upload failed): the release resumes with an upload.
    release.assets = [];
    stub.log.length = 0;
    result = await runIngest(syncArgs(base, normalized, outFile, catalogFile), { env: { GITHUB_TOKEN: "provider-token" } });
    assert.ok(result.ok, result.stderr);
    assert.equal(stub.log.filter((entry) => entry.method === "POST" && entry.path.includes("/assets?name=")).length, 1);
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync-releases fails closed on differing bytes, drafts, and bad metadata", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const { bundle, normalized, catalogFile } = await normalizeBundle(dir);
    const jarBytes = readFileSync(path.join(bundle.bundleDir, "backup-0.1.0.jar"));
    const tag = "plugin-backup-v0.1.0";
    const outFile = path.join(dir, "releases.json");
    const run = async () => await runIngest(syncArgs(base, normalized, outFile, catalogFile), { env: { GITHUB_TOKEN: "provider-token" }, expectFailure: true });

    // Existing asset with a different size fails before any download.
    stub.releases.set(tag, stub.releaseObject(tag, { assets: [stub.assetObject(tag, "backup-0.1.0.jar")] }));
    stub.assetBytes.set(`${tag}/backup-0.1.0.jar`, Buffer.concat([jarBytes, Buffer.from("tampered")]));
    let result = await run();
    assert.match(result.stderr, /differing bytes must never be overwritten/);

    // Same size, different bytes fails after the byte comparison.
    stub.assetBytes.set(`${tag}/backup-0.1.0.jar`, Buffer.from("x".repeat(jarBytes.byteLength)));
    stub.releases.set(tag, stub.releaseObject(tag, { assets: [stub.assetObject(tag, "backup-0.1.0.jar")] }));
    result = await run();
    assert.match(result.stderr, /bytes differ from the source bundle/);

    // Draft release fails closed.
    stub.releases.set(tag, stub.releaseObject(tag, { draft: true, assets: [] }));
    result = await run();
    assert.match(result.stderr, /draft: must be exactly false/);

    // Invalid published_at fails closed.
    stub.releases.set(tag, stub.releaseObject(tag, { publishedAt: "yesterday", assets: [] }));
    result = await run();
    assert.match(result.stderr, /published_at/);

    // Conflicting html_url fails closed.
    stub.releases.set(tag, stub.releaseObject(tag, { assets: [] }));
    stub.releases.get(tag).html_url = "https://github.com/evil/releases/tag/x";
    result = await run();
    assert.match(result.stderr, /html_url/);
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ingest: deterministic catalog merge
// ---------------------------------------------------------------------------

test("ingest creates the first release with a single catalogVersion bump and is deterministic", async () => {
  const dir = tempDir();
  try {
    const sourceCatalog = path.join(dir, "catalog.json");
    writeFileSync(sourceCatalog, stringifyCanonical(emptyCatalog(1), "catalog"));
    const bundle = buildBundle(dir, [backupArtifact(), mcpArtifact()]);
    const normalized = path.join(dir, "normalized.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
    const releasesFile = writeReleaseMeta(dir, bundle.artifacts.map((entry) => ({ module: entry.module, version: entry.descriptor.version, sha256: entry.sha256, size: entry.size })));
    const before = readFileSync(sourceCatalog);
    const result = await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalized, "--releases", releasesFile]);
    assert.ok(result.ok, result.stderr);
    assert.match(result.stdout, /catalogVersion 1 -> 2/);
    const after = readFileSync(sourceCatalog);
    assert.notDeepEqual(after, before);
    const validated = validateCatalogBytes(after);
    assert.ok(validated.ok, JSON.stringify(validated.errors));
    const catalog = validated.catalog;
    assert.equal(catalog.catalogVersion, 2);
    assert.equal(catalog.publishedAt, PUBLISHED_AT);
    assert.deepEqual(catalog.plugins.map((plugin) => plugin.slug), ["backup", "mcp"]);
    const backup = catalog.plugins[0];
    assert.equal(backup.id, "dev.turboism.plugin.backup");
    assert.equal(backup.trust, "official");
    assert.equal(backup.repository, "https://github.com/turboism/turboism-plugin-directory");
    assert.deepEqual(backup.localizations["zh-Hans"], { name: "同步WebDAV Auto-Backup Sync Plugin", summary: "中文backup" });
    const release = backup.releases[0];
    assert.equal(release.version, "0.1.0");
    assert.equal(release.channel, "preview");
    assert.equal(release.status, "active");
    assert.deepEqual(release.platforms, ["windows-x64"]);
    assert.equal(release.sourceRevision, SOURCE_SHA);
    assert.equal(release.releaseUrl, `https://github.com/${PUBLIC_REPO}/releases/tag/plugin-backup-v0.1.0`);
    assert.equal(release.artifact.fileName, "backup-0.1.0.jar");
    assert.equal(release.artifact.sha256, bundle.artifacts[0].sha256);
    // A repeated identical run is a byte-identical no-op.
    const second = await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalized, "--releases", releasesFile]);
    assert.match(second.stdout, /no semantic change/);
    assert.deepEqual(readFileSync(sourceCatalog), after, "the source catalog must stay byte-identical");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ingest appends strictly higher versions retaining history and never removes other plugins", async () => {
  const dir = tempDir();
  try {
    const sourceCatalog = path.join(dir, "catalog.json");
    const first = buildBundle(dir, [backupArtifact()]);
    const normalized1 = path.join(dir, "normalized1.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", first.sidecarPath, "--bundle-dir", first.bundleDir, "--out", normalized1]);
    writeFileSync(sourceCatalog, stringifyCanonical(emptyCatalog(1), "catalog"));
    await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalized1, "--releases", writeReleaseMeta(dir, [{ module: "backup", version: "0.1.0", sha256: first.artifacts[0].sha256, size: first.artifacts[0].size }])]);
    // Second run: backup 0.2.0 (new) + mcp 0.1.0 (new plugin).
    const second = buildBundle(dir, [backupArtifact({ descriptor: makeEmbeddedDescriptor({ version: "0.2.0" }) }), mcpArtifact()]);
    const normalized2 = path.join(dir, "normalized2.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", second.sidecarPath, "--bundle-dir", second.bundleDir, "--out", normalized2]);
    const result = await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalized2, "--releases", writeReleaseMeta(dir, [
      { module: "backup", version: "0.2.0", sha256: second.artifacts[0].sha256, size: second.artifacts[0].size },
      { module: "mcp", version: "0.1.0", sha256: second.artifacts[1].sha256, size: second.artifacts[1].size },
    ])]);
    assert.match(result.stdout, /catalogVersion 2 -> 3/, "one batch, exactly one bump");
    const catalog = validateCatalogBytes(readFileSync(sourceCatalog)).catalog;
    const backup = catalog.plugins.find((plugin) => plugin.slug === "backup");
    assert.deepEqual(backup.releases.map((release) => release.version), ["0.1.0", "0.2.0"], "history is retained in ascending order");
    // A bundle that omits mcp never removes it.
    const third = buildBundle(dir, [backupArtifact({ descriptor: makeEmbeddedDescriptor({ version: "0.3.0" }) })]);
    const normalized3 = path.join(dir, "normalized3.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", third.sidecarPath, "--bundle-dir", third.bundleDir, "--out", normalized3]);
    await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalized3, "--releases", writeReleaseMeta(dir, [{ module: "backup", version: "0.3.0", sha256: third.artifacts[0].sha256, size: third.artifacts[0].size }])]);
    const after = validateCatalogBytes(readFileSync(sourceCatalog)).catalog;
    assert.deepEqual(after.plugins.map((plugin) => plugin.slug).sort(), ["backup", "mcp"], "absence never removes a cataloged plugin");
    assert.equal(after.plugins.find((plugin) => plugin.slug === "backup").releases.length, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ingest rejects lower versions, same-version byte changes, and leaves the source untouched on failure", async () => {
  const dir = tempDir();
  try {
    const sourceCatalog = path.join(dir, "catalog.json");
    const first = buildBundle(dir, [backupArtifact()]);
    const normalized1 = path.join(dir, "normalized1.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", first.sidecarPath, "--bundle-dir", first.bundleDir, "--out", normalized1]);
    writeFileSync(sourceCatalog, stringifyCanonical(emptyCatalog(1), "catalog"));
    await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalized1, "--releases", writeReleaseMeta(dir, [{ module: "backup", version: "0.1.0", sha256: first.artifacts[0].sha256, size: first.artifacts[0].size }])]);
    const settled = readFileSync(sourceCatalog);

    // Lower version fails.
    const lower = buildBundle(dir, [backupArtifact({ descriptor: makeEmbeddedDescriptor({ version: "0.0.9" }) })]);
    const normalizedLower = path.join(dir, "normalized-lower.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", lower.sidecarPath, "--bundle-dir", lower.bundleDir, "--out", normalizedLower]);
    let result = await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalizedLower, "--releases", writeReleaseMeta(dir, [{ module: "backup", version: "0.0.9", sha256: lower.artifacts[0].sha256, size: lower.artifacts[0].size }])], { expectFailure: true });
    assert.match(result.stderr, /not strictly higher/);
    assert.deepEqual(readFileSync(sourceCatalog), settled, "a refused merge must not touch the source");

    // Same version + different bytes fails.
    const sameVersion = buildBundle(dir, [backupArtifact({ descriptor: makeEmbeddedDescriptor({ description: "tampered description" }) })]);
    const normalizedSame = path.join(dir, "normalized-same.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", sameVersion.sidecarPath, "--bundle-dir", sameVersion.bundleDir, "--out", normalizedSame]);
    result = await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalizedSame, "--releases", writeReleaseMeta(dir, [{ module: "backup", version: "0.1.0", sha256: sameVersion.artifacts[0].sha256, size: sameVersion.artifacts[0].size }])], { expectFailure: true });
    assert.match(result.stderr, /conflicts with the authoritative bundle|already cataloged with different bytes\/metadata/);
    assert.deepEqual(readFileSync(sourceCatalog), settled);

    // Same version + same bytes from a DIFFERENT source SHA is a no-op that
    // preserves the original sourceRevision.
    const reserialized = buildBundle(dir, [backupArtifact()], { revision: "dddddddddddddddddddddddddddddddddddddddd" });
    const normalizedReser = path.join(dir, "normalized-reser.json");
    await runIngest(["validate-bundle", "--expected-revision", reserialized.sidecar.source.revision, "--sidecar", reserialized.sidecarPath, "--bundle-dir", reserialized.bundleDir, "--out", normalizedReser]);
    const noop = await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalizedReser, "--releases", writeReleaseMeta(dir, [{ module: "backup", version: "0.1.0", sha256: reserialized.artifacts[0].sha256, size: reserialized.artifacts[0].size }])]);
    assert.match(noop.stdout, /no semantic change/);
    assert.deepEqual(readFileSync(sourceCatalog), settled, "bytes must remain identical");
    assert.equal(validateCatalogBytes(settled).catalog.plugins[0].releases[0].sourceRevision, SOURCE_SHA);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ingest applies a same-version metadata semantic update without touching artifact/timestamps", async () => {
  const dir = tempDir();
  try {
    const sourceCatalog = path.join(dir, "catalog.json");
    const first = buildBundle(dir, [backupArtifact()]);
    const normalized1 = path.join(dir, "normalized1.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", first.sidecarPath, "--bundle-dir", first.bundleDir, "--out", normalized1]);
    writeFileSync(sourceCatalog, stringifyCanonical(emptyCatalog(1), "catalog"));
    await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalized1, "--releases", writeReleaseMeta(dir, [{ module: "backup", version: "0.1.0", sha256: first.artifacts[0].sha256, size: first.artifacts[0].size }])]);
    const settled = JSON.parse(readFileSync(sourceCatalog, "utf8"));

    // Same bytes, channel preview -> stable (reviewed policy change).
    const updated = buildBundle(dir, [{ ...backupArtifact(), policy: makePolicy({ channel: "stable" }) }]);
    const normalizedUpdated = path.join(dir, "normalized-updated.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", updated.sidecarPath, "--bundle-dir", updated.bundleDir, "--out", normalizedUpdated]);
    const result = await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalizedUpdated, "--releases", writeReleaseMeta(dir, [{ module: "backup", version: "0.1.0", sha256: updated.artifacts[0].sha256, size: updated.artifacts[0].size }])]);
    assert.match(result.stdout, /catalogVersion 2 -> 3/);
    const catalog = validateCatalogBytes(readFileSync(sourceCatalog)).catalog;
    const release = catalog.plugins[0].releases[0];
    assert.equal(release.channel, "stable");
    assert.equal(release.publishedAt, settled.plugins[0].releases[0].publishedAt, "publishedAt is preserved");
    assert.equal(release.sourceRevision, SOURCE_SHA);
    assert.equal(release.artifact.url, settled.plugins[0].releases[0].artifact.url, "artifact URL is preserved");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ingest rejects forged or inconsistent release metadata", async () => {
  const dir = tempDir();
  try {
    const sourceCatalog = path.join(dir, "catalog.json");
    writeFileSync(sourceCatalog, stringifyCanonical(emptyCatalog(1), "catalog"));
    const bundle = buildBundle(dir, [backupArtifact()]);
    const normalized = path.join(dir, "normalized.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
    const baseArgs = ["ingest", "--catalog", sourceCatalog, "--bundle", normalized];
    const before = readFileSync(sourceCatalog);

    const meta = (overrides = {}) => [
      { module: "backup", version: "0.1.0", sha256: bundle.artifacts[0].sha256, size: bundle.artifacts[0].size, overrides },
    ];
    const expectFail = async (label, releases) => {
      const file = path.join(dir, `releases-${label}.json`);
      writeFileSync(file, JSON.stringify({ format: "turboism.market-release.meta", schemaVersion: 1, releases }));
      const result = await runIngest([...baseArgs, "--releases", file], { expectFailure: true });
      assert.equal(result.ok, false, label);
      assert.deepEqual(readFileSync(sourceCatalog), before, `${label}: source must stay untouched`);
    };
      await expectFail("wrong-sha", meta({ sha256: "f".repeat(64) }));
      await expectFail("wrong-size", meta({ size: 1 }));
      await expectFail("http-artifact", meta({ artifactUrl: "http://github.com/turboism/turboism-plugin-directory/releases/download/plugin-backup-v0.1.0/backup-0.1.0.jar" }));
      await expectFail("wrong-host", meta({ artifactUrl: "https://evil.example/x.jar" }));
      await expectFail("wrong-tag", meta({ tag: "plugin-backup-v9.9.9" }));
      await expectFail("bad-date", meta({ publishedAt: "2026-13-99T00:00:00Z" }));
      await expectFail("extra-field", meta({ forged: true }));
      await expectFail("unknown-key", [{ module: "backup", version: "0.1.0", sha256: bundle.artifacts[0].sha256, size: bundle.artifacts[0].size, overrides: {} }, { module: "ghost", version: "0.1.0", sha256: bundle.artifacts[0].sha256, size: bundle.artifacts[0].size }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// hydrate
// ---------------------------------------------------------------------------

function catalogWithReleases(dir, artifacts, { catalogVersion = 1 } = {}) {
  const sourceCatalog = path.join(dir, "catalog.json");
  const plugins = artifacts.map((entry) => {
    const tag = `plugin-${entry.module}-v${entry.descriptor.version}`;
    const assetName = `${entry.module}-${entry.descriptor.version}.jar`;
    // Release built in canonical v2 key order (sourceRevision sits between
    // releaseUrl and artifact exactly as the frozen validator requires).
    const release = {
      version: entry.descriptor.version,
      channel: entry.policy.channel,
      status: "active",
      publishedAt: PUBLISHED_AT,
      category: entry.descriptor.category,
      tags: [...entry.descriptor.tags],
      turboismApi: entry.descriptor.turboismApi,
      requiresCubism: entry.descriptor.environment.requiresCubism,
      cubismVersions: [...entry.policy.cubismVersions],
      platforms: ["windows-x64"],
      dependencies: [],
      permissions: [],
      releaseUrl: `https://github.com/${PUBLIC_REPO}/releases/tag/${tag}`,
      sourceRevision: SOURCE_SHA,
      artifact: {
        mediaType: "application/java-archive",
        fileName: assetName,
        url: `https://github.com/${PUBLIC_REPO}/releases/download/${tag}/${assetName}`,
        sha256: entry.sha256,
        descriptorSha256: entry.descriptorSha256,
        size: entry.size,
      },
    };
    return makePlugin({
      id: entry.descriptor.id,
      slug: entry.module,
      name: entry.descriptor.name,
      summary: entry.descriptor.description,
      author: entry.descriptor.author,
      license: entry.descriptor.license,
      releases: [release],
    });
  });
  writeFileSync(sourceCatalog, stringifyCanonical(makeCatalog({ catalogVersion, plugins }), "catalog"));
  return sourceCatalog;
}

test("hydrate downloads every release asset, verifies bytes, and writes the publish manifest", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const bundle = buildBundle(dir, [backupArtifact(), mcpArtifact()]);
    for (const entry of bundle.artifacts) {
      const tag = `plugin-${entry.module}-v${entry.descriptor.version}`;
      stub.assetBytes.set(`${tag}/${entry.asset}`, entry.jarBytes);
    }
    const sourceCatalog = catalogWithReleases(dir, bundle.artifacts);
    const jarsDir = path.join(dir, "jars");
    const manifestOut = path.join(dir, "jars.json");
    const result = await runIngest(["hydrate", "--catalog", sourceCatalog, "--dir", jarsDir, "--manifest-out", manifestOut, "--asset-base", base]);
    assert.ok(result.ok, result.stderr);
    const manifest = JSON.parse(readFileSync(manifestOut, "utf8"));
    assert.deepEqual(Object.keys(manifest).sort(), ["dev.turboism.plugin.backup@0.1.0", "dev.turboism.plugin.mcp@0.1.0"]);
    for (const [key, jarPath] of Object.entries(manifest)) {
      const entry = bundle.artifacts.find((item) => item.descriptor.id === key.split("@")[0]);
      assert.deepEqual(readFileSync(jarPath), entry.jarBytes, `${key} must be byte-identical`);
    }
    assert.equal(stub.log.filter((entry) => entry.method === "GET" && entry.path.includes("/releases/download/")).length, 2);
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hydrate reuses bundle bytes only on an exact match and fails on hash/size/redirect/status failures", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const bundle = buildBundle(dir, [backupArtifact()]);
    const entry = bundle.artifacts[0];
    const tag = `plugin-backup-v${entry.descriptor.version}`;
    const sourceCatalog = catalogWithReleases(dir, [entry]);
    const normalized = path.join(dir, "normalized.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
    const jarsDir = path.join(dir, "jars");
    const manifestOut = path.join(dir, "jars.json");

    // Exact bundle match: no network download at all.
    let result = await runIngest(["hydrate", "--catalog", sourceCatalog, "--bundle", normalized, "--dir", jarsDir, "--manifest-out", manifestOut, "--asset-base", base]);
    assert.ok(result.ok, result.stderr);
    assert.match(result.stdout, /from bundle bytes/);
    assert.equal(stub.log.filter((entry) => entry.method === "GET" && entry.path.includes("/releases/download/")).length, 0);

    // Corrupted local bundle bytes no longer match: the download path is used.
    writeFileSync(path.join(bundle.bundleDir, entry.asset), Buffer.from("corrupted"));
    stub.assetBytes.set(`${tag}/${entry.asset}`, entry.jarBytes);
    result = await runIngest(["hydrate", "--catalog", sourceCatalog, "--bundle", normalized, "--dir", jarsDir, "--manifest-out", manifestOut, "--asset-base", base]);
    assert.ok(result.ok, result.stderr);
    assert.match(result.stdout, /from https:\/\/github\.com/);
    assert.deepEqual(readFileSync(path.join(jarsDir, `backup-${entry.descriptor.version}.jar`)), entry.jarBytes);

    // Wrong bytes served: size/hash verification fails.
    stub.assetBytes.set(`${tag}/${entry.asset}`, Buffer.from("tampered-bytes"));
    result = await runIngest(["hydrate", "--catalog", sourceCatalog, "--dir", jarsDir, "--manifest-out", manifestOut, "--asset-base", base], { expectFailure: true });
    assert.match(result.stderr, /failed size\/SHA-256 verification/);

    // 404 download fails.
    stub.assetBytes.delete(`${tag}/${entry.asset}`);
    result = await runIngest(["hydrate", "--catalog", sourceCatalog, "--dir", jarsDir, "--manifest-out", manifestOut, "--asset-base", base], { expectFailure: true });
    assert.match(result.stderr, /download failed: 404/);

    // Redirect to an unapproved host fails before any second request.
    stub.redirectDownload = { from: `${tag}/${entry.asset}`, to: "http://127.0.0.1:1/dead.jar" };
    result = await runIngest(["hydrate", "--catalog", sourceCatalog, "--dir", jarsDir, "--manifest-out", manifestOut, "--asset-base", base], { expectFailure: true });
    assert.match(result.stderr, /redirect target host .* is not approved/);
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hydrate rejects a symlinked bundle JAR on the reuse path and hydrates manual non-empty catalogs", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const bundle = buildBundle(dir, [backupArtifact()]);
    const entry = bundle.artifacts[0];
    const normalized = path.join(dir, "normalized.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
    // Replace the JAR with a symlink AFTER validation (the reuse path must still reject it).
    rmSync(path.join(bundle.bundleDir, entry.asset));
    symlinkSync(path.join(dir, "elsewhere"), path.join(bundle.bundleDir, entry.asset));
    writeFileSync(path.join(dir, "elsewhere"), "junk");
    const sourceCatalog = catalogWithReleases(dir, [entry]);
    const result = await runIngest(["hydrate", "--catalog", sourceCatalog, "--bundle", normalized, "--dir", path.join(dir, "jars"), "--manifest-out", path.join(dir, "jars.json"), "--asset-base", base], { expectFailure: true });
    assert.match(result.stderr, /must not be a symbolic link/);

    // Manual mode (no bundle) hydrates a non-empty catalog from the assets.
    const tag = `plugin-backup-v${entry.descriptor.version}`;
    stub.assetBytes.set(`${tag}/${entry.asset}`, entry.jarBytes);
    const manual = await runIngest(["hydrate", "--catalog", sourceCatalog, "--dir", path.join(dir, "jars2"), "--manifest-out", path.join(dir, "jars2.json"), "--asset-base", base]);
    assert.ok(manual.ok, manual.stderr);
    assert.deepEqual(readFileSync(path.join(dir, "jars2", `backup-${entry.descriptor.version}.jar`)), entry.jarBytes);
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// verify-production
// ---------------------------------------------------------------------------

function productionPair(catalog) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const catalogBytes = Buffer.from(stringifyCanonical(catalog, "catalog"), "utf8");
  const signed = signCatalogBytes(catalogBytes, privatePem, "turboism-official-v1");
  assert.ok(signed.ok);
  return {
    catalogBytes,
    signatureBytes: Buffer.from(stringifyCanonical(signed.envelope, "signatureEnvelope"), "utf8"),
    allowlist: { "turboism-official-v1": { pem: publicPem, purpose: "production" } },
  };
}

test("verify-production proves identity encoding and reports honest zero JAR evidence for an empty catalog", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const pair = productionPair(emptyCatalog(1));
    stub.rawResponses.set("/api/v2/catalog.json", {
      headers: { "Content-Type": "application/vnd.turboism.plugin-catalog+json;version=2" },
      body: pair.catalogBytes,
    });
    stub.rawResponses.set("/api/v2/catalog.json.sig", {
      headers: { "Content-Type": "application/vnd.turboism.plugin-catalog-signature+json;version=2" },
      body: pair.signatureBytes,
    });
    const keysFile = path.join(dir, "trusted-keys.json");
    writeFileSync(keysFile, JSON.stringify(pair.allowlist));
    const result = await runIngest(["verify-production", "--base-url", base, "--keys", keysFile]);
    assert.ok(result.ok, result.stderr);
    assert.match(result.stdout, /identity catalog bytes \d+/);
    assert.match(result.stdout, /anonymous JARs measured 0/);
    for (const call of stub.log.filter((entry) => entry.path.startsWith("/api/v2/"))) {
      assert.equal(call.auth, null, "production verification must be anonymous");
    }
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify-production rejects encoded catalog bytes, redirect escape, and hop overflow", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const pair = productionPair(emptyCatalog(1));
    const keysFile = path.join(dir, "trusted-keys.json");
    writeFileSync(keysFile, JSON.stringify(pair.allowlist));
    stub.rawResponses.set("/api/v2/catalog.json", {
      headers: {
        "Content-Type": "application/vnd.turboism.plugin-catalog+json;version=2",
        "Content-Encoding": "gzip",
      },
      body: pair.catalogBytes,
    });
    stub.rawResponses.set("/api/v2/catalog.json.sig", {
      headers: { "Content-Type": "application/vnd.turboism.plugin-catalog-signature+json;version=2" },
      body: pair.signatureBytes,
    });
    let result = await runIngest(["verify-production", "--base-url", base, "--keys", keysFile], { expectFailure: true });
    assert.match(result.stderr, /returned Content-Encoding/);

    stub.rawResponses.delete("/api/v2/catalog.json");
    stub.redirects.set("/api/v2/catalog.json", { location: "http://127.0.0.1:1/catalog.json" });
    result = await runIngest(["verify-production", "--base-url", base, "--keys", keysFile], { expectFailure: true });
    assert.match(result.stderr, /redirect target host .* is not approved/);

    stub.redirects.clear();
    for (let index = 0; index <= 5; index += 1) {
      stub.redirects.set(index === 0 ? "/api/v2/catalog.json" : `/catalog-hop-${index}`, {
        location: `/catalog-hop-${index + 1}`,
      });
    }
    result = await runIngest(["verify-production", "--base-url", base, "--keys", keysFile], { expectFailure: true });
    assert.match(result.stderr, /exceeded the 5-redirect cap/);
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// End-to-end: first publish, update, retry/no-op, rollback-on-failure
// ---------------------------------------------------------------------------

function publishFiles(dir, keys) {
  const keyFile = path.join(dir, "signing.pem");
  writeFileSync(keyFile, keys.privateKey);
  const allowlistFile = path.join(dir, "trusted-keys.json");
  writeFileSync(allowlistFile, JSON.stringify(makeAllowlist("turboism-official-v1", keys.publicKey, "production")));
  return { keyFile, allowlistFile };
}

test("e2e: first publish, update, retry/no-op, and rollback-on-failure through the real publisher", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const keys = makeKeyPair();
    const { keyFile, allowlistFile } = publishFiles(dir, keys);
    const sourceCatalog = path.join(dir, "catalog.json");
    writeFileSync(sourceCatalog, stringifyCanonical(emptyCatalog(1), "catalog"));
    const outDir = path.join(dir, "out");
    const stage = async (bundle, metaEntries, label) => {
      const normalized = path.join(dir, `normalized-${label}.json`);
      await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
      const releasesFile = path.join(dir, `releases-${label}.json`);
      await runIngest(["sync-releases", "--bundle", normalized, "--out", releasesFile, "--catalog", sourceCatalog, "--api-url", base, "--asset-base", base], { env: { GITHUB_TOKEN: "provider-token" } });
      await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalized, "--releases", releasesFile]);
      const jarsDir = path.join(dir, `jars-${label}`);
      const manifestOut = path.join(dir, `jars-${label}.json`);
      await runIngest(["hydrate", "--catalog", sourceCatalog, "--bundle", normalized, "--dir", jarsDir, "--manifest-out", manifestOut, "--asset-base", base]);
      return manifestOut;
    };

    // First publish: backup + mcp at 0.1.0 (one signed generation).
    const first = buildBundle(dir, [backupArtifact(), mcpArtifact()]);
    let manifestOut = await stage(first, null, "first");
    let out = runPublish(["--catalog", sourceCatalog, "--jars", manifestOut, "--key", keyFile, "--key-id", "turboism-official-v1", "--keys", allowlistFile, "--out", outDir]);
    assert.match(out, /generation 00000001/);
    let served = readFileSync(path.join(outDir, "current"), "utf8");
    assert.equal(served, "00000001");
    let verified = verifyCatalogBytes(
      readFileSync(path.join(outDir, "generations", served, "catalog.json")),
      readFileSync(path.join(outDir, "generations", served, "catalog.json.sig")),
      loadTrustedKeys(allowlistFile).keys,
      { requireProduction: true },
    );
    assert.ok(verified.ok, JSON.stringify(verified.errors));
    assert.equal(verified.catalog.catalogVersion, 2);
    assert.equal(verified.catalog.plugins.length, 2);

    // Update: backup 0.2.0 (+ resume backup 0.1.0, mcp 0.1.0) -> one new generation.
    const second = buildBundle(dir, [backupArtifact({ descriptor: makeEmbeddedDescriptor({ version: "0.2.0" }) }), mcpArtifact()]);
    manifestOut = await stage(second, null, "second");
    out = runPublish(["--catalog", sourceCatalog, "--jars", manifestOut, "--key", keyFile, "--key-id", "turboism-official-v1", "--keys", allowlistFile, "--out", outDir]);
    assert.match(out, /generation 00000002/);
    assert.equal(readFileSync(path.join(outDir, "current"), "utf8"), "00000002");
    verified = verifyCatalogBytes(
      readFileSync(path.join(outDir, "generations", "00000002", "catalog.json")),
      readFileSync(path.join(outDir, "generations", "00000002", "catalog.json.sig")),
      loadTrustedKeys(allowlistFile).keys,
      { requireProduction: true },
    );
    assert.ok(verified.ok);
    const backup = verified.catalog.plugins.find((plugin) => plugin.slug === "backup");
    assert.deepEqual(backup.releases.map((release) => release.version), ["0.1.0", "0.2.0"]);

    // Retry the exact same bundle: ingest no-op, publisher idempotent, bytes unchanged.
    const beforeRetry = snapshotDir(outDir);
    manifestOut = await stage(second, null, "retry");
    out = runPublish(["--catalog", sourceCatalog, "--jars", manifestOut, "--key", keyFile, "--key-id", "turboism-official-v1", "--keys", allowlistFile, "--out", outDir]);
    assert.match(out, /idempotent/);
    assert.deepEqual(snapshotDir(outDir), beforeRetry, "an idempotent run must not write a single byte");

    // Rollback-on-failure: a new semantic change with a broken signing key
    // must fail publish and leave the served generation untouched.
    const third = buildBundle(dir, [backupArtifact({ descriptor: makeEmbeddedDescriptor({ version: "0.3.0" }) })]);
    manifestOut = await stage(third, null, "third");
    const badKey = path.join(dir, "bad.pem");
    writeFileSync(badKey, "not a private key");
    const beforeFail = snapshotDir(outDir);
    assert.throws(
      () => runPublish(["--catalog", sourceCatalog, "--jars", manifestOut, "--key", badKey, "--key-id", "turboism-official-v1", "--keys", allowlistFile, "--out", outDir]),
      /could not sign/,
    );
    assert.deepEqual(snapshotDir(outDir), beforeFail, "a failed publish must leave the served pair untouched");
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R2: sidecar revision binding + artifact-name convention
// ---------------------------------------------------------------------------

test("R2: verify-run rejects a run without authoritative run_attempt and a non-conventional artifact name", async () => {
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    stub.runs.set("123", makeRun());
    delete stub.runs.get("123").run_attempt;
    let result = await runIngest(verifyArgs(base), { env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "t" }, expectFailure: true });
    assert.match(result.stderr, /missing an authoritative run_attempt/);

    stub.runs.set("123", makeRun({ run_attempt: 2 }));
    const outDir = path.join("/tmp", `verify-${Date.now()}`);
    result = await runIngest(verifyArgs(base, { artifactName: CONVENTIONAL_ARTIFACT, out: outDir }), { env: { TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: "t" }, expectFailure: true });
    assert.match(result.stderr, /does not match the accepted source convention/, "run_attempt 2 must change the expected name");
  } finally {
    await stub.stop();
  }
});

test("R2: validate-bundle rejects a sidecar revision that is not the verified source SHA", async () => {
  const dir = tempDir();
  try {
    const bundle = buildBundle(dir, [backupArtifact()], { revision: "dddddddddddddddddddddddddddddddddddddddd" });
    const result = await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", path.join(dir, "out.json")], { expectFailure: true });
    assert.match(result.stderr, /does not equal the verified source SHA/);
    assert.equal(existsSync(path.join(dir, "out.json")), false, "no normalized manifest may be written on rejection");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R3: read-only preflight rejects catalog-known conflicts before any mutation
// ---------------------------------------------------------------------------

function preflightArgs(catalogFile, normalized) {
  return ["preflight", "--catalog", catalogFile, "--bundle", normalized];
}

async function settleCatalog(dir, sourceCatalog) {
  const first = buildBundle(dir, [backupArtifact()]);
  const normalized1 = path.join(dir, "normalized-settle.json");
  await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", first.sidecarPath, "--bundle-dir", first.bundleDir, "--out", normalized1]);
  await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalized1, "--releases", writeReleaseMeta(dir, [{ module: "backup", version: "0.1.0", sha256: first.artifacts[0].sha256, size: first.artifacts[0].size }])]);
  return { first, normalized1 };
}

test("R3: preflight accepts a clean bundle and writes nothing", async () => {
  const dir = tempDir();
  try {
    const sourceCatalog = path.join(dir, "catalog.json");
    writeFileSync(sourceCatalog, stringifyCanonical(emptyCatalog(1), "catalog"));
    const bundle = buildBundle(dir, [backupArtifact()]);
    const normalized = path.join(dir, "normalized.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
    const before = snapshotDir(dir);
    const result = await runIngest(preflightArgs(sourceCatalog, normalized));
    assert.ok(result.ok, result.stderr);
    assert.match(result.stdout, /1 artifact\(s\) acceptable/);
    assert.deepEqual(snapshotDir(dir), before, "preflight must be read-only");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R3: preflight rejects lower versions, identity conflicts, and same-version byte drift before any Release mutation", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  await stub.start();
  try {
    const sourceCatalog = path.join(dir, "catalog.json");
    writeFileSync(sourceCatalog, stringifyCanonical(emptyCatalog(1), "catalog"));
    await settleCatalog(dir, sourceCatalog);
    const settled = readFileSync(sourceCatalog);

    // Lower version -> preflight fails.
    const lower = buildBundle(dir, [backupArtifact({ descriptor: makeEmbeddedDescriptor({ version: "0.0.9" }) })]);
    const normalizedLower = path.join(dir, "normalized-lower.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", lower.sidecarPath, "--bundle-dir", lower.bundleDir, "--out", normalizedLower]);
    let result = await runIngest(preflightArgs(sourceCatalog, normalizedLower), { expectFailure: true });
    assert.match(result.stderr, /not strictly higher/);

    // Identity conflict (bundle id/slug pair mismatches the cataloged plugin) -> preflight fails.
    const identity = buildBundle(dir, [{ module: "backup", descriptor: makeEmbeddedDescriptor({ id: "dev.turboism.plugin.mcp" }), policy: makePolicy(), localizations: makeLocalizations("x", "y") }]);
    const normalizedIdentity = path.join(dir, "normalized-identity.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", identity.sidecarPath, "--bundle-dir", identity.bundleDir, "--out", normalizedIdentity]);
    result = await runIngest(preflightArgs(sourceCatalog, normalizedIdentity), { expectFailure: true });
    assert.match(result.stderr, /identity conflict/);

    // Same version + different bytes -> preflight fails.
    const sameVersion = buildBundle(dir, [backupArtifact({ descriptor: makeEmbeddedDescriptor({ description: "tampered" }) })]);
    const normalizedSame = path.join(dir, "normalized-same.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", sameVersion.sidecarPath, "--bundle-dir", sameVersion.bundleDir, "--out", normalizedSame]);
    result = await runIngest(preflightArgs(sourceCatalog, normalizedSame), { expectFailure: true });
    assert.match(result.stderr, /same-version changes are never applied/);

    // The preflight failures must be provably read-only: not a single API
    // request was made, and the source catalog is byte-identical.
    assert.equal(stub.log.length, 0, "preflight must never touch the GitHub API");
    assert.deepEqual(readFileSync(sourceCatalog), settled, "preflight must never touch the source catalog");
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R4/R7: sync-releases catalog context + strict conflict checks
// ---------------------------------------------------------------------------

test("R4: sync-releases never recreates or re-uploads an already-cataloged release (zero POSTs)", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const sourceCatalog = path.join(dir, "catalog.json");
    writeFileSync(sourceCatalog, stringifyCanonical(emptyCatalog(1), "catalog"));
    await settleCatalog(dir, sourceCatalog);
    const bundle = buildBundle(dir, [backupArtifact()]);
    const normalized = path.join(dir, "normalized.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
    const jarBytes = readFileSync(path.join(bundle.bundleDir, "backup-0.1.0.jar"));
    const tag = "plugin-backup-v0.1.0";
    const outFile = path.join(dir, "releases.json");
    const runSync = () => runIngest(syncArgs(base, normalized, outFile, sourceCatalog), { env: { GITHUB_TOKEN: "provider-token" }, expectFailure: true });
    const postCount = () => stub.log.filter((entry) => entry.method === "POST").length;

    // Cataloged version, tag missing on GitHub: fail, zero POSTs.
    let result = await runSync();
    assert.match(result.stderr, /for the cataloged backup@0\.1\.0 is missing on GitHub/);
    assert.equal(postCount(), 0, "a cataloged missing release must never be recreated");

    // Cataloged version, tag exists but the canonical asset is missing: fail, zero POSTs.
    stub.releases.set(tag, stub.releaseObject(tag, { assets: [] }));
    result = await runSync();
    assert.match(result.stderr, /its asset is missing on GitHub/);
    assert.equal(postCount(), 0, "a cataloged missing asset must never be re-uploaded");

    // Cataloged version, asset bytes corrupt: fail, zero POSTs.
    stub.assetBytes.set(`${tag}/backup-0.1.0.jar`, Buffer.from("x".repeat(jarBytes.byteLength)));
    stub.releases.set(tag, stub.releaseObject(tag, { assets: [stub.assetObject(tag, "backup-0.1.0.jar")] }));
    result = await runSync();
    assert.match(result.stderr, /bytes differ from the source bundle/);
    assert.equal(postCount(), 0, "corrupt cataloged bytes must never be overwritten");
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R4: sync-releases fails closed when cataloged authoritative metadata conflicts with GitHub", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    // Author a catalog whose releaseUrl/artifact URL differ from the
    // canonical GitHub release for the same tag/version.
    const sourceCatalog = path.join(dir, "catalog.json");
    const tag = "plugin-backup-v0.1.0";
    const assetName = "backup-0.1.0.jar";
    writeFileSync(
      sourceCatalog,
      stringifyCanonical(
        makeCatalog({
          catalogVersion: 1,
          plugins: [
            makePlugin({
              slug: "backup",
              releases: [
                makeRelease({
                  releaseUrl: `https://github.com/${PUBLIC_REPO}/releases/tag/other-tag`,
                  artifact: {
                    mediaType: "application/java-archive",
                    fileName: assetName,
                    url: `https://github.com/${PUBLIC_REPO}/releases/download/other-tag/${assetName}`,
                    sha256: "f".repeat(64),
                    descriptorSha256: "e".repeat(64),
                    size: 1,
                  },
                }),
              ],
            }),
          ],
        }),
        "catalog",
      ),
    );
    const bundle = buildBundle(dir, [backupArtifact()]);
    const normalized = path.join(dir, "normalized.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
    const jarBytes = readFileSync(path.join(bundle.bundleDir, assetName));
    const outFile = path.join(dir, "releases.json");
    const runSync = () => runIngest(syncArgs(base, normalized, outFile, sourceCatalog), { env: { GITHUB_TOKEN: "provider-token" }, expectFailure: true });

    // Cataloged release exists on GitHub with canonical metadata but the
    // CATALOG's releaseUrl points elsewhere: conflict, zero mutations.
    stub.assetBytes.set(`${tag}/${assetName}`, jarBytes);
    stub.releases.set(tag, stub.releaseObject(tag, { assets: [stub.assetObject(tag, assetName)] }));
    let result = await runSync();
    assert.match(result.stderr, /html_url conflicts with the cataloged/);

    // Catalog releaseUrl canonical, but its artifact URL differs from the
    // canonical asset URL: conflict, zero mutations.
    const catalog = JSON.parse(readFileSync(sourceCatalog, "utf8"));
    catalog.plugins[0].releases[0].releaseUrl = `https://github.com/${PUBLIC_REPO}/releases/tag/${tag}`;
    writeFileSync(sourceCatalog, stringifyCanonical(catalog, "catalog"));
    result = await runSync();
    assert.match(result.stderr, /conflicts with the cataloged backup@0\.1\.0 artifact URL/);
    assert.equal(stub.log.filter((entry) => entry.method === "POST").length, 0, "metadata conflicts must never produce mutations");
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R7: sync-releases rejects prerelease, name-mismatch, and duplicate canonical assets on existing releases", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const { bundle, normalized, catalogFile } = await normalizeBundle(dir);
    const jarBytes = readFileSync(path.join(bundle.bundleDir, "backup-0.1.0.jar"));
    const tag = "plugin-backup-v0.1.0";
    const outFile = path.join(dir, "releases.json");
    const runSync = () => runIngest(syncArgs(base, normalized, outFile, catalogFile), { env: { GITHUB_TOKEN: "provider-token" }, expectFailure: true });

    // Prerelease flag conflicts.
    stub.assetBytes.set(`${tag}/backup-0.1.0.jar`, jarBytes);
    stub.releases.set(tag, stub.releaseObject(tag, { assets: [stub.assetObject(tag, "backup-0.1.0.jar")] }));
    stub.releases.get(tag).prerelease = true;
    let result = await runSync();
    assert.match(result.stderr, /prerelease: must be exactly false/);

    // Release name conflicts with the deterministic tag.
    stub.releases.get(tag).prerelease = false;
    stub.releases.get(tag).name = "renamed";
    result = await runSync();
    assert.match(result.stderr, /name metadata conflict/);

    // Duplicate canonical assets are ambiguous.
    stub.releases.get(tag).name = tag;
    const asset = stub.assetObject(tag, "backup-0.1.0.jar");
    stub.releases.get(tag).assets = [asset, { ...asset, id: asset.id + 1 }];
    result = await runSync();
    assert.match(result.stderr, /canonical assets named/);
    assert.equal(stub.log.filter((entry) => entry.method === "POST").length, 0, "conflicts must never produce mutations");
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("R4/R3: an absent tag stays resumable only for a version not yet cataloged (zero POSTs on conflict)", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    // Bundle has backup 0.1.0 + mcp 0.1.0; catalog already contains backup
    // 0.1.0 (via settle) so the preflight/sync for a bundle that REPLAYS the
    // same backup version must not recreate anything, while the not-yet-
    // cataloged mcp is created exactly once.
    const sourceCatalog = path.join(dir, "catalog.json");
    writeFileSync(sourceCatalog, stringifyCanonical(emptyCatalog(1), "catalog"));
    await settleCatalog(dir, sourceCatalog);
    const bundle2 = buildBundle(dir, [backupArtifact(), mcpArtifact()]);
    const normalized2 = path.join(dir, "normalized2.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle2.sidecarPath, "--bundle-dir", bundle2.bundleDir, "--out", normalized2]);
    const outFile = path.join(dir, "releases.json");
    const result = await runIngest(syncArgs(base, normalized2, outFile, sourceCatalog), { env: { GITHUB_TOKEN: "provider-token" }, expectFailure: true });
    assert.match(result.stderr, /backup@0\.1\.0 is missing on GitHub/);
    assert.equal(stub.log.filter((entry) => entry.method === "POST").length, 0, "no release may be created while a cataloged version is missing");
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R5: higher-version display/i18n refresh
// ---------------------------------------------------------------------------

test("R5: a strictly higher version refreshes plugin display/i18n/policy metadata while identity stays immutable", async () => {
  const dir = tempDir();
  try {
    const sourceCatalog = path.join(dir, "catalog.json");
    writeFileSync(sourceCatalog, stringifyCanonical(emptyCatalog(1), "catalog"));
    const first = buildBundle(dir, [backupArtifact()]);
    const normalized1 = path.join(dir, "normalized1.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", first.sidecarPath, "--bundle-dir", first.bundleDir, "--out", normalized1]);
    await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalized1, "--releases", writeReleaseMeta(dir, [{ module: "backup", version: "0.1.0", sha256: first.artifacts[0].sha256, size: first.artifacts[0].size }])]);

    // 0.2.0 changes name, description, author, license, zh-Hans/ja text, and
    // the reviewed repository/support policy.
    const updated = buildBundle(dir, [{
      ...backupArtifact(),
      descriptor: makeEmbeddedDescriptor({
        version: "0.2.0",
        name: "WebDAV Auto-Backup Sync Plugin Pro",
        description: "Uploads backups with retries.",
        author: "New Maintainer",
        license: "Apache-2.0",
      }),
      policy: makePolicy({ repository: "https://github.com/turboism/new-home", support: "https://github.com/turboism/new-home/issues" }),
      localizations: makeLocalizations("WebDAV Pro", "pro backup"),
    }]);
    const normalized2 = path.join(dir, "normalized2.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", updated.sidecarPath, "--bundle-dir", updated.bundleDir, "--out", normalized2]);
    const result = await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalized2, "--releases", writeReleaseMeta(dir, [{ module: "backup", version: "0.2.0", sha256: updated.artifacts[0].sha256, size: updated.artifacts[0].size }])]);
    assert.ok(result.ok, result.stderr);
    const catalog = validateCatalogBytes(readFileSync(sourceCatalog)).catalog;
    const backup = catalog.plugins.find((plugin) => plugin.slug === "backup");
    assert.equal(backup.id, "dev.turboism.plugin.backup", "identity must stay immutable");
    assert.equal(backup.name, "WebDAV Auto-Backup Sync Plugin Pro", "display name must refresh");
    assert.equal(backup.summary, "Uploads backups with retries.");
    assert.equal(backup.author, "New Maintainer");
    assert.equal(backup.license, "Apache-2.0");
    assert.equal(backup.repository, "https://github.com/turboism/new-home");
    assert.deepEqual(backup.localizations["zh-Hans"], { name: "同步WebDAV Pro", summary: "中文pro backup" });
    assert.deepEqual(backup.releases.map((release) => release.version), ["0.1.0", "0.2.0"]);
    // The 0.1.0 release keeps its own original metadata.
    assert.equal(backup.releases[0].artifact.sha256, first.artifacts[0].sha256);
    assert.equal(backup.releases[0].publishedAt, PUBLISHED_AT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R6: top-level publishedAt never decreases
// ---------------------------------------------------------------------------

test("R6: top-level publishedAt never moves backward", async () => {
  const dir = tempDir();
  try {
    // Current catalog carries a publishedAt LATER than the incoming release.
    const sourceCatalog = path.join(dir, "catalog.json");
    writeFileSync(sourceCatalog, stringifyCanonical({ ...emptyCatalog(1), publishedAt: "2026-08-16T12:00:00Z" }, "catalog"));
    const bundle = buildBundle(dir, [backupArtifact()]);
    const normalized = path.join(dir, "normalized.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
    const releasesFile = writeReleaseMeta(dir, [{ module: "backup", version: "0.1.0", sha256: bundle.artifacts[0].sha256, size: bundle.artifacts[0].size }]);
    // Make the accepted release OLDER than the current catalog value.
    const meta = JSON.parse(readFileSync(releasesFile, "utf8"));
    meta.releases["backup@0.1.0"].publishedAt = "2026-08-16T09:00:00Z";
    writeFileSync(releasesFile, JSON.stringify(meta));
    const result = await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalized, "--releases", releasesFile]);
    assert.ok(result.ok, result.stderr);
    const catalog = validateCatalogBytes(readFileSync(sourceCatalog)).catalog;
    assert.equal(catalog.publishedAt, "2026-08-16T12:00:00Z", "publishedAt must not regress below the current catalog value");
    assert.equal(catalog.catalogVersion, 2);

    // A policy-only update on an existing release also keeps the maximum.
    const settled = readFileSync(sourceCatalog);
    const policyOnly = buildBundle(dir, [{ ...backupArtifact(), policy: makePolicy({ channel: "stable" }) }]);
    const normalizedPolicy = path.join(dir, "normalized-policy.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", policyOnly.sidecarPath, "--bundle-dir", policyOnly.bundleDir, "--out", normalizedPolicy]);
    const meta2 = JSON.parse(readFileSync(releasesFile, "utf8"));
    meta2.releases["backup@0.1.0"].publishedAt = "2026-08-16T09:00:00Z";
    writeFileSync(releasesFile, JSON.stringify(meta2));
    const policyResult = await runIngest(["ingest", "--catalog", sourceCatalog, "--bundle", normalizedPolicy, "--releases", releasesFile]);
    assert.ok(policyResult.ok, policyResult.stderr);
    const after = validateCatalogBytes(readFileSync(sourceCatalog)).catalog;
    assert.equal(after.publishedAt, "2026-08-16T12:00:00Z");
    assert.equal(after.catalogVersion, 3);
    assert.notDeepEqual(readFileSync(sourceCatalog), settled);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T1: preflight capacity/body boundaries (before any public mutation)
// ---------------------------------------------------------------------------

/** Canonical valid release entry for a module/version (mirrors the ingest output). */
function releaseFor(module, version, publishedAt = PUBLISHED_AT) {
  const tag = `plugin-${module}-v${version}`;
  const assetName = `${module}-${version}.jar`;
  return {
    version,
    channel: "preview",
    status: "active",
    publishedAt,
    category: "development",
    tags: ["project"],
    turboismApi: "[0.1.0,0.2.0)",
    requiresCubism: false,
    cubismVersions: [],
    platforms: ["windows-x64"],
    dependencies: [],
    permissions: [],
    releaseUrl: `https://github.com/${PUBLIC_REPO}/releases/tag/${tag}`,
    artifact: {
      mediaType: "application/java-archive",
      fileName: assetName,
      url: `https://github.com/${PUBLIC_REPO}/releases/download/${tag}/${assetName}`,
      sha256: "f".repeat(64),
      descriptorSha256: "e".repeat(64),
      size: 1,
    },
  };
}

function pluginWithReleases(slug, id, releases, summary = slug, localizations = {}) {
  return makePlugin({
    slug,
    id,
    name: slug,
    summary,
    author: "A",
    license: "MIT",
    repository: "https://github.com/turboism/Turboism",
    support: "https://github.com/turboism/Turboism/issues",
    localizations,
    releases,
  });
}

test("T1: preflight rejects the 101st release of a plugin with zero API POSTs and a byte-identical catalog", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  await stub.start();
  try {
    const sourceCatalog = path.join(dir, "catalog.json");
    const releases = [];
    for (let i = 1; i <= 100; i += 1) releases.push(releaseFor("backup", `${i}.0.0`));
    writeFileSync(sourceCatalog, stringifyCanonical(makeCatalog({ catalogVersion: 1, plugins: [pluginWithReleases("backup", "dev.turboism.plugin.backup", releases)] }), "catalog"));
    const before = readFileSync(sourceCatalog);
    const bundle = buildBundle(dir, [backupArtifact({ descriptor: makeEmbeddedDescriptor({ version: "101.0.0" }) })]);
    const normalized = path.join(dir, "normalized.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
    const result = await runIngest(preflightArgs(sourceCatalog, normalized), { expectFailure: true });
    assert.match(result.stderr, /would contain 101 releases, exceeding the 100 limit/);
    assert.deepEqual(readFileSync(sourceCatalog), before, "source catalog must stay byte-identical");
    assert.equal(stub.log.filter((entry) => entry.method === "POST").length, 0, "zero release mutation on preflight failure");
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T1: the plugin-count gate rejects the 10001st plugin before any mutation (pure, no I/O)", () => {
  // The 10000-plugin boundary cannot be reached through a valid on-disk
  // source catalog: the frozen 5 MiB body cap binds first at ~6,700 plugins
  // (minimum plugin entry ~770 bytes), so the gate is exercised directly.
  // It is pure: nothing is read, written, or requested.
  const plugins = [];
  for (let i = 0; i < 10001; i += 1) plugins.push({ slug: `f${i}`, releases: [] });
  assert.throws(() => checkTentativeCapacity(plugins, null), /would contain 10001 plugins, exceeding the 10000 limit/);
  assert.throws(
    () => checkTentativeCapacity([{ slug: "f", releases: Array.from({ length: 101 }, () => ({})) }], null),
    /would contain 101 releases, exceeding the 100 limit/,
  );
  assert.throws(() => checkTentativeCapacity([{ slug: "f", releases: [] }], { byteLength: 5 * 1024 * 1024 + 1 }), /exceeding the 5242880-byte cap/);
  assert.doesNotThrow(() => checkTentativeCapacity([{ slug: "f", releases: [] }], { byteLength: 100 }));
});

test("T1: preflight rejects a tentative catalog over the 5 MiB canonical body cap with zero API POSTs", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  await stub.start();
  try {
    const CAP = 5 * 1024 * 1024;
    const summary = "s".repeat(500);
    const localizations = { "zh-Hans": { name: "n", summary: "z".repeat(500) }, ja: { name: "n", summary: "j".repeat(500) } };
    const fillPlugin = (i) => {
      const slug = `fill-${String(i).padStart(6, "0")}`; // fixed-width ids keep the entry size constant
      return pluginWithReleases(slug, `dev.turboism.plugin.${slug}`, [releaseFor(slug, "0.1.0")], summary, localizations);
    };
    // Measure the exact per-plugin DELTA, then fill the catalog to just
    // under the cap (fixed-width ids make the total deterministic). The
    // added bundle plugin is made MUCH larger than any modulo gap (a 500-char
    // description, 12 tags, 100 dependencies and 100 permissions with 500-
    // char reasons => a ~100 KiB entry), so the tentative catalog is
    // GUARANTEED to cross the cap.
    const probe1 = Buffer.byteLength(stringifyCanonical(makeCatalog({ catalogVersion: 1, plugins: [fillPlugin(0)] }), "catalog"));
    const probe2 = Buffer.byteLength(stringifyCanonical(makeCatalog({ catalogVersion: 1, plugins: [fillPlugin(0), fillPlugin(1)] }), "catalog"));
    const perPlugin = probe2 - probe1;
    const count = Math.floor((CAP - probe1 - 16) / perPlugin);
    const plugins = [];
    for (let i = 0; i < count; i += 1) plugins.push(fillPlugin(i));
    const sourceCatalog = path.join(dir, "catalog.json");
    writeFileSync(sourceCatalog, stringifyCanonical(makeCatalog({ catalogVersion: 1, plugins }), "catalog"));
    const before = readFileSync(sourceCatalog);
    assert.ok(before.byteLength < CAP, `source catalog must fit under the cap (${before.byteLength} bytes)`);

    const bigDescriptor = makeEmbeddedDescriptor({
      description: "d".repeat(500),
      tags: Array.from({ length: 12 }, (_, i) => `tag-${String(i).padStart(2, "0")}`),
      dependencies: Array.from({ length: 100 }, (_, i) => ({ id: `dev.turboism.plugin.dep${i}`, version: "[1.0.0,2.0.0)", type: "required", ordering: "none", reason: `r${i}-${"x".repeat(480)}` })),
      permissions: Array.from({ length: 100 }, (_, i) => ({ id: `dev.turboism.plugin.perm${i}`, scope: "application", reason: `p${i}-${"y".repeat(480)}` })),
    });
    const bundle = buildBundle(dir, [backupArtifact({ descriptor: bigDescriptor })]);
    const normalized = path.join(dir, "normalized.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
    const result = await runIngest(preflightArgs(sourceCatalog, normalized), { expectFailure: true });
    assert.match(result.stderr, new RegExp(`exceeding the ${CAP}-byte cap`));
    assert.deepEqual(readFileSync(sourceCatalog), before, "source catalog must stay byte-identical");
    assert.equal(stub.log.filter((entry) => entry.method === "POST").length, 0, "zero release mutation on preflight failure");
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T2: strict GitHub Release booleans on BOTH create and resume responses
// ---------------------------------------------------------------------------

test("T2: strict release-response booleans on resumed AND created releases", async () => {
  const dir = tempDir();
  const stub = new ApiStub();
  const base = await stub.start();
  try {
    const { bundle, normalized, catalogFile } = await normalizeBundle(dir);
    const jarBytes = readFileSync(path.join(bundle.bundleDir, "backup-0.1.0.jar"));
    const tag = "plugin-backup-v0.1.0";
    const outFile = path.join(dir, "releases.json");
    const runSync = () => runIngest(syncArgs(base, normalized, outFile, catalogFile), { env: { GITHUB_TOKEN: "provider-token" }, expectFailure: true });

    // Resumed release: null/string/missing booleans are all rejected.
    stub.assetBytes.set(`${tag}/backup-0.1.0.jar`, jarBytes);
    stub.releases.set(tag, stub.releaseObject(tag, { assets: [stub.assetObject(tag, "backup-0.1.0.jar")] }));
    stub.releases.get(tag).draft = null;
    let result = await runSync();
    assert.match(result.stderr, /draft: must be exactly false, got null/);
    stub.releases.get(tag).draft = "false";
    result = await runSync();
    assert.match(result.stderr, /draft: must be exactly false, got "false"/);
    delete stub.releases.get(tag).prerelease;
    result = await runSync();
    assert.match(result.stderr, /prerelease: must be exactly false, got undefined/);

    // The CREATED response runs the same strict gate: a malformed boolean on
    // the POST /releases response blocks the asset upload.
    stub.releases.clear();
    stub.assetBytes.clear();
    stub.onCreate = (release) => {
      release.prerelease = 0;
    };
    result = await runSync();
    assert.match(result.stderr, /prerelease: must be exactly false, got 0/);
    assert.equal(stub.log.filter((entry) => entry.method === "POST").length, 1, "the release POST happened but the asset upload must never follow");
  } finally {
    await stub.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// T3: cross-bound authoritative release-metadata fields
// ---------------------------------------------------------------------------

test("T3: forged release metadata is rejected before any catalog merge (source catalog unchanged)", async () => {
  const dir = tempDir();
  try {
    const sourceCatalog = path.join(dir, "catalog.json");
    writeFileSync(sourceCatalog, stringifyCanonical(emptyCatalog(1), "catalog"));
    const before = readFileSync(sourceCatalog);
    const bundle = buildBundle(dir, [backupArtifact()]);
    const normalized = path.join(dir, "normalized.json");
    await runIngest(["validate-bundle", "--expected-revision", SOURCE_SHA, "--sidecar", bundle.sidecarPath, "--bundle-dir", bundle.bundleDir, "--out", normalized]);
    const baseArgs = ["ingest", "--catalog", sourceCatalog, "--bundle", normalized];
    const meta = (overrides = {}) => ({ module: "backup", version: "0.1.0", sha256: bundle.artifacts[0].sha256, size: bundle.artifacts[0].size, ...overrides });
    const cases = [
      ["wrong-key", { module: "backup", version: "0.1.0" }, (doc) => { doc.releases["backup@9.9.9"] = doc.releases["backup@0.1.0"]; delete doc.releases["backup@0.1.0"]; }],
      ["bad-version-grammar", meta({ version: "0.1" }), null],
      ["forged-tag", meta({ tag: "plugin-backup-v9.9.9" }), null],
      ["forged-assetName", meta({ assetName: "backup-0.1.0-evil.jar" }), null],
      ["forged-releaseUrl", meta({ releaseUrl: "https://github.com/turboism/turboism-plugin-directory/releases/tag/plugin-backup-v9.9.9" }), null],
      ["forged-artifactUrl", meta({ artifactUrl: "https://github.com/turboism/turboism-plugin-directory/releases/download/plugin-backup-v9.9.9/backup-0.1.0.jar" }), null],
    ];
    for (const [label, entry, mutate] of cases) {
      const file = path.join(dir, `releases-${label}.json`);
      const doc = { format: "turboism.market-release.meta", schemaVersion: 1, releases: { "backup@0.1.0": { module: "backup", version: "0.1.0", tag: "plugin-backup-v0.1.0", releaseUrl: `https://github.com/${PUBLIC_REPO}/releases/tag/plugin-backup-v0.1.0`, publishedAt: PUBLISHED_AT, artifactUrl: `https://github.com/${PUBLIC_REPO}/releases/download/plugin-backup-v0.1.0/backup-0.1.0.jar`, assetName: "backup-0.1.0.jar", sha256: bundle.artifacts[0].sha256, size: bundle.artifacts[0].size, ...entry } } };
      if (mutate !== null) mutate(doc);
      writeFileSync(file, JSON.stringify(doc));
      const result = await runIngest([...baseArgs, "--releases", file], { expectFailure: true });
      assert.equal(result.ok, false, `${label} must be rejected`);
      assert.deepEqual(readFileSync(sourceCatalog), before, `${label} must leave the source catalog unchanged`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
