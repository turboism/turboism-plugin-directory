// Strict third-party plugin JAR preflight, descriptor/sidecar alignment,
// localization/README extraction, and normalized SubmissionManifest generation.
import { closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import {
  MAX_ARTIFACT_SIZE,
  MAX_DESCRIPTOR_BYTES,
  MAX_JAR_ENTRIES,
  compareVersions,
  decodeUtf8Fatal,
  parseStrictJsonBytes,
  parseStrictVersion,
  parseVersionRange,
  sha256Hex,
  validateParsedCatalog,
} from "../catalog-v2/catalog.mjs";
import { extractJarReadmes } from "../catalog-v2/readme.mjs";
import { scanJarBytecode } from "./bytecode-scan.mjs";
import {
  isReservedOrRetiredPluginId,
  normalizeGitHubRepositoryUrl,
  validatePluginNamespaceAndOwnership,
} from "./ownership.mjs";

export const SUBMISSION_FORMAT = "turboism.plugin.submission";
export const SUBMISSION_SCHEMA_VERSION = 1;
export const REVIEWED_THIRD_PARTY_TRUST = "reviewed-third-party";

const DESCRIPTOR_ENTRY = "META-INF/turboism/plugin.json";
const MANIFEST_ENTRY_LOWER = "meta-inf/manifest.mf";
const CUBISM_SIDECAR_ENTRY = "META-INF/turboism/cubism-versions.json";
const CUBISM_SIDECAR_FORMAT = "turboism.plugin-cubism-versions/v1";
const DESCRIPTOR_FORMAT = "turboism.plugin.meta";
const ADMITTED_SUBMISSION_DESCRIPTOR_SCHEMAS = new Set([3, 4]);

const MAX_PATH_BYTES = 1024;
const MAX_PATH_DEPTH = 32;
const MAX_CUBISM_SIDECAR_BYTES = 64 * 1024;
const MAX_CUBISM_VERSIONS = 100;
const MAX_PROPERTIES_BYTES = 256 * 1024;
const MAX_README_BYTES = 1024 * 1024;
const MAX_COMPRESSION_RATIO = 100;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_TAGS = 12;
const MIN_TOKEN_LENGTH = 2;
const MAX_TOKEN_LENGTH = 32;

const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_EOCD_SIZE = 22;
const ZIP_EOCD_MAX_SEARCH = 65557;
const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATE = 8;

const DEFAULT_CHANNEL = "stable";
const DEFAULT_PLATFORM = "windows-x64";
const MEDIA_TYPE_JAR = "application/java-archive";
const ALLOWED_CHANNELS = Object.freeze(["stable", "preview"]);
const ALLOWED_ENV_UI = Object.freeze(["none", "swing", "embedded"]);
const ALLOWED_DEPENDENCY_TYPES = Object.freeze(["required", "optional"]);
const ALLOWED_ORDERINGS = Object.freeze(["none", "before", "after"]);
const ALLOWED_PERMISSION_SCOPES = Object.freeze(["application", "user"]);
const ALLOWED_SUBMISSION_KEYS = Object.freeze([
  "format",
  "schemaVersion",
  "submittedAt",
  "submitter",
  "repository",
  "plugin",
  "release",
  "bytecodeAudit",
  "readmes",
]);

const BASE_ALLOWED_DESCRIPTOR_KEYS = Object.freeze([
  "format",
  "schemaVersion",
  "id",
  "name",
  "version",
  "description",
  "entrypoints",
  "turboismApi",
  "authors",
  "license",
  "website",
  "resources",
  "i18n",
  "dependencies",
  "permissions",
  "capabilities",
  "environment",
  "lifecycle",
  "category",
  "tags",
]);
const V4_EXTRA_DESCRIPTOR_KEYS = Object.freeze(["eventExports", "eventImports"]);

const FORBIDDEN_PACKAGE_PREFIXES = Object.freeze([
  "dev/turboism/core/",
  "dev/turboism/hook/",
  "dev/turboism/mapping/",
  "dev/turboism/adapter/",
  "dev/turboism/permissions/",
  "dev/turboism/diagnostics/",
  "dev/turboism/bootstrap/",
  "dev/turboism/ui/",
  "dev/turboism/internal/",
  "dev/turboism/sdk/",
  "dev/turboism/test/",
  "dev/turboism/testframework/",
  "testframework/",
  "com/live2d/",
  "jp/noids/",
]);

const FORBIDDEN_HOST_PREFIXES = Object.freeze(["native/", "natives/", "host/", "cubism/", "live2d/"]);
const FORBIDDEN_NATIVE_SUFFIXES = Object.freeze([
  ".dll",
  ".so",
  ".dylib",
  ".exe",
  ".msi",
  ".jnilib",
  ".dmg",
  ".pkg",
  ".app",
  ".deb",
  ".rpm",
]);
const FORBIDDEN_SCRIPT_SUFFIXES = Object.freeze([".sh", ".bat", ".cmd", ".ps1"]);

const RE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.jar$/;
const RE_PLUGIN_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_HOST_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const RE_SOURCE_REVISION = /^[0-9a-f]{40}$/;
const RE_UTC_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/;
const RE_LOCALE_ID = /^[A-Za-z]{2,8}(?:[-_][A-Za-z0-9]{1,8})*$/;
const RE_JAVA_IDENTIFIER = /^[$_\p{L}][$_\p{L}\p{N}]*$/u;
const RE_FORBIDDEN_MANIFEST_AGENT = /^(?:premain-class|agent-class)\s*:/im;

const LOCALE_CANDIDATES = Object.freeze({
  "zh-Hans": Object.freeze(["zh-Hans", "zh_Hans", "zh-CN", "zh_CN", "zh"]),
  "zh-Hant": Object.freeze(["zh-Hant", "zh_Hant", "zh-TW", "zh_TW", "zh-HK", "zh_HK"]),
  ja: Object.freeze(["ja", "ja-JP", "ja_JP"]),
  ko: Object.freeze(["ko", "ko-KR", "ko_KR"]),
});

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInt(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isValidUtcDateTime(value) {
  if (typeof value !== "string" || !RE_UTC_DATE_TIME.test(value)) return false;
  const parsed = Date.parse(value);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 19) + "Z" === value;
}

function isJavaBinaryName(value) {
  if (typeof value !== "string" || value.length === 0) return false;
  return value.split(".").every((segment) => segment.length > 0 && RE_JAVA_IDENTIFIER.test(segment));
}

function isNormalizedResourcePath(value, requireTrailingSlash) {
  if (typeof value !== "string" || value.length === 0) return false;
  if (requireTrailingSlash && !value.endsWith("/")) return false;
  if (value.startsWith("/") || value.includes("\\")) return false;
  const trimmed = requireTrailingSlash ? value.slice(0, -1) : value;
  if (trimmed.length === 0) return false;
  const segments = trimmed.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function isValidKebabToken(value) {
  if (typeof value !== "string") return false;
  const codePoints = [...value].length;
  return codePoints >= MIN_TOKEN_LENGTH && codePoints <= MAX_TOKEN_LENGTH && RE_KEBAB.test(value);
}

function hasUtf8Bom(bytes) {
  return bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function readBoundedJarBytes(jarPathOrBytes) {
  if (Buffer.isBuffer(jarPathOrBytes)) {
    return { ok: true, bytes: jarPathOrBytes };
  }
  if (jarPathOrBytes instanceof Uint8Array) {
    return { ok: true, bytes: Buffer.from(jarPathOrBytes) };
  }
  if (typeof jarPathOrBytes !== "string" || jarPathOrBytes.length === 0) {
    return { ok: false, errors: [{ path: "jar", message: "JAR path or buffer is required" }] };
  }
  let lstat;
  try {
    lstat = lstatSync(jarPathOrBytes);
  } catch {
    return { ok: false, errors: [{ path: "jar", message: "JAR file is not readable" }] };
  }
  if (lstat.isSymbolicLink()) {
    return { ok: false, errors: [{ path: "jar", message: "JAR must not be a symbolic link" }] };
  }
  let fd;
  try {
    fd = openSync(jarPathOrBytes, "r");
  } catch {
    return { ok: false, errors: [{ path: "jar", message: "JAR file is not readable" }] };
  }
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) {
      return { ok: false, errors: [{ path: "jar", message: "JAR must be a regular file" }] };
    }
    if (stats.size < 1 || stats.size > MAX_ARTIFACT_SIZE) {
      return {
        ok: false,
        errors: [{ path: "jar.size", message: `JAR size must be between 1 and ${MAX_ARTIFACT_SIZE} bytes` }],
      };
    }
    return { ok: true, bytes: readFileSync(fd) };
  } catch {
    return { ok: false, errors: [{ path: "jar", message: "JAR file is not readable" }] };
  } finally {
    closeSync(fd);
  }
}

function findZipEocd(bytes) {
  const size = bytes.byteLength;
  const start = Math.max(0, size - ZIP_EOCD_MAX_SEARCH);
  for (let i = size - ZIP_EOCD_SIZE; i >= start; i -= 1) {
    if (bytes.readUInt32LE(i) !== ZIP_EOCD_SIG) continue;
    const commentLen = bytes.readUInt16LE(i + 20);
    if (i + ZIP_EOCD_SIZE + commentLen !== size) continue;
    if (i >= 20 && bytes.readUInt32LE(i - 20) === 0x07064b50) return null;
    return i;
  }
  return null;
}

function validateSafeEntryPath(name, isDirectory) {
  if (typeof name !== "string" || name.length === 0) return false;
  const trimmed = isDirectory && name.endsWith("/") ? name.slice(0, -1) : name;
  if (trimmed.length === 0) return false;
  if (trimmed !== trimmed.normalize("NFC")) return false;
  if (Buffer.byteLength(trimmed, "utf8") > MAX_PATH_BYTES) return false;
  if (trimmed.startsWith("/") || trimmed.includes("\\")) return false;
  const segments = trimmed.split("/");
  if (segments.length > MAX_PATH_DEPTH) return false;
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function detectContamination(entryName) {
  const lower = entryName.toLowerCase();
  if (lower.endsWith(".jar")) {
    return "nested JAR archives are not allowed";
  }
  if (lower.startsWith("meta-inf/versions/")) {
    return "multi-release META-INF/versions/ entries are not allowed";
  }
  if (lower === "meta-inf/turboism/hooks" || lower.startsWith("meta-inf/turboism/hooks/")) {
    return "META-INF/turboism/hooks entries are not allowed";
  }
  if (lower.startsWith("meta-inf/turboism/contracts/")) {
    return "META-INF/turboism/contracts/ entries are not allowed";
  }
  if (lower.endsWith("/meta-inf/turboism/plugin.json")) {
    return "nested plugin.json descriptors are not allowed";
  }
  for (const prefix of FORBIDDEN_PACKAGE_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return `entry under reserved package prefix "${prefix}" is not allowed`;
    }
  }
  if (lower.startsWith("dev/turboism/") && lower.includes("/internal/")) {
    return "entries under dev/turboism/**/internal/ are not allowed";
  }
  for (const prefix of FORBIDDEN_HOST_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return `entry under reserved host prefix "${prefix}" is not allowed`;
    }
  }
  for (const suffix of FORBIDDEN_NATIVE_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return `native binary "${entryName}" is not allowed`;
    }
  }
  for (const suffix of FORBIDDEN_SCRIPT_SUFFIXES) {
    if (lower.endsWith(suffix)) {
      return `installer or shell script "${entryName}" is not allowed`;
    }
  }
  return null;
}

