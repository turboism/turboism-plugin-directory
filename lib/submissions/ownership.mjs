// Third-party plugin ownership registry validation, namespace anti-hijack guards,
// and least-privilege repository publisher verification.
import { parseStrictJson, parseStrictJsonBytes } from "../catalog-v2/catalog.mjs";

export const OWNERSHIP_FORMAT = "turboism.plugin.ownership";
export const OWNERSHIP_SCHEMA_VERSION = 1;
export const PUBLISHERS_MANIFEST_PATH = ".github/turboism-publishers.json";

export const RESERVED_CORE_PLUGIN_ID = "dev.turboism.core";
export const RESERVED_TURBOISM_NAMESPACE_PREFIX = "dev.turboism.";
export const RETIRED_CLIENT_PLUGIN_IDS = Object.freeze([
  "dev.turboism.plugin.backup",
  "dev.turboism.plugin.clipmask",
  "dev.turboism.plugin.logfilter",
  "dev.turboism.plugin.perfopt",
  "dev.turboism.plugin.renderopt",
]);
export const RESERVED_ROUTE_SLUGS = Object.freeze([
  "submit",
  "dashboard",
  "api",
  "admin",
  "auth",
  "login",
  "logout",
  "not-found",
  "sitemap.xml",
  "robots.txt",
]);

const MAX_OWNERSHIP_BYTES = 2 * 1024 * 1024;
const MAX_PLUGIN_ID_LENGTH = 128;
const MAX_SLUG_LENGTH = 100;
const MAX_LOGIN_LENGTH = 100;
const MAX_CLAIMS = 10000;
const MAX_PUBLISHERS_BYTES = 64 * 1024;
const MAX_PUBLISHERS_ENTRIES = 100;

const GITHUB_OWNER_TYPE_USER = "User";
const GITHUB_OWNER_TYPE_ORG = "Organization";
const OFFICIAL_TRUST = "official";

const ROOT_KEYS = Object.freeze(["format", "schemaVersion", "claims"]);
const CLAIM_KEYS = Object.freeze([
  "slug",
  "ownerGithubId",
  "ownerLogin",
  "repoId",
  "repository",
  "claimedAt",
]);
const PUBLISHERS_ROOT_KEYS = Object.freeze(["publishers"]);

const RE_PLUGIN_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const RE_GITHUB_REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const RE_UTC_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInt(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidUtcDateTime(value) {
  if (typeof value !== "string" || !RE_UTC_DATE_TIME.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return false;
  return new Date(timestamp).toISOString().slice(0, 19) + "Z" === value;
}

/**
 * Checks whether a plugin id falls under a reserved or retired first-party namespace.
 * @param {string} pluginId
 * @returns {boolean}
 */
export function isReservedOrRetiredPluginId(pluginId) {
  if (typeof pluginId !== "string") return false;
  if (pluginId === RESERVED_CORE_PLUGIN_ID) return true;
  if (pluginId.startsWith(RESERVED_TURBOISM_NAMESPACE_PREFIX)) return true;
  return RETIRED_CLIENT_PLUGIN_IDS.includes(pluginId);
}

/**
 * Normalizes and validates an HTTPS GitHub repository URL (`https://github.com/<owner>/<repo>`).
 * @param {unknown} rawUrl
 * @returns {string | null}
 */
export function normalizeGitHubRepositoryUrl(rawUrl) {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  const match = RE_GITHUB_REPO_URL.exec(trimmed);
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    return null;
  }
  return trimmed;
}

function checkClosedKeys(obj, allowedKeys, path, issues) {
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.includes(key)) {
      issues.push({ path, message: `unknown field "${key}"` });
    }
  }
}

