#!/usr/bin/env node
/**
 * Validate the signed Plugin Directory v2 catalog and projected directory entries.
 * Fails CI when the source catalog, deployed generation, or any projected entry is invalid.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateCatalogBytes } from "../lib/catalog-v2/catalog.mjs";
import { loadDirectorySnapshot } from "../lib/directory.ts";

const retiredJson = path.join(process.cwd(), "lib", "directory.json");
const sourceCatalogPath = path.join(process.cwd(), "catalog", "v2", "catalog.json");

const REQUIRED_FIELDS = [
  "id",
  "slug",
  "name",
  "summary",
  "trust",
  "author",
  "license",
  "repository",
  "support",
  "category",
  "latestVersion",
  "channel",
  "releaseUrl",
  "downloadUrl",
  "fileName",
  "sha256",
  "verifiedRelease",
  "verifiedAgainst",
  "verifiedOn",
  "checksum",
  "tags",
  "verification",
];

const VALID_TRUST = new Set(["official", "reviewed-third-party"]);
const VALID_VERIFICATION = new Set(["verified", "pending-current-version", "withdrawn"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const errors = [];

if (existsSync(retiredJson)) {
  errors.push("lib/directory.json must be retired; directory entries are derived from the signed v2 catalog");
}

try {
  const sourceBytes = readFileSync(sourceCatalogPath);
  const sourceCheck = validateCatalogBytes(sourceBytes);
  if (!sourceCheck.ok) {
    for (const issue of sourceCheck.errors) {
      errors.push(`catalog/v2/catalog.json (${issue.path}): ${issue.message}`);
    }
  }
} catch (error) {
  errors.push(`catalog/v2/catalog.json: ${error instanceof Error ? error.message : String(error)}`);
}

let snapshot = null;
try {
  snapshot = loadDirectorySnapshot();
} catch (error) {
  errors.push(`public/api/v2: ${error instanceof Error ? error.message : String(error)}`);
}

const plugins = snapshot?.plugins ?? [];
const seenSlugs = new Set();
const seenIds = new Set();

for (const [index, plugin] of plugins.entries()) {
  const where = `entry[${index}] (${plugin.slug ?? "?"})`;

  for (const field of REQUIRED_FIELDS) {
    const value = plugin[field];
    if (value === undefined || value === null || value === "") {
      errors.push(`${where}: missing required field "${field}"`);
    }
  }

  if (plugin.slug !== undefined) {
    if (!SLUG_PATTERN.test(plugin.slug)) {
      errors.push(`${where}: slug "${plugin.slug}" must be lowercase kebab-case`);
    }
    if (seenSlugs.has(plugin.slug)) {
      errors.push(`${where}: duplicate slug "${plugin.slug}"`);
    }
    seenSlugs.add(plugin.slug);
  }

  if (plugin.id !== undefined) {
    if (seenIds.has(plugin.id)) {
      errors.push(`${where}: duplicate plugin id "${plugin.id}"`);
    }
    seenIds.add(plugin.id);
  }

  if (plugin.trust !== undefined && !VALID_TRUST.has(plugin.trust)) {
    errors.push(`${where}: trust "${plugin.trust}" must be one of ${[...VALID_TRUST].join(", ")}`);
  }

  if (plugin.verification !== undefined && !VALID_VERIFICATION.has(plugin.verification)) {
    errors.push(
      `${where}: verification "${plugin.verification}" must be one of ${[...VALID_VERIFICATION].join(", ")}`,
    );
  }

  if (plugin.checksum !== undefined && !/^[0-9a-f]{64}$/.test(plugin.checksum)) {
    errors.push(`${where}: checksum must be a lowercase 64-char hex SHA-256`);
  }

  if (plugin.sha256 !== plugin.checksum) {
    errors.push(`${where}: sha256 and checksum must match`);
  }

  if (plugin.latestVersion !== undefined && !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(plugin.latestVersion)) {
    errors.push(`${where}: latestVersion "${plugin.latestVersion}" must be a strict MAJOR.MINOR.PATCH version`);
  }

  if (plugin.requiresCubism && (!Array.isArray(plugin.cubismVersions) || plugin.cubismVersions.length === 0)) {
    errors.push(`${where}: cubismVersions must be non-empty when requiresCubism is true`);
  }

  if (!plugin.requiresCubism && Array.isArray(plugin.cubismVersions) && plugin.cubismVersions.length > 0) {
    errors.push(`${where}: cubismVersions must be empty when requiresCubism is false`);
  }

  if (plugin.tags !== undefined) {
    if (!Array.isArray(plugin.tags)) {
      errors.push(`${where}: tags must be an array`);
    } else if (plugin.tags.some((tag) => typeof tag !== "string" || !tag.trim())) {
      errors.push(`${where}: tags must be non-empty strings`);
    }
  }
}

if (errors.length > 0) {
  console.error(`Plugin directory validation failed with ${errors.length} issue(s):`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log(
  `Plugin directory OK: generation ${snapshot.generationId} (catalogVersion ${snapshot.catalogVersion}), ${plugins.length} entr${plugins.length === 1 ? "y" : "ies"} validated.`,
);
