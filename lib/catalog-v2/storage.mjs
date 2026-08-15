// Immutable-snapshot generation storage for the v2 catalog/signature pair.
//
// Layout under a publication root (default public/api/v2):
//
//   generations/<generationId>/catalog.json      immutable snapshot
//   generations/<generationId>/catalog.json.sig  immutable snapshot
//   current                                      pointer file: the generation id
//
// Publication stages BOTH exact bytes into a NEW generation directory first,
// then commits the pointer with one atomic tmp+rename. A fault before the
// pointer commit leaves the previously committed generation served; the
// pointer is the single atomic switch, so a mixed pair can never be current.
//
// Generation ids are bounded (1-10 decimal digits); the pointer is bounded and
// validated with a strict grammar, and every path step is checked against
// symlinks so no traversal or symlink escape is possible.
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MAX_CATALOG_BYTES, MAX_SIGNATURE_BYTES } from "./catalog.mjs";

export const POINTER_FILE = "current";
export const GENERATIONS_DIR = "generations";
export const MAX_POINTER_BYTES = 64;
export const MAX_GENERATION_ID = 99999999;

const RE_GENERATION_ID = /^[0-9]{1,10}$/;

/** @typedef {{ code: "catalog_unavailable" | "catalog_invalid", message: string }} StorageError */

/** True when a generation id is a bounded decimal identifier. */
export function isValidGenerationId(id) {
  if (typeof id !== "string" || !RE_GENERATION_ID.test(id)) return false;
  const numeric = Number(id);
  return Number.isSafeInteger(numeric) && numeric >= 1 && numeric <= MAX_GENERATION_ID;
}

function generationDirFor(baseDir, id) {
  return path.join(baseDir, GENERATIONS_DIR, id);
}

/** Defense in depth: the resolved generation dir must stay inside the root. */
function insideRoot(baseDir, candidate) {
  const root = path.resolve(baseDir);
  const resolved = path.resolve(candidate);
  return resolved === root || resolved.startsWith(root + path.sep);
}

function readBoundedFile(file, cap, what) {
  let stats;
  try {
    stats = lstatSync(file);
  } catch {
    return { ok: false, code: "catalog_unavailable", message: `${what} is not readable` };
  }
  if (stats.isSymbolicLink()) {
    return { ok: false, code: "catalog_unavailable", message: `${what} must not be a symbolic link` };
  }
  if (!stats.isFile()) {
    return { ok: false, code: "catalog_unavailable", message: `${what} is not a regular file` };
  }
  if (stats.size > cap) {
    return { ok: false, code: "catalog_invalid", message: `${what} exceeds its size cap` };
  }
  let fd;
  try {
    fd = openSync(file, "r");
  } catch {
    return { ok: false, code: "catalog_unavailable", message: `${what} is not readable` };
  }
  try {
    return { ok: true, bytes: readFileSync(fd) };
  } catch {
    return { ok: false, code: "catalog_unavailable", message: `${what} is not readable` };
  } finally {
    closeSync(fd);
  }
}

/**
 * Load the current generation consistently: read the pointer once, then read
 * both snapshot files of that one generation. Any load failure (missing,
 * torn, escaping pointer; missing or non-regular generation files) is
 * catalog_unavailable; size-cap violations are catalog_invalid. The loaded
 * pair is NOT verified here — verification happens in the route layer.
 * @param {string} baseDir
 * @returns {{ ok: true, generationId: string, catalogBytes: Buffer, sigBytes: Buffer } | { ok: false, code: string, message: string }}
 */
