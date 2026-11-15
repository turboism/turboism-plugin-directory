#!/usr/bin/env node
// Scans catalog/v2/submissions/**/*.json, re-verifies any newly merged submission
// manifests against their remote Release JARs, and atomically merges them into
// catalog/v2/catalog.json and catalog/v2/ownership.json.
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  MAX_CATALOG_BYTES,
  compareVersions,
  parseStrictJsonBytes,
  parseStrictVersion,
  stringifyCanonical,
  validateCatalogBytes,
} from "../../lib/catalog-v2/catalog.mjs";
import { downloadGitHubReleaseJar } from "../../lib/submissions/github-client.mjs";
import {
  parseOwnershipRegistry,
  serializeOwnershipRegistry,
} from "../../lib/submissions/ownership.mjs";
import {
  REVIEWED_THIRD_PARTY_TRUST,
  validateSubmissionManifest,
} from "../../lib/submissions/preflight.mjs";
import { ingestSubmissionManifest } from "./ingest-submission.mjs";

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const DEFAULT_SUBMISSIONS_DIR = path.join("catalog", "v2", "submissions");
const DEFAULT_CATALOG_PATH = path.join("catalog", "v2", "catalog.json");
const DEFAULT_OWNERSHIP_PATH = path.join("catalog", "v2", "ownership.json");
const TEMP_SYNC_DIR_PREFIX = "turboism-sync-";

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoundedRegularFile(filePath, maxBytes, label) {
  let lstat;
  try {
    lstat = lstatSync(filePath);
  } catch {
    throw new Error(`${label} "${filePath}" is not readable.`);
  }
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    throw new Error(`${label} "${filePath}" must be a regular non-symlink file.`);
  }
  if (lstat.size > maxBytes) {
    throw new Error(`${label} "${filePath}" exceeds ${maxBytes} bytes.`);
  }
  return readFileSync(filePath);
}

