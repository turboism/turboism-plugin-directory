#!/usr/bin/env node
// Ingest the accepted Turboism first-party source bundle into the public
// Plugin Directory v2 pipeline (the Provider half of the selected-plugin
// automatic publication lane).
//
// Subcommands (Node 22 stdlib only; every network and filesystem boundary is
// injectable so the test suite uses local HTTP stubs and never touches
// GitHub):
//
//   verify-run
//       Poll a source Actions run with a strict bounded timeout, prove from
//       the GitHub API that it is exactly the turboism/Turboism
//       .github/workflows/publish-selected-plugins.yml push run on main at
//       the claimed SHA, bind the claimed artifact name to the accepted
//       source convention turboism-market-release-<head_sha>-<run_id>-<run_attempt>
//       from authoritative run metadata, find exactly one non-expired
//       artifact with that exact name, download it (bounded), and safely
//       extract it into --out (traversal/symlink/oversize entries are
//       rejected). This is the ONLY step that touches the private-source
//       read token; the token is read from the environment and never echoed
//       or persisted.
//
//   validate-bundle
//       Offline strict validation of the extracted bundle: exact sidecar
//       shape (turboism.market-release schema 1, unknown fields rejected),
//       canonical JAR filenames, SHA-256/size/descriptor-hash, regular
//       non-symlink JARs inside the bundle root, schema-v3 descriptor
//       binding against the real JAR bytes (reusing inspectJarFile and
//       bindReleaseToDescriptor from lib/catalog-v2/catalog.mjs), complete
//       en/zh-Hans/ja names+descriptions, and the reviewed policy fields.
//       The sidecar source revision must equal the verified --expected-revision.
//       Writes a normalized artifact manifest for the later subcommands.
//
//   preflight
//       Read-only catalog-known conflict check against the CURRENT signed
//       source catalog (identity, strictly-higher versions, same-version
//       byte drift) using the SAME shared merge primitives as ingest. Runs
//       BEFORE sync-releases so a lower/conflicting version can never mutate
//       a public Release. Writes nothing.
//
//   sync-releases
//       Create or resume immutable PUBLIC GitHub Releases in
//       turboism/turboism-plugin-directory using the Provider's own
//       GITHUB_TOKEN: absent tag -> create release + upload asset (only for
//       versions NOT yet in the --catalog source catalog); existing
//       byte-identical asset -> resume; existing differing bytes, draft,
//       prerelease, name/tag conflict, duplicate canonical assets, or
//       cataloged-but-missing/corrupt state -> fail closed. Never overwrites
//       an asset or tag (no --clobber). Writes the authoritative release
//       metadata (published_at/html_url/browser_download_url) after
//       validating it.
//
//   ingest
//       Deterministically merge the bundle into the source catalog:
//       trust official, slug = module, descriptor-bound display fields,
//       reviewed policy, platforms ["windows-x64"], status active, preserve
//       earlier releases, strictly-higher new versions (refreshing the
//       plugin-level current display/i18n/policy metadata from the new
//       descriptor/policy), same-version byte-identical no-op (original
//       sourceRevision preserved), fail closed on same-version different
//       bytes / lower versions / catalog conflicts. One semantic change
//       bumps catalogVersion by exactly one and sets publishedAt to the
//       maximum of the current catalog value and the accepted GitHub release
//       timestamps (never backward); no change leaves the source bytes
//       identical. The replacement is atomic.
//
//   hydrate
//       Build the temporary local JAR manifest for EVERY release in the
//       resulting catalog: reuse incoming bundle bytes only on an exact
//       SHA-256/size match, otherwise download the exact already-validated
//       GitHub Release asset URL (bounded stream, size+SHA verified before
//       binding). Manual mode (no bundle) hydrates non-empty catalogs from
//       the public assets so the existing publisher still works.
//
// The existing scripts/catalog-v2/publish.mjs then signs and stages the
// source catalog against this temporary manifest; nothing here writes under
// public/ and nothing here touches the signing key.

import { closeSync, copyFileSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  MAX_ARTIFACT_SIZE,
  MAX_CATALOG_BYTES,
  MAX_PLUGINS,
  MAX_RELEASES,
  OFFICIAL_CATEGORIES,
  bindReleaseToDescriptor,
  compareVersions,
  inspectJarFile,
  parseStrictJsonBytes,
  parseStrictVersion,
  parseVersionRange,
  sha256Hex,
  stringifyCanonical,
  validateCatalogBytes,
} from "../../lib/catalog-v2/catalog.mjs";

// ---------------------------------------------------------------------------
// Contract constants (kept in sync with the frozen lib/catalog-v2/catalog.mjs
// and the accepted turboism.market-release schema 1 sidecar).
// ---------------------------------------------------------------------------

const SIDECAR_NAME = "market-release.json";
const MARKET_FORMAT = "turboism.market-release";
const MARKET_SCHEMA = 1;

const MAX_BUNDLE_ARTIFACTS = 100; // aligned with the catalog MAX_PLUGINS/MAX_RELEASES order of magnitude
const MAX_BUNDLE_ZIP_BYTES = MAX_BUNDLE_ARTIFACTS * MAX_ARTIFACT_SIZE; // 1.6 GiB strict download/extract cap
const MAX_BUNDLE_ENTRIES = 4096; // entry-count cap for the extracted artifact zip
const MAX_ARTIFACT_NAME = 256;

// Value-shape regexes, mirroring lib/catalog-v2/catalog.mjs (module-private
// there). The merged catalog is additionally validated with
// validateCatalogBytes before it is written, so a drift here can only cause
// an earlier, clearer failure - never a weaker published contract.
const RE_SHA256 = /^[0-9a-f]{64}$/;
const RE_SOURCE_REVISION = /^[0-9a-f]{40}$/;
const RE_PLUGIN_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const RE_KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_HOST_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const RE_RUN_ID = /^\d{1,20}$/;
const RE_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const CHANNEL_VALUES = ["stable", "preview"];
const PERMISSION_SCOPE_VALUES = ["application", "user"];
const DEPENDENCY_TYPE_VALUES = ["required", "optional"];
const ORDERING_VALUES = ["none", "before", "after"];
const LOCALE_VALUES = ["en", "zh-Hans", "ja"];

const DEFAULT_API_URL = "https://api.github.com";
const DEFAULT_ASSET_BASE = "https://github.com";
const DEFAULT_SOURCE_REPO = "turboism/Turboism";
const DEFAULT_PUBLIC_REPO = "turboism/turboism-plugin-directory";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const fail = (message) => {
  const error = new Error(message);
  error.exited = true;
  throw error;
};

const usageError = (message) => {
  const error = new Error(message);
  error.usage = true;
  throw error;
};

function parseFlags(argv, { strings = [], booleans = [] } = {}) {
  const flags = {};
  const known = new Set([...strings, ...booleans]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) usageError(`unexpected positional argument "${arg}"`);
    const name = arg.slice(2);
    if (!known.has(name)) usageError(`unknown flag --${name}`);
    if (booleans.includes(name)) {
      flags[name] = true;
    } else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) usageError(`flag --${name} requires a value`);
      flags[name] = value;
      i += 1;
    }
  }
  return flags;
}

function requireFlag(flags, name) {
  if (typeof flags[name] !== "string" || flags[name].length === 0) usageError(`missing required flag --${name}`);
  return flags[name];
}

function requireFileRegular(file, what) {
  let stats;
  try {
    stats = lstatSync(file);
  } catch {
    fail(`${what} ${file} is not readable`);
  }
  if (stats.isSymbolicLink()) fail(`${what} ${file} must not be a symbolic link`);
  if (!stats.isFile()) fail(`${what} ${file} is not a regular file`);
  return stats;
}

function readBoundedFile(file, cap, what) {
  requireFileRegular(file, what);
  const stats = lstatSync(file);
  if (stats.size > cap) fail(`${what} ${file} exceeds ${cap} bytes`);
  return readFileSync(file);
}

function writeFileAtomic(file, bytes) {
  const dir = path.dirname(path.resolve(file));
  mkdirSync(dir, { recursive: true });
  const temporary = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`);
  try {
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path.resolve(file));
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      // best-effort cleanup of the temp name; it is never treated as the file
    }
    throw error;
  }
}

function strictJson(bytes, what) {
  // Strict UTF-8 decode + duplicate-key rejection + depth cap: the same
  // parser the frozen catalog validator uses, so a malformed sidecar or
  // response can never smuggle duplicate keys into the pipeline.
  const parsed = parseStrictJsonBytes(bytes);
  if (!parsed.ok) fail(`${what} must be valid strict UTF-8 JSON: ${parsed.message}`);
  return parsed.value;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkKeysOnly(obj, allowed, path, issues) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) issues.push({ path, message: `unknown field "${key}"` });
  }
}

function checkRequiredFields(obj, required, path, issues) {
  for (const key of required) {
    if (!(key in obj)) issues.push({ path, message: `missing required field "${key}"` });
  }
}

function checkString(obj, key, path, issues, { min = 1, max = Infinity, re = null, label = key } = {}) {
  const value = obj[key];
  if (typeof value !== "string") {
    issues.push({ path: `${path}.${key}`, message: `${label} must be a string` });
    return null;
  }
  if (value.length < min || value.length > max) {
    issues.push({ path: `${path}.${key}`, message: `${label} length must be between ${min} and ${max}` });
    return null;
  }
  if (re !== null && !re.test(value)) {
    issues.push({ path: `${path}.${key}`, message: `${label} does not match the required shape` });
    return null;
  }
  return value;
}

function checkBoolean(obj, key, path, issues) {
  const value = obj[key];
  if (typeof value !== "boolean") {
    issues.push({ path: `${path}.${key}`, message: "must be a boolean" });
    return null;
  }
  return value;
}

function checkInteger(obj, key, path, issues, { min = 0, max = Infinity } = {}) {
  const value = obj[key];
  if (!Number.isInteger(value) || value < min || value > max) {
    issues.push({ path: `${path}.${key}`, message: `must be an integer between ${min} and ${max}` });
    return null;
  }
  return value;
}

function checkHttpsUrl(obj, key, path, issues, { host = null, pathnameRe = null } = {}) {
  const value = obj[key];
  if (typeof value !== "string") {
    issues.push({ path: `${path}.${key}`, message: "must be an https URL" });
    return null;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    parsed = null;
  }
  if (parsed === null || parsed.protocol !== "https:" || parsed.hostname === "") {
    issues.push({ path: `${path}.${key}`, message: "must be an absolute https URL" });
    return null;
  }
  if (host !== null && parsed.hostname !== host) {
    issues.push({ path: `${path}.${key}`, message: `must be on host "${host}"` });
    return null;
  }
  if (pathnameRe !== null && !pathnameRe.test(parsed.pathname)) {
    issues.push({ path: `${path}.${key}`, message: "URL path does not match the required shape" });
    return null;
  }
  return parsed;
}

function checkDateTime(obj, key, path, issues) {
  const value = obj[key];
  if (typeof value !== "string") {
    issues.push({ path: `${path}.${key}`, message: "must be a UTC date-time string" });
    return null;
  }
  const match = RE_DATE_TIME.exec(value);
  if (!match || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 19) + "Z" !== value) {
    issues.push({ path: `${path}.${key}`, message: "must be a valid UTC date-time like 2026-08-16T09:00:00Z" });
    return null;
  }
  return value;
}

function checkKebabToken(obj, key, path, issues, { min = 2, max = 32 } = {}) {
  const value = checkString(obj, key, path, issues, { min, max, re: RE_KEBAB, label: "token" });
  return value;
}

/** Raise the collected validation issues; return the parsed JSON object. */
function raiseIf(issues, what) {
  if (issues.length === 0) return;
  const detail = issues.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
  fail(`${what}: ${detail}`);
}

// ---------------------------------------------------------------------------
// Bounded HTTP (injectable base URLs; tests stub every endpoint locally).
// ---------------------------------------------------------------------------

async function apiFetch(url, { token = null, method = "GET", json = null, body = null, contentType = null } = {}) {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  let payload = body;
  if (json !== null) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(json);
  } else if (contentType !== null) {
    headers["Content-Type"] = contentType;
  }
  let response;
  try {
    response = await fetch(url, { method, headers, body: payload });
  } catch (error) {
    fail(`request to ${url} failed: ${error.message}`);
  }
  return response;
}

async function apiJson(url, options) {
  const response = await apiFetch(url, options);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    fail(`GitHub API ${response.status} for ${url}: ${body.slice(0, 300)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const value = strictJson(bytes, `GitHub API response from ${url}`);
  if (!isPlainObject(value)) fail(`GitHub API response from ${url} must be an object`);
  return value;
}

/** Download exact bytes with a hard stream cap (strict bound before/while reading). */
async function fetchBounded(url, cap, { token = null } = {}) {
  const response = await apiFetch(url, { token });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    fail(`download failed: ${response.status} ${response.statusText} for ${url}`);
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > cap) {
    await response.body?.cancel().catch(() => {});
    fail(`download from ${url} declares ${declared} bytes, exceeding the ${cap}-byte cap`);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (error) {
      fail(`download from ${url} failed mid-stream: ${error.message}`);
    }
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      fail(`download from ${url} exceeded the ${cap}-byte cap`);
    }
    chunks.push(Buffer.from(chunk.value));
  }
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// verify-run: source run proof + artifact download + safe extraction
// ---------------------------------------------------------------------------