function inflateZipEntry(bytes, entry, maxBytes) {
  if (entry.uncompressedSize > maxBytes) {
    throw new Error(`JAR entry "${entry.name}" exceeds ${maxBytes} uncompressed bytes`);
  }
  if (entry.localOffset + 30 > bytes.byteLength || bytes.readUInt32LE(entry.localOffset) !== ZIP_LOCAL_SIG) {
    throw new Error(`JAR entry "${entry.name}" has a malformed local header`);
  }
  const localFlags = bytes.readUInt16LE(entry.localOffset + 6);
  const localMethod = bytes.readUInt16LE(entry.localOffset + 8);
  const localNameLen = bytes.readUInt16LE(entry.localOffset + 26);
  const localExtraLen = bytes.readUInt16LE(entry.localOffset + 28);
  if (localFlags !== entry.flags || localMethod !== entry.method) {
    throw new Error(`JAR entry "${entry.name}" local/central flags or method disagree`);
  }
  const localName = bytes.toString("utf8", entry.localOffset + 30, entry.localOffset + 30 + localNameLen);
  if (localName !== entry.name) {
    throw new Error(`JAR entry "${entry.name}" local and central names disagree`);
  }
  const dataStart = entry.localOffset + 30 + localNameLen + localExtraLen;
  if (dataStart + entry.compressedSize > bytes.byteLength) {
    throw new Error(`JAR entry "${entry.name}" compressed data exceeds file bounds`);
  }
  if (entry.method === ZIP_METHOD_DEFLATE && entry.compressedSize > 0) {
    const ratio = entry.uncompressedSize / entry.compressedSize;
    if (ratio > MAX_COMPRESSION_RATIO) {
      throw new Error(`JAR entry "${entry.name}" compression ratio exceeds limit`);
    }
  }
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  let output;
  if (entry.method === ZIP_METHOD_STORED) {
    output = Buffer.from(compressed);
  } else if (entry.method === ZIP_METHOD_DEFLATE) {
    output = inflateRawSync(compressed, { maxOutputLength: maxBytes });
  } else {
    throw new Error(`JAR entry "${entry.name}" uses unsupported ZIP method ${entry.method}`);
  }
  if (output.byteLength !== entry.uncompressedSize) {
    throw new Error(`JAR entry "${entry.name}" uncompressed size mismatch`);
  }
  return output;
}

