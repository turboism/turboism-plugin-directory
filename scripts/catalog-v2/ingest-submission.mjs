#!/usr/bin/env node
// Verifies an accepted third-party SubmissionManifest against a local or remote Release JAR
// and atomically merges the entry into catalog/v2/catalog.json and catalog/v2/ownership.json.
import {
  appendFileSync,
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  MAX_ARTIFACT_SIZE,
  MAX_CATALOG_BYTES,
  compareVersions,
  parseStrictJsonBytes,
  parseStrictVersion,
  stringifyCanonical,
  validateCatalogBytes,
  validateParsedCatalog,
} from "../../lib/catalog-v2/catalog.mjs";
import { formatBytecodeAuditMarkdown } from "../../lib/submissions/bytecode-scan.mjs";
import { downloadGitHubReleaseJar } from "../../lib/submissions/github-client.mjs";
import {
  parseOwnershipRegistry,
  serializeOwnershipRegistry,
} from "../../lib/submissions/ownership.mjs";
import {
  REVIEWED_THIRD_PARTY_TRUST,
  runSubmissionPreflight,
  validateSubmissionManifest,
} from "../../lib/submissions/preflight.mjs";

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const DEFAULT_CATALOG_PATH = path.join("catalog", "v2", "catalog.json");
const DEFAULT_OWNERSHIP_PATH = path.join("catalog", "v2", "ownership.json");
const TEMP_JAR_DIR_PREFIX = "turboism-ingest-";

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

function sameCanonicalValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Formats a Markdown audit and verification summary for GitHub Step Summary or local reports.
 * @param {{ manifest: object, catalogVersion: number, isFirstClaim: boolean, dryRun: boolean }} params
 * @returns {string}
 */
export function buildIngestionSummaryMarkdown({ manifest, catalogVersion, isFirstClaim, dryRun }) {
  const modeLabel = dryRun ? "Dry-run validation passed" : "Ingested into source catalog";
  const auditSection = formatBytecodeAuditMarkdown(manifest.bytecodeAudit);
  return [
    `## Submission Verification: \`${manifest.plugin.id}@${manifest.release.version}\``,
    "",
    `- **Status**: ${modeLabel}`,
    `- **Slug**: \`${manifest.plugin.slug}\``,
    `- **Trust Tier**: \`${manifest.plugin.trust}\``,
    `- **Submitter**: @${manifest.submitter.login} (\`${manifest.submitter.githubId}\`)`,
    `- **Repository**: ${manifest.repository.url} (\`${manifest.repository.releaseTag}\` @ \`${manifest.repository.sourceRevision}\`)`,
    `- **Artifact**: ${manifest.release.artifact.url}`,
    `- **Artifact SHA-256**: \`${manifest.release.artifact.sha256}\` (${manifest.release.artifact.size} bytes)`,
    `- **First Ownership Claim**: ${isFirstClaim ? "yes" : "no"}`,
    `- **Next Catalog Version**: \`${catalogVersion}\``,
    "",
    auditSection,
    "",
  ].join("\n");
}

/**
 * Re-verifies a SubmissionManifest against the local JAR bytes and produces updated
 * Catalog v2 and Ownership Registry states without side effects.
 * @param {{ manifest: object, jarPathOrBytes: string | Buffer | Uint8Array, catalog: object, ownership: object }} params
 * @returns {{ ok: true, catalog: object, catalogBytes: Buffer, ownership: object, ownershipText: string, isFirstClaim: boolean } | { ok: false, errors: Array<{ path: string, message: string }> }}
 */