/**
 * Validate the source Actions run payload against the frozen identity
 * contract (task contract 2). The source workflow dispatches before its own
 * run settles, so identity is checked on every poll and completion is polled
 * with a strict bounded timeout.
 */
function checkSourceRun(run, expectedSha, runId) {
  const issues = [];
  const repository = run.repository;
  if (!isPlainObject(repository) || typeof repository.full_name !== "string" || repository.full_name !== DEFAULT_SOURCE_REPO) {
    issues.push(`repository is not exactly ${DEFAULT_SOURCE_REPO}`);
  }
  if (typeof run.path !== "string" || run.path !== ".github/workflows/publish-selected-plugins.yml") {
    issues.push(`workflow path is not exactly .github/workflows/publish-selected-plugins.yml (got ${JSON.stringify(run.path)})`);
  }
  if (run.event !== "push") issues.push(`event is not exactly push (got ${JSON.stringify(run.event)})`);
  if (run.head_branch !== "main") issues.push(`branch is not exactly main (got ${JSON.stringify(run.head_branch)})`);
  if (run.head_sha !== expectedSha) issues.push(`head SHA ${JSON.stringify(run.head_sha)} does not equal the claimed source SHA`);
  if (issues.length > 0) {
    fail(`source run ${runId} failed identity proof: ${issues.join("; ")}`);
  }
  return run;
}

/** Extract one GitHub Actions artifact zip into dir with strict entry rules. */
function extractArtifactZip(zipBytes, dir) {
  // End-of-central-directory scan with an exact endpoint (mirrors the JAR
  // inspector in lib/catalog-v2/catalog.mjs; ZIP64 locator is rejected).
  const size = zipBytes.byteLength;
  const EOCD_SIZE = 22;
  const EOCD_MAX_SEARCH = 65535 + EOCD_SIZE;
  let eocd = -1;
  for (let i = size - EOCD_SIZE; i >= Math.max(0, size - EOCD_MAX_SEARCH); i -= 1) {
    if (zipBytes.readUInt32LE(i) !== 0x06054b50) continue;
    const commentLen = zipBytes.readUInt16LE(i + 20);
    if (i + EOCD_SIZE + commentLen !== size) continue;
    if (i >= 20 && zipBytes.readUInt32LE(i - 20) === 0x07064b50) fail("artifact zip must not be ZIP64");
    eocd = i;
    break;
  }
  if (eocd === -1) fail("artifact zip has no valid end-of-central-directory record");
  const diskNumber = zipBytes.readUInt16LE(eocd + 4);
  const cdStartDisk = zipBytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = zipBytes.readUInt16LE(eocd + 8);
  const totalEntries = zipBytes.readUInt16LE(eocd + 10);
  if (diskNumber !== 0 || cdStartDisk !== 0 || entriesOnDisk !== totalEntries) fail("artifact zip must be single-disk");
  const cdSize = zipBytes.readUInt32LE(eocd + 12);
  const cdOffset = zipBytes.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize !== eocd) fail("artifact zip central directory must end exactly at the EOCD");
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) fail("artifact zip must not use ZIP64");
  if (totalEntries > MAX_BUNDLE_ENTRIES) fail(`artifact zip has more than ${MAX_BUNDLE_ENTRIES} entries`);

  let offset = cdOffset;
  const seen = new Set();
  let totalUncompressed = 0;
  for (let i = 0; i < totalEntries; i += 1) {
    if (offset + 46 > size || zipBytes.readUInt32LE(offset) !== 0x02014b50) fail("artifact zip central directory is malformed");
    const flags = zipBytes.readUInt16LE(offset + 8);
    const method = zipBytes.readUInt16LE(offset + 10);
    const compressedSize = zipBytes.readUInt32LE(offset + 20);
    const uncompressedSize = zipBytes.readUInt32LE(offset + 24);
    const nameLen = zipBytes.readUInt16LE(offset + 28);
    const extraLen = zipBytes.readUInt16LE(offset + 30);
    const commentLen = zipBytes.readUInt16LE(offset + 32);
    const externalAttrs = zipBytes.readUInt32LE(offset + 38);
    const localOffset = zipBytes.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    if (nameStart + nameLen > size) fail("artifact zip entry name exceeds file bounds");
    if ((flags & 0x0001) !== 0) fail("artifact zip must not contain encrypted entries");
    if (method !== 0 && method !== 8) fail(`artifact zip entry uses unsupported method ${method}`);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      fail("artifact zip must not contain ZIP64 entries");
    }
    const name = zipBytes.toString("utf8", nameStart, nameStart + nameLen);
    if (name.length === 0 || name.startsWith("/") || name.includes("\\") || name.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
      fail(`artifact zip entry name "${name}" is not a safe relative path`);
    }
    if (seen.has(name)) fail(`artifact zip contains duplicate entry "${name}"`);
    seen.add(name);
    offset = nameStart + nameLen + extraLen + commentLen;

    const mode = (externalAttrs >>> 16) & 0xffff;
    const type = mode & 0xf000;
    if (type === 0xa000) fail(`artifact zip entry "${name}" is a symbolic link`);
    if (type !== 0 && type !== 0x8000 && type !== 0x4000) {
      fail(`artifact zip entry "${name}" is not a regular file or directory`);
    }
    if (name.endsWith("/")) continue; // directory entry
    if (type === 0x4000) continue; // directory entry without trailing slash
    if (uncompressedSize > MAX_ARTIFACT_SIZE) {
      fail(`artifact zip entry "${name}" exceeds ${MAX_ARTIFACT_SIZE} uncompressed bytes`);
    }
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_BUNDLE_ZIP_BYTES) fail("artifact zip total uncompressed size exceeds the cap");

    // Local header: verify signature and locate the entry data.
    if (localOffset + 30 > size || zipBytes.readUInt32LE(localOffset) !== 0x04034b50) fail(`artifact zip entry "${name}" local header is malformed`);
    const localNameLen = zipBytes.readUInt16LE(localOffset + 26);
    const localExtraLen = zipBytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > size) fail(`artifact zip entry "${name}" data exceeds file bounds`);
    const compressed = zipBytes.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else {
      try {
        data = inflateRawSync(compressed, { maxOutputLength: uncompressedSize });
      } catch {
        fail(`artifact zip entry "${name}" is not valid deflate`);
      }
    }
    if (data.byteLength !== uncompressedSize) fail(`artifact zip entry "${name}" size mismatch after inflation`);
    const target = path.join(dir, ...name.split("/"));
    const resolved = path.resolve(target);
    if (resolved !== path.join(path.resolve(dir), ...name.split("/"))) fail(`artifact zip entry "${name}" escapes the extraction root`);
    mkdirSync(path.dirname(resolved), { recursive: true });
    writeFileSync(resolved, data, { mode: 0o600 });
  }
  if (offset !== cdOffset + cdSize) fail("artifact zip central directory length mismatch");
}