function inspectJarArchiveStructure(bytes) {
  const issues = [];
  if (bytes.byteLength < ZIP_EOCD_SIZE + 4) {
    return { ok: false, errors: [{ path: "jar", message: "not a valid ZIP/JAR file" }] };
  }
  const eocd = findZipEocd(bytes);
  if (eocd === null) {
    return { ok: false, errors: [{ path: "jar", message: "missing or misplaced ZIP end-of-central-directory record" }] };
  }
  const diskNumber = bytes.readUInt16LE(eocd + 4);
  const cdStartDisk = bytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocd + 8);
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  if (diskNumber !== 0 || cdStartDisk !== 0 || entriesOnDisk !== totalEntries) {
    return { ok: false, errors: [{ path: "jar", message: "multi-disk ZIP archives are not allowed" }] };
  }
  const cdSize = bytes.readUInt32LE(eocd + 12);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize !== eocd) {
    return { ok: false, errors: [{ path: "jar", message: "central directory must end exactly at EOCD" }] };
  }
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    return { ok: false, errors: [{ path: "jar", message: "ZIP64 archives are not supported" }] };
  }
  if (totalEntries > MAX_JAR_ENTRIES) {
    return { ok: false, errors: [{ path: "jar", message: `JAR exceeds ${MAX_JAR_ENTRIES} entries` }] };
  }

  const entriesByName = new Map();
  const collisionCheck = new Map();
  let totalUncompressed = 0;
  let offset = cdOffset;
  for (let i = 0; i < totalEntries; i += 1) {
    if (offset + 46 > bytes.byteLength || bytes.readUInt32LE(offset) !== ZIP_CENTRAL_SIG) {
      return { ok: false, errors: [{ path: "jar", message: "malformed central directory" }] };
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLen = bytes.readUInt16LE(offset + 28);
    const extraLen = bytes.readUInt16LE(offset + 30);
    const commentLen = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    if (nameStart + nameLen > bytes.byteLength) {
      return { ok: false, errors: [{ path: "jar", message: "entry name exceeds file bounds" }] };
    }
    if ((flags & 0x0001) !== 0) {
      return { ok: false, errors: [{ path: "jar", message: "encrypted JAR entries are not allowed" }] };
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      return { ok: false, errors: [{ path: "jar", message: "ZIP64 entries are not supported" }] };
    }
    const name = bytes.toString("utf8", nameStart, nameStart + nameLen);
    offset = nameStart + nameLen + extraLen + commentLen;
    const isDirectory = name.endsWith("/");
    if (!validateSafeEntryPath(name, isDirectory)) {
      issues.push({ path: `jar.entry.${name}`, message: `unsafe JAR entry path "${name}"` });
      continue;
    }
    const normalizedLower = (isDirectory ? name.slice(0, -1) : name).toLowerCase();
    const existingCollision = collisionCheck.get(normalizedLower);
    if (existingCollision !== undefined) {
      issues.push({
        path: `jar.entry.${name}`,
        message: `case-colliding or duplicate JAR entry "${name}" conflicts with "${existingCollision}"`,
      });
      continue;
    }
    collisionCheck.set(normalizedLower, name);
    if (isDirectory) continue;

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      issues.push({ path: "jar", message: `JAR total uncompressed bytes exceed ${MAX_TOTAL_UNCOMPRESSED_BYTES}` });
      break;
    }

    const contaminationReason = detectContamination(name);
    if (contaminationReason !== null) {
      issues.push({ path: `jar.entry.${name}`, message: contaminationReason });
      continue;
    }

    entriesByName.set(name, { name, flags, method, compressedSize, uncompressedSize, localOffset });
  }
  if (offset !== cdOffset + cdSize) {
    issues.push({ path: "jar", message: "central directory length mismatch" });
  }
  return issues.length > 0 ? { ok: false, errors: issues } : { ok: true, entriesByName };
}

function unescapeJavaPropertiesText(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    i += 1;
    if (i >= raw.length) break;
    const next = raw[i];
    switch (next) {
      case "t":
        out += "\t";
        break;
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "f":
        out += "\f";
        break;
      case "u": {
        const hex = raw.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          out += String.fromCharCode(Number.parseInt(hex, 16));
          i += 4;
        } else {
          out += "u";
        }
        break;
      }
      default:
        out += next;
        break;
    }
  }
  return out;
}

/**
 * Parses a Java .properties resource bundle into a key-value map.
 * @param {string} content
 * @returns {Record<string, string>}
 */
export function parseJavaProperties(content) {
  const result = {};
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length) {
    let line = lines[index].replace(/^[ \t\f]+/, "");
    index += 1;
    if (line.length === 0 || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }
    while (index < lines.length) {
      let backslashes = 0;
      for (let pos = line.length - 1; pos >= 0 && line[pos] === "\\"; pos -= 1) {
        backslashes += 1;
      }
      if (backslashes % 2 === 0) break;
      line = line.slice(0, -1) + lines[index].replace(/^[ \t\f]+/, "");
      index += 1;
    }
    let sep = -1;
    for (let i = 0; i < line.length; i += 1) {
      if (line[i] === "\\") {
        i += 1;
        continue;
      }
      if (line[i] === "=" || line[i] === ":" || line[i] === " " || line[i] === "\t") {
        sep = i;
        break;
      }
    }
    const rawKey = sep === -1 ? line : line.slice(0, sep);
    let rawVal = sep === -1 ? "" : line.slice(sep);
    if (sep !== -1) {
      rawVal = rawVal.replace(/^[ \t\f]*[=:]?[ \t\f]*/, "");
    }
    const key = unescapeJavaPropertiesText(rawKey);
    if (key.length > 0) {
      result[key] = unescapeJavaPropertiesText(rawVal);
    }
  }
  return result;
}

