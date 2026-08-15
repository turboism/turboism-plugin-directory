// Turboism Plugin Directory v2 shared core: strict catalog validation, canonical
// deterministic encoding, Ed25519 sign/verify, discovery query engine, and
// bounded schema-v3 JAR descriptor inspection. Plain ESM with JSDoc types so the
// App Router routes, the offline CLI tools, and the node:test suite use exactly
// one implementation. No third-party dependencies.
//
// Contract: docs/plugin-directory-api-v2.md (frozen) and
// docs/openapi/plugin-directory-v2.openapi.json.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as ed25519Sign,
  verify as ed25519Verify,
  timingSafeEqual,
} from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const CATALOG_FORMAT = "turboism.plugin.catalog";
export const SIGNATURE_FORMAT = "turboism.plugin.catalog.signature";
export const SEARCH_FORMAT = "turboism.plugin.search";
export const SCHEMA_VERSION = 2;
export const ED25519_ALGORITHM = "Ed25519";

export const MAX_CATALOG_BYTES = 5 * 1024 * 1024; // 5 MiB
export const MAX_SIGNATURE_BYTES = 16 * 1024; // 16 KiB
export const MAX_PLUGINS = 10000;
export const MAX_RELEASES = 100;
export const MAX_TAGS = 12;
export const MAX_DEPENDENCIES = 100;
export const MAX_PERMISSIONS = 100;
export const MAX_CUBISM_VERSIONS = 100;
export const MAX_ARTIFACT_SIZE = 16 * 1024 * 1024; // 16 MiB
export const MAX_Q_LENGTH = 200;
export const MAX_PAGE_SIZE = 100;
export const MAX_JAR_ENTRIES = 65536;
export const MAX_DESCRIPTOR_BYTES = 1024 * 1024; // 1 MiB uncompressed descriptor cap
export const MAX_TRUSTED_KEYS_FILE_BYTES = 64 * 1024; // 64 KiB manifest cap
export const MAX_TRUSTED_KEYS = 16; // at most 16 keys in the allowlist

export const MIN_TOKEN_LENGTH = 2;
export const MAX_TOKEN_LENGTH = 32;

// Reviewed runtime category registry at publication time (contract 5.2).
export const OFFICIAL_CATEGORIES = [
  "modeling",
  "workflow",
  "appearance",
  "analysis",
  "performance",
  "integration",
  "system",
  "development",
];