async function mainVerifyRun(argv) {
  const flags = parseFlags(argv, {
    strings: ["run-id", "sha", "artifact-name", "out", "api-url", "poll-interval", "poll-timeout", "token-env"],
  });
  const runId = requireFlag(flags, "run-id");
  const sha = requireFlag(flags, "sha");
  const artifactName = requireFlag(flags, "artifact-name");
  const outDir = requireFlag(flags, "out");
  const apiUrl = flags["api-url"] ?? DEFAULT_API_URL;
  const pollInterval = Number(flags["poll-interval"] ?? 15);
  const pollTimeout = Number(flags["poll-timeout"] ?? 1200);
  const tokenEnv = flags["token-env"] ?? "TURBOISM_RELEASE_ARTIFACT_READ_TOKEN";
  if (!RE_RUN_ID.test(runId)) usageError("--run-id must be a numeric GitHub Actions run id");
  if (!RE_SOURCE_REVISION.test(sha)) usageError("--sha must be a 40-character lowercase hex commit SHA");
  if (typeof artifactName !== "string" || artifactName.length === 0 || artifactName.length > MAX_ARTIFACT_NAME) {
    usageError("--artifact-name must be a non-empty string of at most 256 characters");
  }
  if (!Number.isFinite(pollInterval) || pollInterval <= 0 || !Number.isFinite(pollTimeout) || pollTimeout <= 0) {
    usageError("--poll-interval and --poll-timeout must be positive seconds");
  }
  const token = process.env[tokenEnv];
  if (typeof token !== "string" || token.length === 0) {
    fail(`the ${tokenEnv} environment variable is required for source-run verification and is not set`);
  }
  try {
    mkdirSync(outDir, { recursive: true });
    const existing = readdirSync(outDir);
    if (existing.length > 0) fail(`--out directory ${outDir} must be empty, found ${existing.length} entries`);
  } catch (error) {
    if (error.exited) throw error;
    fail(`cannot prepare --out directory ${outDir}: ${error.message}`);
  }

  const runUrl = `${apiUrl}/repos/${DEFAULT_SOURCE_REPO}/actions/runs/${runId}`;
  const deadline = Date.now() + pollTimeout * 1000;
  let run = null;
  for (;;) {
    const response = await apiFetch(runUrl, { token });
    if (response.status === 404) fail(`source run ${runId} does not exist or the token cannot read it`);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      fail(`cannot inspect source run ${runId}: GitHub API ${response.status}: ${body.slice(0, 300)}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    run = strictJson(bytes, "source run response");
    checkSourceRun(run, sha, runId);
    if (run.status === "completed") break;
    if (Date.now() + pollInterval * 1000 > deadline) fail(`source run ${runId} did not complete within ${pollTimeout} seconds`);
    await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000));
  }
  if (run.conclusion !== "success") fail(`source run ${runId} completed with conclusion "${run.conclusion}", expected success`);

  // R2: bind the claimed artifact name to the accepted source convention using
  // authoritative run metadata: turboism-market-release-<head_sha>-<run_id>-<run_attempt>.
  if (typeof run.run_attempt !== "number" || run.run_attempt < 1) {
    fail(`source run ${runId} is missing an authoritative run_attempt; cannot bind the artifact name`);
  }
  const expectedArtifactName = `turboism-market-release-${run.head_sha}-${runId}-${run.run_attempt}`;
  if (artifactName !== expectedArtifactName) {
    fail(`artifact name "${artifactName}" does not match the accepted source convention "${expectedArtifactName}"`);
  }

  // Exactly one non-expired artifact with the exact claimed name.
  const artifactsUrl = `${apiUrl}/repos/${DEFAULT_SOURCE_REPO}/actions/runs/${runId}/artifacts?per_page=100`;
  const artifactPage = await apiJson(artifactsUrl, { token });
  if (!Array.isArray(artifactPage.artifacts)) fail("source artifacts response must contain an artifacts array");
  const matches = artifactPage.artifacts.filter((artifact) => isPlainObject(artifact) && artifact.name === artifactName && artifact.expired !== true);
  if (matches.length === 0) fail(`no non-expired artifact named "${artifactName}" exists for source run ${runId}`);
  if (matches.length > 1) fail(`more than one non-expired artifact named "${artifactName}" exists for source run ${runId}`);
  const artifact = matches[0];
  if (typeof artifact.id !== "number" && typeof artifact.archive_download_url !== "string") {
    fail("source artifact response is missing id or archive_download_url");
  }
  if (typeof artifact.size_in_bytes === "number" && artifact.size_in_bytes > MAX_BUNDLE_ZIP_BYTES) {
    fail(`source artifact declares ${artifact.size_in_bytes} bytes, exceeding the ${MAX_BUNDLE_ZIP_BYTES}-byte cap`);
  }
  const downloadUrl =
    typeof artifact.archive_download_url === "string" && artifact.archive_download_url.length > 0
      ? artifact.archive_download_url
      : `${apiUrl}/repos/${DEFAULT_SOURCE_REPO}/actions/artifacts/${artifact.id}/zip`;
  const zipBytes = await fetchBounded(downloadUrl, MAX_BUNDLE_ZIP_BYTES, { token });
  extractArtifactZip(zipBytes, outDir);
  console.log(`verified source run ${runId} (${sha}) and extracted artifact "${artifactName}" -> ${outDir}`);
}

// ---------------------------------------------------------------------------
// validate-bundle: offline strict bundle validation
// ---------------------------------------------------------------------------

const POLICY_KEYS = ["channel", "cubismVersions", "repository", "support"];
const DESCRIPTOR_KEYS = ["id", "version", "name", "description", "author", "license", "category", "tags", "turboismApi", "environment", "dependencies", "permissions"];
const ENVIRONMENT_KEYS = ["requiresCubism", "ui"];
const LOCALIZATION_KEYS = ["name", "description"];
const ARTIFACT_KEYS = ["project", "module", "asset", "sha256", "size", "descriptorSha256", "policy", "descriptor", "localizations"];

function validatePolicy(policy, path, issues) {
  if (!isPlainObject(policy)) {
    issues.push({ path, message: "must be an object" });
    return null;
  }
  checkKeysOnly(policy, POLICY_KEYS, path, issues);
  checkRequiredFields(policy, POLICY_KEYS, path, issues);
  if (policy.channel !== undefined && !CHANNEL_VALUES.includes(policy.channel)) {
    issues.push({ path: `${path}.channel`, message: `must be one of ${CHANNEL_VALUES.join(", ")}` });
  }
  if (policy.cubismVersions !== undefined) {
    if (!Array.isArray(policy.cubismVersions)) {
      issues.push({ path: `${path}.cubismVersions`, message: "must be an array" });
    } else {
      const seen = new Set();
      policy.cubismVersions.forEach((value, index) => {
        if (typeof value !== "string" || !RE_HOST_VERSION.test(value)) {
          issues.push({ path: `${path}.cubismVersions[${index}]`, message: "must be an exact host version like 5.3.02" });
        } else if (seen.has(value)) {
          issues.push({ path: `${path}.cubismVersions[${index}]`, message: `duplicate cubism version "${value}"` });
        }
        seen.add(value);
      });
    }
  }
  checkHttpsUrl(policy, "repository", path, issues, { host: null });
  checkHttpsUrl(policy, "support", path, issues, { host: null });
  return policy;
}

function validateDependencyList(dependencies, path, issues) {
  if (!Array.isArray(dependencies)) {
    issues.push({ path, message: "must be an array" });
    return null;
  }
  const seen = new Set();
  dependencies.forEach((dependency, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(dependency)) {
      issues.push({ path: itemPath, message: "must be an object" });
      return;
    }
    checkKeysOnly(dependency, ["id", "version", "type", "ordering", "reason"], itemPath, issues);
    checkRequiredFields(dependency, ["id", "version", "type", "ordering"], itemPath, issues);
    const id = checkString(dependency, "id", itemPath, issues, { min: 1, max: 128, re: RE_PLUGIN_ID, label: "dependency id" });
    if (id !== null) {
      if (seen.has(id)) issues.push({ path: `${itemPath}.id`, message: `duplicate dependency id "${id}"` });
      seen.add(id);
    }
    const version = checkString(dependency, "version", itemPath, issues, { min: 1, max: 64, label: "dependency version" });
    if (version !== null && parseVersionRange(version) === null) {
      issues.push({ path: `${itemPath}.version`, message: `"${version}" is not a strict version or half-open range` });
    }
    if (dependency.type !== undefined && !DEPENDENCY_TYPE_VALUES.includes(dependency.type)) {
      issues.push({ path: `${itemPath}.type`, message: `must be one of ${DEPENDENCY_TYPE_VALUES.join(", ")}` });
    }
    if (dependency.ordering !== undefined && !ORDERING_VALUES.includes(dependency.ordering)) {
      issues.push({ path: `${itemPath}.ordering`, message: `must be one of ${ORDERING_VALUES.join(", ")}` });
    }
    if (dependency.reason !== undefined) checkString(dependency, "reason", itemPath, issues, { min: 1, max: 500 });
  });
  return dependencies;
}

function validatePermissionList(permissions, path, issues) {
  if (!Array.isArray(permissions)) {
    issues.push({ path, message: "must be an array" });
    return null;
  }
  const seen = new Set();
  permissions.forEach((permission, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(permission)) {
      issues.push({ path: itemPath, message: "must be an object" });
      return;
    }
    checkKeysOnly(permission, ["id", "scope", "reason"], itemPath, issues);
    checkRequiredFields(permission, ["id", "reason"], itemPath, issues);
    const id = checkString(permission, "id", itemPath, issues, { min: 1, max: 128, re: RE_PLUGIN_ID, label: "permission id" });
    if (id !== null) {
      if (seen.has(id)) issues.push({ path: `${itemPath}.id`, message: `duplicate permission id "${id}"` });
      seen.add(id);
    }
    if (permission.scope !== undefined && !PERMISSION_SCOPE_VALUES.includes(permission.scope)) {
      issues.push({ path: `${itemPath}.scope`, message: `must be one of ${PERMISSION_SCOPE_VALUES.join(", ")}` });
    }
    checkString(permission, "reason", itemPath, issues, { min: 1, max: 500 });
  });
  return permissions;
}

function validateDescriptorSubset(descriptor, path, issues) {
  if (!isPlainObject(descriptor)) {
    issues.push({ path, message: "must be an object" });
    return null;
  }
  checkKeysOnly(descriptor, DESCRIPTOR_KEYS, path, issues);
  checkRequiredFields(descriptor, DESCRIPTOR_KEYS, path, issues);
  checkString(descriptor, "id", path, issues, { min: 1, max: 128, re: RE_PLUGIN_ID, label: "plugin id" });
  const version = checkString(descriptor, "version", path, issues, { min: 1, max: 64, label: "version" });
  if (version !== null && parseStrictVersion(version) === null) {
    issues.push({ path: `${path}.version`, message: `"${version}" is not a strict MAJOR.MINOR.PATCH version` });
  }
  checkString(descriptor, "name", path, issues, { min: 1, max: 120 });
  checkString(descriptor, "description", path, issues, { min: 1, max: 500 });
  checkString(descriptor, "author", path, issues, { min: 1, max: 120 });
  checkString(descriptor, "license", path, issues, { min: 1, max: 100 });
  checkKebabToken(descriptor, "category", path, issues, { min: 2, max: 32 });
  if (descriptor.category !== undefined && !OFFICIAL_CATEGORIES.includes(descriptor.category)) {
    issues.push({ path: `${path}.category`, message: `official category "${descriptor.category}" is not in the reviewed registry` });
  }
  if (descriptor.tags !== undefined) {
    if (!Array.isArray(descriptor.tags)) {
      issues.push({ path: `${path}.tags`, message: "must be an array" });
    } else {
      if (descriptor.tags.length < 1 || descriptor.tags.length > 12) {
        issues.push({ path: `${path}.tags`, message: "must contain between 1 and 12 tags" });
      }
      const seen = new Set();
      descriptor.tags.forEach((tag, index) => {
        const tagPath = `${path}.tags[${index}]`;
        if (typeof tag !== "string" || tag.length < 2 || tag.length > 32 || !RE_KEBAB.test(tag)) {
          issues.push({ path: tagPath, message: "must be a lowercase kebab-case token of 2-32 characters" });
        } else if (seen.has(tag)) {
          issues.push({ path: tagPath, message: `duplicate tag "${tag}"` });
        }
        seen.add(tag);
      });
    }
  }
  const apiRange = checkString(descriptor, "turboismApi", path, issues, { min: 1, max: 64 });
  if (apiRange !== null && parseVersionRange(apiRange) === null) {
    issues.push({ path: `${path}.turboismApi`, message: `"${apiRange}" is not a strict version or half-open range` });
  }
  if (descriptor.environment !== undefined) {
    const environmentPath = `${path}.environment`;
    if (!isPlainObject(descriptor.environment)) {
      issues.push({ path: environmentPath, message: "must be an object" });
    } else {
      checkKeysOnly(descriptor.environment, ENVIRONMENT_KEYS, environmentPath, issues);
      checkRequiredFields(descriptor.environment, ENVIRONMENT_KEYS, environmentPath, issues);
      checkBoolean(descriptor.environment, "requiresCubism", environmentPath, issues);
      checkString(descriptor.environment, "ui", environmentPath, issues, { min: 0, max: 64 });
    }
  }
  validateDependencyList(descriptor.dependencies, `${path}.dependencies`, issues);
  validatePermissionList(descriptor.permissions, `${path}.permissions`, issues);
  return descriptor;
}

function validateLocalizations(localizations, path, issues) {
  if (!isPlainObject(localizations)) {
    issues.push({ path, message: "must be an object" });
    return null;
  }
  checkKeysOnly(localizations, LOCALE_VALUES, path, issues);
  checkRequiredFields(localizations, LOCALE_VALUES, path, issues);
  for (const locale of LOCALE_VALUES) {
    const item = localizations[locale];
    const itemPath = `${path}.${locale}`;
    if (!isPlainObject(item)) {
      issues.push({ path: itemPath, message: "must be an object" });
      continue;
    }
    checkKeysOnly(item, LOCALIZATION_KEYS, itemPath, issues);
    checkRequiredFields(item, LOCALIZATION_KEYS, itemPath, issues);
    checkString(item, "name", itemPath, issues, { min: 1, max: 120 });
    checkString(item, "description", itemPath, issues, { min: 1, max: 500 });
  }
  return localizations;
}

/** Deep-compare two JSON values (deterministic, key-order sensitive like canonical bytes). */
function sameJson(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((value, index) => sameJson(value, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) => key in b && sameJson(a[key], b[key]));
  }
  return false;
}

async function mainValidateBundle(argv) {
  const flags = parseFlags(argv, { strings: ["sidecar", "bundle-dir", "out", "expected-revision"] });
  const sidecarPath = requireFlag(flags, "sidecar");
  const bundleDir = requireFlag(flags, "bundle-dir");
  const outPath = requireFlag(flags, "out");
  const expectedRevision = requireFlag(flags, "expected-revision");
  if (!RE_SOURCE_REVISION.test(expectedRevision)) usageError("--expected-revision must be a 40-character lowercase hex commit SHA");

  const bundleRoot = path.resolve(bundleDir);
  const sidecarBytes = readBoundedFile(sidecarPath, 4 * 1024 * 1024, "sidecar");
  const sidecar = strictJson(sidecarBytes, "sidecar");
  const issues = [];
  if (!isPlainObject(sidecar)) fail("sidecar must be a JSON object");
  checkKeysOnly(sidecar, ["format", "schemaVersion", "source", "artifacts"], "sidecar", issues);
  checkRequiredFields(sidecar, ["format", "schemaVersion", "source", "artifacts"], "sidecar", issues);
  if (sidecar.format !== MARKET_FORMAT) issues.push({ path: "sidecar.format", message: `must be exactly "${MARKET_FORMAT}"` });
  if (sidecar.schemaVersion !== MARKET_SCHEMA) issues.push({ path: "sidecar.schemaVersion", message: `must be exactly ${MARKET_SCHEMA}` });
  if (sidecar.source !== undefined) {
    if (!isPlainObject(sidecar.source)) {
      issues.push({ path: "sidecar.source", message: "must be an object" });
    } else {
      checkKeysOnly(sidecar.source, ["revision"], "sidecar.source", issues);
      checkRequiredFields(sidecar.source, ["revision"], "sidecar.source", issues);
      checkString(sidecar.source, "revision", "sidecar.source", issues, { min: 40, max: 40, re: RE_SOURCE_REVISION });
    }
  }
  if (sidecar.artifacts !== undefined) {
    if (!Array.isArray(sidecar.artifacts)) {
      issues.push({ path: "sidecar.artifacts", message: "must be an array" });
    } else if (sidecar.artifacts.length < 1 || sidecar.artifacts.length > MAX_BUNDLE_ARTIFACTS) {
      issues.push({ path: "sidecar.artifacts", message: `must contain between 1 and ${MAX_BUNDLE_ARTIFACTS} artifacts` });
    }
  }
  raiseIf(issues, "bundle sidecar");

  // R2: the sidecar revision must equal the source SHA of the verified run;
  // a syntactically valid but forged revision is rejected here, before any
  // Release or catalog mutation.
  if (sidecar.source.revision !== expectedRevision) {
    fail(`bundle sidecar revision ${sidecar.source.revision} does not equal the verified source SHA ${expectedRevision}`);
  }

  const normalized = { format: MARKET_FORMAT, schemaVersion: MARKET_SCHEMA, source: { revision: sidecar.source.revision }, artifacts: [] };
  const seenModules = new Set();
  const seenIds = new Set();
  const seenVersions = new Map(); // module -> Set(version)
  for (let index = 0; index < sidecar.artifacts.length; index += 1) {
    const artifact = sidecar.artifacts[index];
    const pathPrefix = `sidecar.artifacts[${index}]`;
    const itemIssues = [];
    if (!isPlainObject(artifact)) {
      issues.push({ path: pathPrefix, message: "must be an object" });
      continue;
    }
    checkKeysOnly(artifact, ARTIFACT_KEYS, pathPrefix, itemIssues);
    checkRequiredFields(artifact, ARTIFACT_KEYS, pathPrefix, itemIssues);
    const project = checkString(artifact, "project", pathPrefix, itemIssues, { min: 1, max: 128 });
    const moduleName = checkString(artifact, "module", pathPrefix, itemIssues, { min: 1, max: 100, re: RE_KEBAB, label: "module" });
    if (project !== null && moduleName !== null && project !== `:plugins:${moduleName}`) {
      itemIssues.push({ path: `${pathPrefix}.project`, message: `project "${project}" must equal ":plugins:${module}"` });
    }
    const descriptor = validateDescriptorSubset(artifact.descriptor, `${pathPrefix}.descriptor`, itemIssues);
    const policy = validatePolicy(artifact.policy, `${pathPrefix}.policy`, itemIssues);
    validateLocalizations(artifact.localizations, `${pathPrefix}.localizations`, itemIssues);
    checkString(artifact, "sha256", pathPrefix, itemIssues, { min: 64, max: 64, re: RE_SHA256, label: "sha256" });
    checkString(artifact, "descriptorSha256", pathPrefix, itemIssues, { min: 64, max: 64, re: RE_SHA256 });
    checkInteger(artifact, "size", pathPrefix, itemIssues, { min: 1, max: MAX_ARTIFACT_SIZE });
    const asset = checkString(artifact, "asset", pathPrefix, itemIssues, { min: 5, max: 255 });
    if (asset !== null && !/\.jar$/.test(asset)) {
      itemIssues.push({ path: `${pathPrefix}.asset`, message: `"${asset}" must be a canonical .jar filename` });
    }
    if (moduleName !== null && descriptor !== null && asset !== null && asset !== `${moduleName}-${descriptor.version}.jar`) {
      itemIssues.push({ path: `${pathPrefix}.asset`, message: `"${asset}" must be exactly "<module>-<version>.jar" (got "${moduleName}-${descriptor.version}.jar")` });
    }
    if (descriptor !== null) {
      if (seenIds.has(descriptor.id)) itemIssues.push({ path: `${pathPrefix}.descriptor.id`, message: `duplicate plugin id "${descriptor.id}" in one bundle` });
      seenIds.add(descriptor.id);
      if (moduleName !== null) {
        if (seenModules.has(moduleName)) itemIssues.push({ path: `${pathPrefix}.module`, message: `duplicate module "${moduleName}" in one bundle` });
        seenModules.add(moduleName);
        const versions = seenVersions.get(moduleName) ?? new Set();
        if (versions.has(descriptor.version)) {
          itemIssues.push({ path: `${pathPrefix}.descriptor.version`, message: `duplicate version "${descriptor.version}" for module "${moduleName}"` });
        }
        versions.add(descriptor.version);
        seenVersions.set(moduleName, versions);
      }
      // Policy/cubism consistency (contract: cubismVersions must be non-empty
      // exactly when the descriptor requires Cubism).
      if (policy !== null && typeof descriptor.environment?.requiresCubism === "boolean") {
        const versions = policy.cubismVersions ?? [];
        if (descriptor.environment.requiresCubism && versions.length === 0) {
          itemIssues.push({ path: `${pathPrefix}.policy.cubismVersions`, message: "must contain at least one exact reviewed Editor version when requiresCubism is true" });
        }
        if (!descriptor.environment.requiresCubism && versions.length > 0) {
          itemIssues.push({ path: `${pathPrefix}.policy.cubismVersions`, message: "must be empty when requiresCubism is false" });
        }
      }
    }
    issues.push(...itemIssues);
  }
  raiseIf(issues, "bundle sidecar");

  // Real-JAR verification: every referenced JAR must exist in the bundle root
  // as a regular non-symlink file with exact bytes, and the embedded
  // schema-v3 descriptor must agree with the sidecar subset on every market
  // field (reusing inspectJarFile + bindReleaseToDescriptor).
  const artifacts = [...sidecar.artifacts].sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : 0));
  const bundleEntries = new Set(readdirSync(bundleRoot));
  if (!bundleEntries.has(SIDECAR_NAME)) fail(`bundle root ${bundleDir} is missing ${SIDECAR_NAME}`);
  const expectedFiles = new Set([SIDECAR_NAME]);
  for (const artifact of artifacts) {
    const jarPath = path.join(bundleRoot, artifact.asset);
    const resolved = path.resolve(jarPath);
    if (!resolved.startsWith(bundleRoot + path.sep)) fail(`artifact "${artifact.asset}" escapes the bundle root`);
    requireFileRegular(resolved, "bundle JAR");
    expectedFiles.add(artifact.asset);
    const inspected = inspectJarFile(resolved, {
      sha256: artifact.sha256,
      size: artifact.size,
      descriptorSha256: artifact.descriptorSha256,
    });
    if (!inspected.ok) {
      const detail = inspected.errors.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
      fail(`bundle JAR ${artifact.asset}: ${detail}`);
    }
    const bound = bindReleaseToDescriptor(
      {
        version: artifact.descriptor.version,
        category: artifact.descriptor.category,
        tags: artifact.descriptor.tags,
        turboismApi: artifact.descriptor.turboismApi,
        requiresCubism: artifact.descriptor.environment.requiresCubism,
        dependencies: artifact.descriptor.dependencies.map((dependency) => ({
          id: dependency.id,
          version: dependency.version,
          type: dependency.type ?? "required",
          ordering: dependency.ordering ?? "none",
        })),
        permissions: artifact.descriptor.permissions.map((permission) => ({
          id: permission.id,
          scope: permission.scope ?? "application",
        })),
      },
      artifact.descriptor.id,
      inspected.descriptor,
    );
    if (!bound.ok) {
      const detail = bound.issues.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
      fail(`bundle JAR ${artifact.asset} descriptor does not bind: ${detail}`);
    }
    // Every market field of the sidecar must agree with the embedded
    // descriptor; author is a derived view of the embedded authors[0].name
    // (the accepted source sidecar carries the derived first author).
    let drift = null;
    for (const key of DESCRIPTOR_KEYS) {
      if (key === "author") {
        const embeddedAuthor = typeof inspected.descriptor.author === "string"
          ? inspected.descriptor.author
          : Array.isArray(inspected.descriptor.authors) && isPlainObject(inspected.descriptor.authors[0])
            ? inspected.descriptor.authors[0].name
            : undefined;
        if (embeddedAuthor !== artifact.descriptor.author) drift = key;
      } else if (!sameJson(inspected.descriptor[key], artifact.descriptor[key])) {
        drift = key;
      }
      if (drift !== null) break;
    }
    if (drift !== null) {
      fail(`bundle JAR ${artifact.asset}: embedded descriptor market fields do not match the sidecar descriptor (field "${drift}")`);
    }
    normalized.artifacts.push({
      project: artifact.project,
      module: artifact.module,
      pluginId: artifact.descriptor.id,
      version: artifact.descriptor.version,
      asset: artifact.asset,
      sha256: artifact.sha256,
      size: artifact.size,
      descriptorSha256: artifact.descriptorSha256,
      policy: artifact.policy,
      descriptor: artifact.descriptor,
      localizations: artifact.localizations,
      jarPath: resolved,
    });
  }
  // The bundle must contain exactly the sidecar and the referenced JARs.
  for (const entry of bundleEntries) {
    if (!expectedFiles.has(entry)) fail(`bundle root ${bundleDir} contains unexpected file "${entry}"`);
  }
  writeFileAtomic(outPath, Buffer.from(JSON.stringify(normalized), "utf8"));
  console.log(`validated bundle: ${normalized.artifacts.length} artifact(s), revision ${normalized.source.revision}`);
}

// ---------------------------------------------------------------------------
// sync-releases: create/resume immutable public GitHub Releases
// ---------------------------------------------------------------------------

/**
 * T2: ONE strict release-response validator for BOTH created and resumed
 * releases. The contract requires draft and prerelease to be exactly false
 * (missing/null/string values are rejected), the deterministic tag/name to
 * match exactly, the Provider release URL to be exact, published_at to be a
 * valid UTC date-time, and the upload/assets shape to be present as needed.
 */
function validateReleaseResponse(release, owner, repository, tag, { requireUploadUrl = false, requireAssets = false } = {}) {
  const issues = [];
  const prefix = "release";
  if (release.tag_name !== tag) {
    issues.push({ path: `${prefix}.tag_name`, message: `tag metadata conflict: expected "${tag}", got "${JSON.stringify(release.tag_name)}"` });
  }
  if (release.name !== tag) {
    issues.push({ path: `${prefix}.name`, message: `name metadata conflict: expected "${tag}", got ${JSON.stringify(release.name)}` });
  }
  if (release.draft !== false) {
    issues.push({ path: `${prefix}.draft`, message: `must be exactly false, got ${JSON.stringify(release.draft)}; refusing to mutate or reuse it` });
  }
  if (release.prerelease !== false) {
    issues.push({ path: `${prefix}.prerelease`, message: `must be exactly false, got ${JSON.stringify(release.prerelease)}; refusing to mutate or reuse it` });
  }
  checkDateTime(release, "published_at", prefix, issues);
  const expectedHtml = `https://github.com/${owner}/${repository}/releases/tag/${tag}`;
  if (release.html_url !== expectedHtml) {
    issues.push({ path: `${prefix}.html_url`, message: `must be exactly ${expectedHtml}` });
  }
  if (requireUploadUrl && (typeof release.upload_url !== "string" || release.upload_url.length === 0)) {
    issues.push({ path: `${prefix}.upload_url`, message: "must be a non-empty string on a created release" });
  }
  if (requireAssets && !Array.isArray(release.assets)) {
    issues.push({ path: `${prefix}.assets`, message: "must be an array on an existing release" });
  }
  raiseIf(issues, `release "${tag}"`);
  return release;
}

function releaseTag(module, version) {
  return `plugin-${module}-v${version}`;
}

async function mainSyncReleases(argv) {
  const flags = parseFlags(argv, {
    strings: ["bundle", "out", "catalog", "api-url", "repo", "asset-base", "token-env"],
  });
  const bundlePath = requireFlag(flags, "bundle");
  const outPath = requireFlag(flags, "out");
  const catalogPath = requireFlag(flags, "catalog");
  const apiUrl = flags["api-url"] ?? DEFAULT_API_URL;
  const repo = flags["repo"] ?? DEFAULT_PUBLIC_REPO;
  const assetBase = flags["asset-base"] ?? DEFAULT_ASSET_BASE;
  const tokenEnv = flags["token-env"] ?? "GITHUB_TOKEN";
  const token = process.env[tokenEnv];
  if (typeof token !== "string" || token.length === 0) {
    fail(`the ${tokenEnv} environment variable is required for public Release creation and is not set`);
  }
  const repoMatch = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.exec(repo);
  if (repoMatch === null) usageError("--repo must be <owner>/<repo>");
  const [owner, repository] = repo.split("/");

  const bundle = strictJson(readBoundedFile(bundlePath, 16 * 1024 * 1024, "bundle manifest"), "bundle manifest");
  const issues = [];
  if (!isPlainObject(bundle)) fail("bundle manifest must be an object");
  checkKeysOnly(bundle, ["format", "schemaVersion", "source", "artifacts"], "bundle manifest", issues);
  checkRequiredFields(bundle, ["format", "schemaVersion", "source", "artifacts"], "bundle manifest", issues);
  if (bundle.format !== MARKET_FORMAT) issues.push({ path: "bundle manifest.format", message: `must be "${MARKET_FORMAT}"` });
  if (bundle.schemaVersion !== MARKET_SCHEMA) issues.push({ path: "bundle manifest.schemaVersion", message: `must be ${MARKET_SCHEMA}` });
  if (!Array.isArray(bundle.artifacts)) issues.push({ path: "bundle manifest.artifacts", message: "must be an array" });
  raiseIf(issues, "bundle manifest");

  // R4: the signed source catalog is the authority on what is already
  // published. A version present in the catalog must exist on GitHub with
  // byte-identical, authoritative metadata; it is NEVER recreated or
  // re-uploaded. Absent tags/assets are resumable only for versions that are
  // not yet cataloged (the partial pre-catalog failure window).
  const catalogBytes = readBoundedFile(catalogPath, 5 * 1024 * 1024, "source catalog");
  const catalogCheck = validateCatalogBytes(catalogBytes);
  if (!catalogCheck.ok) {
    const detail = catalogCheck.errors.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    fail(`source catalog is not a valid v2 catalog: ${detail}`);
  }
  const cataloged = new Map(); // `${slug}@${version}` -> { releaseUrl, artifactUrl, sha256 }
  for (const plugin of catalogCheck.catalog.plugins) {
    for (const release of plugin.releases) {
      cataloged.set(`${plugin.slug}@${release.version}`, {
        releaseUrl: release.releaseUrl,
        artifactUrl: release.artifact.url,
        sha256: release.artifact.sha256,
      });
    }
  }

  const releases = {};
  for (const artifact of bundle.artifacts) {
    if (!isPlainObject(artifact) || typeof artifact.module !== "string" || typeof artifact.version !== "string" || typeof artifact.asset !== "string" || typeof artifact.sha256 !== "string" || typeof artifact.size !== "number") {
      fail("bundle manifest artifact is malformed");
    }
    const key = `${artifact.module}@${artifact.version}`;
    const catalogedEntry = cataloged.get(key);
    const tag = releaseTag(artifact.module, artifact.version);
    const releasesUrl = `${apiUrl}/repos/${owner}/${repository}/releases/tags/${encodeURIComponent(tag)}`;
    const existingResponse = await apiFetch(releasesUrl, { token });
    let release;
    let created = false;
    if (existingResponse.status === 404) {
      // Absent tag: resumable ONLY for a version not yet cataloged.
      if (catalogedEntry !== undefined) {
        fail(`release "${tag}" for the cataloged ${key} is missing on GitHub; never recreating a cataloged release`);
      }
      release = await apiJson(`${apiUrl}/repos/${owner}/${repository}/releases`, {
        token,
        method: "POST",
        json: {
          tag_name: tag,
          name: tag,
          body: `Public plugin release ${artifact.module} v${artifact.version} for the Turboism Plugin Directory.`,
          draft: false,
          prerelease: false,
        },
      });
      created = true;
      // T2: a freshly created response must pass the SAME strict gate
      // (upload_url is required because the asset upload follows).
      validateReleaseResponse(release, owner, repository, tag, { requireUploadUrl: true });
    } else if (existingResponse.ok) {
      const bytes = Buffer.from(await existingResponse.arrayBuffer());
      release = strictJson(bytes, "release response");
      // T2: the strict shared gate on the resumed release (assets are
      // required for the canonical-asset resolution below).
      validateReleaseResponse(release, owner, repository, tag, { requireAssets: true });
      // R4: a cataloged release must carry the exact authoritative metadata
      // the catalog was published with.
      if (catalogedEntry !== undefined && release.html_url !== catalogedEntry.releaseUrl) {
        fail(`release "${tag}" html_url conflicts with the cataloged ${key} releaseUrl; refusing to operate on it`);
      }
    } else {
      const body = await existingResponse.text().catch(() => "");
      fail(`cannot inspect release "${tag}": GitHub API ${existingResponse.status}: ${body.slice(0, 300)}`);
    }

    // Find the canonical asset among the release's own assets. Exactly one
    // canonical asset may exist (R7); duplicates are ambiguous and rejected.
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const canonicalAssets = assets.filter((asset) => isPlainObject(asset) && asset.name === artifact.asset);
    if (canonicalAssets.length > 1) {
      fail(`release "${tag}" has ${canonicalAssets.length} canonical assets named "${artifact.asset}"; ambiguous, refusing to operate`);
    }
    const existingAsset = canonicalAssets[0];
    let asset;
    if (existingAsset !== undefined) {
      // Existing asset: a strict size gate before any download, then an
      // exact byte comparison. Never overwrite.
      if (typeof existingAsset.size === "number" && existingAsset.size !== artifact.size) {
        fail(`release "${tag}" asset "${artifact.asset}" is ${existingAsset.size} bytes, expected ${artifact.size}; differing bytes must never be overwritten`);
      }
      const assetUrl = existingAsset.browser_download_url;
      if (typeof assetUrl !== "string" || assetUrl !== `https://github.com/${owner}/${repository}/releases/download/${tag}/${artifact.asset}`) {
        fail(`release "${tag}" asset "${artifact.asset}" has an unexpected browser_download_url`);
      }
      // R4: a cataloged asset must be exactly the URL the catalog publishes.
      if (catalogedEntry !== undefined && assetUrl !== catalogedEntry.artifactUrl) {
        fail(`release "${tag}" asset "${artifact.asset}" conflicts with the cataloged ${key} artifact URL; refusing to operate on it`);
      }
      const existingBytes = await fetchBounded(downloadTarget(assetUrl, assetBase), MAX_ARTIFACT_SIZE);
      if (sha256Hex(existingBytes) !== artifact.sha256 || existingBytes.byteLength !== artifact.size) {
        fail(`release "${tag}" asset "${artifact.asset}" bytes differ from the source bundle; refusing to overwrite`);
      }
      if (catalogedEntry !== undefined && catalogedEntry.sha256 !== artifact.sha256) {
        fail(`release "${tag}" is cataloged for ${key} with a different artifact hash; never operating on a corrupt cataloged state`);
      }
      asset = existingAsset;
    } else {
      // Asset absent: resumable ONLY for a version not yet cataloged.
      if (catalogedEntry !== undefined) {
        fail(`release "${tag}" is already cataloged for ${key} but its asset is missing on GitHub; never re-uploading a cataloged asset`);
      }
      const uploadUrl = uploadTarget(release.upload_url, owner, repository, artifact.asset, apiUrl);
      const jarBytes = readBoundedFile(artifact.jarPath, MAX_ARTIFACT_SIZE, "bundle JAR");
      if (sha256Hex(jarBytes) !== artifact.sha256 || jarBytes.byteLength !== artifact.size) {
        fail(`bundle JAR ${artifact.jarPath} no longer matches the sidecar bytes`);
      }
      const uploaded = await apiJson(uploadUrl, {
        token,
        method: "POST",
        body: jarBytes,
        contentType: "application/java-archive",
      });
      if (!isPlainObject(uploaded) || uploaded.name !== artifact.asset || uploaded.size !== artifact.size) {
        fail(`asset upload for "${tag}" did not return the expected asset object`);
      }
      asset = uploaded;
    }
    if (typeof asset.browser_download_url !== "string" || asset.browser_download_url !== `https://github.com/${owner}/${repository}/releases/download/${tag}/${artifact.asset}`) {
      fail(`release "${tag}" asset "${artifact.asset}" has an invalid browser_download_url`);
    }
    if (typeof release.published_at !== "string" || !RE_DATE_TIME.test(release.published_at)) {
      fail(`release "${tag}" has an invalid published_at`);
    }
    releases[`${artifact.module}@${artifact.version}`] = {
      module: artifact.module,
      version: artifact.version,
      tag,
      releaseUrl: release.html_url,
      publishedAt: release.published_at,
      artifactUrl: asset.browser_download_url,
      assetName: artifact.asset,
      sha256: artifact.sha256,
      size: artifact.size,
    };
    console.log(`${created ? "created" : "resumed"} release ${tag} -> ${release.html_url}`);
  }
  writeFileAtomic(outPath, Buffer.from(JSON.stringify({ format: "turboism.market-release.meta", schemaVersion: 1, releases }), "utf8"));
  console.log(`release metadata written to ${outPath}`);
}

/** The download URL for a github.com asset (injectable asset base for tests). */
function downloadTarget(url, assetBase) {
  if (assetBase === DEFAULT_ASSET_BASE) return url;
  if (!url.startsWith(DEFAULT_ASSET_BASE + "/")) fail(`cannot remap download URL ${url}`);
  return assetBase + url.slice(DEFAULT_ASSET_BASE.length);
}

/** The upload target derived from a release upload_url template. */
function uploadTarget(uploadUrlTemplate, owner, repository, assetName, apiUrl) {
  if (typeof uploadUrlTemplate !== "string" || uploadUrlTemplate.length === 0) fail("release response is missing upload_url");
  const template = uploadUrlTemplate.replace(/\{[^}]*\}$/, "");
  let parsed;
  try {
    parsed = new URL(template);
  } catch {
    parsed = null;
  }
  // Production requires https; local test stubs (http api-url) may use http.
  const apiIsHttp = typeof apiUrl === "string" && apiUrl.startsWith("http://");
  const expectedPrefix = `/repos/${owner}/${repository}/releases/`;
  if (
    parsed === null ||
    (parsed.protocol !== "https:" && !(apiIsHttp && parsed.protocol === "http:")) ||
    !parsed.pathname.startsWith(expectedPrefix) ||
    !parsed.pathname.endsWith("/assets")
  ) {
    fail(`release upload_url "${uploadUrlTemplate}" is not a valid https upload endpoint`);
  }
  return `${template}?name=${encodeURIComponent(assetName)}`;
}


// ---------------------------------------------------------------------------
// Shared catalog-merge primitives (used by BOTH the read-only preflight and
// the mutating ingest, so preflight can never drift from the real merge).
// ---------------------------------------------------------------------------

/**
 * Resolve the catalog plugin an artifact binds to by id/slug. Identity is
 * immutable: a bundle whose plugin id or module slug conflicts with the
 * cataloged plugin is rejected.
 * @param {Array<object>} plugins
 * @param {object} artifact normalized bundle artifact
 * @returns {{ ok: true, plugin: object|undefined } | { ok: false, message: string }}
 */
function resolvePluginContext(plugins, artifact) {
  const byId = plugins.find((plugin) => plugin.id === artifact.pluginId);
  const bySlug = plugins.find((plugin) => plugin.slug === artifact.module);
  if (byId !== undefined && bySlug !== undefined && byId !== bySlug) {
    return { ok: false, message: `identity conflict: plugin id "${artifact.pluginId}" and slug "${artifact.module}" are cataloged as different plugins` };
  }
  if (byId !== undefined && byId.slug !== artifact.module) {
    return { ok: false, message: `identity conflict: plugin id "${artifact.pluginId}" is cataloged with slug "${byId.slug}", bundle says "${artifact.module}"` };
  }
  if (bySlug !== undefined && bySlug.id !== artifact.pluginId) {
    return { ok: false, message: `identity conflict: plugin slug "${artifact.module}" is cataloged with id "${bySlug.id}", bundle says "${artifact.pluginId}"` };
  }
  return { ok: true, plugin: byId ?? bySlug };
}

/** Message when the artifact version is not strictly higher than the greatest cataloged one. */
function strictlyHigherError(plugin, version) {
  const greatest = plugin.releases.length > 0 ? plugin.releases[plugin.releases.length - 1] : null;
  if (greatest === null) return null;
  const existingVersion = parseStrictVersion(greatest.version);
  const incomingVersion = parseStrictVersion(version);
  if (existingVersion === null || incomingVersion === null || compareVersions(incomingVersion, existingVersion) <= 0) {
    return `version ${version} for "${plugin.slug}" is not strictly higher than the cataloged ${greatest.version}; refusing to append`;
  }
  return null;
}

/**
 * Read-only acceptability verdict for one artifact against the catalog
 * (R3): rejects every catalog-known conflict — identity, lower version, and
 * same-version byte drift — BEFORE any public Release mutation. Policy-only
 * changes on an identical JAR stay acceptable (applied later by ingest).
 * @param {object|undefined} plugin resolved plugin (undefined = new plugin)
 * @param {object} artifact normalized bundle artifact
 * @returns {{ status: "new-plugin" | "new-version" | "same-version" | "error", message?: string }}
 */
function preflightArtifact(plugin, artifact) {
  if (plugin === undefined) return { status: "new-plugin" };
  const existing = plugin.releases.find((release) => release.version === artifact.version);
  if (existing !== undefined) {
    if (existing.artifact.sha256 !== artifact.sha256) {
      return {
        status: "error",
        message: `version ${artifact.version} for "${artifact.module}" is already cataloged with different bytes (${existing.artifact.sha256} != ${artifact.sha256}); same-version changes are never applied (VERSION_NOT_BUMPED)`,
      };
    }
    return { status: "same-version" };
  }
  const lower = strictlyHigherError(plugin, artifact.version);
  if (lower !== null) return { status: "error", message: lower };
  return { status: "new-version" };
}

function sortedBundleArtifacts(bundle) {
  return [...bundle.artifacts].sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : 0));
}