function validateAndParseDescriptor(descriptorBytes, issues) {
  if (hasUtf8Bom(descriptorBytes)) {
    issues.push({ path: "descriptor", message: "plugin.json must not start with a UTF-8 BOM" });
    return null;
  }
  const parsed = parseStrictJsonBytes(descriptorBytes);
  if (!parsed.ok) {
    issues.push({ path: "descriptor", message: `plugin.json must be strict UTF-8 JSON: ${parsed.message}` });
    return null;
  }
  const d = parsed.value;
  if (!isPlainObject(d)) {
    issues.push({ path: "descriptor", message: "plugin.json must be a JSON object" });
    return null;
  }
  if (d.format !== DESCRIPTOR_FORMAT) {
    issues.push({ path: "descriptor.format", message: `format must be "${DESCRIPTOR_FORMAT}"` });
  }
  if (!ADMITTED_SUBMISSION_DESCRIPTOR_SCHEMAS.has(d.schemaVersion)) {
    issues.push({ path: "descriptor.schemaVersion", message: "schemaVersion must be 3 or 4 for third-party submissions" });
    return null;
  }
  const allowedKeys = d.schemaVersion === 4
    ? [...BASE_ALLOWED_DESCRIPTOR_KEYS, ...V4_EXTRA_DESCRIPTOR_KEYS]
    : BASE_ALLOWED_DESCRIPTOR_KEYS;
  for (const key of Object.keys(d)) {
    if (!allowedKeys.includes(key)) {
      issues.push({ path: "descriptor", message: `unknown descriptor field "${key}"` });
    }
  }
  if (typeof d.id !== "string" || !RE_PLUGIN_ID.test(d.id) || d.id.length > 128) {
    issues.push({ path: "descriptor.id", message: "id must be a lowercase reverse-domain identifier" });
  } else if (isReservedOrRetiredPluginId(d.id)) {
    issues.push({ path: "descriptor.id", message: `plugin id "${d.id}" belongs to a reserved or retired namespace` });
  }
  if (typeof d.name !== "string" || d.name.trim().length === 0 || [...d.name].length > 120) {
    issues.push({ path: "descriptor.name", message: "name must be 1-120 code points" });
  }
  if (typeof d.version !== "string" || parseStrictVersion(d.version) === null) {
    issues.push({ path: "descriptor.version", message: "version must be strict MAJOR.MINOR.PATCH" });
  }
  if (d.description !== undefined && (typeof d.description !== "string" || [...d.description].length > 500)) {
    issues.push({ path: "descriptor.description", message: "description must be a string up to 500 code points" });
  }
  if (!Array.isArray(d.entrypoints) || d.entrypoints.length === 0) {
    issues.push({ path: "descriptor.entrypoints", message: "entrypoints must be a non-empty array of class names" });
  } else {
    const seenEp = new Set();
    d.entrypoints.forEach((ep, index) => {
      if (!isJavaBinaryName(ep)) {
        issues.push({ path: `descriptor.entrypoints[${index}]`, message: "entrypoint must be a valid Java binary class name" });
      } else if (seenEp.has(ep)) {
        issues.push({ path: `descriptor.entrypoints[${index}]`, message: `duplicate entrypoint "${ep}"` });
      } else {
        seenEp.add(ep);
      }
    });
  }
  if (typeof d.turboismApi !== "string" || parseVersionRange(d.turboismApi) === null) {
    issues.push({ path: "descriptor.turboismApi", message: "turboismApi must be a valid version or half-open range" });
  }
  if (!Array.isArray(d.authors) || d.authors.length === 0) {
    issues.push({ path: "descriptor.authors", message: "authors must be a non-empty array" });
  } else {
    d.authors.forEach((author, index) => {
      if (!isPlainObject(author) || typeof author.name !== "string" || author.name.trim().length === 0) {
        issues.push({ path: `descriptor.authors[${index}]`, message: "author must be an object with a non-empty name" });
      } else if ([...author.name].length > 120) {
        issues.push({ path: `descriptor.authors[${index}].name`, message: "author name must be at most 120 code points" });
      }
      if (isPlainObject(author)) {
        for (const key of Object.keys(author)) {
          if (key !== "name" && key !== "email") {
            issues.push({ path: `descriptor.authors[${index}]`, message: `unknown author field "${key}"` });
          }
        }
        if (author.email !== undefined && (typeof author.email !== "string" || author.email.trim().length === 0)) {
          issues.push({ path: `descriptor.authors[${index}].email`, message: "author email must be a non-empty string" });
        }
      }
    });
  }
  if (typeof d.license !== "string" || d.license.trim().length === 0 || [...d.license].length > 100) {
    issues.push({ path: "descriptor.license", message: "license must be a non-empty string up to 100 code points" });
  }
  if (typeof d.website !== "string") {
    issues.push({ path: "descriptor.website", message: "website must be an HTTP(S) URL string" });
  } else {
    try {
      const url = new URL(d.website);
      if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname === "") {
        issues.push({ path: "descriptor.website", message: "website must be an absolute HTTP(S) URL" });
      }
    } catch {
      issues.push({ path: "descriptor.website", message: "website must be an absolute HTTP(S) URL" });
    }
  }
  if (!Array.isArray(d.resources)) {
    issues.push({ path: "descriptor.resources", message: "resources must be an array" });
  } else {
    const seenRoots = new Set();
    d.resources.forEach((root, index) => {
      if (!isNormalizedResourcePath(root, true) || root.toLowerCase().startsWith("meta-inf/turboism/")) {
        issues.push({
          path: `descriptor.resources[${index}]`,
          message: "resource root must be a normalized relative prefix ending in '/' outside META-INF/turboism/",
        });
      } else if (seenRoots.has(root)) {
        issues.push({ path: `descriptor.resources[${index}]`, message: `duplicate resource root "${root}"` });
      } else {
        seenRoots.add(root);
      }
    });
  }
  if (!isPlainObject(d.i18n)) {
    issues.push({ path: "descriptor.i18n", message: "i18n must be an object" });
  } else {
    for (const key of Object.keys(d.i18n)) {
      if (key !== "baseName" && key !== "locales") {
        issues.push({ path: "descriptor.i18n", message: `unknown i18n field "${key}"` });
      }
    }
    if (!isNormalizedResourcePath(d.i18n.baseName, false) || d.i18n.baseName.endsWith(".properties")) {
      issues.push({ path: "descriptor.i18n.baseName", message: "i18n.baseName must be a normalized resource base name" });
    }
    if (!Array.isArray(d.i18n.locales)) {
      issues.push({ path: "descriptor.i18n.locales", message: "i18n.locales must be an array" });
    } else {
      const seenLocales = new Set();
      d.i18n.locales.forEach((loc, index) => {
        if (typeof loc !== "string" || (loc !== "base" && !RE_LOCALE_ID.test(loc))) {
          issues.push({ path: `descriptor.i18n.locales[${index}]`, message: `invalid locale identifier "${loc}"` });
        } else if (seenLocales.has(loc)) {
          issues.push({ path: `descriptor.i18n.locales[${index}]`, message: `duplicate locale "${loc}"` });
        } else {
          seenLocales.add(loc);
        }
      });
    }
  }
  if (!isValidKebabToken(d.category)) {
    issues.push({ path: "descriptor.category", message: "category must be a 2-32 character lowercase kebab-case token" });
  }
  if (d.tags !== undefined) {
    if (!Array.isArray(d.tags) || d.tags.length > MAX_TAGS) {
      issues.push({ path: "descriptor.tags", message: `tags must be an array of at most ${MAX_TAGS} tokens` });
    } else {
      const seenTags = new Set();
      d.tags.forEach((tag, index) => {
        if (!isValidKebabToken(tag)) {
          issues.push({ path: `descriptor.tags[${index}]`, message: "tag must be a 2-32 character lowercase kebab-case token" });
        } else if (seenTags.has(tag)) {
          issues.push({ path: `descriptor.tags[${index}]`, message: `duplicate tag "${tag}"` });
        } else {
          seenTags.add(tag);
        }
      });
    }
  }
  if (d.environment !== undefined) {
    if (!isPlainObject(d.environment)) {
      issues.push({ path: "descriptor.environment", message: "environment must be an object" });
    } else {
      for (const key of Object.keys(d.environment)) {
        if (key !== "requiresCubism" && key !== "ui") {
          issues.push({ path: "descriptor.environment", message: `unknown environment field "${key}"` });
        }
      }
      if (d.environment.requiresCubism !== undefined && typeof d.environment.requiresCubism !== "boolean") {
        issues.push({ path: "descriptor.environment.requiresCubism", message: "requiresCubism must be a boolean" });
      }
      if (d.environment.ui !== undefined && !ALLOWED_ENV_UI.includes(d.environment.ui)) {
        issues.push({ path: "descriptor.environment.ui", message: `ui must be one of ${ALLOWED_ENV_UI.join(", ")}` });
      }
    }
  }
  if (d.lifecycle !== undefined) {
    if (!isPlainObject(d.lifecycle)) {
      issues.push({ path: "descriptor.lifecycle", message: "lifecycle must be an object" });
    } else {
      for (const key of Object.keys(d.lifecycle)) {
        if (key !== "hotReload") {
          issues.push({ path: "descriptor.lifecycle", message: `unknown lifecycle field "${key}"` });
        }
      }
      if (d.lifecycle.hotReload !== undefined && typeof d.lifecycle.hotReload !== "boolean") {
        issues.push({ path: "descriptor.lifecycle.hotReload", message: "hotReload must be a boolean" });
      }
    }
  }
  if (d.dependencies !== undefined) {
    if (!Array.isArray(d.dependencies)) {
      issues.push({ path: "descriptor.dependencies", message: "dependencies must be an array" });
    } else {
      const seenDeps = new Set();
      d.dependencies.forEach((dep, index) => {
        const depPath = `descriptor.dependencies[${index}]`;
        if (!isPlainObject(dep)) {
          issues.push({ path: depPath, message: "dependency must be an object" });
          return;
        }
        for (const key of Object.keys(dep)) {
          if (!["id", "version", "type", "ordering", "reason"].includes(key)) {
            issues.push({ path: depPath, message: `unknown dependency field "${key}"` });
          }
        }
        if (typeof dep.id !== "string" || !RE_PLUGIN_ID.test(dep.id)) {
          issues.push({ path: `${depPath}.id`, message: "dependency id must be a reverse-domain identifier" });
        } else if (seenDeps.has(dep.id)) {
          issues.push({ path: `${depPath}.id`, message: `duplicate dependency id "${dep.id}"` });
        } else {
          seenDeps.add(dep.id);
        }
        if (typeof dep.version !== "string" || parseVersionRange(dep.version) === null) {
          issues.push({ path: `${depPath}.version`, message: "dependency version must be a valid version range" });
        }
        if (dep.type !== undefined && !ALLOWED_DEPENDENCY_TYPES.includes(dep.type)) {
          issues.push({ path: `${depPath}.type`, message: `type must be one of ${ALLOWED_DEPENDENCY_TYPES.join(", ")}` });
        }
        if (dep.ordering !== undefined && !ALLOWED_ORDERINGS.includes(dep.ordering)) {
          issues.push({ path: `${depPath}.ordering`, message: `ordering must be one of ${ALLOWED_ORDERINGS.join(", ")}` });
        }
        if (dep.reason !== undefined && (typeof dep.reason !== "string" || dep.reason.trim().length === 0)) {
          issues.push({ path: `${depPath}.reason`, message: "reason must be a non-empty string" });
        }
      });
    }
  }
  if (d.permissions !== undefined) {
    if (!Array.isArray(d.permissions)) {
      issues.push({ path: "descriptor.permissions", message: "permissions must be an array" });
    } else {
      const seenPerms = new Set();
      d.permissions.forEach((perm, index) => {
        const permPath = `descriptor.permissions[${index}]`;
        if (!isPlainObject(perm)) {
          issues.push({ path: permPath, message: "permission must be an object" });
          return;
        }
        for (const key of Object.keys(perm)) {
          if (!["id", "scope", "reason"].includes(key)) {
            issues.push({ path: permPath, message: `unknown permission field "${key}"` });
          }
        }
        if (typeof perm.id !== "string" || !RE_PLUGIN_ID.test(perm.id)) {
          issues.push({ path: `${permPath}.id`, message: "permission id must be a dotted identifier" });
        } else if (seenPerms.has(perm.id)) {
          issues.push({ path: `${permPath}.id`, message: `duplicate permission id "${perm.id}"` });
        } else {
          seenPerms.add(perm.id);
        }
        if (perm.scope !== undefined && !ALLOWED_PERMISSION_SCOPES.includes(perm.scope)) {
          issues.push({ path: `${permPath}.scope`, message: `scope must be one of ${ALLOWED_PERMISSION_SCOPES.join(", ")}` });
        }
        if (typeof perm.reason !== "string" || perm.reason.trim().length === 0 || [...perm.reason].length > 2000) {
          issues.push({ path: `${permPath}.reason`, message: "permission reason must be a non-empty string" });
        }
      });
    }
  }
  return d;
}

