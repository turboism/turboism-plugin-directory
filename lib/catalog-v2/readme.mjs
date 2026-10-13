// Generation-bound README extraction, hashing, and loading for official plugin JARs.
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { defaultProductionDir } from "./catalog.mjs";
import { loadCurrentGeneration } from "./storage.mjs";

const MAX_JAR_SIZE = 16 * 1024 * 1024;
const MAX_README_BYTES = 1024 * 1024; // 1 MiB cap per markdown file
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;

const README_ENTRIES = {
  "META-INF/turboism/readme/README.md": "en",
  "META-INF/turboism/readme/README_zh.md": "zh",
  "META-INF/turboism/readme/README_ja.md": "ja",
  "META-INF/turboism/readme/README_ko.md": "ko",
};

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function findEocd(bytes) {
  const maxBacktrack = Math.min(bytes.byteLength, 65535 + 22);
  for (let i = bytes.byteLength - 22; i >= bytes.byteLength - maxBacktrack; i -= 1) {
    if (bytes.readUInt32LE(i) === ZIP_EOCD_SIG) return i;
  }
  return null;
}

/**
 * Safely extracts official README files (en, zh, ja, ko) from verified JAR bytes.
 * Bounded read, traversal-safe, supports stored (0) and deflate (8) compression.
 * @param {string|Buffer} jarPathOrBytes
 * @returns {Record<string, { locale: string, fileName: string, content: string, sha256: string, size: number }>}
 */
export function extractJarReadmes(jarPathOrBytes) {
  let bytes;
  if (Buffer.isBuffer(jarPathOrBytes)) {
    bytes = jarPathOrBytes;
  } else {
    let lstat;
    try {
      lstat = lstatSync(jarPathOrBytes);
    } catch {
      throw new Error(`JAR file "${jarPathOrBytes}" is not readable`);
    }
    if (lstat.isSymbolicLink() || !lstat.isFile()) {
      throw new Error(`JAR file "${jarPathOrBytes}" must be a regular non-symlink file`);
    }
    if (lstat.size > MAX_JAR_SIZE) {
      throw new Error(`JAR file exceeds maximum size bound of ${MAX_JAR_SIZE} bytes`);
    }
    const fd = openSync(jarPathOrBytes, "r");
    try {
      bytes = readFileSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  const eocd = findEocd(bytes);
  if (eocd === null) throw new Error("Invalid JAR: end-of-central-directory record not found");

  const cdSize = bytes.readUInt32LE(eocd + 12);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  const totalEntries = bytes.readUInt16LE(eocd + 10);

  if (cdOffset + cdSize > bytes.byteLength || cdOffset + cdSize !== eocd) {
    throw new Error("Invalid JAR: malformed central directory layout");
  }

  const result = {};
  let offset = cdOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (offset + 46 > bytes.byteLength || bytes.readUInt32LE(offset) !== ZIP_CENTRAL_SIG) {
      break;
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
      throw new Error("Encrypted entries in JAR are not supported");
    }

    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLen);
    const locale = README_ENTRIES[name];

    if (locale !== undefined) {
      if (uncompressedSize > MAX_README_BYTES) {
        throw new Error(`README entry "${name}" exceeds 1 MiB cap (${uncompressedSize} bytes)`);
      }
      if (localOffset + 30 > bytes.byteLength) {
        throw new Error(`Malformed local header offset for "${name}"`);
      }

      const localNameLen = bytes.readUInt16LE(localOffset + 26);
      const localExtraLen = bytes.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;

      if (dataStart + compressedSize > bytes.byteLength) {
        throw new Error(`Compressed data exceeds file bounds for "${name}"`);
      }

      const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
      let entryBytes;
      if (method === 0) {
        entryBytes = Buffer.from(compressed);
      } else if (method === 8) {
        entryBytes = zlib.inflateRawSync(compressed, { maxOutputLength: MAX_README_BYTES });
      } else {
        throw new Error(`Unsupported compression method ${method} for "${name}"`);
      }

      if (entryBytes.byteLength !== uncompressedSize) {
        throw new Error(`Decompressed bytes mismatch for "${name}"`);
      }

      const content = entryBytes.toString("utf8");
      const sha256 = sha256Hex(entryBytes);
      const fileName = path.basename(name);

      result[locale] = {
        locale,
        fileName,
        entryName: name,
        content,
        sha256,
        size: entryBytes.byteLength,
      };
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }

  return result;
}

/**
 * Extracts and stages READMEs into a generation directory, and creates readmes.json.
 * @param {string} genDir generation directory (e.g. public/api/v2/generations/00000002)
 * @param {Record<string, string>} manifest JAR manifest mapping `${pluginId}@${version}` -> jarPath
 */
export function writeGenerationReadmes(genDir, manifest) {
  const readmesBase = path.join(genDir, "readmes");
  mkdirSync(readmesBase, { recursive: true });

  const manifestDoc = {
    format: "turboism.plugin.readmes",
    schemaVersion: 1,
    generationId: path.basename(genDir),
    plugins: {},
  };

  for (const [key, jarPath] of Object.entries(manifest)) {
    const [pluginId, version] = key.split("@");
    if (!pluginId || !version) continue;

    const extracted = extractJarReadmes(jarPath);
    if (Object.keys(extracted).length === 0) continue;

    const pluginDir = path.join(readmesBase, pluginId, version);
    mkdirSync(pluginDir, { recursive: true });

    const pluginRecord = {};
    for (const [locale, item] of Object.entries(extracted)) {
      const filePath = path.join(pluginDir, item.fileName);
      writeFileSync(filePath, item.content, "utf8");
      pluginRecord[locale] = {
        file: item.fileName,
        path: path.posix.join("readmes", pluginId, version, item.fileName),
        sha256: item.sha256,
        size: item.size,
      };
    }
    manifestDoc.plugins[key] = pluginRecord;
  }

  const readmesJsonPath = path.join(genDir, "readmes.json");
  writeFileSync(readmesJsonPath, JSON.stringify(manifestDoc, null, 2) + "\n", "utf8");
  return manifestDoc;
}

/**
 * Loads the raw README markdown files for a plugin version from the current generation.
 * @param {string} pluginId
 * @param {string} version
 * @param {{ dir?: string, generationId?: string }} options
 * @returns {Record<string, string>} map of locale to markdown string
 */
export function loadPluginReadmes(pluginId, version, { dir = defaultProductionDir(), generationId = null } = {}) {
  let targetGen = generationId;
  if (!targetGen) {
    const loaded = loadCurrentGeneration(dir);
    if (!loaded.ok) return {};
    targetGen = loaded.generationId;
  }

  const pluginDir = path.join(dir, "generations", targetGen, "readmes", pluginId, version);
  const result = {};
  const fileMap = {
    en: "README.md",
    zh: "README_zh.md",
    ja: "README_ja.md",
    ko: "README_ko.md",
  };

  for (const [locale, fileName] of Object.entries(fileMap)) {
    const filePath = path.join(pluginDir, fileName);
    try {
      result[locale] = readFileSync(filePath, "utf8");
    } catch {
      // Locale file absent, continue
    }
  }

  return result;
}