/** Load and validate the source catalog + normalized bundle (shared by preflight and ingest). */
function loadCatalogAndBundle(catalogPath, bundlePath) {
  const sourceBytes = readBoundedFile(catalogPath, 5 * 1024 * 1024, "source catalog");
  const validated = validateCatalogBytes(sourceBytes);
  if (!validated.ok) {
    const detail = validated.errors.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    fail(`source catalog is not a valid v2 catalog: ${detail}`);
  }
  const bundle = strictJson(readBoundedFile(bundlePath, 16 * 1024 * 1024, "bundle manifest"), "bundle manifest");
  if (!isPlainObject(bundle) || !Array.isArray(bundle.artifacts) || typeof bundle.source?.revision !== "string") {
    fail("bundle manifest is malformed");
  }
  return { sourceBytes, catalog: validated.catalog, bundle };
}

/**
 * Deterministic placeholder release metadata for the read-only preflight
 * (T1): same-version artifacts inherit the EXISTING cataloged release's
 * authoritative fields (so the tentative merge is byte-identical or
 * policy-only, exactly like ingest); new versions/plugins use canonical
 * deterministic values (tag/asset/URLs) and the CURRENT catalog publishedAt.
 * Never written anywhere.
 */
function placeholderReleaseMetadata(artifact, catalog, plugin) {
  const tag = releaseTag(artifact.module, artifact.version);
  const existing = plugin?.releases.find((release) => release.version === artifact.version);
  if (existing !== undefined) {
    return {
      module: artifact.module,
      version: artifact.version,
      tag,
      releaseUrl: existing.releaseUrl,
      publishedAt: existing.publishedAt,
      artifactUrl: existing.artifact.url,
      assetName: existing.artifact.fileName,
      sha256: artifact.sha256,
      size: artifact.size,
    };
  }
  return {
    module: artifact.module,
    version: artifact.version,
    tag,
    releaseUrl: `https://github.com/turboism/turboism-plugin-directory/releases/tag/${tag}`,
    publishedAt: catalog.publishedAt,
    artifactUrl: `https://github.com/turboism/turboism-plugin-directory/releases/download/${tag}/${artifact.asset}`,
    assetName: artifact.asset,
    sha256: artifact.sha256,
    size: artifact.size,
  };
}