export function loadCurrentGeneration(baseDir) {
  const pointer = readBoundedFile(path.join(baseDir, POINTER_FILE), MAX_POINTER_BYTES, "the current pointer");
  if (!pointer.ok) return pointer;
  const generationId = pointer.bytes.toString("utf8");
  if (!isValidGenerationId(generationId)) {
    return { ok: false, code: "catalog_unavailable", message: "the current pointer is not a valid generation id" };
  }
  const genDir = generationDirFor(baseDir, generationId);
  if (!insideRoot(baseDir, genDir)) {
    return { ok: false, code: "catalog_unavailable", message: "the generation path escapes the publication root" };
  }
  let genStats;
  try {
    genStats = lstatSync(genDir);
  } catch {
    return { ok: false, code: "catalog_unavailable", message: "the current generation is not present" };
  }
  if (genStats.isSymbolicLink() || !genStats.isDirectory()) {
    return { ok: false, code: "catalog_unavailable", message: "the current generation is not a real directory" };
  }
  const catalog = readBoundedFile(path.join(genDir, "catalog.json"), MAX_CATALOG_BYTES, "the catalog");
  if (!catalog.ok) return catalog;
  const sig = readBoundedFile(path.join(genDir, "catalog.json.sig"), MAX_SIGNATURE_BYTES, "the catalog signature");
  if (!sig.ok) return sig;
  return { ok: true, generationId, catalogBytes: catalog.bytes, sigBytes: sig.bytes };
}

/**
 * Compute the next generation id: one past the highest existing valid id,
 * zero-padded to 8 digits. Bounded by MAX_GENERATION_ID.
 * @param {string} baseDir
 * @returns {{ ok: true, id: string } | { ok: false, message: string }}
 */
export function nextGenerationId(baseDir) {
  let entries = [];
  try {
    entries = readdirSync(path.join(baseDir, GENERATIONS_DIR), { withFileTypes: true });
  } catch {
    entries = [];
  }
  let max = 0;
  for (const entry of entries) {
    if (entry.isDirectory() && isValidGenerationId(entry.name)) {
      const numeric = Number(entry.name);
      if (numeric > max) max = numeric;
    }
  }
  const next = max + 1;
  if (next > MAX_GENERATION_ID) {
    return { ok: false, message: `generation id space exhausted (at most ${MAX_GENERATION_ID})` };
  }
  return { ok: true, id: String(next).padStart(8, "0") };
}

/**
 * Stage BOTH exact bytes into a fresh generation directory and verify the
 * written bytes by reading them back. Never touches the pointer.
 * @param {string} baseDir
 * @param {string} id
 * @param {Uint8Array} catalogBytes
 * @param {Uint8Array} sigBytes
 * @returns {{ ok: true, genDir: string } | { ok: false, message: string }}
 */
export function stageGeneration(baseDir, id, catalogBytes, sigBytes) {
  if (!isValidGenerationId(id)) {
    return { ok: false, message: `invalid generation id "${id}"` };
  }
  const genDir = generationDirFor(baseDir, id);
  if (!insideRoot(baseDir, genDir)) {
    return { ok: false, message: "generation path escapes the publication root" };
  }
  try {
    mkdirSync(path.join(baseDir, GENERATIONS_DIR), { recursive: true });
    // Non-recursive leaf creation: fails if the generation already exists.
    mkdirSync(genDir, { recursive: false });
  } catch {
    return { ok: false, message: `generation ${id} already exists or cannot be created` };
  }
  const catalogFile = path.join(genDir, "catalog.json");
  const sigFile = path.join(genDir, "catalog.json.sig");
  writeFileSync(`${catalogFile}.tmp`, catalogBytes);
  writeFileSync(`${sigFile}.tmp`, sigBytes);
  renameSync(`${catalogFile}.tmp`, catalogFile);
  renameSync(`${sigFile}.tmp`, sigFile);
  // Verify the exact staged bytes on disk before the pointer may be committed.
  const readCatalog = readFileSync(catalogFile);
  const readSig = readFileSync(sigFile);
  if (!readCatalog.equals(Buffer.from(catalogBytes)) || !readSig.equals(Buffer.from(sigBytes))) {
    return { ok: false, message: "staged bytes do not match the verified pair" };
  }
  return { ok: true, genDir };
}

/**
 * ONE atomic current-pointer commit: write a tmp pointer then rename it over
 * `current`. Only called after stageGeneration succeeded for the same id.
 * @param {string} baseDir
 * @param {string} id
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function commitPointer(baseDir, id) {
  if (!isValidGenerationId(id)) {
    return { ok: false, message: `invalid generation id "${id}"` };
  }
  const pointerFile = path.join(baseDir, POINTER_FILE);
  const tmpFile = `${pointerFile}.tmp`;
  try {
    writeFileSync(tmpFile, id, "utf8");
    renameSync(tmpFile, pointerFile);
  } catch {
    return { ok: false, message: "pointer commit failed" };
  }
  return { ok: true };
}