function writeFileAtomic(filePath, bytes) {
  const resolved = path.resolve(filePath);
  const dir = path.dirname(resolved);
  mkdirSync(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(resolved)}.tmp-${process.pid}-${Date.now()}`);
  try {
    const fd = openSync(tempPath, "wx", 0o600);
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tempPath, resolved);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // Ignore cleanup errors on temp file.
    }
    throw error;
  }
}

function collectSubmissionJsonFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  const stat = lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Submissions path "${dir}" must be a regular directory.`);
  }
  const files = [];
  const walk = (currentDir) => {
    const entries = readdirSync(currentDir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Submission path "${fullPath}" must not be a symbolic link.`);
      }
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(fullPath);
      }
    }
  };
  walk(dir);
  return files;
}

function verifyAlreadyIngestedMatch(manifest, existingPlugin, existingRelease, ownership) {
  if (existingPlugin.trust !== REVIEWED_THIRD_PARTY_TRUST) {
    return `plugin "${manifest.plugin.id}" is already cataloged under trust "${existingPlugin.trust}"`;
  }
  if (
    existingRelease.artifact?.sha256 !== manifest.release.artifact.sha256 ||
    existingRelease.artifact?.size !== manifest.release.artifact.size ||
    existingRelease.artifact?.descriptorSha256 !== manifest.release.artifact.descriptorSha256
  ) {
    return `cataloged release ${manifest.plugin.id}@${manifest.release.version} does not match submission artifact hash or size`;
  }
  const claim = ownership.claims?.[manifest.plugin.id];
  if (!claim) {
    return `missing ownership claim for already-cataloged plugin "${manifest.plugin.id}"`;
  }
  if (claim.ownerGithubId !== manifest.submitter.githubId || claim.repoId !== manifest.repository.id) {
    return `ownership claim for "${manifest.plugin.id}" conflicts with submission manifest`;
  }
  return null;
}

/**
 * Scans all submission manifests under submissionsDir, verifies pending releases against their JARs,
 * and produces updated catalog and ownership files with a single catalogVersion increment.
 */
export async function syncMergedSubmissions({
  submissionsDir = DEFAULT_SUBMISSIONS_DIR,
  catalogPath = DEFAULT_CATALOG_PATH,
  ownershipPath = DEFAULT_OWNERSHIP_PATH,
  catalogOut = null,
  ownershipOut = null,
  dryRun = false,
  fetchImpl = fetch,
} = {}) {
  const catalogBytes = readBoundedRegularFile(catalogPath, MAX_CATALOG_BYTES, "catalog");
  const catalogParsed = validateCatalogBytes(catalogBytes);
  if (!catalogParsed.ok) {
    const detail = catalogParsed.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Invalid source catalog: ${detail}`);
  }

  const ownershipBytes = readBoundedRegularFile(ownershipPath, MAX_MANIFEST_BYTES, "ownership registry");
  const ownershipParsed = parseOwnershipRegistry(ownershipBytes);
  if (!ownershipParsed.ok) {
    const detail = ownershipParsed.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Invalid ownership registry: ${detail}`);
  }

  const manifestFiles = collectSubmissionJsonFiles(submissionsDir);
  if (manifestFiles.length === 0) {
    return {
      ingested: [],
      skipped: [],
      catalogVersion: catalogParsed.catalog.catalogVersion,
      changed: false,
    };
  }

  const records = manifestFiles.map((filePath) => {
    const raw = readBoundedRegularFile(filePath, MAX_MANIFEST_BYTES, "submission manifest");
    const parsed = parseStrictJsonBytes(raw);
    if (!parsed.ok || !isPlainObject(parsed.value)) {
      throw new Error(`Invalid JSON in "${filePath}": ${parsed.ok ? "must be an object" : parsed.message}`);
    }
    const validation = validateSubmissionManifest(parsed.value);
    if (!validation.ok) {
      const detail = validation.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
      throw new Error(`Invalid submission manifest "${filePath}": ${detail}`);
    }
    return {
      filePath,
      manifest: parsed.value,
      parsedVersion: parseStrictVersion(parsed.value.release.version),
    };
  });

  records.sort((a, b) => {
    if (a.manifest.plugin.id !== b.manifest.plugin.id) {
      return a.manifest.plugin.id < b.manifest.plugin.id ? -1 : 1;
    }
    if (a.parsedVersion && b.parsedVersion) {
      return compareVersions(a.parsedVersion, b.parsedVersion);
    }
    return a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0;
  });

  const baseCatalogVersion = catalogParsed.catalog.catalogVersion;
  let currentCatalog = catalogParsed.catalog;
  let currentOwnership = ownershipParsed.registry;
  const ingested = [];
  const skipped = [];

  for (const record of records) {
    const { manifest, filePath } = record;
    const pluginId = manifest.plugin.id;
    const version = manifest.release.version;
    const existingPlugin = currentCatalog.plugins.find((item) => item.id === pluginId) ?? null;
    const existingRelease = existingPlugin?.releases?.find((item) => item.version === version) ?? null;

    if (existingPlugin && existingRelease) {
      const mismatch = verifyAlreadyIngestedMatch(manifest, existingPlugin, existingRelease, currentOwnership);
      if (mismatch !== null) {
        throw new Error(`Submission "${filePath}" conflicts with catalog: ${mismatch}`);
      }
      skipped.push({ filePath, pluginId, version });
      continue;
    }

    const tempDir = mkdtempSync(path.join(tmpdir(), TEMP_SYNC_DIR_PREFIX));
    try {
      const jarPath = path.join(tempDir, manifest.release.artifact.fileName);
      await downloadGitHubReleaseJar({
        url: manifest.release.artifact.url,
        expectedSize: manifest.release.artifact.size,
        destPath: jarPath,
        fetchImpl,
      });

      const merged = ingestSubmissionManifest({
        manifest,
        jarPathOrBytes: jarPath,
        catalog: currentCatalog,
        ownership: currentOwnership,
      });
      if (!merged.ok) {
        const detail = merged.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
        throw new Error(`Submission "${filePath}" failed verification: ${detail}`);
      }

      currentCatalog = merged.catalog;
      currentOwnership = merged.ownership;
      ingested.push({ filePath, pluginId, version, isFirstClaim: merged.isFirstClaim });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  if (ingested.length === 0) {
    return {
      ingested,
      skipped,
      catalogVersion: baseCatalogVersion,
      changed: false,
    };
  }

  // Advance catalogVersion by exactly 1 per publish batch to satisfy publish.mjs invariant.
  const finalCatalog = {
    ...currentCatalog,
    catalogVersion: baseCatalogVersion + 1,
  };
  const finalCatalogBytes = Buffer.from(stringifyCanonical(finalCatalog, "catalog"), "utf8");
  const finalCheck = validateCatalogBytes(finalCatalogBytes);
  if (!finalCheck.ok) {
    const detail = finalCheck.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Merged catalog failed final v2 validation: ${detail}`);
  }
  const finalOwnershipText = serializeOwnershipRegistry(currentOwnership);

  if (!dryRun) {
    writeFileAtomic(catalogOut ?? catalogPath, finalCatalogBytes);
    writeFileAtomic(ownershipOut ?? ownershipPath, Buffer.from(finalOwnershipText, "utf8"));
  }

  return {
    ingested,
    skipped,
    catalogVersion: finalCheck.catalog.catalogVersion,
    changed: true,
  };
}

function parseCliArgs(argv) {
  const flags = {
    submissionsDir: DEFAULT_SUBMISSIONS_DIR,
    catalog: DEFAULT_CATALOG_PATH,
    ownership: DEFAULT_OWNERSHIP_PATH,
    catalogOut: null,
    ownershipOut: null,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      flags.dryRun = true;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Flag ${arg} requires a value.`);
    }
    switch (arg) {
      case "--submissions-dir":
        flags.submissionsDir = next;
        i += 1;
        break;
      case "--catalog":
        flags.catalog = next;
        i += 1;
        break;
      case "--ownership":
        flags.ownership = next;
        i += 1;
        break;
      case "--catalog-out":
        flags.catalogOut = next;
        i += 1;
        break;
      case "--ownership-out":
        flags.ownershipOut = next;
        i += 1;
        break;
      default:
        throw new Error(`Unknown CLI flag "${arg}".`);
    }
  }
  return flags;
}

async function main() {
  const flags = parseCliArgs(process.argv.slice(2));
  const result = await syncMergedSubmissions({
    submissionsDir: flags.submissionsDir,
    catalogPath: flags.catalog,
    ownershipPath: flags.ownership,
    catalogOut: flags.catalogOut,
    ownershipOut: flags.ownershipOut,
    dryRun: flags.dryRun,
  });

  if (!result.changed) {
    console.log(
      `sync-merged-submissions: ${result.skipped.length} submission(s) already cataloged; no changes (catalogVersion ${result.catalogVersion}).`,
    );
    return;
  }

  const mode = flags.dryRun ? "[DRY RUN] " : "";
  console.log(
    `${mode}sync-merged-submissions: ingested ${result.ingested.length} submission(s), skipped ${result.skipped.length}; catalogVersion -> ${result.catalogVersion}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