/**
 * Shared deterministic merge core (used by BOTH ingest with the real GitHub
 * release metadata and preflight with deterministic placeholder metadata):
 * identity/version/hash acceptance, strictly-higher refresh, same-version
 * no-op/policy handling, deterministic new-plugin append. Mutates a deep
 * clone of the catalog plugins and returns the tentative merged document.
 * Fails closed on every catalog-known conflict.
 */
function mergeBundleIntoCatalog({ current, bundle, revision, releasesFor }) {
  const plugins = structuredClone(current.plugins);
  const changed = []; // module@version entries that produced a semantic change
  const newPlugins = [];
  const sortedArtifacts = sortedBundleArtifacts(bundle);

  for (const artifact of sortedArtifacts) {
    const key = `${artifact.module}@${artifact.version}`;
    const meta = releasesFor(artifact);
    if (!isPlainObject(meta)) fail(`release metadata for ${key} is malformed`);
    if (meta.sha256 !== artifact.sha256 || meta.size !== artifact.size) {
      fail(`release metadata for ${key} does not match the bundle artifact bytes`);
    }
    const candidate = buildReleaseEntry(artifact, meta, revision);
    const candidatePlugin = buildPluginEntry(artifact, candidate);

    // Identity is immutable; the same resolution the read-only preflight ran.
    const context = resolvePluginContext(plugins, artifact);
    if (!context.ok) fail(context.message);
    const plugin = context.plugin;
    if (plugin === undefined) {
      // Brand-new plugin: append after validating that the release is a
      // first version (nothing to compare against).
      newPlugins.push(candidatePlugin);
      changed.push(key);
      continue;
    }
    const existingIndex = plugin.releases.findIndex((release) => release.version === artifact.version);
    if (existingIndex === -1) {
      // R5: a strictly higher accepted version refreshes the plugin-level
      // CURRENT metadata (display fields, bundled translations, reviewed
      // policy) from the new descriptor/policy; identity (id, slug, trust)
      // remains immutable. Earlier release entries keep their own metadata.
      const lower = strictlyHigherError(plugin, artifact.version);
      if (lower !== null) fail(lower);
      plugin.name = candidatePlugin.name;
      plugin.summary = candidatePlugin.summary;
      plugin.author = candidatePlugin.author;
      plugin.license = candidatePlugin.license;
      plugin.localizations = candidatePlugin.localizations;
      plugin.repository = candidatePlugin.repository;
      plugin.support = candidatePlugin.support;
      plugin.releases.push(candidate);
      changed.push(key);
      continue;
    }
    // Same version already cataloged: plugin-level non-policy fields must
    // still agree with the authoritative JAR (only reviewed policy fields are
    // updateable); then a byte-identical no-op or a metadata semantic update;
    // everything else fails closed. sourceRevision is compared separately:
    // the ORIGINAL revision is always preserved.
    for (const field of ["name", "summary", "author", "license"]) {
      if (plugin[field] !== candidatePlugin[field]) {
        fail(`catalog plugin "${artifact.module}" ${field} conflicts with the authoritative bundle (${JSON.stringify(plugin[field])} != ${JSON.stringify(candidatePlugin[field])})`);
      }
    }
    if (JSON.stringify(plugin.localizations) !== JSON.stringify(candidatePlugin.localizations)) {
      fail(`catalog plugin "${artifact.module}" localizations conflict with the authoritative bundle`);
    }
    if (plugin.id !== candidatePlugin.id || plugin.trust !== "official") {
      fail(`catalog plugin "${artifact.module}" identity/trust conflicts with the official bundle`);
    }
    if (plugin.repository !== candidatePlugin.repository || plugin.support !== candidatePlugin.support) {
      plugin.repository = candidatePlugin.repository;
      plugin.support = candidatePlugin.support;
      changed.push(key);
    }
    const existing = plugin.releases[existingIndex];
    const stripRevision = (release) => {
      const rest = { ...release };
      delete rest.sourceRevision;
      return rest;
    };
    if (sameJson(stripRevision(candidate), stripRevision(existing))) {
      // Byte-identical: preserves the original sourceRevision and release
      // metadata even when a later source run has a different SHA.
      continue;
    }
    const policyUpdated = { ...existing, channel: candidate.channel, cubismVersions: candidate.cubismVersions };
    if (sameJson(stripRevision(policyUpdated), stripRevision(candidate))) {
      plugin.releases[existingIndex] = policyUpdated;
      changed.push(key);
      continue;
    }
    fail(
      `version ${artifact.version} for "${artifact.module}" is already cataloged with different bytes/metadata; ` +
        "same-version changes are never applied (VERSION_NOT_BUMPED)",
    );
  }

  // Deterministic append: new plugins sorted by id.
  if (newPlugins.length > 0) {
    newPlugins.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    plugins.push(...newPlugins);
  }
  return { plugins, changed };
}