export function ingestSubmissionManifest({ manifest, jarPathOrBytes, catalog, ownership }) {
  const manifestCheck = validateSubmissionManifest(manifest);
  if (!manifestCheck.ok) {
    return { ok: false, errors: manifestCheck.errors };
  }
  const catalogCheck = validateParsedCatalog(catalog);
  if (!catalogCheck.ok) {
    return { ok: false, errors: catalogCheck.errors };
  }
  const ownershipCheck = parseOwnershipRegistry(ownership);
  if (!ownershipCheck.ok) {
    return { ok: false, errors: ownershipCheck.errors };
  }

  const currentCatalog = catalogCheck.catalog;
  const currentOwnership = ownershipCheck.registry;
  const expectedPlugin = manifest.plugin;
  const expectedRelease = manifest.release;

  const preflight = runSubmissionPreflight({
    jarPathOrBytes,
    slug: expectedPlugin.slug,
    assetFileName: expectedRelease.artifact.fileName,
    artifactUrl: expectedRelease.artifact.url,
    releaseUrl: expectedRelease.releaseUrl,
    channel: expectedRelease.channel,
    publishedAt: expectedRelease.publishedAt,
    sourceRevision: manifest.repository.sourceRevision,
    submitter: manifest.submitter,
    repository: {
      id: manifest.repository.id,
      url: manifest.repository.url,
      fullName: manifest.repository.fullName,
      defaultBranch: manifest.repository.defaultBranch,
      releaseTag: manifest.repository.releaseTag,
    },
    catalog: currentCatalog,
    ownership: currentOwnership,
    repoReadmes: manifest.readmes,
    submittedAt: manifest.submittedAt,
  });

  if (!preflight.ok) {
    return { ok: false, errors: preflight.errors };
  }

  const verifiedPlugin = preflight.manifest.plugin;
  const verifiedRelease = preflight.manifest.release;
  const issues = [];

  if (verifiedRelease.artifact.size !== expectedRelease.artifact.size) {
    issues.push({
      path: "artifact.size",
      message: `JAR size ${verifiedRelease.artifact.size} does not match manifest ${expectedRelease.artifact.size}`,
    });
  }
  if (verifiedRelease.artifact.sha256 !== expectedRelease.artifact.sha256) {
    issues.push({
      path: "artifact.sha256",
      message: `JAR sha256 ${verifiedRelease.artifact.sha256} does not match manifest ${expectedRelease.artifact.sha256}`,
    });
  }
  if (verifiedRelease.artifact.descriptorSha256 !== expectedRelease.artifact.descriptorSha256) {
    issues.push({
      path: "artifact.descriptorSha256",
      message: `descriptorSha256 ${verifiedRelease.artifact.descriptorSha256} does not match manifest ${expectedRelease.artifact.descriptorSha256}`,
    });
  }
  if (!sameCanonicalValue(verifiedPlugin, expectedPlugin)) {
    issues.push({
      path: "plugin",
      message: "JAR preflight metadata no longer matches the approved SubmissionManifest",
    });
  }
  if (issues.length > 0) {
    return { ok: false, errors: issues };
  }

  const nextPlugins = structuredClone(currentCatalog.plugins);
  const existingIndex = nextPlugins.findIndex((item) => item.id === verifiedPlugin.id);
  if (existingIndex === -1) {
    nextPlugins.push(structuredClone(verifiedPlugin));
  } else {
    const existing = nextPlugins[existingIndex];
    if (existing.trust !== REVIEWED_THIRD_PARTY_TRUST) {
      return {
        ok: false,
        errors: [{ path: "plugin.trust", message: "cannot merge third-party submission into an official plugin entry" }],
      };
    }
    const updatedReleases = [...existing.releases, structuredClone(verifiedRelease)].sort((a, b) =>
      compareVersions(parseStrictVersion(a.version), parseStrictVersion(b.version)),
    );
    nextPlugins[existingIndex] = {
      id: existing.id,
      slug: existing.slug,
      name: verifiedPlugin.name,
      summary: verifiedPlugin.summary,
      trust: REVIEWED_THIRD_PARTY_TRUST,
      author: verifiedPlugin.author,
      license: verifiedPlugin.license,
      repository: verifiedPlugin.repository,
      support: verifiedPlugin.support,
      localizations: structuredClone(verifiedPlugin.localizations),
      releases: updatedReleases,
    };
  }

  const nextPublishedAt =
    currentCatalog.publishedAt >= verifiedRelease.publishedAt
      ? currentCatalog.publishedAt
      : verifiedRelease.publishedAt;

  const nextCatalog = {
    format: currentCatalog.format,
    schemaVersion: currentCatalog.schemaVersion,
    catalogVersion: currentCatalog.catalogVersion + 1,
    publishedAt: nextPublishedAt,
    plugins: nextPlugins,
  };

  const canonicalCatalogText = stringifyCanonical(nextCatalog, "catalog");
  const catalogBytes = Buffer.from(canonicalCatalogText, "utf8");
  const finalCatalogCheck = validateCatalogBytes(catalogBytes);
  if (!finalCatalogCheck.ok) {
    return { ok: false, errors: finalCatalogCheck.errors };
  }

  const nextOwnership = structuredClone(currentOwnership);
  const existingClaim = nextOwnership.claims[verifiedPlugin.id];
  const isFirstClaim = existingClaim === undefined;
  nextOwnership.claims[verifiedPlugin.id] = {
    slug: verifiedPlugin.slug,
    ownerGithubId: manifest.submitter.githubId,
    ownerLogin: manifest.submitter.login,
    repoId: manifest.repository.id,
    repository: manifest.repository.url,
    claimedAt: isFirstClaim ? manifest.submittedAt : existingClaim.claimedAt,
  };
  const ownershipText = serializeOwnershipRegistry(nextOwnership);

  return {
    ok: true,
    catalog: finalCatalogCheck.catalog,
    catalogBytes,
    ownership: nextOwnership,
    ownershipText,
    isFirstClaim,
  };
}

/**
 * Loads a submission manifest file, resolves the JAR locally or via bounded remote download,
 * verifies and merges it, and optionally writes updated catalog/ownership/summary files.
 */