function validateClaimObject(pluginId, claim, issues) {
  const path = `claims.${pluginId}`;
  if (!RE_PLUGIN_ID.test(pluginId) || pluginId.length > MAX_PLUGIN_ID_LENGTH) {
    issues.push({ path, message: "claim key must be a valid reverse-domain plugin id" });
  } else if (isReservedOrRetiredPluginId(pluginId)) {
    issues.push({ path, message: "claim key must not target a reserved or retired plugin id" });
  }
  if (!isPlainObject(claim)) {
    issues.push({ path, message: "claim entry must be an object" });
    return;
  }
  checkClosedKeys(claim, CLAIM_KEYS, path, issues);
  for (const requiredKey of CLAIM_KEYS) {
    if (!(requiredKey in claim)) {
      issues.push({ path, message: `missing required field "${requiredKey}"` });
    }
  }
  if (typeof claim.slug !== "string" || claim.slug.length === 0 || claim.slug.length > MAX_SLUG_LENGTH || !RE_SLUG.test(claim.slug)) {
    issues.push({ path: `${path}.slug`, message: "slug must be lowercase kebab-case" });
  }
  if (!isPositiveSafeInt(claim.ownerGithubId)) {
    issues.push({ path: `${path}.ownerGithubId`, message: "ownerGithubId must be a positive safe integer" });
  }
  if (
    typeof claim.ownerLogin !== "string" ||
    claim.ownerLogin.length === 0 ||
    claim.ownerLogin.length > MAX_LOGIN_LENGTH ||
    !RE_GITHUB_LOGIN.test(claim.ownerLogin)
  ) {
    issues.push({ path: `${path}.ownerLogin`, message: "ownerLogin must be a valid GitHub login" });
  }
  if (!isPositiveSafeInt(claim.repoId)) {
    issues.push({ path: `${path}.repoId`, message: "repoId must be a positive safe integer" });
  }
  if (normalizeGitHubRepositoryUrl(claim.repository) === null) {
    issues.push({ path: `${path}.repository`, message: "repository must be an https://github.com/<owner>/<repo> URL" });
  }
  if (!isValidUtcDateTime(claim.claimedAt)) {
    issues.push({ path: `${path}.claimedAt`, message: "claimedAt must be a UTC ISO-8601 second timestamp" });
  }
}

/**
 * Parses and strictly validates the ownership sidecar (`catalog/v2/ownership.json`).
 * Rejects duplicate JSON keys, unknown fields, non-positive numeric ids, and slug collisions.
 * @param {Buffer | Uint8Array | string | object} input
 * @returns {{ ok: true, registry: { format: "turboism.plugin.ownership", schemaVersion: 1, claims: Record<string, object> } } | { ok: false, errors: Array<{ path: string, message: string }> }}
 */
export function parseOwnershipRegistry(input) {
  let value;
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    if (input.byteLength > MAX_OWNERSHIP_BYTES) {
      return { ok: false, errors: [{ path: "ownership", message: `ownership registry exceeds ${MAX_OWNERSHIP_BYTES} bytes` }] };
    }
    const parsed = parseStrictJsonBytes(input);
    if (!parsed.ok) {
      return { ok: false, errors: [{ path: "ownership", message: parsed.message }] };
    }
    value = parsed.value;
  } else if (typeof input === "string") {
    if (Buffer.byteLength(input, "utf8") > MAX_OWNERSHIP_BYTES) {
      return { ok: false, errors: [{ path: "ownership", message: `ownership registry exceeds ${MAX_OWNERSHIP_BYTES} bytes` }] };
    }
    try {
      value = parseStrictJson(input);
    } catch (error) {
      return { ok: false, errors: [{ path: "ownership", message: error instanceof Error ? error.message : String(error) }] };
    }
  } else {
    value = input;
  }

  if (!isPlainObject(value)) {
    return { ok: false, errors: [{ path: "ownership", message: "ownership registry must be an object" }] };
  }

  const issues = [];
  checkClosedKeys(value, ROOT_KEYS, "ownership", issues);
  for (const requiredKey of ROOT_KEYS) {
    if (!(requiredKey in value)) {
      issues.push({ path: "ownership", message: `missing required field "${requiredKey}"` });
    }
  }
  if (value.format !== undefined && value.format !== OWNERSHIP_FORMAT) {
    issues.push({ path: "ownership.format", message: `format must be "${OWNERSHIP_FORMAT}"` });
  }
  if (value.schemaVersion !== undefined && value.schemaVersion !== OWNERSHIP_SCHEMA_VERSION) {
    issues.push({ path: "ownership.schemaVersion", message: `schemaVersion must be ${OWNERSHIP_SCHEMA_VERSION}` });
  }
  if (value.claims !== undefined && !isPlainObject(value.claims)) {
    issues.push({ path: "ownership.claims", message: "claims must be an object" });
  }
  if (issues.length > 0) {
    return { ok: false, errors: issues };
  }

  const claimEntries = Object.entries(value.claims);
  if (claimEntries.length > MAX_CLAIMS) {
    issues.push({ path: "ownership.claims", message: `claims must contain at most ${MAX_CLAIMS} entries` });
    return { ok: false, errors: issues };
  }

  const seenSlugs = new Map();
  for (const [pluginId, claim] of claimEntries) {
    validateClaimObject(pluginId, claim, issues);
    if (isPlainObject(claim) && typeof claim.slug === "string") {
      const existingPluginId = seenSlugs.get(claim.slug);
      if (existingPluginId !== undefined) {
        issues.push({
          path: `claims.${pluginId}.slug`,
          message: `slug "${claim.slug}" is already claimed by "${existingPluginId}"`,
        });
      } else {
        seenSlugs.set(claim.slug, pluginId);
      }
    }
  }

  return issues.length > 0 ? { ok: false, errors: issues } : { ok: true, registry: value };
}