/** Tentative semantic catalog document as ingest would produce it (bump + publishedAt). */
function tentativeBumpedCatalog(current, merged, changed, publishedAtFor) {
  const mergedDoc = { ...current, plugins: merged.plugins };
  const mergedBytes = Buffer.from(stringifyCanonical(mergedDoc, "catalog"), "utf8");
  const uniqueChanged = [...new Set(changed)];
  if (uniqueChanged.length === 0) return { doc: mergedDoc, semantic: false, bytes: mergedBytes };
  // R6: publishedAt never moves backward.
  const publishedAt = [current.publishedAt, ...uniqueChanged.map((key) => publishedAtFor(key))].sort().at(-1);
  const bumped = { ...mergedDoc, catalogVersion: current.catalogVersion + 1, publishedAt };
  return { doc: bumped, semantic: true, bytes: Buffer.from(stringifyCanonical(bumped, "catalog"), "utf8") };
}

/**
 * T1: frozen v2 capacity gates on the tentative catalog — plugin count
 * <= 10,000, release count <= 100 per plugin, canonical body <= 5 MiB.
 * Exported so the boundary is unit-testable even where a valid on-disk
 * source catalog cannot reach it (the body cap binds first at ~6,700
 * plugins given the ~770-byte minimum plugin entry).
 */