export async function runIngestSubmission({
  manifestPath,
  jarPath = null,
  catalogPath = DEFAULT_CATALOG_PATH,
  ownershipPath = DEFAULT_OWNERSHIP_PATH,
  catalogOut = null,
  ownershipOut = null,
  summaryOut = null,
  dryRun = false,
  fetchImpl = fetch,
}) {
  const manifestBytes = readBoundedRegularFile(manifestPath, MAX_MANIFEST_BYTES, "submission manifest");
  const manifestParsed = parseStrictJsonBytes(manifestBytes);
  if (!manifestParsed.ok || !isPlainObject(manifestParsed.value)) {
    throw new Error(`Invalid submission manifest JSON: ${manifestParsed.ok ? "must be an object" : manifestParsed.message}`);
  }
  const manifest = manifestParsed.value;
  const manifestValidation = validateSubmissionManifest(manifest);
  if (!manifestValidation.ok) {
    const detail = manifestValidation.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Invalid submission manifest structure: ${detail}`);
  }

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

  let tempDir = null;
  let resolvedJarPath = jarPath;
  try {
    if (resolvedJarPath) {
      readBoundedRegularFile(resolvedJarPath, MAX_ARTIFACT_SIZE, "release JAR");
    } else {
      tempDir = mkdtempSync(path.join(tmpdir(), TEMP_JAR_DIR_PREFIX));
      resolvedJarPath = path.join(tempDir, manifest.release.artifact.fileName);
      await downloadGitHubReleaseJar({
        url: manifest.release.artifact.url,
        expectedSize: manifest.release.artifact.size,
        destPath: resolvedJarPath,
        fetchImpl,
      });
    }

    const result = ingestSubmissionManifest({
      manifest,
      jarPathOrBytes: resolvedJarPath,
      catalog: catalogParsed.catalog,
      ownership: ownershipParsed.registry,
    });

    if (!result.ok) {
      const detail = result.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
      throw new Error(`Submission ingestion rejected: ${detail}`);
    }

    const summaryMarkdown = buildIngestionSummaryMarkdown({
      manifest,
      catalogVersion: result.catalog.catalogVersion,
      isFirstClaim: result.isFirstClaim,
      dryRun,
    });
    if (summaryOut) {
      mkdirSync(path.dirname(path.resolve(summaryOut)), { recursive: true });
      appendFileSync(summaryOut, `${summaryMarkdown}\n`, "utf8");
    }

    if (!dryRun) {
      const targetCatalogOut = catalogOut ?? catalogPath;
      const targetOwnershipOut = ownershipOut ?? ownershipPath;
      writeFileAtomic(targetCatalogOut, result.catalogBytes);
      writeFileAtomic(targetOwnershipOut, Buffer.from(result.ownershipText, "utf8"));
    }

    return {
      ...result,
      manifest,
      dryRun,
      summaryMarkdown,
    };
  } finally {
    if (tempDir !== null) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function parseCliArgs(argv) {
  const flags = {
    manifest: null,
    jar: null,
    catalog: DEFAULT_CATALOG_PATH,
    ownership: DEFAULT_OWNERSHIP_PATH,
    catalogOut: null,
    ownershipOut: null,
    summaryOut: process.env.GITHUB_STEP_SUMMARY || null,
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
      case "--manifest":
        flags.manifest = next;
        i += 1;
        break;
      case "--jar":
        flags.jar = next;
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
      case "--summary-out":
        flags.summaryOut = next;
        i += 1;
        break;
      default:
        throw new Error(`Unknown CLI flag "${arg}".`);
    }
  }
  if (!flags.manifest) {
    throw new Error(
      "Usage: node scripts/catalog-v2/ingest-submission.mjs --manifest <submission.json> [--jar <plugin.jar>] [--catalog <catalog.json>] [--ownership <ownership.json>] [--catalog-out <path>] [--ownership-out <path>] [--summary-out <path>] [--dry-run]",
    );
  }
  return flags;
}

async function main() {
  const flags = parseCliArgs(process.argv.slice(2));
  const result = await runIngestSubmission({
    manifestPath: flags.manifest,
    jarPath: flags.jar,
    catalogPath: flags.catalog,
    ownershipPath: flags.ownership,
    catalogOut: flags.catalogOut,
    ownershipOut: flags.ownershipOut,
    summaryOut: flags.summaryOut,
    dryRun: flags.dryRun,
  });

  if (flags.dryRun) {
    console.log(
      `[DRY RUN] Verified ${result.manifest.plugin.id}@${result.manifest.release.version}; catalogVersion -> ${result.catalog.catalogVersion}; firstClaim=${result.isFirstClaim}`,
    );
    return;
  }

  console.log(
    `Ingested ${result.manifest.plugin.id}@${result.manifest.release.version} (catalogVersion ${result.catalog.catalogVersion}, firstClaim=${result.isFirstClaim}).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