function validateCubismSidecar(bytes, pluginId, issues) {
  if (bytes.byteLength > MAX_CUBISM_SIDECAR_BYTES) {
    issues.push({ path: "cubismVersions", message: `${CUBISM_SIDECAR_ENTRY} exceeds ${MAX_CUBISM_SIDECAR_BYTES} bytes` });
    return [];
  }
  const parsed = parseStrictJsonBytes(bytes);
  if (!parsed.ok || !isPlainObject(parsed.value)) {
    issues.push({ path: "cubismVersions", message: `${CUBISM_SIDECAR_ENTRY} must be valid strict UTF-8 JSON object` });
    return [];
  }
  const doc = parsed.value;
  if (doc.format !== CUBISM_SIDECAR_FORMAT) {
    issues.push({ path: "cubismVersions.format", message: `format must be "${CUBISM_SIDECAR_FORMAT}"` });
  }
  if (doc.plugin !== pluginId) {
    issues.push({ path: "cubismVersions.plugin", message: `plugin must equal descriptor id "${pluginId}"` });
  }
  if (!Array.isArray(doc.supportedVersions) || doc.supportedVersions.length === 0 || doc.supportedVersions.length > MAX_CUBISM_VERSIONS) {
    issues.push({
      path: "cubismVersions.supportedVersions",
      message: `supportedVersions must contain 1-${MAX_CUBISM_VERSIONS} Editor versions`,
    });
    return [];
  }
  const seen = new Set();
  const versions = [];
  doc.supportedVersions.forEach((ver, index) => {
    if (typeof ver !== "string" || !RE_HOST_VERSION.test(ver)) {
      issues.push({ path: `cubismVersions.supportedVersions[${index}]`, message: "must match host version like 5.3.02" });
    } else if (seen.has(ver)) {
      issues.push({ path: `cubismVersions.supportedVersions[${index}]`, message: `duplicate version "${ver}"` });
    } else {
      seen.add(ver);
      versions.push(ver);
    }
  });
  if (doc.fullFeatureVersions !== undefined) {
    if (!Array.isArray(doc.fullFeatureVersions) || doc.fullFeatureVersions.length === 0) {
      issues.push({ path: "cubismVersions.fullFeatureVersions", message: "fullFeatureVersions must be a non-empty array when present" });
    } else {
      const seenFull = new Set();
      doc.fullFeatureVersions.forEach((ver, index) => {
        if (typeof ver !== "string" || !seen.has(ver)) {
          issues.push({ path: `cubismVersions.fullFeatureVersions[${index}]`, message: "must be present in supportedVersions" });
        } else if (seenFull.has(ver)) {
          issues.push({ path: `cubismVersions.fullFeatureVersions[${index}]`, message: `duplicate version "${ver}"` });
        } else {
          seenFull.add(ver);
        }
      });
    }
  }
  return versions;
}