export function checkTentativeCapacity(plugins, bytes) {
  if (plugins.length > MAX_PLUGINS) {
    fail(`preflight: tentative catalog would contain ${plugins.length} plugins, exceeding the ${MAX_PLUGINS} limit`);
  }
  for (const plugin of plugins) {
    if (plugin.releases.length > MAX_RELEASES) {
      fail(`preflight: plugin "${plugin.slug}" would contain ${plugin.releases.length} releases, exceeding the ${MAX_RELEASES} limit`);
    }
  }
  if (bytes !== null && bytes.byteLength > MAX_CATALOG_BYTES) {
    fail(`preflight: tentative catalog would be ${bytes.byteLength} bytes, exceeding the ${MAX_CATALOG_BYTES}-byte cap`);
  }
}

/**
 * T1/R3: read-only preflight. Runs the shared identity/version/byte
 * acceptance AND the complete tentative semantic catalog (using
 * deterministic placeholder release metadata) against the CURRENT signed
 * source catalog, then rejects every catalog-known boundary BEFORE
 * sync-releases can POST/upload anything: plugin count <= 10,000, release
 * count <= 100 per plugin, canonical body <= 5 MiB, and every other
 * catalog-schema violation derivable without GitHub timestamps/URLs
 * (validated with validateCatalogBytes on the tentative bytes).
 */
async function mainPreflight(argv) {
  const flags = parseFlags(argv, { strings: ["catalog", "bundle"] });
  const catalogPath = requireFlag(flags, "catalog");
  const bundlePath = requireFlag(flags, "bundle");
  const { catalog, bundle } = loadCatalogAndBundle(catalogPath, bundlePath);
  const revision = bundle.source.revision;
  // R3: explicit identity/version/byte verdicts first (same primitives as
  // ingest) so conflicts fail with their exact pre-merge messages.
  for (const artifact of sortedBundleArtifacts(bundle)) {
    const context = resolvePluginContext(catalog.plugins, artifact);
    if (!context.ok) fail(`preflight: ${context.message}`);
    const verdict = preflightArtifact(context.plugin, artifact);
    if (verdict.status === "error") fail(`preflight: ${verdict.message}`);
  }
  const releasesFor = (artifact) => {
    const context = resolvePluginContext(catalog.plugins, artifact);
    if (!context.ok) fail(`preflight: ${context.message}`);
    return placeholderReleaseMetadata(artifact, catalog, context.plugin);
  };
  const { plugins, changed } = mergeBundleIntoCatalog({ current: catalog, bundle, revision, releasesFor });
  const publishedAtFor = (key) => {
    const [moduleName, version] = key.split("@");
    const artifact = bundle.artifacts.find((a) => a.module === moduleName && a.version === version);
    if (artifact === undefined) fail(`preflight: cannot resolve placeholder metadata for ${key}`);
    return placeholderReleaseMetadata(artifact, catalog, resolvePluginContext(catalog.plugins, artifact).plugin).publishedAt;
  };
  const { semantic, bytes } = tentativeBumpedCatalog(catalog, { plugins }, changed, publishedAtFor);
  if (bytes.byteLength > MAX_CATALOG_BYTES) {
    fail(`preflight: tentative catalog would be ${bytes.byteLength} bytes, exceeding the ${MAX_CATALOG_BYTES}-byte cap`);
  }
  checkTentativeCapacity(plugins, bytes);
  if (semantic) {
    const schemaCheck = validateCatalogBytes(bytes);
    if (!schemaCheck.ok) {
      const detail = schemaCheck.errors.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
      fail(`preflight: tentative catalog failed v2 validation: ${detail}`);
    }
  }
  console.log(`preflight: ${bundle.artifacts.length} artifact(s) acceptable against catalogVersion ${catalog.catalogVersion}; tentative ${bytes.byteLength} bytes, ${plugins.length} plugin(s); nothing written`);
}

// ---------------------------------------------------------------------------
// ingest: deterministic catalog merge with atomic source replacement
// ---------------------------------------------------------------------------

function normalizeReleaseMetadata(releasesFile) {
  const doc = strictJson(readBoundedFile(releasesFile, 16 * 1024 * 1024, "release metadata"), "release metadata");
  const issues = [];
  if (!isPlainObject(doc)) fail("release metadata must be an object");
  checkKeysOnly(doc, ["format", "schemaVersion", "releases"], "release metadata", issues);
  checkRequiredFields(doc, ["format", "schemaVersion", "releases"], "release metadata", issues);
  if (doc.format !== "turboism.market-release.meta") issues.push({ path: "release metadata.format", message: 'must be "turboism.market-release.meta"' });
  if (doc.schemaVersion !== 1) issues.push({ path: "release metadata.schemaVersion", message: "must be 1" });
  if (doc.releases !== undefined) {
    if (!isPlainObject(doc.releases)) {
      issues.push({ path: "release metadata.releases", message: "must be an object" });
    } else {
      for (const [key, meta] of Object.entries(doc.releases)) {
        const prefix = `release metadata.releases.${key}`;
        if (!isPlainObject(meta)) {
          issues.push({ path: prefix, message: "must be an object" });
          continue;
        }
        checkKeysOnly(meta, ["module", "version", "tag", "releaseUrl", "publishedAt", "artifactUrl", "assetName", "sha256", "size"], prefix, issues);
        checkRequiredFields(meta, ["module", "version", "tag", "releaseUrl", "publishedAt", "artifactUrl", "assetName", "sha256", "size"], prefix, issues);
        const moduleName = checkString(meta, "module", prefix, issues, { min: 1, max: 100, re: RE_KEBAB, label: "module" });
        const version = checkString(meta, "version", prefix, issues, { min: 1, max: 64 });
        const tag = checkString(meta, "tag", prefix, issues, { min: 1, max: 200 });
        const assetName = checkString(meta, "assetName", prefix, issues, { min: 5, max: 255 });
        checkDateTime(meta, "publishedAt", prefix, issues);
        checkString(meta, "sha256", prefix, issues, { min: 64, max: 64, re: RE_SHA256 });
        checkInteger(meta, "size", prefix, issues, { min: 1, max: MAX_ARTIFACT_SIZE });
        // T3: every authoritative field must cross-bind into ONE deterministic
        // Provider release — the map key, module, version, tag, asset name and
        // both canonical URLs form a single unforgeable unit.
        if (version !== null && parseStrictVersion(version) === null) {
          issues.push({ path: `${prefix}.version`, message: `"${version}" is not a strict MAJOR.MINOR.PATCH version` });
        }
        if (moduleName !== null && version !== null && key !== `${moduleName}@${version}`) {
          issues.push({ path: `release metadata key "${key}"`, message: `must be exactly "<module>@<version>", got "<${moduleName}>@<${version}>"` });
        }
        if (moduleName !== null && version !== null && tag !== null) {
          const expectedTag = releaseTag(moduleName, version);
          if (tag !== expectedTag) {
            issues.push({ path: `${prefix}.tag`, message: `must be exactly ${expectedTag}` });
          }
        }
        if (moduleName !== null && version !== null && assetName !== null) {
          const expectedAsset = `${moduleName}-${version}.jar`;
          if (assetName !== expectedAsset) {
            issues.push({ path: `${prefix}.assetName`, message: `must be exactly ${expectedAsset}` });
          }
        }
        if (moduleName !== null && version !== null && tag !== null) {
          const expectedReleaseUrl = `https://github.com/turboism/turboism-plugin-directory/releases/tag/${tag}`;
          if (meta.releaseUrl !== expectedReleaseUrl) {
            issues.push({ path: `${prefix}.releaseUrl`, message: `must be exactly ${expectedReleaseUrl}` });
          }
          const expectedArtifactUrl = `https://github.com/turboism/turboism-plugin-directory/releases/download/${tag}/${assetName ?? "?"}`;
          if (meta.artifactUrl !== expectedArtifactUrl) {
            issues.push({ path: `${prefix}.artifactUrl`, message: `must be exactly ${expectedArtifactUrl}` });
          }
        }
      }
    }
  }
  raiseIf(issues, "release metadata");
  return doc.releases;
}

