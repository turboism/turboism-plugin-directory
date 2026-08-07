#!/usr/bin/env node
/**
 * Validate the plugin directory entries before merge.
 * Fails CI when an entry is malformed, duplicated, or missing required fields.
 */
const { plugins } = require("../lib/directory.json");

const REQUIRED_FIELDS = [
  "slug",
  "name",
  "summary",
  "trust",
  "author",
  "license",
  "repository",
  "support",
  "releaseUrl",
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
const seenSlugs = new Set();
const seenRepos = new Set();

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

  if (plugin.trust !== undefined && !VALID_TRUST.has(plugin.trust)) {
    errors.push(`${where}: trust "${plugin.trust}" must be one of ${[...VALID_TRUST].join(", ")}`);
  }

  if (plugin.verification !== undefined && !VALID_VERIFICATION.has(plugin.verification)) {
    errors.push(
      `${where}: verification "${plugin.verification}" must be one of ${[...VALID_VERIFICATION].join(", ")}`,
    );
  }

  if (plugin.repository !== undefined) {
    const normalized = plugin.repository.replace(/\/$/, "");
    if (seenRepos.has(normalized)) {
      errors.push(`${where}: duplicate repository "${normalized}"`);
    }
    seenRepos.add(normalized);
  }

  if (plugin.checksum !== undefined && !/^[0-9a-f]{64}$/i.test(plugin.checksum)) {
    errors.push(`${where}: checksum must be a 64-char hex SHA-256`);
  }

  if (plugin.verifiedRelease !== undefined && !/^\d+\.\d+\.\d+/.test(plugin.verifiedRelease)) {
    errors.push(`${where}: verifiedRelease "${plugin.verifiedRelease}" must be a semver`);
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

console.log(`Plugin directory OK: ${plugins.length} entr${plugins.length === 1 ? "y" : "ies"} validated.`);