/**
 * Validates and serializes an ownership registry with deterministic key ordering.
 * @param {object} registry
 * @returns {string}
 */
export function serializeOwnershipRegistry(registry) {
  const validated = parseOwnershipRegistry(registry);
  if (!validated.ok) {
    const detail = validated.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    throw new Error(`Invalid ownership registry: ${detail}`);
  }
  const sortedClaims = {};
  const sortedIds = Object.keys(validated.registry.claims).sort();
  for (const pluginId of sortedIds) {
    const claim = validated.registry.claims[pluginId];
    sortedClaims[pluginId] = {
      slug: claim.slug,
      ownerGithubId: claim.ownerGithubId,
      ownerLogin: claim.ownerLogin,
      repoId: claim.repoId,
      repository: claim.repository,
      claimedAt: claim.claimedAt,
    };
  }
  const canonical = {
    format: OWNERSHIP_FORMAT,
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    claims: sortedClaims,
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

/**
 * Enforces third-party namespace boundaries, anti-hijack rules, and numeric owner/repo locks.
 * @param {{ pluginId: string, slug: string, submitterGithubId: number, repoId: number, repositoryUrl: string, catalog: { plugins: Array<object> }, ownership: { claims: Record<string, object> } }} params
 * @returns {{ ok: true, isFirstClaim: boolean, existingClaim: object | null } | { ok: false, errors: Array<{ path: string, message: string }> }}
 */
export function validatePluginNamespaceAndOwnership({
  pluginId,
  slug,
  submitterGithubId,
  repoId,
  repositoryUrl,
  catalog,
  ownership,
}) {
  const issues = [];

  if (typeof pluginId !== "string" || pluginId.length === 0 || pluginId.length > MAX_PLUGIN_ID_LENGTH || !RE_PLUGIN_ID.test(pluginId)) {
    issues.push({ path: "pluginId", message: "pluginId must be a lowercase reverse-domain identifier" });
  } else if (isReservedOrRetiredPluginId(pluginId)) {
    issues.push({ path: "pluginId", message: `pluginId "${pluginId}" belongs to a reserved or retired namespace` });
  }

  if (typeof slug !== "string" || slug.length === 0 || slug.length > MAX_SLUG_LENGTH || !RE_SLUG.test(slug)) {
    issues.push({ path: "slug", message: "slug must be lowercase kebab-case" });
  } else if (RESERVED_ROUTE_SLUGS.includes(slug)) {
    issues.push({ path: "slug", message: `slug "${slug}" is reserved for directory routes` });
  }

  if (!isPositiveSafeInt(submitterGithubId)) {
    issues.push({ path: "submitterGithubId", message: "submitterGithubId must be a positive safe integer" });
  }
  if (!isPositiveSafeInt(repoId)) {
    issues.push({ path: "repoId", message: "repoId must be a positive safe integer" });
  }
  if (normalizeGitHubRepositoryUrl(repositoryUrl) === null) {
    issues.push({ path: "repositoryUrl", message: "repositoryUrl must be an https://github.com/<owner>/<repo> URL" });
  }

  if (!isPlainObject(catalog) || !Array.isArray(catalog.plugins)) {
    issues.push({ path: "catalog", message: "catalog must contain a plugins array" });
  }
  const ownershipCheck = parseOwnershipRegistry(ownership);
  if (!ownershipCheck.ok) {
    issues.push(...ownershipCheck.errors);
  }

  if (issues.length > 0) {
    return { ok: false, errors: issues };
  }

  for (const existingPlugin of catalog.plugins) {
    if (!isPlainObject(existingPlugin)) continue;
    const sameId = existingPlugin.id === pluginId;
    const sameSlug = existingPlugin.slug === slug;
    if (!sameId && !sameSlug) continue;
    if (existingPlugin.trust === OFFICIAL_TRUST) {
      issues.push({
        path: sameId ? "pluginId" : "slug",
        message: `official catalog entry "${existingPlugin.id}" (${existingPlugin.slug}) cannot be claimed by third-party submissions`,
      });
      continue;
    }
    if (sameId && !sameSlug) {
      issues.push({
        path: "slug",
        message: `pluginId "${pluginId}" is already cataloged under slug "${existingPlugin.slug}"`,
      });
    }
    if (sameSlug && !sameId) {
      issues.push({
        path: "pluginId",
        message: `slug "${slug}" is already cataloged under pluginId "${existingPlugin.id}"`,
      });
    }
  }

  const claims = ownershipCheck.registry.claims;
  const claimById = Object.prototype.hasOwnProperty.call(claims, pluginId) ? claims[pluginId] : null;
  let claimBySlugId = null;
  for (const [claimedPluginId, claim] of Object.entries(claims)) {
    if (claim.slug === slug) {
      claimBySlugId = claimedPluginId;
      break;
    }
  }

  if (claimBySlugId !== null && claimBySlugId !== pluginId) {
    issues.push({
      path: "slug",
      message: `slug "${slug}" is already claimed by plugin "${claimBySlugId}"`,
    });
  }
  if (claimById !== null && claimById.slug !== slug) {
    issues.push({
      path: "slug",
      message: `plugin "${pluginId}" is already claimed under slug "${claimById.slug}"`,
    });
  }

  const authoritativeClaim = claimById ?? (claimBySlugId !== null ? claims[claimBySlugId] : null);
  if (authoritativeClaim !== null) {
    if (authoritativeClaim.ownerGithubId !== submitterGithubId) {
      issues.push({
        path: "submitterGithubId",
        message: `plugin "${pluginId}" is claimed by GitHub user id ${authoritativeClaim.ownerGithubId}`,
      });
    }
    if (authoritativeClaim.repoId !== repoId) {
      issues.push({
        path: "repoId",
        message: `plugin "${pluginId}" is locked to repository id ${authoritativeClaim.repoId}`,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, errors: issues };
  }

  return {
    ok: true,
    isFirstClaim: claimById === null,
    existingClaim: claimById,
  };
}

function parsePublishersManifest(content) {
  let rawBytes;
  if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
    if (content.byteLength > MAX_PUBLISHERS_BYTES) {
      return { ok: false, error: `${PUBLISHERS_MANIFEST_PATH} exceeds ${MAX_PUBLISHERS_BYTES} bytes` };
    }
    const parsed = parseStrictJsonBytes(content);
    if (!parsed.ok) return { ok: false, error: `${PUBLISHERS_MANIFEST_PATH}: ${parsed.message}` };
    rawBytes = parsed.value;
  } else if (typeof content === "string") {
    if (Buffer.byteLength(content, "utf8") > MAX_PUBLISHERS_BYTES) {
      return { ok: false, error: `${PUBLISHERS_MANIFEST_PATH} exceeds ${MAX_PUBLISHERS_BYTES} bytes` };
    }
    try {
      rawBytes = parseStrictJson(content);
    } catch (error) {
      return {
        ok: false,
        error: `${PUBLISHERS_MANIFEST_PATH} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } else {
    return { ok: false, error: `${PUBLISHERS_MANIFEST_PATH} content must be a string or Buffer` };
  }

  if (!isPlainObject(rawBytes)) {
    return { ok: false, error: `${PUBLISHERS_MANIFEST_PATH} must be a JSON object` };
  }
  for (const key of Object.keys(rawBytes)) {
    if (!PUBLISHERS_ROOT_KEYS.includes(key)) {
      return { ok: false, error: `${PUBLISHERS_MANIFEST_PATH} contains unknown field "${key}"` };
    }
  }
  if (!Array.isArray(rawBytes.publishers) || rawBytes.publishers.length === 0) {
    return { ok: false, error: `${PUBLISHERS_MANIFEST_PATH} must define a non-empty publishers array` };
  }
  if (rawBytes.publishers.length > MAX_PUBLISHERS_ENTRIES) {
    return { ok: false, error: `${PUBLISHERS_MANIFEST_PATH} exceeds ${MAX_PUBLISHERS_ENTRIES} entries` };
  }
  for (const entry of rawBytes.publishers) {
    if (isPositiveSafeInt(entry)) continue;
    if (typeof entry === "string" && entry.length > 0 && entry.length <= MAX_LOGIN_LENGTH && RE_GITHUB_LOGIN.test(entry)) {
      continue;
    }
    return { ok: false, error: `${PUBLISHERS_MANIFEST_PATH} entries must be positive user ids or valid GitHub logins` };
  }
  return { ok: true, publishers: rawBytes.publishers };
}

/**
 * Verifies that the authenticated submitter holds publishing authority over a public, active repository.
 * @param {{ submitter: { githubId: number, login: string }, repo: { private?: boolean, archived?: boolean, disabled?: boolean, owner?: { id?: number, type?: string } }, isPublicOrgMember?: boolean, publishersFileContent?: string | Buffer | Uint8Array | null }} params
 * @returns {{ ok: true, reason: "repo_owner" | "org_public_member" | "publishers_manifest" } | { ok: false, error: string }}
 */
export function verifyRepositoryPublisher({
  submitter,
  repo,
  isPublicOrgMember = false,
  publishersFileContent = null,
}) {
  if (!submitter || !isPositiveSafeInt(submitter.githubId) || typeof submitter.login !== "string" || submitter.login.length === 0) {
    return { ok: false, error: "Submitter identity must include a positive integer githubId and login." };
  }
  if (!isPlainObject(repo) || !isPlainObject(repo.owner)) {
    return { ok: false, error: "Repository metadata must include an owner object." };
  }
  if (repo.private !== false) {
    return { ok: false, error: "Private repositories are not eligible for directory submission." };
  }
  if (repo.archived === true) {
    return { ok: false, error: "Archived repositories are not eligible for directory submission." };
  }
  if (repo.disabled === true) {
    return { ok: false, error: "Disabled repositories are not eligible for directory submission." };
  }

  if (repo.owner.type === GITHUB_OWNER_TYPE_USER && repo.owner.id === submitter.githubId) {
    return { ok: true, reason: "repo_owner" };
  }
  if (repo.owner.type === GITHUB_OWNER_TYPE_ORG && isPublicOrgMember === true) {
    return { ok: true, reason: "org_public_member" };
  }

  if (publishersFileContent !== null && publishersFileContent !== undefined) {
    const manifest = parsePublishersManifest(publishersFileContent);
    if (!manifest.ok) {
      return { ok: false, error: manifest.error };
    }
    const normalizedLogin = submitter.login.toLowerCase();
    const matched = manifest.publishers.some((entry) => {
      if (typeof entry === "number") return entry === submitter.githubId;
      return entry.toLowerCase() === normalizedLogin;
    });
    if (matched) {
      return { ok: true, reason: "publishers_manifest" };
    }
  }

  return {
    ok: false,
    error: `Submitter "${submitter.login}" (${submitter.githubId}) is not authorized to publish releases from this repository.`,
  };
}