function buildReleaseEntry(artifact, meta, revision) {
  const descriptor = artifact.descriptor;
  return {
    version: descriptor.version,
    channel: artifact.policy.channel,
    status: "active",
    publishedAt: meta.publishedAt,
    category: descriptor.category,
    tags: [...descriptor.tags],
    turboismApi: descriptor.turboismApi,
    requiresCubism: descriptor.environment.requiresCubism,
    cubismVersions: [...artifact.policy.cubismVersions],
    platforms: ["windows-x64"],
    dependencies: descriptor.dependencies.map((dependency) => {
      const entry = {
        id: dependency.id,
        version: dependency.version,
        type: dependency.type ?? "required",
        ordering: dependency.ordering ?? "none",
      };
      if (dependency.reason !== undefined) entry.reason = dependency.reason;
      return entry;
    }),
    permissions: descriptor.permissions.map((permission) => ({
      id: permission.id,
      scope: permission.scope ?? "application",
      reason: permission.reason,
    })),
    releaseUrl: meta.releaseUrl,
    sourceRevision: revision,
    artifact: {
      mediaType: "application/java-archive",
      fileName: artifact.asset,
      url: meta.artifactUrl,
      sha256: artifact.sha256,
      descriptorSha256: artifact.descriptorSha256,
      size: artifact.size,
    },
  };
}

function buildPluginEntry(artifact, release) {
  const descriptor = artifact.descriptor;
  return {
    id: descriptor.id,
    slug: artifact.module,
    name: descriptor.name,
    summary: descriptor.description,
    trust: "official",
    author: descriptor.author,
    license: descriptor.license,
    repository: artifact.policy.repository,
    support: artifact.policy.support,
    localizations: {
      "zh-Hans": { name: artifact.localizations["zh-Hans"].name, summary: artifact.localizations["zh-Hans"].description },
      ja: { name: artifact.localizations.ja.name, summary: artifact.localizations.ja.description },
    },
    releases: [release],
  };
}

async function mainIngest(argv) {
  const flags = parseFlags(argv, { strings: ["catalog", "bundle", "releases", "out"] });
  const catalogPath = requireFlag(flags, "catalog");
  const bundlePath = requireFlag(flags, "bundle");
  const releasesPath = requireFlag(flags, "releases");
  const outPath = flags["out"] ?? catalogPath;

  const sourceBytes = readBoundedFile(catalogPath, 5 * 1024 * 1024, "source catalog");
  const validated = validateCatalogBytes(sourceBytes);
  if (!validated.ok) {
    const detail = validated.errors.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    fail(`source catalog is not a valid v2 catalog: ${detail}`);
  }
  const current = validated.catalog;
  const releases = normalizeReleaseMetadata(releasesPath);
  const bundle = strictJson(readBoundedFile(bundlePath, 16 * 1024 * 1024, "bundle manifest"), "bundle manifest");
  if (!isPlainObject(bundle) || !Array.isArray(bundle.artifacts) || typeof bundle.source?.revision !== "string") {
    fail("bundle manifest is malformed");
  }
  const revision = bundle.source.revision;

  const artifactsByKey = new Map();
  for (const artifact of bundle.artifacts) {
    artifactsByKey.set(`${artifact.module}@${artifact.version}`, artifact);
  }
  const releaseKeys = new Set(Object.keys(releases));
  for (const key of artifactsByKey.keys()) {
    if (!releaseKeys.has(key)) fail(`bundle artifact ${key} has no accepted release metadata`);
  }
  for (const key of releaseKeys) {
    if (!artifactsByKey.has(key)) fail(`release metadata ${key} has no matching bundle artifact`);
  }

  // Shared deterministic merge core — the SAME logic the read-only
  // preflight runs with placeholder metadata.
  const mergedResult = mergeBundleIntoCatalog({
    current,
    bundle,
    revision,
    releasesFor: (artifact) => releases[`${artifact.module}@${artifact.version}`],
  });
  const { semantic, bytes: bumpedBytes } = tentativeBumpedCatalog(
    current,
    mergedResult,
    mergedResult.changed,
    (key) => releases[key].publishedAt,
  );
  if (!semantic) {
    if (!bumpedBytes.equals(sourceBytes)) fail("internal error: no semantic change but bytes differ");
    console.log(`ingest: no semantic change; source catalog left untouched (catalogVersion ${current.catalogVersion})`);
    return;
  }
  const uniqueChanged = [...new Set(mergedResult.changed)];
  if (uniqueChanged.length === 0) fail("internal error: catalog bytes changed but no accepted release was recorded");
  const finalCheck = validateCatalogBytes(bumpedBytes);
  if (!finalCheck.ok) {
    const detail = finalCheck.errors.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    fail(`merged catalog failed v2 validation: ${detail}`);
  }
  writeFileAtomic(outPath, bumpedBytes);
  const finalCatalog = strictJson(bumpedBytes, "merged catalog");
  console.log(
    `ingest: catalogVersion ${current.catalogVersion} -> ${finalCatalog.catalogVersion} (${uniqueChanged.length} accepted release(s), publishedAt ${finalCatalog.publishedAt}); wrote ${outPath}`,
  );
}

// ---------------------------------------------------------------------------
// hydrate: temporary local JAR manifest for EVERY catalog release
// ---------------------------------------------------------------------------

async function mainHydrate(argv) {
  const flags = parseFlags(argv, { strings: ["catalog", "bundle", "dir", "manifest-out", "asset-base"] });
  const catalogPath = requireFlag(flags, "catalog");
  const bundlePath = flags["bundle"] ?? null;
  const dir = requireFlag(flags, "dir");
  const manifestOut = requireFlag(flags, "manifest-out");
  const assetBase = flags["asset-base"] ?? DEFAULT_ASSET_BASE;

  const sourceBytes = readBoundedFile(catalogPath, 5 * 1024 * 1024, "source catalog");
  const validated = validateCatalogBytes(sourceBytes);
  if (!validated.ok) {
    const detail = validated.errors.slice(0, 5).map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    fail(`source catalog is not a valid v2 catalog: ${detail}`);
  }
  const catalog = validated.catalog;
  const bundle = bundlePath === null ? null : strictJson(readBoundedFile(bundlePath, 16 * 1024 * 1024, "bundle manifest"), "bundle manifest");
  if (bundle !== null && (!isPlainObject(bundle) || !Array.isArray(bundle.artifacts))) {
    fail("bundle manifest is malformed");
  }
  const bundleIndex = new Map(); // `${sha256}:${size}` -> artifact
  if (bundle !== null) {
    for (const artifact of bundle.artifacts) {
      if (!isPlainObject(artifact) || typeof artifact.sha256 !== "string" || typeof artifact.size !== "number") {
        fail("bundle manifest artifact is malformed");
      }
      const entry = bundleIndex.get(`${artifact.sha256}:${artifact.size}`);
      if (entry !== undefined && entry.jarPath !== artifact.jarPath) {
        fail("bundle manifest contains two artifacts with identical bytes");
      }
      bundleIndex.set(`${artifact.sha256}:${artifact.size}`, artifact);
    }
  }
  mkdirSync(dir, { recursive: true });
  const manifest = {};
  for (const plugin of catalog.plugins) {
    for (const release of plugin.releases) {
      const key = `${plugin.id}@${release.version}`;
      const artifact = release.artifact;
      if (!isPlainObject(artifact) || typeof artifact.url !== "string" || typeof artifact.sha256 !== "string" || typeof artifact.size !== "number") {
        fail(`catalog release ${key} has a malformed artifact`);
      }
      const target = path.join(dir, `${plugin.slug}-${release.version}.jar`);
      const resolved = path.resolve(target);
      if (!resolved.startsWith(path.resolve(dir) + path.sep)) fail(`hydration target for ${key} escapes the temp dir`);
      const match = bundleIndex.get(`${artifact.sha256}:${artifact.size}`);
      let reused = false;
      if (match !== undefined) {
        // Automated mode may reuse incoming bundle bytes only on an exact
        // SHA-256/size match; a regular-file or symlink problem always fails
        // closed, while plain byte drift falls back to the authoritative
        // Release asset (which is verified against the catalog hash).
        requireFileRegular(match.jarPath, "bundle JAR");
        const localBytes = readFileSync(match.jarPath);
        if (sha256Hex(localBytes) === artifact.sha256 && localBytes.byteLength === artifact.size) {
          copyFileSync(match.jarPath, resolved);
          console.log(`hydrated ${key} from bundle bytes (${localBytes.byteLength} bytes)`);
          reused = true;
        }
      }
      if (!reused) {
        const downloadUrl = downloadTarget(artifact.url, assetBase);
        const bytes = await fetchBounded(downloadUrl, MAX_ARTIFACT_SIZE);
        if (bytes.byteLength !== artifact.size || sha256Hex(bytes) !== artifact.sha256) {
          fail(`downloaded asset for ${key} failed size/SHA-256 verification (${bytes.byteLength} bytes)`);
        }
        writeFileSync(resolved, bytes, { mode: 0o600 });
        console.log(`hydrated ${key} from ${artifact.url} (${bytes.byteLength} bytes)`);
      }
      manifest[key] = resolved;
    }
  }
  writeFileAtomic(manifestOut, Buffer.from(JSON.stringify(manifest), "utf8"));
  console.log(`hydration complete: ${Object.keys(manifest).length} release binding(s) -> ${manifestOut}`);
}

// ---------------------------------------------------------------------------
// CLI dispatch
// ---------------------------------------------------------------------------

const USAGE = `usage: node scripts/catalog-v2/ingest-official-release.mjs <subcommand> [flags]

subcommands:
  verify-run       --run-id <id> --sha <sha> --artifact-name <name> --out <dir>
                   [--api-url <url>] [--poll-interval <sec>] [--poll-timeout <sec>]
                   [--token-env <env>]
  validate-bundle  --sidecar <file> --bundle-dir <dir> --out <file> --expected-revision <sha>
  preflight        --catalog <file> --bundle <file>
  sync-releases    --bundle <file> --out <file> --catalog <file> [--api-url <url>]
                   [--repo <owner/repo>] [--asset-base <url>] [--token-env <env>]
  ingest           --catalog <file> --bundle <file> --releases <file> [--out <file>]
  hydrate          --catalog <file> [--bundle <file>] --dir <dir> --manifest-out <file>
                   [--asset-base <url>]`;

async function main() {
  const [subcommand, ...args] = process.argv.slice(2);
  try {
    switch (subcommand) {
      case "verify-run":
        await mainVerifyRun(args);
        break;
      case "validate-bundle":
        await mainValidateBundle(args);
        break;
      case "preflight":
        await mainPreflight(args);
        break;
      case "sync-releases":
        await mainSyncReleases(args);
        break;
      case "ingest":
        await mainIngest(args);
        break;
      case "hydrate":
        await mainHydrate(args);
        break;
      default:
        console.error(USAGE);
        process.exit(2);
    }
  } catch (error) {
    if (error.usage) {
      console.error(`error: ${error.message}`);
      console.error(USAGE);
      process.exit(2);
    }
    if (error instanceof AggregateError) {
      console.error(`error: ${error.message}`);
    } else {
      console.error(`error: ${error.message}`);
    }
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) await main();