const RE_STRICT_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const RE_HALF_OPEN_RANGE = /^\[(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*),(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\)$/;
const RE_HOST_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const RE_KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_KEY_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_PLUGIN_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_SHA256 = /^[0-9a-f]{64}$/;
const RE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.jar$/;
const RE_SOURCE_REVISION = /^[0-9a-f]{40}$/;
// Exact immutable artifact URL shape: https://github.com/<owner>/<repo>/releases/download/<tag>/<fileName>
const RE_ARTIFACT_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/releases\/download\/[^/?#]+\/([A-Za-z0-9][A-Za-z0-9._-]*\.jar)$/;
const RE_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;

const TRUST_VALUES = ["official", "reviewed-third-party"];
const CHANNEL_VALUES = ["stable", "preview"];
const STATUS_VALUES = ["active", "yanked"];
const PLATFORM_VALUES = ["windows-x64"];
const LOCALE_VALUES = ["en", "zh-Hans", "ja"];
const SORT_VALUES = ["published-desc", "updated-desc", "name-asc", "name-desc"];
const DEPENDENCY_TYPE_VALUES = ["required", "optional"];
const ORDERING_VALUES = ["none", "before", "after"];
const PERMISSION_SCOPE_VALUES = ["application", "user"];

const DESCRIPTOR_ENTRY = "META-INF/turboism/plugin.json";
const DESCRIPTOR_FORMAT = "turboism.plugin.meta";

// Canonical key order for published/search/envelope objects (contract 5.4 and
// OpenAPI component property order; the Markdown example is authoritative for
// artifact). Deterministic object keys and array order in published bytes.
const KEY_ORDER = {
  catalog: ["format", "schemaVersion", "catalogVersion", "publishedAt", "plugins"],
  plugin: ["id", "slug", "name", "summary", "trust", "author", "license", "repository", "support", "localizations", "releases"],
  release: [
    "version",
    "channel",
    "status",
    "publishedAt",
    "category",
    "tags",
    "turboismApi",
    "requiresCubism",
    "cubismVersions",
    "platforms",
    "dependencies",
    "permissions",
    "releaseUrl",
    "sourceRevision",
    "artifact",
  ],
  artifact: ["mediaType", "fileName", "url", "sha256", "descriptorSha256", "size"],
  dependency: ["id", "version", "type", "ordering", "reason"],
  permission: ["id", "scope", "reason"],
  localization: ["name", "summary"],
  localizations: ["zh-Hans", "ja"],
  envelope: ["format", "schemaVersion", "algorithm", "keyId", "catalogSha256", "signature"],
  search: ["format", "schemaVersion", "catalogVersion", "query", "pagination", "items"],
  query: ["q", "trust", "categories", "tags", "channels", "turboismApi", "cubismVersion", "platforms", "locale", "sort"],
  pagination: ["page", "pageSize", "totalItems", "totalPages", "hasPrevious", "hasNext"],
  searchItem: [
    "id",
    "slug",
    "displayName",
    "displaySummary",
    "trust",
    "author",
    "license",
    "repository",
    "support",
    "latestCompatibleRelease",
  ],
  errorEnvelope: ["error"],
  error: ["code", "message", "field"],
};

/** @typedef {{ path: string, message: string }} ValidationIssue */

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function codePointLength(value) {
  return [...value].length;
}

const MAX_JSON_DEPTH = 128;

/**
 * Fatal UTF-8 decode: throws on invalid byte sequences instead of silently
 * replacing them like Buffer.toString("utf8").
 * @param {Uint8Array|Buffer} bytes
 * @returns {string}
 */
export function decodeUtf8Fatal(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Strict JSON parser: RFC 8259 grammar, bounded depth, and rejection of
 * duplicate object keys at every nesting level (JSON.parse silently keeps the
 * last duplicate). Throws Error on any violation.
 * @param {string} text
 * @returns {unknown}
 */
export function parseStrictJson(text) {
  let index = 0;
  let depth = 0;

  const fail = (message) => {
    throw new Error(`strict JSON: ${message} at offset ${index}`);
  };
  const skipWhitespace = () => {
    while (index < text.length && (text[index] === " " || text[index] === "\t" || text[index] === "\n" || text[index] === "\r")) {
      index += 1;
    }
  };
  const parseString = () => {
    if (text[index] !== '"') fail("expected string");
    index += 1;
    let result = "";
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        index += 1;
        return result;
      }
      if (char === "\\") {
        index += 1;
        const escape = text[index];
        if (escape === undefined) fail("unterminated string escape");
        index += 1;
        switch (escape) {
          case '"':
          case "\\":
          case "/":
            result += escape;
            break;
          case "b":
            result += "\b";
            break;
          case "f":
            result += "\f";
            break;
          case "n":
            result += "\n";
            break;
          case "r":
            result += "\r";
            break;
          case "t":
            result += "\t";
            break;
          case "u": {
            const hex = text.slice(index, index + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("invalid \\u escape");
            const code = Number.parseInt(hex, 16);
            index += 4;
            if (code >= 0xd800 && code <= 0xdbff) {
              // High surrogate: require a following low surrogate escape.
              if (text.slice(index, index + 2) !== "\\u") fail("lone high surrogate");
              const lowHex = text.slice(index + 2, index + 6);
              if (!/^[0-9a-fA-F]{4}$/.test(lowHex)) fail("invalid low surrogate");
              const low = Number.parseInt(lowHex, 16);
              if (low < 0xdc00 || low > 0xdfff) fail("invalid low surrogate");
              index += 6;
              result += String.fromCodePoint(((code - 0xd800) << 10) + (low - 0xdc00) + 0x10000);
            } else if (code >= 0xdc00 && code <= 0xdfff) {
              fail("lone low surrogate");
            } else {
              result += String.fromCharCode(code);
            }
            break;
          }
          default:
            fail(`unknown escape "\\${escape}"`);
        }
        continue;
      }
      if (char.charCodeAt(0) < 0x20) fail("unescaped control character in string");
      result += char;
      index += 1;
    }
    fail("unterminated string");
  };
  const parseNumber = () => {
    const start = index;
    if (text[index] === "-") index += 1;
    if (text[index] === "0") {
      index += 1;
    } else if (/[1-9]/.test(text[index] ?? "")) {
      while (/[0-9]/.test(text[index] ?? "")) index += 1;
    } else {
      fail("invalid number");
    }
    if (text[index] === ".") {
      index += 1;
      if (!/[0-9]/.test(text[index] ?? "")) fail("invalid number fraction");
      while (/[0-9]/.test(text[index] ?? "")) index += 1;
    }
    if (text[index] === "e" || text[index] === "E") {
      index += 1;
      if (text[index] === "+" || text[index] === "-") index += 1;
      if (!/[0-9]/.test(text[index] ?? "")) fail("invalid number exponent");
      while (/[0-9]/.test(text[index] ?? "")) index += 1;
    }
    const raw = text.slice(start, index);
    const value = Number(raw);
    if (!Number.isFinite(value)) fail("number out of range");
    return value;
  };
  const parseValue = () => {
    skipWhitespace();
    const char = text[index];
    if (char === undefined) fail("unexpected end of input");
    if (char === "{") {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) fail("nesting too deep");
      index += 1;
      skipWhitespace();
      const object = {};
      if (text[index] === "}") {
        index += 1;
        depth -= 1;
        return object;
      }
      const seen = new Set();
      for (;;) {
        skipWhitespace();
        if (text[index] !== '"') fail("expected object key string");
        const key = parseString();
        if (seen.has(key)) fail(`duplicate object key "${key}"`);
        seen.add(key);
        skipWhitespace();
        if (text[index] !== ":") fail("expected ':' after object key");
        index += 1;
        object[key] = parseValue();
        skipWhitespace();
        if (text[index] === ",") {
          index += 1;
          continue;
        }
        if (text[index] === "}") {
          index += 1;
          depth -= 1;
          return object;
        }
        fail("expected ',' or '}' in object");
      }
    }
    if (char === "[") {
      depth += 1;
      if (depth > MAX_JSON_DEPTH) fail("nesting too deep");
      index += 1;
      skipWhitespace();
      const array = [];
      if (text[index] === "]") {
        index += 1;
        depth -= 1;
        return array;
      }
      for (;;) {
        array.push(parseValue());
        skipWhitespace();
        if (text[index] === ",") {
          index += 1;
          continue;
        }
        if (text[index] === "]") {
          index += 1;
          depth -= 1;
          return array;
        }
        fail("expected ',' or ']' in array");
      }
    }
    if (char === '"') return parseString();
    if (char === "t") {
      if (text.slice(index, index + 4) === "true") {
        index += 4;
        return true;
      }
      fail("invalid literal");
    }
    if (char === "f") {
      if (text.slice(index, index + 5) === "false") {
        index += 5;
        return false;
      }
      fail("invalid literal");
    }
    if (char === "n") {
      if (text.slice(index, index + 4) === "null") {
        index += 4;
        return null;
      }
      fail("invalid literal");
    }
    if (char === "-" || /[0-9]/.test(char)) return parseNumber();
    fail(`unexpected character "${char}"`);
  };

  const value = parseValue();
  skipWhitespace();
  if (index !== text.length) fail("trailing content after JSON value");
  return value;
}

/**
 * Parse JSON bytes with fatal UTF-8 decoding and duplicate-key rejection.
 * @param {Uint8Array|Buffer} bytes
 * @returns {{ ok: true, value: unknown } | { ok: false, message: string }}
 */
export function parseStrictJsonBytes(bytes) {
  let text;
  try {
    text = decodeUtf8Fatal(bytes);
  } catch {
    return { ok: false, message: "must be valid UTF-8" };
  }
  try {
    return { ok: true, value: parseStrictJson(text) };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

function checkKeys(obj, orderKey, path, issues) {
  const allowed = KEY_ORDER[orderKey];
  let lastIndex = -1;
  for (const key of Object.keys(obj)) {
    const index = allowed.indexOf(key);
    if (index === -1) {
      issues.push({ path, message: `unknown field "${key}"` });
      continue;
    }
    if (index < lastIndex) {
      issues.push({ path, message: `field "${key}" out of canonical key order` });
    }
    lastIndex = index;
  }
}

function checkRequired(obj, required, path, issues) {
  for (const key of required) {
    if (!(key in obj)) {
      issues.push({ path, message: `missing required field "${key}"` });
    }
  }
}

function requireString(obj, key, path, issues, { minLength = 1, maxLength = Infinity } = {}) {
  const value = obj[key];
  if (typeof value !== "string") {
    issues.push({ path: `${path}.${key}`, message: "must be a string" });
    return null;
  }
  const length = codePointLength(value);
  if (length < minLength || length > maxLength) {
    issues.push({
      path: `${path}.${key}`,
      message: `length must be between ${minLength} and ${maxLength} code points`,
    });
    return null;
  }
  return value;
}

function requireBoolean(obj, key, path, issues) {
  const value = obj[key];
  if (typeof value !== "boolean") {
    issues.push({ path: `${path}.${key}`, message: "must be a boolean" });
    return null;
  }
  return value;
}

function requireInteger(obj, key, path, issues, { min = -Infinity, max = Infinity } = {}) {
  const value = obj[key];
  if (!Number.isInteger(value)) {
    issues.push({ path: `${path}.${key}`, message: "must be an integer" });
    return null;
  }
  if (value < min || value > max) {
    const bound =
      min > -Infinity && max < Infinity
        ? `between ${min} and ${max}`
        : min > -Infinity
          ? `at least ${min}`
          : `at most ${max}`;
    issues.push({ path: `${path}.${key}`, message: `must be ${bound}` });
    return null;
  }
  return value;
}

/** Parse a strict MAJOR.MINOR.PATCH version, or null. */
export function parseStrictVersion(value) {
  if (typeof value !== "string" || !RE_STRICT_VERSION.test(value)) return null;
  return value.split(".").map(Number);
}

/** Compare two strict version arrays; negative when a < b. */
export function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Validate a version range: exact strict version or half-open [a,b) with a < b.
 * Returns { lower, upper:null } for exact, { lower, upper } for a range, or null.
 */
export function parseVersionRange(value) {
  if (typeof value !== "string") return null;
  const exact = parseStrictVersion(value);
  if (exact) return { lower: exact, upper: null };
  const match = RE_HALF_OPEN_RANGE.exec(value);
  if (!match) return null;
  const lower = [Number(match[1]), Number(match[2]), Number(match[3])];
  const upper = [Number(match[4]), Number(match[5]), Number(match[6])];
  if (compareVersions(lower, upper) >= 0) return null;
  return { lower, upper };
}

/** True when a parsed range contains a parsed strict version. */
export function rangeContains(range, version) {
  if (range.upper === null) return compareVersions(range.lower, version) === 0;
  return compareVersions(range.lower, version) <= 0 && compareVersions(version, range.upper) < 0;
}

function validateVersionRange(value, path, issues) {
  if (parseVersionRange(value) === null) {
    issues.push({ path, message: `"${value}" is not a strict version or half-open [a,b) range` });
    return false;
  }
  return true;
}

function validateHostVersion(value, path, issues) {
  if (typeof value !== "string" || !RE_HOST_VERSION.test(value)) {
    issues.push({ path, message: "must match a host version like 5.3.02" });
    return false;
  }
  return true;
}

function validateToken(value, path, issues) {
  if (typeof value !== "string") {
    issues.push({ path, message: "must be a string" });
    return false;
  }
  const length = codePointLength(value);
  if (length < MIN_TOKEN_LENGTH || length > MAX_TOKEN_LENGTH) {
    issues.push({ path, message: `must be ${MIN_TOKEN_LENGTH}-${MAX_TOKEN_LENGTH} code points` });
    return false;
  }
  if (!RE_KEBAB.test(value)) {
    issues.push({ path, message: "must be lowercase kebab-case" });
    return false;
  }
  return true;
}

function validateHttpsUrl(value, path, issues) {
  if (typeof value !== "string") {
    issues.push({ path, message: "must be an https URL" });
    return false;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    parsed = null;
  }
  if (parsed === null || parsed.protocol !== "https:" || parsed.hostname === "") {
    issues.push({ path, message: "must be an absolute https URL" });
    return false;
  }
  return true;
}

function validateDateTime(value, path, issues) {
  if (typeof value !== "string") {
    issues.push({ path, message: "must be a string" });
    return false;
  }
  const match = RE_DATE_TIME.exec(value);
  if (!match) {
    issues.push({ path, message: "must be a UTC date-time like 2026-08-15T00:00:00Z" });
    return false;
  }
  const [, , mo, d, h, mi, s] = match;
  const n = (v) => Number(v);
  if (n(mo) < 1 || n(mo) > 12 || n(d) < 1 || n(d) > 31 || n(h) > 23 || n(mi) > 59 || n(s) > 59) {
    issues.push({ path, message: "date-time fields out of range" });
    return false;
  }
  // Round-trip check rejects calendar rollovers such as 2026-02-30.
  if (!Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) + "Z" === value) {
    return true;
  }
  issues.push({ path, message: "not a valid UTC date-time" });
  return false;
}

function validateStringArray(obj, key, path, issues, { label, minItems = 0, maxItems = Infinity, unique = true, validateItem = null, sorted = false, sortCompare = null } = {}) {
  const value = obj[key];
  if (!Array.isArray(value)) {
    issues.push({ path: `${path}.${key}`, message: "must be an array" });
    return [];
  }
  if (value.length < minItems || value.length > maxItems) {
    issues.push({ path: `${path}.${key}`, message: `must contain between ${minItems} and ${maxItems} items` });
  }
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    const itemPath = `${path}.${key}[${i}]`;
    if (validateItem) validateItem(item, itemPath, issues);
    if (unique && typeof item === "string") {
      if (seen.has(item)) issues.push({ path: itemPath, message: `duplicate ${label} "${item}"` });
      seen.add(item);
    }
  }
  if (sorted && value.every((item) => typeof item === "string")) {
    for (let i = 1; i < value.length; i += 1) {
      if (sortCompare(value[i - 1], value[i]) >= 0) {
        issues.push({ path: `${path}.${key}`, message: `must be strictly ordered (${label} at index ${i - 1} and ${i})` });
        break;
      }
    }
  }
  return value;
}

function validateArtifact(value, path, issues) {
  if (!isPlainObject(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  checkKeys(value, "artifact", path, issues);
  checkRequired(value, ["fileName", "mediaType", "url", "sha256", "descriptorSha256", "size"], path, issues);
  const fileName = requireString(value, "fileName", path, issues, { minLength: 5, maxLength: 255 });
  if (fileName !== null && !RE_FILE_NAME.test(fileName)) {
    issues.push({ path: `${path}.fileName`, message: "must match [A-Za-z0-9][A-Za-z0-9._-]*.jar" });
  }
  if (value.mediaType !== undefined && value.mediaType !== "application/java-archive") {
    issues.push({ path: `${path}.mediaType`, message: "must be exactly application/java-archive" });
  }
  if (typeof value.url === "string" && value.url !== "") {
    const urlMatch = RE_ARTIFACT_URL.exec(value.url);
    if (urlMatch === null) {
      issues.push({ path: `${path}.url`, message: "must be an exact https github.com/<owner>/<repo>/releases/download/<tag>/<fileName> URL with no credentials, query, or fragment" });
    } else if (typeof value.fileName === "string" && urlMatch[1] !== value.fileName) {
      issues.push({ path: `${path}.url`, message: "must end with artifact.fileName" });
    }
  } else {
    validateHttpsUrl(value.url, `${path}.url`, issues);
  }
  for (const key of ["sha256", "descriptorSha256"]) {
    const hash = requireString(value, key, path, issues, { minLength: 64, maxLength: 64 });
    if (hash !== null && !RE_SHA256.test(hash)) {
      issues.push({ path: `${path}.${key}`, message: "must be a lowercase 64-character SHA-256 hex digest" });
    }
  }
  requireInteger(value, "size", path, issues, { min: 1, max: MAX_ARTIFACT_SIZE });
}

function validateDependency(value, path, issues) {
  if (!isPlainObject(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  checkKeys(value, "dependency", path, issues);
  checkRequired(value, ["id", "version", "type", "ordering"], path, issues);
  const id = requireString(value, "id", path, issues, { minLength: 1, maxLength: 128 });
  if (id !== null && !RE_PLUGIN_ID.test(id)) {
    issues.push({ path: `${path}.id`, message: "must be a lowercase dotted plugin id" });
  }
  validateVersionRange(value.version, `${path}.version`, issues);
  if (value.type !== undefined && !DEPENDENCY_TYPE_VALUES.includes(value.type)) {
    issues.push({ path: `${path}.type`, message: `must be one of ${DEPENDENCY_TYPE_VALUES.join(", ")}` });
  }
  if (value.ordering !== undefined && !ORDERING_VALUES.includes(value.ordering)) {
    issues.push({ path: `${path}.ordering`, message: `must be one of ${ORDERING_VALUES.join(", ")}` });
  }
  if (value.reason !== undefined) requireString(value, "reason", path, issues, { minLength: 1, maxLength: 500 });
}

function validatePermission(value, path, issues) {
  if (!isPlainObject(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  checkKeys(value, "permission", path, issues);
  checkRequired(value, ["id", "scope", "reason"], path, issues);
  const id = requireString(value, "id", path, issues, { minLength: 1, maxLength: 128 });
  if (id !== null && !RE_PLUGIN_ID.test(id)) {
    issues.push({ path: `${path}.id`, message: "must be a lowercase dotted plugin id" });
  }
  if (value.scope !== undefined && !PERMISSION_SCOPE_VALUES.includes(value.scope)) {
    issues.push({ path: `${path}.scope`, message: `must be one of ${PERMISSION_SCOPE_VALUES.join(", ")}` });
  }
  if (value.reason !== undefined) requireString(value, "reason", path, issues, { minLength: 1, maxLength: 500 });
}

function validateObjectArray(obj, key, path, issues, { maxItems = Infinity, label, validateItem, uniqueIds = false }) {
  const value = obj[key];
  if (!Array.isArray(value)) {
    issues.push({ path: `${path}.${key}`, message: "must be an array" });
    return;
  }
  if (value.length > maxItems) {
    issues.push({ path: `${path}.${key}`, message: `must contain at most ${maxItems} items` });
  }
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    const itemPath = `${path}.${key}[${i}]`;
    validateItem(value[i], itemPath, issues);
    if (uniqueIds && isPlainObject(value[i]) && typeof value[i].id === "string") {
      if (seen.has(value[i].id)) {
        issues.push({ path: `${itemPath}.id`, message: `duplicate ${label} id "${value[i].id}"` });
      }
      seen.add(value[i].id);
    }
  }
}

function validateLocalization(value, path, issues) {
  if (!isPlainObject(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  checkKeys(value, "localization", path, issues);
  checkRequired(value, ["name", "summary"], path, issues);
  requireString(value, "name", path, issues, { minLength: 1, maxLength: 120 });
  requireString(value, "summary", path, issues, { minLength: 1, maxLength: 500 });
}

function validateRelease(value, path, issues) {
  if (!isPlainObject(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  checkKeys(value, "release", path, issues);
  checkRequired(
    value,
    ["version", "channel", "status", "publishedAt", "category", "tags", "turboismApi", "requiresCubism", "cubismVersions", "platforms", "dependencies", "permissions", "releaseUrl", "artifact"],
    path,
    issues,
  );
  const version = requireString(value, "version", path, issues, { minLength: 1, maxLength: 64 });
  if (version !== null && parseStrictVersion(version) === null) {
    issues.push({ path: `${path}.version`, message: "must be a strict MAJOR.MINOR.PATCH version" });
  }
  if (value.channel !== undefined && !CHANNEL_VALUES.includes(value.channel)) {
    issues.push({ path: `${path}.channel`, message: `must be one of ${CHANNEL_VALUES.join(", ")}` });
  }
  if (value.status !== undefined && !STATUS_VALUES.includes(value.status)) {
    issues.push({ path: `${path}.status`, message: `must be one of ${STATUS_VALUES.join(", ")}` });
  }
  validateDateTime(value.publishedAt, `${path}.publishedAt`, issues);
  validateToken(value.category, `${path}.category`, issues);
  validateStringArray(value, "tags", path, issues, {
    label: "tag",
    minItems: 0,
    maxItems: MAX_TAGS,
    unique: true,
    validateItem: (item, itemPath, itemIssues) => validateToken(item, itemPath, itemIssues),
  });
  validateVersionRange(value.turboismApi, `${path}.turboismApi`, issues);
  const requiresCubism = requireBoolean(value, "requiresCubism", path, issues);
  const cubismVersions = validateStringArray(value, "cubismVersions", path, issues, {
    label: "cubism version",
    maxItems: MAX_CUBISM_VERSIONS,
    unique: true,
    validateItem: (item, itemPath, itemIssues) => validateHostVersion(item, itemPath, itemIssues),
  });
  if (requiresCubism !== null && requiresCubism && cubismVersions.length === 0) {
    issues.push({ path: `${path}.cubismVersions`, message: "must contain at least one exact reviewed Editor release when requiresCubism is true" });
  }
  if (requiresCubism !== null && !requiresCubism && cubismVersions.length > 0) {
    issues.push({ path: `${path}.cubismVersions`, message: "must be empty when requiresCubism is false" });
  }
  validateStringArray(value, "platforms", path, issues, {
    label: "platform",
    minItems: 1,
    unique: true,
    validateItem: (item, itemPath, itemIssues) => {
      if (typeof item !== "string" || !PLATFORM_VALUES.includes(item)) {
        itemIssues.push({ path: itemPath, message: `must be one of ${PLATFORM_VALUES.join(", ")}` });
      }
    },
  });
  validateObjectArray(value, "dependencies", path, issues, { maxItems: MAX_DEPENDENCIES, label: "dependency", validateItem: validateDependency, uniqueIds: true });
  validateObjectArray(value, "permissions", path, issues, { maxItems: MAX_PERMISSIONS, label: "permission", validateItem: validatePermission, uniqueIds: true });
  validateHttpsUrl(value.releaseUrl, `${path}.releaseUrl`, issues);
  if (value.sourceRevision !== undefined) {
    const revision = requireString(value, "sourceRevision", path, issues, { minLength: 40, maxLength: 40 });
    if (revision !== null && !RE_SOURCE_REVISION.test(revision)) {
      issues.push({ path: `${path}.sourceRevision`, message: "must be a 40-character lowercase hex revision" });
    }
  }
  validateArtifact(value.artifact, `${path}.artifact`, issues);
}

function validatePlugin(value, index, issues) {
  const path = `plugins[${index}]`;
  if (!isPlainObject(value)) {
    issues.push({ path, message: "must be an object" });
    return;
  }
  checkKeys(value, "plugin", path, issues);
  checkRequired(value, ["id", "slug", "name", "summary", "trust", "author", "license", "repository", "support", "localizations", "releases"], path, issues);
  const id = requireString(value, "id", path, issues, { minLength: 1, maxLength: 128 });
  if (id !== null && !RE_PLUGIN_ID.test(id)) {
    issues.push({ path: `${path}.id`, message: "must be a lowercase dotted plugin id" });
  }
  const slug = requireString(value, "slug", path, issues, { minLength: 1, maxLength: 100 });
  if (slug !== null && !RE_SLUG.test(slug)) {
    issues.push({ path: `${path}.slug`, message: "must be lowercase kebab-case" });
  }
  requireString(value, "name", path, issues, { minLength: 1, maxLength: 120 });
  requireString(value, "summary", path, issues, { minLength: 1, maxLength: 500 });
  if (value.trust !== undefined && !TRUST_VALUES.includes(value.trust)) {
    issues.push({ path: `${path}.trust`, message: `must be one of ${TRUST_VALUES.join(", ")}` });
  }
  requireString(value, "author", path, issues, { minLength: 1, maxLength: 120 });
  requireString(value, "license", path, issues, { minLength: 1, maxLength: 100 });
  validateHttpsUrl(value.repository, `${path}.repository`, issues);
  validateHttpsUrl(value.support, `${path}.support`, issues);
  if (value.localizations !== undefined) {
    if (!isPlainObject(value.localizations)) {
      issues.push({ path: `${path}.localizations`, message: "must be an object" });
    } else {
      checkKeys(value.localizations, "localizations", path + ".localizations", issues);
      if (value.localizations["zh-Hans"] !== undefined) validateLocalization(value.localizations["zh-Hans"], `${path}.localizations.zh-Hans`, issues);
      if (value.localizations.ja !== undefined) validateLocalization(value.localizations.ja, `${path}.localizations.ja`, issues);
    }
  }
  validateStringArray(value, "releases", path, issues, {
    label: "release",
    minItems: 1,
    maxItems: MAX_RELEASES,
    unique: false,
    validateItem: (item, itemPath, itemIssues) => validateRelease(item, itemPath, itemIssues),
  });
}

/**
 * Strictly validate complete catalog JSON bytes. Returns the parsed catalog on
 * success. Semantic rules: duplicate plugin ids/slugs and release versions,
 * official category registry, version order mistakes, and all bounds.
 * @param {Uint8Array|Buffer} bytes
 * @returns {{ ok: true, catalog: object } | { ok: false, errors: ValidationIssue[] }}
 */
/**
 * Strictly validate complete catalog JSON bytes. The 5 MiB cap is enforced
 * BEFORE decoding or parsing; decoding is fatal UTF-8; duplicate JSON object
 * keys are rejected at every nesting level.
 * @param {Uint8Array|Buffer} bytes
 * @returns {{ ok: true, catalog: object } | { ok: false, errors: ValidationIssue[] }}
 */
export function validateCatalogBytes(bytes) {
  if (bytes.byteLength > MAX_CATALOG_BYTES) {
    return { ok: false, errors: [{ path: "catalog", message: `catalog body must be at most ${MAX_CATALOG_BYTES} bytes` }] };
  }
  const parsed = parseStrictJsonBytes(bytes);
  if (!parsed.ok) {
    return { ok: false, errors: [{ path: "catalog", message: parsed.message }] };
  }
  if (!isPlainObject(parsed.value)) {
    return { ok: false, errors: [{ path: "catalog", message: "must be an object" }] };
  }
  return validateParsedCatalog(parsed.value);
}

/**
 * Structure and semantic validation of an already-parsed catalog object
 * (no byte caps). Exported so tests can exercise count caps that are
 * unreachable through the byte cap.
 * @param {object} catalog
 * @returns {{ ok: true, catalog: object } | { ok: false, errors: ValidationIssue[] }}
 */
export function validateParsedCatalog(catalog) {
  const issues = [];
  validateCatalogObject(catalog, issues);
  if (issues.length > 0) return { ok: false, errors: issues };

  const seenIds = new Set();
  const seenSlugs = new Set();
  for (let i = 0; i < catalog.plugins.length; i += 1) {
    const plugin = catalog.plugins[i];
    const path = `plugins[${i}]`;
    if (seenIds.has(plugin.id)) issues.push({ path: `${path}.id`, message: `duplicate plugin id "${plugin.id}"` });
    seenIds.add(plugin.id);
    if (seenSlugs.has(plugin.slug)) issues.push({ path: `${path}.slug`, message: `duplicate slug "${plugin.slug}"` });
    seenSlugs.add(plugin.slug);
    const seenVersions = new Set();
    let previous = null;
    for (let r = 0; r < plugin.releases.length; r += 1) {
      const release = plugin.releases[r];
      const releasePath = `${path}.releases[${r}]`;
      if (seenVersions.has(release.version)) {
        issues.push({ path: `${releasePath}.version`, message: `duplicate release version "${release.version}"` });
      }
      seenVersions.add(release.version);
      const parsed = parseStrictVersion(release.version);
      if (parsed !== null && previous !== null && compareVersions(previous, parsed) >= 0) {
        issues.push({ path: `${releasePath}.version`, message: `release versions must be strictly ascending (${release.version} after ${previous.map(String).join(".")})` });
      }
      if (parsed !== null) previous = parsed;
      if (plugin.trust === "official" && typeof release.category === "string" && !OFFICIAL_CATEGORIES.includes(release.category)) {
        issues.push({ path: `${releasePath}.category`, message: `official category "${release.category}" is not in the reviewed registry` });
      }
    }
  }
  return issues.length > 0 ? { ok: false, errors: issues } : { ok: true, catalog };
}

function validateCatalogObject(catalog, issues) {
  if (!isPlainObject(catalog)) {
    issues.push({ path: "catalog", message: "must be an object" });
    return;
  }
  checkKeys(catalog, "catalog", "catalog", issues);
  checkRequired(catalog, ["format", "schemaVersion", "catalogVersion", "publishedAt", "plugins"], "catalog", issues);
  if (catalog.format !== undefined && catalog.format !== CATALOG_FORMAT) {
    issues.push({ path: "catalog.format", message: `must be "${CATALOG_FORMAT}"` });
  }
  if (catalog.schemaVersion !== undefined && catalog.schemaVersion !== SCHEMA_VERSION) {
    issues.push({ path: "catalog.schemaVersion", message: `must be ${SCHEMA_VERSION}` });
  }
  requireInteger(catalog, "catalogVersion", "catalog", issues, { min: 1 });
  validateDateTime(catalog.publishedAt, "catalog.publishedAt", issues);
  validateStringArray(catalog, "plugins", "catalog", issues, {
    label: "plugin",
    maxItems: MAX_PLUGINS,
    unique: false,
    validateItem: (item, itemPath, itemIssues) => validatePlugin(item, Number(itemPath.match(/\[(\d+)\]/)[1]), itemIssues),
  });
}

function validateEnvelopeObject(envelope, issues) {
  if (!isPlainObject(envelope)) {
    issues.push({ path: "signature", message: "must be an object" });
    return;
  }
  checkKeys(envelope, "envelope", "signature", issues);
  checkRequired(envelope, ["format", "schemaVersion", "algorithm", "keyId", "catalogSha256", "signature"], "signature", issues);
  if (envelope.format !== undefined && envelope.format !== SIGNATURE_FORMAT) {
    issues.push({ path: "signature.format", message: `must be "${SIGNATURE_FORMAT}"` });
  }
  if (envelope.schemaVersion !== undefined && envelope.schemaVersion !== SCHEMA_VERSION) {
    issues.push({ path: "signature.schemaVersion", message: `must be ${SCHEMA_VERSION}` });
  }
  if (envelope.algorithm !== undefined && envelope.algorithm !== ED25519_ALGORITHM) {
    issues.push({ path: "signature.algorithm", message: `must be "${ED25519_ALGORITHM}"` });
  }
  const keyId = requireString(envelope, "keyId", "signature", issues, { minLength: 1, maxLength: 100 });
  if (keyId !== null && !RE_KEY_ID.test(keyId)) {
    issues.push({ path: "signature.keyId", message: "must be lowercase kebab-case" });
  }
  const hash = requireString(envelope, "catalogSha256", "signature", issues, { minLength: 64, maxLength: 64 });
  if (hash !== null && !RE_SHA256.test(hash)) {
    issues.push({ path: "signature.catalogSha256", message: "must be a lowercase 64-character SHA-256 hex digest" });
  }
  const signature = requireString(envelope, "signature", "signature", issues, { minLength: 88, maxLength: 88 });
  if (signature !== null) {
    let decoded;
    try {
      decoded = Buffer.from(signature, "base64");
    } catch {
      decoded = null;
    }
    if (decoded === null || decoded.length !== 64) {
      issues.push({ path: "signature.signature", message: "must be base64 of exactly 64 Ed25519 bytes" });
    }
  }
}

/**
 * Validate a detached-signature envelope file. Enforces the 16 KiB cap.
 * @param {Uint8Array|Buffer} sigBytes
 * @returns {{ ok: true, envelope: object } | { ok: false, errors: ValidationIssue[] }}
 */
export function validateEnvelopeBytes(sigBytes) {
  if (sigBytes.byteLength > MAX_SIGNATURE_BYTES) {
    return { ok: false, errors: [{ path: "signature", message: `signature envelope must be at most ${MAX_SIGNATURE_BYTES} bytes` }] };
  }
  const parsed = parseStrictJsonBytes(sigBytes);
  if (!parsed.ok) {
    return { ok: false, errors: [{ path: "signature", message: parsed.message }] };
  }
  if (!isPlainObject(parsed.value)) {
    return { ok: false, errors: [{ path: "signature", message: "must be an object" }] };
  }
  const issues = [];
  validateEnvelopeObject(parsed.value, issues);
  return issues.length > 0 ? { ok: false, errors: issues } : { ok: true, envelope: parsed.value };
}

/**
 * Load a trusted-keys allowlist file: { keyId: { pem, purpose } }.
 * @param {string} file
 * @returns {{ ok: true, keys: object } | { ok: false, message: string }}
 */
export function loadTrustedKeys(file) {
  // Bound the manifest BEFORE reading: stat first, reject oversized files.
  let size;
  try {
    size = statSync(file).size;
  } catch {
    return { ok: false, message: "trusted key allowlist is not readable" };
  }
  if (size > MAX_TRUSTED_KEYS_FILE_BYTES) {
    return { ok: false, message: `trusted key allowlist must be at most ${MAX_TRUSTED_KEYS_FILE_BYTES} bytes` };
  }
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { ok: false, message: "trusted key allowlist is not readable" };
  }
  const parsed = parseStrictJsonBytes(Buffer.from(raw, "utf8"));
  if (!parsed.ok) {
    return { ok: false, message: `trusted key allowlist is not valid strict JSON: ${parsed.message}` };
  }
  if (!isPlainObject(parsed.value)) {
    return { ok: false, message: "trusted key allowlist must be a key object" };
  }
  const manifest = parsed.value;
  const entries = Object.entries(manifest);
  if (entries.length > MAX_TRUSTED_KEYS) {
    return { ok: false, message: `trusted key allowlist must contain at most ${MAX_TRUSTED_KEYS} keys` };
  }
  const keys = {};
  for (const [keyId, entry] of entries) {
    if (typeof keyId !== "string" || !RE_KEY_ID.test(keyId) || keyId.length > 100) {
      return { ok: false, message: `trusted key "${keyId}" is not a valid key id` };
    }
    if (!isPlainObject(entry) || typeof entry.pem !== "string" || entry.pem.length === 0 || entry.pem.length > 4096) {
      return { ok: false, message: `trusted key "${keyId}" must have a pem string` };
    }
    // purpose is mandatory and never defaults (a default could silently
    // elevate a test key to production).
    if (typeof entry.purpose !== "string" || !["production", "test"].includes(entry.purpose)) {
      return { ok: false, message: `trusted key "${keyId}" must declare purpose production or test` };
    }
    keys[keyId] = { pem: entry.pem, purpose: entry.purpose };
  }
  return { ok: true, keys };
}

/**
 * Verify exact catalog bytes against a detached signature envelope, in the
 * normative order (contract 4): reject unknown format/schema/algorithm/keyId,
 * hash the exact bytes, constant-time compare, verify Ed25519, then parse and
 * validate the catalog schema.
 * @param {Uint8Array|Buffer} catalogBytes
 * @param {Uint8Array|Buffer} sigBytes
 * @param {object} trustedKeys allowlist { keyId: { pem, purpose } }
 * @param {{ requireProduction?: boolean }} [options]
 * @returns {{ ok: true, catalog: object, envelope: object, sha256: string } | { ok: false, errors: ValidationIssue[], sha256?: string }}
 */
export function verifyCatalogBytes(catalogBytes, sigBytes, trustedKeys, options = {}) {
  const issues = [];
  const envelopeCheck = validateEnvelopeBytes(sigBytes);
  if (!envelopeCheck.ok) {
    return { ok: false, errors: envelopeCheck.errors };
  }
  const envelope = envelopeCheck.envelope;
  const key = trustedKeys[envelope.keyId];
  if (!key) {
    issues.push({ path: "signature.keyId", message: `unknown key id "${envelope.keyId}"` });
    return { ok: false, errors: issues };
  }
  if (options.requireProduction && key.purpose !== "production") {
    issues.push({
      path: "signature.keyId",
      message: `public artifact must not be signed with non-production key "${envelope.keyId}"`,
    });
    return { ok: false, errors: issues };
  }
  const actual = createHash("sha256").update(catalogBytes).digest("hex");
  const expected = Buffer.from(envelope.catalogSha256, "hex");
  const actualBytes = Buffer.from(actual, "hex");
  if (expected.length !== actualBytes.length || !timingSafeEqual(expected, actualBytes)) {
    issues.push({ path: "signature.catalogSha256", message: `hash mismatch: catalog is ${actual}` });
    return { ok: false, errors: issues, sha256: actual };
  }
  let publicKey;
  try {
    publicKey = createPublicKey(key.pem);
  } catch {
    issues.push({ path: "signature.keyId", message: `trusted key "${envelope.keyId}" is not a valid public key` });
    return { ok: false, errors: issues, sha256: actual };
  }
  let valid = false;
  try {
    valid = ed25519Verify(null, Buffer.from(catalogBytes), publicKey, Buffer.from(envelope.signature, "base64"));
  } catch {
    valid = false;
  }
  if (!valid) {
    issues.push({ path: "signature.signature", message: "Ed25519 signature verification failed" });
    return { ok: false, errors: issues, sha256: actual };
  }
  const catalogCheck = validateCatalogBytes(catalogBytes);
  if (!catalogCheck.ok) {
    return { ok: false, errors: catalogCheck.errors, sha256: actual };
  }
  return { ok: true, catalog: catalogCheck.catalog, envelope, sha256: actual };
}

/**
 * Build a detached Ed25519 signature envelope over exact catalog bytes.
 * @param {Uint8Array|Buffer} catalogBytes
 * @param {string} privateKeyPem PKCS#8 PEM of an Ed25519 private key
 * @param {string} keyId
 * @returns {{ ok: true, envelope: object } | { ok: false, errors: ValidationIssue[] }}
 */
export function signCatalogBytes(catalogBytes, privateKeyPem, keyId) {
  const catalogCheck = validateCatalogBytes(catalogBytes);
  if (!catalogCheck.ok) {
    return { ok: false, errors: catalogCheck.errors };
  }
  if (typeof keyId !== "string" || !RE_KEY_ID.test(keyId) || keyId.length > 100) {
    return { ok: false, errors: [{ path: "keyId", message: "must be lowercase kebab-case, at most 100 characters" }] };
  }
  if (typeof privateKeyPem !== "string" || privateKeyPem.trim() === "") {
    return { ok: false, errors: [{ path: "key", message: "must be a PEM private key" }] };
  }
  let privateKey;
  try {
    privateKey = createPrivateKey(privateKeyPem);
  } catch {
    return { ok: false, errors: [{ path: "key", message: "must be a valid PEM private key" }] };
  }
  if (privateKey.asymmetricKeyType !== "ed25519") {
    return { ok: false, errors: [{ path: "key", message: "must be an Ed25519 private key" }] };
  }
  const signature = ed25519Sign(null, Buffer.from(catalogBytes), privateKey).toString("base64");
  const catalogSha256 = createHash("sha256").update(catalogBytes).digest("hex");
  return {
    ok: true,
    envelope: {
      format: SIGNATURE_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      algorithm: ED25519_ALGORITHM,
      keyId,
      catalogSha256,
      signature,
    },
  };
}

// ---------------------------------------------------------------------------
// Canonical deterministic JSON encoding (contract 4: deterministic object keys
// and array order in published bytes).
// ---------------------------------------------------------------------------

function escapeString(value) {
  return JSON.stringify(value);
}

function canonArray(items, type, out) {
  out.push("[");
  for (let i = 0; i < items.length; i += 1) {
    if (i > 0) out.push(",");
    canonValue(items[i], type, out);
  }
  out.push("]");
}

function canonObject(obj, orderKey, out) {
  out.push("{");
  let first = true;
  for (const key of KEY_ORDER[orderKey]) {
    if (!(key in obj)) continue;
    if (!first) out.push(",");
    first = false;
    out.push(escapeString(key), ":");
    canonValue(obj[key], childType(orderKey, key), out);
  }
  out.push("}");
}

function childType(parent, key) {
  switch (parent) {
    case "catalog":
      return key === "plugins" ? "plugin" : "scalar";
    case "plugin":
      return key === "releases" ? "release" : key === "localizations" ? "localizations" : "scalar";
    case "localizations":
      return "localization";
    case "release":
      if (key === "tags" || key === "cubismVersions" || key === "platforms") return "stringArray";
      if (key === "dependencies") return "dependency";
      if (key === "permissions") return "permission";
      if (key === "artifact") return "artifact";
      return "scalar";
    case "dependency":
    case "permission":
    case "localization":
    case "artifact":
    case "envelope":
    case "error":
      return "scalar";
    case "search":
      return key === "query" ? "query" : key === "pagination" ? "pagination" : key === "items" ? "searchItem" : "scalar";
    case "query":
      if (key === "trust" || key === "categories" || key === "tags" || key === "channels" || key === "platforms") return "stringArray";
      return "scalar";
    case "pagination":
      return "scalar";
    case "searchItem":
      return key === "latestCompatibleRelease" ? "release" : "scalar";
    case "errorEnvelope":
      return "error";
    default:
      return "scalar";
  }
}

function canonValue(value, type, out) {
  if (type === "scalar") {
    out.push(JSON.stringify(value));
    return;
  }
  if (type === "stringArray") {
    canonArray(value, "scalar", out);
    return;
  }
  // Typed arrays (plugins, releases, items, dependencies, permissions, ...).
  if (Array.isArray(value)) {
    canonArray(value, type, out);
    return;
  }
  if (type === "plugin" || type === "release" || type === "dependency" || type === "permission" || type === "localization" || type === "localizations" || type === "artifact" || type === "envelope" || type === "search" || type === "query" || type === "pagination" || type === "searchItem" || type === "errorEnvelope" || type === "error") {
    canonObject(value, type, out);
    return;
  }
  out.push(JSON.stringify(value));
}

/**
 * Deterministic compact JSON with canonical key order. Input objects must be
 * validated (or generated by this module); unknown shapes serialize their own
 * key order as-is.
 * @param {object} value
 * @param {string} type one of KEY_ORDER keys
 * @returns {string}
 */
export function stringifyCanonical(value, type) {
  const out = [];
  canonValue(value, type, out);
  return out.join("");
}

/** SHA-256 of exact bytes. */
export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Strong ETag for a byte representation: a quoted SHA-256. */
export function bodyEtag(bytes) {
  return `"${sha256Hex(bytes)}"`;
}

/** True when an If-None-Match header matches the given strong ETag. */
export function ifNoneMatchMatches(header, etag) {
  if (header === null || header === undefined) return false;
  if (header.trim() === "*") return true;
  return header
    .split(",")
    .map((part) => part.trim().replace(/^W\//, ""))
    .includes(etag);
}

// ---------------------------------------------------------------------------
// Discovery query engine (contract 6).
// ---------------------------------------------------------------------------

const REPEATED_PARAMS = new Set(["trust", "category", "tag", "channel", "platform"]);
const SCALAR_PARAMS = new Set(["q", "turboismApi", "cubismVersion", "locale", "sort", "page", "pageSize"]);
const KNOWN_PARAMS = new Set([...REPEATED_PARAMS, ...SCALAR_PARAMS]);

/**
 * @typedef {{ q: string, trust: string[], categories: string[], tags: string[], channels: string[], turboismApi: string|null, cubismVersion: string|null, platforms: string[], locale: string, sort: string, page: number, pageSize: number }} SearchQuery
 * @typedef {{ code: "invalid_query", message: string, field: string }} QueryError
 */

function invalidQuery(field, message) {
  return { ok: false, error: { code: "invalid_query", message, field } };
}

function validateKebabParam(value, field, label) {
  if (typeof value !== "string") return invalidQuery(field, `${label} must be a string`);
  const length = codePointLength(value);
  if (length < MIN_TOKEN_LENGTH || length > MAX_TOKEN_LENGTH) {
    return invalidQuery(field, `${label} must be ${MIN_TOKEN_LENGTH}-${MAX_TOKEN_LENGTH} code points`);
  }
  if (!RE_KEBAB.test(value)) {
    return invalidQuery(field, `${label} must be lowercase kebab-case`);
  }
  return null;
}

/**
 * Parse and normalize discovery query parameters. Unknown parameters and
 * duplicate scalar parameters return 400 invalid_query. Repeated values are OR
 * within a field; duplicates normalize to one. Text is normalized with NFKC
 * and locale-independent lowercase.
 * @param {URLSearchParams} searchParams
 * @returns {{ ok: true, query: SearchQuery } | { ok: false, error: QueryError }}
 */
export function parseQuery(searchParams) {
  for (const name of new Set(searchParams.keys())) {
    if (!KNOWN_PARAMS.has(name)) {
      return invalidQuery(name, "unknown query parameter");
    }
  }
  for (const name of SCALAR_PARAMS) {
    if (searchParams.getAll(name).length > 1) {
      return invalidQuery(name, "duplicate scalar parameter");
    }
  }

  const query = {
    q: "",
    trust: [],
    categories: [],
    tags: [],
    channels: [],
    turboismApi: null,
    cubismVersion: null,
    platforms: [],
    locale: "en",
    sort: "published-desc",
    page: 1,
    pageSize: 20,
  };

  const rawQ = searchParams.get("q");
  if (rawQ !== null) {
    const normalized = rawQ.normalize("NFKC").trim().toLowerCase();
    if (codePointLength(normalized) > MAX_Q_LENGTH) {
      return invalidQuery("q", `q must be at most ${MAX_Q_LENGTH} Unicode code points`);
    }
    query.q = normalized;
  }

  for (const [param, field, values] of [
    ["trust", "trust", TRUST_VALUES],
    ["channel", "channels", CHANNEL_VALUES],
    ["platform", "platforms", PLATFORM_VALUES],
  ]) {
    for (const raw of searchParams.getAll(param)) {
      if (!values.includes(raw)) {
        return invalidQuery(param, `invalid ${param} value`);
      }
      if (!query[field].includes(raw)) {
        query[field].push(raw);
      }
    }
  }

  for (const [param, field, label] of [
    ["tag", "tags", "tag"],
    ["category", "categories", "category"],
  ]) {
    for (const raw of searchParams.getAll(param)) {
      const problem = validateKebabParam(raw, param, label);
      if (problem) return problem;
      if (!query[field].includes(raw)) {
        query[field].push(raw);
      }
    }
  }

  const turboismApi = searchParams.get("turboismApi");
  if (turboismApi !== null) {
    if (parseStrictVersion(turboismApi) === null) {
      return invalidQuery("turboismApi", "must be a strict MAJOR.MINOR.PATCH version");
    }
    query.turboismApi = turboismApi;
  }

  const cubismVersion = searchParams.get("cubismVersion");
  if (cubismVersion !== null) {
    if (!RE_HOST_VERSION.test(cubismVersion)) {
      return invalidQuery("cubismVersion", "must be a host version like 5.3.02");
    }
    query.cubismVersion = cubismVersion;
  }

  const locale = searchParams.get("locale");
  if (locale !== null) {
    if (!LOCALE_VALUES.includes(locale)) {
      return invalidQuery("locale", `must be one of ${LOCALE_VALUES.join(", ")}`);
    }
    query.locale = locale;
  }

  const sort = searchParams.get("sort");
  if (sort !== null) {
    if (!SORT_VALUES.includes(sort)) {
      return invalidQuery("sort", `must be one of ${SORT_VALUES.join(", ")}`);
    }
    query.sort = sort;
  }

  const page = searchParams.get("page");
  if (page !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(page) || Number(page) < 1 || Number(page) > Number.MAX_SAFE_INTEGER) {
      return invalidQuery("page", "page must be a canonical integer of 1 or greater, within the safe integer range");
    }
    query.page = Number(page);
  }

  const pageSize = searchParams.get("pageSize");
  if (pageSize !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(pageSize) || Number(pageSize) < 1 || Number(pageSize) > MAX_PAGE_SIZE) {
      return invalidQuery("pageSize", `pageSize must be a canonical integer between 1 and ${MAX_PAGE_SIZE}`);
    }
    query.pageSize = Number(pageSize);
  }

  return { ok: true, query };
}

const normalizeText = (value) => value.normalize("NFKC").toLowerCase();

function displayNameFor(plugin, locale) {
  const localized = plugin.localizations && plugin.localizations[locale];
  return localized ? localized.name : plugin.name;
}

function displaySummaryFor(plugin, locale) {
  const localized = plugin.localizations && plugin.localizations[locale];
  return localized ? localized.summary : plugin.summary;
}

function releaseMatchesFilters(release, query) {
  if (release.status !== "active") return false;
  if (query.channels.length > 0 && !query.channels.includes(release.channel)) return false;
  if (query.turboismApi !== null) {
    const range = parseVersionRange(release.turboismApi);
    if (range === null) return false;
    if (!rangeContains(range, parseStrictVersion(query.turboismApi))) return false;
  }
  // Core runtime version must not substitute for the Cubism Editor release.
  if (query.cubismVersion !== null && release.requiresCubism && !release.cubismVersions.includes(query.cubismVersion)) {
    return false;
  }
  if (query.platforms.length > 0 && !release.platforms.some((platform) => query.platforms.includes(platform))) return false;
  if (query.categories.length > 0 && !query.categories.includes(release.category)) return false;
  if (query.tags.length > 0 && !release.tags.some((tag) => query.tags.includes(tag))) return false;
  return true;
}

/** q is one literal normalized substring over plugin identity and the release's own classification. */
function releaseMatchesQuery(release, query) {
  if (query.q === "") return true;
  const candidates = [release.category, ...release.tags].map(normalizeText);
  return candidates.some((candidate) => candidate.includes(query.q));
}

function pluginMatchesQuery(plugin, query) {
  if (query.q === "") return true;
  const candidates = [plugin.id, plugin.slug, displayNameFor(plugin, query.locale), displaySummaryFor(plugin, query.locale)].map(normalizeText);
  return candidates.some((candidate) => candidate.includes(query.q));
}

/**
 * Run the discovery search over a validated catalog. Deterministic: only active
 * releases participate; filters and q apply before the highest matching strict
 * version is selected; `latestCompatibleRelease` owns category/tags.
 * @param {object} catalog validated catalog object
 * @param {SearchQuery} query parsed query
 * @returns {object} full search response body (canonical key order)
 */
export function runSearch(catalog, query) {
  const matches = [];
  for (const plugin of catalog.plugins) {
    if (query.trust.length > 0 && !query.trust.includes(plugin.trust)) continue;
    const pluginQ = pluginMatchesQuery(plugin, query);
    const candidates = plugin.releases.filter((release) => {
      if (!releaseMatchesFilters(release, query)) return false;
      if (pluginQ) return true;
      return releaseMatchesQuery(release, query);
    });
    if (candidates.length === 0) continue;
    const latestCompatibleRelease = candidates.reduce((best, release) =>
      compareVersions(parseStrictVersion(release.version), parseStrictVersion(best.version)) > 0 ? release : best,
    );
    // updated-desc reflects the most recent MATCHING candidate release; yanked,
    // filtered-out, and incompatible releases never contribute.
    const updatedAt = candidates.reduce((max, release) => (release.publishedAt > max ? release.publishedAt : max), "");
    matches.push({
      plugin,
      latestCompatibleRelease,
      displayName: displayNameFor(plugin, query.locale),
      displaySummary: displaySummaryFor(plugin, query.locale),
      updatedAt,
    });
  }

  const idAsc = (a, b) => (a.plugin.id < b.plugin.id ? -1 : a.plugin.id > b.plugin.id ? 1 : 0);
  const nameForSort = (a) => normalizeText(a.displayName);
  const comparators = {
    "published-desc": (a, b) => {
      const byDate = b.latestCompatibleRelease.publishedAt.localeCompare(a.latestCompatibleRelease.publishedAt);
      return byDate !== 0 ? byDate : idAsc(a, b);
    },
    "updated-desc": (a, b) => {
      const byDate = b.updatedAt.localeCompare(a.updatedAt);
      return byDate !== 0 ? byDate : idAsc(a, b);
    },
    "name-asc": (a, b) => {
      const byName = nameForSort(a) < nameForSort(b) ? -1 : nameForSort(a) > nameForSort(b) ? 1 : 0;
      return byName !== 0 ? byName : idAsc(a, b);
    },
    "name-desc": (a, b) => {
      const byName = nameForSort(b) < nameForSort(a) ? -1 : nameForSort(b) > nameForSort(a) ? 1 : 0;
      return byName !== 0 ? byName : idAsc(a, b);
    },
  };
  matches.sort(comparators[query.sort]);

  const totalItems = matches.length;
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / query.pageSize);
  const start = (query.page - 1) * query.pageSize;
  const pageItems = query.page > totalPages ? [] : matches.slice(start, start + query.pageSize);

  const items = pageItems.map(({ plugin, latestCompatibleRelease, displayName, displaySummary }) => ({
    id: plugin.id,
    slug: plugin.slug,
    displayName,
    displaySummary,
    trust: plugin.trust,
    author: plugin.author,
    license: plugin.license,
    repository: plugin.repository,
    support: plugin.support,
    latestCompatibleRelease,
  }));

  const normalizedQuery = {
    q: query.q,
    trust: query.trust,
    categories: query.categories,
    tags: query.tags,
    channels: query.channels,
    platforms: query.platforms,
    locale: query.locale,
    sort: query.sort,
  };
  if (query.turboismApi !== null) normalizedQuery.turboismApi = query.turboismApi;
  if (query.cubismVersion !== null) normalizedQuery.cubismVersion = query.cubismVersion;

  return {
    format: SEARCH_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    catalogVersion: catalog.catalogVersion,
    query: normalizedQuery,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages,
      hasPrevious: query.page > 1 && totalItems > 0,
      hasNext: query.page < totalPages,
    },
    items,
  };
}

// ---------------------------------------------------------------------------
// Bounded schema-v3 JAR descriptor inspection (contract 5.3 and 8).
// ---------------------------------------------------------------------------

const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const EOCD_SIZE = 22;
const EOCD_MAX_SEARCH = 65557;

/** Strict plugin JAR policy: valid ZIP, exactly one descriptor, no traversal names, bounded reads. */
export function inspectJarFile(jarPath, artifact) {
  const issues = [];
  // Reject symlinks before opening; open, fstat, and enforce the size cap
  // BEFORE reading any bytes.
  let lstat;
  try {
    lstat = lstatSync(jarPath);
  } catch {
    return { ok: false, errors: [{ path: "jar", message: "JAR file is not readable" }] };
  }
  if (lstat.isSymbolicLink()) {
    return { ok: false, errors: [{ path: "jar", message: "JAR must not be a symbolic link" }] };
  }
  let fd;
  try {
    fd = openSync(jarPath, "r");
  } catch {
    return { ok: false, errors: [{ path: "jar", message: "JAR file is not readable" }] };
  }
  let stats;
  try {
    stats = fstatSync(fd);
  } catch {
    closeSync(fd);
    return { ok: false, errors: [{ path: "jar", message: "JAR file is not stat-able" }] };
  }
  if (!stats.isFile()) {
    closeSync(fd);
    return { ok: false, errors: [{ path: "jar", message: "JAR must be a regular file" }] };
  }
  if (stats.size > MAX_ARTIFACT_SIZE) {
    closeSync(fd);
    return { ok: false, errors: [{ path: "jar", message: `JAR must be at most ${MAX_ARTIFACT_SIZE} bytes` }] };
  }
  let bytes;
  try {
    bytes = readFileSync(fd);
  } catch {
    closeSync(fd);
    return { ok: false, errors: [{ path: "jar", message: "JAR file is not readable" }] };
  }
  closeSync(fd);

  const jarSha256 = sha256Hex(bytes);
  if (jarSha256 !== artifact.sha256) {
    issues.push({ path: "jar.sha256", message: `JAR SHA-256 ${jarSha256} does not equal artifact.sha256` });
  }
  if (bytes.byteLength !== artifact.size) {
    issues.push({ path: "jar.size", message: `JAR size ${bytes.byteLength} does not equal artifact.size` });
  }
  if (bytes.byteLength < EOCD_SIZE + 4) {
    issues.push({ path: "jar", message: "not a valid ZIP/JAR file" });
    return { ok: false, errors: issues };
  }

  const eocd = findEocd(bytes);
  if (eocd === null) {
    issues.push({ path: "jar", message: "missing or misplaced ZIP end-of-central-directory record" });
    return { ok: false, errors: issues };
  }
  // Multi-disk archives are rejected; the EOCD must describe a single disk.
  const diskNumber = bytes.readUInt16LE(eocd + 4);
  const cdStartDisk = bytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocd + 8);
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  if (diskNumber !== 0 || cdStartDisk !== 0 || entriesOnDisk !== totalEntries) {
    issues.push({ path: "jar", message: "multi-disk ZIP archives are not allowed" });
    return { ok: false, errors: issues };
  }
  const cdSize = bytes.readUInt32LE(eocd + 12);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > bytes.byteLength || cdOffset + cdSize !== eocd) {
    issues.push({ path: "jar", message: "central directory must end exactly at the end-of-central-directory record" });
    return { ok: false, errors: issues };
  }
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    issues.push({ path: "jar", message: "ZIP64 archives are not supported" });
    return { ok: false, errors: issues };
  }
  if (totalEntries > MAX_JAR_ENTRIES) {
    issues.push({ path: "jar", message: `JAR has more than ${MAX_JAR_ENTRIES} entries` });
    return { ok: false, errors: issues };
  }

  let descriptorEntry = null;
  let offset = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (offset + 46 > bytes.byteLength || bytes.readUInt32LE(offset) !== ZIP_CENTRAL_SIG) {
      issues.push({ path: "jar", message: "malformed central directory" });
      return { ok: false, errors: issues };
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLen = bytes.readUInt16LE(offset + 28);
    const extraLen = bytes.readUInt16LE(offset + 30);
    const commentLen = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    if ((flags & 0x0001) !== 0) {
      issues.push({ path: "jar", message: "encrypted entries are not allowed" });
      return { ok: false, errors: issues };
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      issues.push({ path: "jar", message: "ZIP64 entries are not supported" });
      return { ok: false, errors: issues };
    }
    const nameStart = offset + 46;
    if (nameStart + nameLen > bytes.byteLength) {
      issues.push({ path: "jar", message: "entry name exceeds file bounds" });
      return { ok: false, errors: issues };
    }
    const name = bytes.toString("utf8", nameStart, nameStart + nameLen);
    if (name.length === 0 || name.startsWith("/") || name.includes("\\") || name.split("/").some((segment) => segment === ".." || segment.includes(".."))) {
      issues.push({ path: "jar", message: `entry name "${name}" is not a safe relative path` });
      return { ok: false, errors: issues };
    }
    if (name === DESCRIPTOR_ENTRY) {
      if (descriptorEntry !== null) {
        issues.push({ path: "jar", message: `more than one ${DESCRIPTOR_ENTRY} entry` });
        return { ok: false, errors: issues };
      }
      descriptorEntry = { flags, method, compressedSize, uncompressedSize, localOffset, nameLen, extraLen, commentLen };
    }
    offset = nameStart + nameLen + extraLen + commentLen;
  }
  // Central directory length and count must be exact.
  if (offset !== cdOffset + cdSize) {
    issues.push({ path: "jar", message: "central directory length does not match the declared size" });
    return { ok: false, errors: issues };
  }

  if (descriptorEntry === null) {
    issues.push({ path: "jar", message: `missing ${DESCRIPTOR_ENTRY} entry` });
    return { ok: false, errors: issues };
  }
  if (descriptorEntry.uncompressedSize > MAX_DESCRIPTOR_BYTES) {
    issues.push({ path: "jar", message: `${DESCRIPTOR_ENTRY} exceeds ${MAX_DESCRIPTOR_BYTES} uncompressed bytes` });
    return { ok: false, errors: issues };
  }
  if (descriptorEntry.localOffset + 30 > bytes.byteLength || bytes.readUInt32LE(descriptorEntry.localOffset) !== ZIP_LOCAL_SIG) {
    issues.push({ path: "jar", message: "descriptor local header is malformed" });
    return { ok: false, errors: issues };
  }
  const localFlags = bytes.readUInt16LE(descriptorEntry.localOffset + 6);
  const localMethod = bytes.readUInt16LE(descriptorEntry.localOffset + 8);
  const localNameLen = bytes.readUInt16LE(descriptorEntry.localOffset + 26);
  const localExtraLen = bytes.readUInt16LE(descriptorEntry.localOffset + 28);
  if (localFlags !== descriptorEntry.flags || localMethod !== descriptorEntry.method) {
    issues.push({ path: "jar", message: "descriptor local and central flags/method differ" });
    return { ok: false, errors: issues };
  }
  const dataStart = descriptorEntry.localOffset + 30 + localNameLen + localExtraLen;
  const localName = bytes.toString("utf8", descriptorEntry.localOffset + 30, descriptorEntry.localOffset + 30 + localNameLen);
  if (localName !== DESCRIPTOR_ENTRY) {
    issues.push({ path: "jar", message: "descriptor local and central entry names differ" });
    return { ok: false, errors: issues };
  }
  if (dataStart + descriptorEntry.compressedSize > bytes.byteLength) {
    issues.push({ path: "jar", message: "descriptor data exceeds file bounds" });
    return { ok: false, errors: issues };
  }
  const compressed = bytes.subarray(dataStart, dataStart + descriptorEntry.compressedSize);
  let descriptorBytes;
  if (descriptorEntry.method === 0) {
    descriptorBytes = Buffer.from(compressed);
  } else if (descriptorEntry.method === 8) {
    try {
      descriptorBytes = inflateRawSync(compressed, { maxOutputLength: MAX_DESCRIPTOR_BYTES });
    } catch {
      issues.push({ path: "jar", message: "descriptor data is not valid deflate" });
      return { ok: false, errors: issues };
    }
  } else {
    issues.push({ path: "jar", message: `unsupported ZIP method ${descriptorEntry.method} for descriptor` });
    return { ok: false, errors: issues };
  }
  // The actual descriptor bytes must equal the declared uncompressed size and
  // stay within the 1 MiB cap (STORED included).
  if (descriptorBytes.byteLength !== descriptorEntry.uncompressedSize) {
    issues.push({ path: "jar", message: "descriptor bytes do not equal the declared uncompressed size" });
    return { ok: false, errors: issues };
  }
  if (descriptorBytes.byteLength > MAX_DESCRIPTOR_BYTES) {
    issues.push({ path: "jar", message: `${DESCRIPTOR_ENTRY} exceeds ${MAX_DESCRIPTOR_BYTES} uncompressed bytes` });
    return { ok: false, errors: issues };
  }
  const descriptorSha256 = sha256Hex(descriptorBytes);
  if (descriptorSha256 !== artifact.descriptorSha256) {
    issues.push({ path: "jar.descriptorSha256", message: `descriptor SHA-256 ${descriptorSha256} does not equal artifact.descriptorSha256` });
  }
  const parsed = parseStrictJsonBytes(descriptorBytes);
  if (!parsed.ok) {
    issues.push({ path: "jar.descriptor", message: `descriptor must be valid strict UTF-8 JSON: ${parsed.message}` });
    return { ok: false, errors: issues };
  }
  const descriptor = parsed.value;
  if (!isPlainObject(descriptor)) {
    issues.push({ path: "jar.descriptor", message: "descriptor must be an object" });
    return { ok: false, errors: issues };
  }
  return { ok: issues.length === 0, errors: issues, descriptor, jarSha256, jarSize: bytes.byteLength, descriptorSha256, descriptorBytes };
}

/**
 * Locate the end-of-central-directory record with a strict endpoint: the
 * record must end exactly at end-of-file (offset + 22 + commentLen === size),
 * scanning from the end so the LAST self-consistent record wins. A ZIP64
 * EOCD locator (0x07064b50) immediately before the candidate is rejected.
 */
function findEocd(bytes) {
  const size = bytes.byteLength;
  const start = Math.max(0, size - EOCD_MAX_SEARCH);
  for (let i = size - EOCD_SIZE; i >= start; i -= 1) {
    if (bytes.readUInt32LE(i) !== ZIP_EOCD_SIG) continue;
    const commentLen = bytes.readUInt16LE(i + 20);
    if (i + EOCD_SIZE + commentLen !== size) continue;
    // ZIP64 archives carry a 20-byte EOCD locator directly before the EOCD.
    if (i >= 20 && bytes.readUInt32LE(i - 20) === 0x07064b50) return null;
    return i;
  }
  return null;
}

const scopeOf = (permission) => (permission.scope === undefined || permission.scope === null ? "application" : permission.scope);
const typeOf = (dependency) => (dependency.type === undefined || dependency.type === null ? "required" : dependency.type);
const orderingOf = (dependency) => (dependency.ordering === undefined || dependency.ordering === null ? "none" : dependency.ordering);

/**
 * Normalize a descriptor permission list to { id, scope } with omitted scope
 * defaulting to "application" (contract 5.3).
 * @param {unknown} permissions
 * @returns {{ ok: true, entries: Array<{id: string, scope: string}> } | { ok: false, issues: ValidationIssue[] }}
 */
export function normalizeDescriptorPermissions(permissions) {
  if (!Array.isArray(permissions)) {
    return { ok: false, issues: [{ path: "descriptor.permissions", message: "must be an array" }] };
  }
  const entries = [];
  for (let i = 0; i < permissions.length; i += 1) {
    const item = permissions[i];
    if (!isPlainObject(item) || typeof item.id !== "string" || item.id.length === 0) {
      return { ok: false, issues: [{ path: `descriptor.permissions[${i}]`, message: "must be an object with a string id" }] };
    }
    const scope = scopeOf(item);
    if (!PERMISSION_SCOPE_VALUES.includes(scope)) {
      return { ok: false, issues: [{ path: `descriptor.permissions[${i}].scope`, message: `must be one of ${PERMISSION_SCOPE_VALUES.join(", ")}` }] };
    }
    entries.push({ id: item.id, scope });
  }
  return { ok: true, entries };
}

/**
 * Normalize a descriptor dependency list to { id, version, type, ordering }
 * with omitted type defaulting to "required" and ordering to "none".
 * @param {unknown} dependencies
 * @returns {{ ok: true, entries: Array<{id: string, version: string, type: string, ordering: string}> } | { ok: false, issues: ValidationIssue[] }}
 */
export function normalizeDescriptorDependencies(dependencies) {
  if (!Array.isArray(dependencies)) {
    return { ok: false, issues: [{ path: "descriptor.dependencies", message: "must be an array" }] };
  }
  const entries = [];
  for (let i = 0; i < dependencies.length; i += 1) {
    const item = dependencies[i];
    if (!isPlainObject(item) || typeof item.id !== "string" || item.id.length === 0) {
      return { ok: false, issues: [{ path: `descriptor.dependencies[${i}]`, message: "must be an object with a string id" }] };
    }
    const type = typeOf(item);
    const ordering = orderingOf(item);
    if (!DEPENDENCY_TYPE_VALUES.includes(type)) {
      return { ok: false, issues: [{ path: `descriptor.dependencies[${i}].type`, message: `must be one of ${DEPENDENCY_TYPE_VALUES.join(", ")}` }] };
    }
    if (!ORDERING_VALUES.includes(ordering)) {
      return { ok: false, issues: [{ path: `descriptor.dependencies[${i}].ordering`, message: `must be one of ${ORDERING_VALUES.join(", ")}` }] };
    }
    entries.push({ id: item.id, version: item.version, type, ordering });
  }
  return { ok: true, entries };
}

/**
 * Compare one catalog release to an inspected schema-v3 descriptor (contract
 * 5.3). The JAR inspection and descriptor hash comparison are separate steps
 * (inspectJarFile); this binds identity, classification, and normalized
 * capability metadata.
 * @param {object} release validated catalog release
 * @param {string} pluginId validated catalog plugin id
 * @param {object} descriptor parsed descriptor JSON
 * @returns {{ ok: true } | { ok: false, issues: ValidationIssue[] }}
 */
export function bindReleaseToDescriptor(release, pluginId, descriptor) {
  const issues = [];
  if (descriptor.format !== DESCRIPTOR_FORMAT) {
    issues.push({ path: "descriptor.format", message: `must be exactly "${DESCRIPTOR_FORMAT}", got ${JSON.stringify(descriptor.format)}` });
  }
  if (descriptor.schemaVersion !== 3) {
    issues.push({ path: "descriptor.schemaVersion", message: `must be exactly 3, got ${JSON.stringify(descriptor.schemaVersion)}` });
  }
  if (descriptor.id !== pluginId) {
    issues.push({ path: "descriptor.id", message: `descriptor id "${descriptor.id}" does not equal plugin id "${pluginId}"` });
  }
  if (descriptor.version !== release.version) {
    issues.push({ path: "descriptor.version", message: `descriptor version "${descriptor.version}" does not equal release version "${release.version}"` });
  }
  if (descriptor.category !== release.category) {
    issues.push({ path: "descriptor.category", message: `descriptor category "${descriptor.category}" does not equal release category "${release.category}"` });
  }
  const descriptorTags = Array.isArray(descriptor.tags) ? descriptor.tags : null;
  if (descriptorTags === null) {
    issues.push({ path: "descriptor.tags", message: "must be an array" });
  } else {
    const tagsMatch = descriptorTags.length === release.tags.length && descriptorTags.every((tag, i) => tag === release.tags[i]);
    if (!tagsMatch) {
      issues.push({
        path: "descriptor.tags",
        message: `ordered tags [${descriptorTags.join(", ")}] do not exactly equal release tags [${release.tags.join(", ")}]`,
      });
    }
  }
  if (descriptor.turboismApi !== release.turboismApi) {
    issues.push({ path: "descriptor.turboismApi", message: `descriptor turboismApi "${descriptor.turboismApi}" does not equal release turboismApi "${release.turboismApi}"` });
  }
  const requiresCubism = descriptor.environment && descriptor.environment.requiresCubism;
  if (typeof requiresCubism !== "boolean" || requiresCubism !== release.requiresCubism) {
    issues.push({
      path: "descriptor.environment.requiresCubism",
      message: `descriptor requiresCubism ${JSON.stringify(requiresCubism)} does not equal release requiresCubism ${release.requiresCubism}`,
    });
  }
  const permissions = normalizeDescriptorPermissions(descriptor.permissions);
  if (!permissions.ok) {
    issues.push(...permissions.issues);
  } else {
    const catalogPermissions = (release.permissions || []).map((p) => `${p.id}\u0000${p.scope}`).sort();
    const descriptorPermissionKeys = permissions.entries.map((p) => `${p.id}\u0000${p.scope}`).sort();
    if (JSON.stringify(catalogPermissions) !== JSON.stringify(descriptorPermissionKeys)) {
      issues.push({ path: "descriptor.permissions", message: "permission set does not agree with the release after scope normalization" });
    }
  }
  const dependencies = normalizeDescriptorDependencies(descriptor.dependencies);
  if (!dependencies.ok) {
    issues.push(...dependencies.issues);
  } else {
    const key = (d) => `${d.id}\u0000${d.version}\u0000${d.type}\u0000${d.ordering}`;
    const catalogDependencies = (release.dependencies || []).map(key).sort();
    const descriptorDependencyKeys = dependencies.entries.map(key).sort();
    if (JSON.stringify(catalogDependencies) !== JSON.stringify(descriptorDependencyKeys)) {
      issues.push({ path: "descriptor.dependencies", message: "dependency set does not agree with the release after type/ordering normalization" });
    }
  }
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}

/**
 * Full offline binding check for one release: JAR bytes/hash/size, descriptor
 * hash, schema-v3 descriptor identity and classification equality.
 * @param {string} jarPath
 * @param {object} release validated catalog release
 * @param {string} pluginId
 * @returns {{ ok: true } | { ok: false, errors: ValidationIssue[] }}
 */
export function checkJarBinding(jarPath, release, pluginId) {
  const inspected = inspectJarFile(jarPath, release.artifact);
  if (!inspected.ok) {
    return { ok: false, errors: inspected.errors };
  }
  const bound = bindReleaseToDescriptor(release, pluginId, inspected.descriptor);
  if (!bound.ok) {
    return { ok: false, errors: bound.issues };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Deployed production pair loading (contract 3 and 8).
// ---------------------------------------------------------------------------

/**
 * Default production storage directory (the static delivery root for the
 * /api/v2 path when Next.js routes are not shadowing it).
 */
export function defaultProductionDir() {
  return path.join(process.cwd(), "public", "api", "v2");
}