function i18nCatalogPath(baseName, locale) {
  return locale === "base" ? `${baseName}.properties` : `${baseName}_${locale.replace(/-/g, "_")}.properties`;
}

function extractPropertiesMap(jarBytes, entriesByName, i18nConfig, issues) {
  const expectedFiles = new Set();
  const basePath = `${i18nConfig.baseName}.properties`;
  expectedFiles.add(basePath);
  for (const locale of i18nConfig.locales) {
    expectedFiles.add(i18nCatalogPath(i18nConfig.baseName, locale));
  }

  const bundlesByFile = new Map();
  for (const filePath of expectedFiles) {
    const entry = entriesByName.get(filePath);
    if (!entry) {
      issues.push({ path: "jar.i18n", message: `missing declared i18n bundle "${filePath}"` });
      continue;
    }
    try {
      const rawBytes = inflateZipEntry(jarBytes, entry, MAX_PROPERTIES_BYTES);
      bundlesByFile.set(filePath, parseJavaProperties(decodeUtf8Fatal(rawBytes)));
    } catch (error) {
      issues.push({
        path: "jar.i18n",
        message: `invalid i18n bundle "${filePath}": ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const prefix = `${i18nConfig.baseName}_`;
  for (const entryName of entriesByName.keys()) {
    const isI18nCandidate = entryName === basePath || (entryName.startsWith(prefix) && entryName.endsWith(".properties"));
    if (isI18nCandidate && !expectedFiles.has(entryName)) {
      issues.push({ path: "jar.i18n", message: `undeclared i18n bundle "${entryName}"` });
    }
  }

  return { expectedFiles, bundlesByFile };
}

function buildLocalizedTexts(descriptor, i18nConfig, bundlesByFile) {
  const baseProps = bundlesByFile.get(`${i18nConfig.baseName}.properties`) ?? {};
  const enProps =
    bundlesByFile.get(i18nCatalogPath(i18nConfig.baseName, "en")) ??
    bundlesByFile.get(i18nCatalogPath(i18nConfig.baseName, "en_US")) ??
    {};

  const englishName = (enProps["plugin.name"] ?? baseProps["plugin.name"] ?? descriptor.name).trim();
  const rawDesc = descriptor.description ?? "";
  const englishSummary = (rawDesc.trim() || enProps["plugin.description"] || baseProps["plugin.description"] || englishName).trim();

  const localizations = {};
  for (const [catalogLocale, candidates] of Object.entries(LOCALE_CANDIDATES)) {
    for (const candidate of candidates) {
      const candidatePath = i18nCatalogPath(i18nConfig.baseName, candidate);
      const props = bundlesByFile.get(candidatePath);
      if (!props) continue;
      const localizedName = props["plugin.name"]?.trim();
      const localizedSummary = props["plugin.description"]?.trim();
      if (localizedName || localizedSummary) {
        localizations[catalogLocale] = {
          name: (localizedName || englishName).slice(0, 120),
          summary: (localizedSummary || englishSummary).slice(0, 500),
        };
        break;
      }
    }
  }

  return {
    name: englishName.slice(0, 120),
    summary: englishSummary.slice(0, 500),
    localizations,
  };
}

/**
 * Validates a SubmissionManifest object structure and catalog compatibility.
 * @param {unknown} manifest
 * @returns {{ ok: true, manifest: object } | { ok: false, errors: Array<{ path: string, message: string }> }}
 */
export function validateSubmissionManifest(manifest) {
  const issues = [];
  if (!isPlainObject(manifest)) {
    return { ok: false, errors: [{ path: "submission", message: "manifest must be an object" }] };
  }
  for (const key of Object.keys(manifest)) {
    if (!ALLOWED_SUBMISSION_KEYS.includes(key)) {
      issues.push({ path: "submission", message: `unknown field "${key}"` });
    }
  }
  for (const requiredKey of ALLOWED_SUBMISSION_KEYS) {
    if (!(requiredKey in manifest)) {
      issues.push({ path: "submission", message: `missing required field "${requiredKey}"` });
    }
  }
  if (manifest.format !== SUBMISSION_FORMAT) {
    issues.push({ path: "submission.format", message: `format must be "${SUBMISSION_FORMAT}"` });
  }
  if (manifest.schemaVersion !== SUBMISSION_SCHEMA_VERSION) {
    issues.push({ path: "submission.schemaVersion", message: `schemaVersion must be ${SUBMISSION_SCHEMA_VERSION}` });
  }
  if (!isValidUtcDateTime(manifest.submittedAt)) {
    issues.push({ path: "submission.submittedAt", message: "submittedAt must be a UTC ISO-8601 second timestamp" });
  }
  if (!isPlainObject(manifest.submitter) || !isPositiveSafeInt(manifest.submitter.githubId) || typeof manifest.submitter.login !== "string" || manifest.submitter.login.length === 0) {
    issues.push({ path: "submission.submitter", message: "submitter must contain positive githubId and login" });
  }
  if (!isPlainObject(manifest.repository)) {
    issues.push({ path: "submission.repository", message: "repository must be an object" });
  } else {
    if (!isPositiveSafeInt(manifest.repository.id)) {
      issues.push({ path: "submission.repository.id", message: "repository.id must be a positive safe integer" });
    }
    if (normalizeGitHubRepositoryUrl(manifest.repository.url) === null) {
      issues.push({ path: "submission.repository.url", message: "repository.url must be a GitHub HTTPS URL" });
    }
    if (typeof manifest.repository.sourceRevision !== "string" || !RE_SOURCE_REVISION.test(manifest.repository.sourceRevision)) {
      issues.push({ path: "submission.repository.sourceRevision", message: "sourceRevision must be a 40-char lowercase hex SHA" });
    }
    if (!isValidUtcDateTime(manifest.repository.publishedAt)) {
      issues.push({ path: "submission.repository.publishedAt", message: "publishedAt must be a UTC ISO-8601 second timestamp" });
    }
  }
  if (isPlainObject(manifest.plugin)) {
    if (manifest.plugin.trust !== REVIEWED_THIRD_PARTY_TRUST) {
      issues.push({ path: "submission.plugin.trust", message: `trust must be "${REVIEWED_THIRD_PARTY_TRUST}"` });
    }
    const syntheticCheck = validateParsedCatalog({
      format: "turboism.plugin.catalog",
      schemaVersion: 2,
      catalogVersion: 1,
      publishedAt: manifest.submittedAt ?? "2026-01-01T00:00:00Z",
      plugins: [manifest.plugin],
    });
    if (!syntheticCheck.ok) {
      issues.push(...syntheticCheck.errors);
    }
  } else {
    issues.push({ path: "submission.plugin", message: "plugin must be an object" });
  }
  if (!isPlainObject(manifest.bytecodeAudit) || !Array.isArray(manifest.bytecodeAudit.findings)) {
    issues.push({ path: "submission.bytecodeAudit", message: "bytecodeAudit must be a structured audit report" });
  }
  if (!isPlainObject(manifest.readmes)) {
    issues.push({ path: "submission.readmes", message: "readmes must be an object" });
  }
  return issues.length > 0 ? { ok: false, errors: issues } : { ok: true, manifest };
}

/**
 * Runs complete third-party plugin JAR preflight checks against Desktop Client policies,
 * Catalog v2 schema contracts, ownership locks, and JVM bytecode scanning, returning a
 * normalized SubmissionManifest on success.
 * @param {object} params
 * @returns {{ ok: true, manifest: object, isFirstClaim: boolean } | { ok: false, errors: Array<{ path: string, message: string }> }}
 */
export function runSubmissionPreflight({
  jarPathOrBytes,
  slug,
  assetFileName,
  artifactUrl,
  releaseUrl,
  channel = DEFAULT_CHANNEL,
  publishedAt,
  sourceRevision,
  submitter,
  repository,
  catalog,
  ownership,
  repoReadmes = {},
  submittedAt = publishedAt,
}) {
  const issues = [];

  if (typeof slug !== "string" || !RE_SLUG.test(slug) || slug.length > 100) {
    issues.push({ path: "slug", message: "slug must be lowercase kebab-case" });
  }
  if (typeof assetFileName !== "string" || !RE_FILE_NAME.test(assetFileName) || assetFileName.length > 255) {
    issues.push({ path: "artifact.fileName", message: "fileName must match [A-Za-z0-9][A-Za-z0-9._-]*.jar" });
  }
  if (!ALLOWED_CHANNELS.includes(channel)) {
    issues.push({ path: "release.channel", message: `channel must be one of ${ALLOWED_CHANNELS.join(", ")}` });
  }
  if (!isValidUtcDateTime(publishedAt)) {
    issues.push({ path: "release.publishedAt", message: "publishedAt must be a UTC ISO-8601 second timestamp" });
  }
  if (!isValidUtcDateTime(submittedAt)) {
    issues.push({ path: "submittedAt", message: "submittedAt must be a UTC ISO-8601 second timestamp" });
  }
  if (typeof sourceRevision !== "string" || !RE_SOURCE_REVISION.test(sourceRevision)) {
    issues.push({ path: "release.sourceRevision", message: "sourceRevision must be a 40-character lowercase hex commit SHA" });
  }

  const normalizedRepoUrl = normalizeGitHubRepositoryUrl(repository?.url);
  if (!isPlainObject(repository) || !isPositiveSafeInt(repository.id) || normalizedRepoUrl === null) {
    issues.push({ path: "repository", message: "repository must include positive numeric id and HTTPS GitHub URL" });
  } else {
    const repoSlugMatch = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(normalizedRepoUrl);
    const repoOwner = repoSlugMatch[1];
    const repoName = repoSlugMatch[2];
    const releaseTag = repository.releaseTag;
    if (typeof releaseTag !== "string" || releaseTag.length === 0 || /[/?#\\]/.test(releaseTag)) {
      issues.push({ path: "repository.releaseTag", message: "releaseTag must be a valid tag name" });
    } else {
      const expectedArtifactUrl = `https://github.com/${repoOwner}/${repoName}/releases/download/${releaseTag}/${assetFileName}`;
      if (artifactUrl !== expectedArtifactUrl) {
        issues.push({ path: "artifact.url", message: `artifactUrl must equal "${expectedArtifactUrl}"` });
      }
      const expectedReleaseUrl = `https://github.com/${repoOwner}/${repoName}/releases/tag/${releaseTag}`;
      if (releaseUrl !== expectedReleaseUrl) {
        issues.push({ path: "release.releaseUrl", message: `releaseUrl must equal "${expectedReleaseUrl}"` });
      }
    }
  }

  if (!isPlainObject(submitter) || !isPositiveSafeInt(submitter.githubId) || typeof submitter.login !== "string" || submitter.login.length === 0) {
    issues.push({ path: "submitter", message: "submitter must include positive integer githubId and login" });
  }

  const jarRead = readBoundedJarBytes(jarPathOrBytes);
  if (!jarRead.ok) {
    return { ok: false, errors: [...issues, ...jarRead.errors] };
  }
  const jarBytes = jarRead.bytes;
  if (jarBytes.byteLength < 1 || jarBytes.byteLength > MAX_ARTIFACT_SIZE) {
    issues.push({ path: "jar.size", message: `JAR size must be between 1 and ${MAX_ARTIFACT_SIZE} bytes` });
  }

  const structure = inspectJarArchiveStructure(jarBytes);
  if (!structure.ok) {
    return { ok: false, errors: [...issues, ...structure.errors] };
  }
  const entriesByName = structure.entriesByName;

  const manifestEntry = [...entriesByName.values()].find((entry) => entry.name.toLowerCase() === MANIFEST_ENTRY_LOWER);
  if (manifestEntry) {
    try {
      const mfBytes = inflateZipEntry(jarBytes, manifestEntry, MAX_DESCRIPTOR_BYTES);
      const mfText = decodeUtf8Fatal(mfBytes);
      if (RE_FORBIDDEN_MANIFEST_AGENT.test(mfText)) {
        issues.push({
          path: "jar.manifest",
          message: "META-INF/MANIFEST.MF must not declare Premain-Class or Agent-Class",
        });
      }
    } catch (error) {
      issues.push({
        path: "jar.manifest",
        message: `invalid META-INF/MANIFEST.MF: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const descriptorEntry = entriesByName.get(DESCRIPTOR_ENTRY);
  if (!descriptorEntry) {
    issues.push({ path: "jar.descriptor", message: `missing ${DESCRIPTOR_ENTRY}` });
    return { ok: false, errors: issues };
  }

  let descriptorBytes;
  try {
    descriptorBytes = inflateZipEntry(jarBytes, descriptorEntry, MAX_DESCRIPTOR_BYTES);
  } catch (error) {
    issues.push({ path: "jar.descriptor", message: error instanceof Error ? error.message : String(error) });
    return { ok: false, errors: issues };
  }

  const descriptor = validateAndParseDescriptor(descriptorBytes, issues);
  if (!descriptor || issues.length > 0) {
    return { ok: false, errors: issues };
  }

  const ownershipResult = validatePluginNamespaceAndOwnership({
    pluginId: descriptor.id,
    slug,
    submitterGithubId: submitter.githubId,
    repoId: repository.id,
    repositoryUrl: normalizedRepoUrl,
    catalog,
    ownership,
  });
  if (!ownershipResult.ok) {
    issues.push(...ownershipResult.errors);
  }

  for (const entrypoint of descriptor.entrypoints) {
    const classEntryName = `${entrypoint.replace(/\./g, "/")}.class`;
    if (!entriesByName.has(classEntryName)) {
      issues.push({
        path: "descriptor.entrypoints",
        message: `missing entrypoint class "${classEntryName}" inside JAR`,
      });
    }
  }

  for (const root of descriptor.resources) {
    const hasMatch = [...entriesByName.keys()].some((entryName) => entryName.startsWith(root));
    if (!hasMatch) {
      issues.push({
        path: "descriptor.resources",
        message: `declared resource root "${root}" matches no entries in JAR`,
      });
    }
  }

  const { expectedFiles: declaredI18nFiles, bundlesByFile } = extractPropertiesMap(
    jarBytes,
    entriesByName,
    descriptor.i18n,
    issues,
  );

  for (const entryName of entriesByName.keys()) {
    if (
      entryName === DESCRIPTOR_ENTRY ||
      entryName.toLowerCase() === MANIFEST_ENTRY_LOWER ||
      entryName.endsWith(".class") ||
      entryName.startsWith("META-INF/")
    ) {
      continue;
    }
    const coveredByResourceRoot = descriptor.resources.some((root) => entryName.startsWith(root));
    const coveredByI18n = declaredI18nFiles.has(entryName);
    if (!coveredByResourceRoot && !coveredByI18n) {
      issues.push({
        path: `jar.entry.${entryName}`,
        message: `undeclared resource "${entryName}" is not covered by resources prefixes or i18n bundles`,
      });
    }
  }

  const requiresCubism = Boolean(descriptor.environment?.requiresCubism);
  let cubismVersions = [];
  const cubismEntry = entriesByName.get(CUBISM_SIDECAR_ENTRY);
  if (requiresCubism) {
    if (!cubismEntry) {
      issues.push({
        path: "jar.cubismVersions",
        message: `missing ${CUBISM_SIDECAR_ENTRY} when environment.requiresCubism is true`,
      });
    } else {
      try {
        const sidecarBytes = inflateZipEntry(jarBytes, cubismEntry, MAX_CUBISM_SIDECAR_BYTES);
        cubismVersions = validateCubismSidecar(sidecarBytes, descriptor.id, issues);
      } catch (error) {
        issues.push({
          path: "jar.cubismVersions",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const existingCatalogPlugin = Array.isArray(catalog?.plugins)
    ? catalog.plugins.find((item) => isPlainObject(item) && item.id === descriptor.id)
    : null;
  if (existingCatalogPlugin && Array.isArray(existingCatalogPlugin.releases)) {
    const incomingVersion = parseStrictVersion(descriptor.version);
    for (const existingRelease of existingCatalogPlugin.releases) {
      const existingVersion = parseStrictVersion(existingRelease.version);
      if (incomingVersion && existingVersion && compareVersions(incomingVersion, existingVersion) <= 0) {
        issues.push({
          path: "release.version",
          message: `version ${descriptor.version} must be strictly higher than existing release ${existingRelease.version}`,
        });
      }
    }
  }

  let bytecodeAudit;
  try {
    bytecodeAudit = scanJarBytecode(jarBytes, descriptor.permissions ?? []);
  } catch (error) {
    issues.push({
      path: "jar.bytecode",
      message: `bytecode scan failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  if (issues.length > 0) {
    return { ok: false, errors: issues };
  }

  const localized = buildLocalizedTexts(descriptor, descriptor.i18n, bundlesByFile);
  const extractedReadmes = extractJarReadmes(jarBytes);
  const readmes = {};
  for (const [locale, doc] of Object.entries(extractedReadmes)) {
    readmes[locale] = doc.content;
  }
  for (const [locale, fallbackMarkdown] of Object.entries(repoReadmes)) {
    if (!readmes[locale] && typeof fallbackMarkdown === "string" && fallbackMarkdown.trim().length > 0) {
      if (Buffer.byteLength(fallbackMarkdown, "utf8") <= MAX_README_BYTES) {
        readmes[locale] = fallbackMarkdown;
      }
    }
  }

  const jarSha256 = sha256Hex(jarBytes);
  const descriptorSha256 = sha256Hex(descriptorBytes);

  const release = {
    version: descriptor.version,
    channel,
    status: "active",
    publishedAt,
    category: descriptor.category,
    tags: [...(descriptor.tags ?? [])],
    turboismApi: descriptor.turboismApi,
    requiresCubism,
    cubismVersions,
    platforms: [DEFAULT_PLATFORM],
    dependencies: (descriptor.dependencies ?? []).map((dep) => {
      const entry = {
        id: dep.id,
        version: dep.version,
        type: dep.type ?? "required",
        ordering: dep.ordering ?? "none",
      };
      if (dep.reason !== undefined) entry.reason = dep.reason;
      return entry;
    }),
    permissions: (descriptor.permissions ?? []).map((perm) => ({
      id: perm.id,
      scope: perm.scope ?? "application",
      reason: perm.reason,
    })),
    ...(descriptor.lifecycle?.hotReload !== undefined ? { hotReload: descriptor.lifecycle.hotReload } : {}),
    releaseUrl,
    sourceRevision,
    artifact: {
      mediaType: MEDIA_TYPE_JAR,
      fileName: assetFileName,
      url: artifactUrl,
      sha256: jarSha256,
      descriptorSha256,
      size: jarBytes.byteLength,
    },
  };

  const plugin = {
    id: descriptor.id,
    slug,
    name: localized.name,
    summary: localized.summary,
    trust: REVIEWED_THIRD_PARTY_TRUST,
    author: descriptor.authors[0].name.trim(),
    license: descriptor.license.trim(),
    repository: normalizedRepoUrl,
    support: `${normalizedRepoUrl}/issues`,
    localizations: localized.localizations,
    releases: [release],
  };

  const manifest = {
    format: SUBMISSION_FORMAT,
    schemaVersion: SUBMISSION_SCHEMA_VERSION,
    submittedAt,
    submitter: {
      githubId: submitter.githubId,
      login: submitter.login,
      name: typeof submitter.name === "string" ? submitter.name : "",
      verificationReason: submitter.verificationReason ?? "repo_owner",
    },
    repository: {
      id: repository.id,
      fullName: repository.fullName ?? normalizedRepoUrl.replace("https://github.com/", ""),
      url: normalizedRepoUrl,
      defaultBranch: repository.defaultBranch ?? "main",
      releaseTag: repository.releaseTag,
      releaseUrl,
      sourceRevision,
      publishedAt,
    },
    plugin,
    release,
    bytecodeAudit,
    readmes,
  };

  const manifestValidation = validateSubmissionManifest(manifest);
  if (!manifestValidation.ok) {
    return { ok: false, errors: manifestValidation.errors };
  }

  return {
    ok: true,
    manifest,
    isFirstClaim: ownershipResult.isFirstClaim,
  };
}
