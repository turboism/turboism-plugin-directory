// Turboism Plugin Directory v2 HTTP response builders. Web-API only (Request /
// Response), so the App Router routes are thin wrappers and the node:test
// suite exercises the exact production response semantics without a server.
// All endpoints are read-only: GET and HEAD; unsupported methods are rejected
// by Next.js with 405 and never mutate state.
//
// Production routes NEVER consult environment variables: the deployed pair is
// read from the default publication root (public/api/v2) with the committed
// trusted-key allowlist. Only direct library calls may inject an explicit
// storage object for tests.
import {
  bodyEtag,
  defaultProductionDir,
  ifNoneMatchMatches,
  loadTrustedKeys,
  parseQuery,
  runSearch,
  stringifyCanonical,
  validateEnvelopeBytes,
  verifyCatalogBytes,
} from "./catalog.mjs";
import { loadCurrentGeneration } from "./storage.mjs";
import path from "node:path";

export const CATALOG_CONTENT_TYPE = "application/vnd.turboism.plugin-catalog+json;version=2";
export const SIGNATURE_CONTENT_TYPE = "application/vnd.turboism.plugin-catalog-signature+json;version=2";
export const SEARCH_CONTENT_TYPE = "application/vnd.turboism.plugin-search+json;version=2";
export const CATALOG_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";
export const SEARCH_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";
export const ERROR_CONTENT_TYPE = "application/json";

const BASE_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
};

const VND_BASE = {
  [CATALOG_CONTENT_TYPE]: "application/vnd.turboism.plugin-catalog+json",
  [SIGNATURE_CONTENT_TYPE]: "application/vnd.turboism.plugin-catalog-signature+json",
  [SEARCH_CONTENT_TYPE]: "application/vnd.turboism.plugin-search+json",
};

function defaultTrustedKeysFile() {
  return path.join(process.cwd(), "lib", "catalog-v2", "trusted-keys.json");
}

/** Storage resolution: explicit injected object only; never environment variables. */
function resolveStorage(storage) {
  if (typeof storage === "object" && storage !== null && storage.dir !== undefined) return storage.dir;
  if (typeof storage === "string") return storage;
  return defaultProductionDir();
}

function resolveTrustedKeys(storage) {
  if (typeof storage === "object" && storage !== null && storage.trustedKeysFile !== undefined) return storage.trustedKeysFile;
  return defaultTrustedKeysFile();
}

/**
 * Accept negotiation (RFC 9110 media ranges): absent Accept is acceptable.
 * Generic JSON/wildcard ranges are acceptable only with q > 0; the vendor
 * media type is acceptable ONLY with an explicit version=2 parameter and
 * q > 0. Malformed ranges and malformed qvalues make that range unacceptable.
 * @param {string|null} accept
 * @param {string} vndContentType the exact "type;version=2" this endpoint serves
 */
export function acceptsRepresentation(accept, vndContentType) {
  if (accept === null || accept === undefined || accept.trim() === "") return true;
  const vndBase = VND_BASE[vndContentType];
  return accept.split(",").some((part) => rangeAcceptable(part, vndBase));
}

const RE_QVALUE = /^(0(\.\d{0,3})?|1(\.0{0,3})?)$/;

function rangeAcceptable(part, vndBase) {
  const segments = part.trim().split(";");
  const mediaType = segments.shift().trim().toLowerCase();
  if (mediaType === "") return false;
  const parameters = {};
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed === "") return false; // malformed: empty parameter
    const eq = trimmed.indexOf("=");
    if (eq === -1) return false; // malformed: parameter without a value
    const name = trimmed.slice(0, eq).trim().toLowerCase();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    } else if (value.includes('"')) {
      return false; // malformed quoting
    }
    if (name === "" || value === "") return false;
    if (name in parameters) return false; // malformed: duplicate parameter
    parameters[name] = value;
  }
  if (parameters.q !== undefined && !RE_QVALUE.test(parameters.q)) {
    return false; // malformed qvalue
  }
  if (parameters.q !== undefined && Number(parameters.q) === 0) {
    return false; // explicitly unacceptable
  }
  if (mediaType === "*/*" || mediaType === "application/*" || mediaType === "application/json") {
    return true;
  }
  if (mediaType !== vndBase) return false;
  // The vendor representation is only served with version=2.
  if (parameters.version !== "2") return false;
  return true;
}

/**
 * Fail-closed production loading: read the current generation and verify it
 * against the committed trusted-key allowlist (production purpose only).
 * Returns the verified catalog/envelope or a fail-closed error code.
 * @param {string} dir
 * @param {string} trustedKeysFile
 * @returns {{ ok: true, generationId: string, catalogBytes: Buffer, sigBytes: Buffer, catalog: object } | { ok: false, code: string, message: string }}
 */
export function loadVerifiedCurrentGeneration(dir, trustedKeysFile) {
  const loaded = loadCurrentGeneration(dir);
  if (!loaded.ok) return loaded;
  const keysCheck = loadTrustedKeys(trustedKeysFile);
  if (!keysCheck.ok) {
    return { ok: false, code: "catalog_invalid", message: "the trusted key allowlist is not readable" };
  }
  const verified = verifyCatalogBytes(loaded.catalogBytes, loaded.sigBytes, keysCheck.keys, { requireProduction: true });
  if (!verified.ok) {
    return { ok: false, code: "catalog_invalid", message: "the deployed catalog failed signature verification" };
  }
  return { ok: true, ...loaded, catalog: verified.catalog };
}

/**
 * Build a response, then mirror it for HEAD: same status and headers plus a
 * Content-Length of the GET body, with no body. 304 responses carry no body
 * and no Content-Length in either method.
 */
function respond(body, headers, status, forHead) {
  if (!forHead) {
    return new Response(body, { status, headers });
  }
  if (status === 304) {
    return new Response(null, { status, headers });
  }
  const headHeaders = new Headers(headers);
  if (body !== null) {
    headHeaders.set("Content-Length", String(body.byteLength));
  }
  return new Response(null, { status, headers: headHeaders });
}

function errorResponse(status, code, message, field, forHead = false) {
  const error = { code, message };
  if (field !== undefined) error.field = field;
  // The body is always computed so HEAD mirrors GET's Content-Length; respond
  // drops the bytes for HEAD.
  const body = Buffer.from(stringifyCanonical({ error }, "errorEnvelope"), "utf8");
  const headers = { "Content-Type": ERROR_CONTENT_TYPE, ...BASE_HEADERS };
  return respond(body, headers, status, forHead);
}

function notAcceptable(forHead) {
  return errorResponse(406, "not_acceptable", "requested representation is not supported", undefined, forHead);
}

function notModified(etag, cacheControl) {
  return new Response(null, {
    status: 304,
    headers: { ETag: etag, "Cache-Control": cacheControl },
  });
}

/**
 * GET/HEAD /api/v2/catalog.json — exact identity-encoded catalog bytes.
 * @param {Request} request
 * @param {{ dir?: string, trustedKeysFile?: string } | string} [storage]
 * @param {boolean} [forHead]
 * @returns {Response}
 */
export function serveCatalog(request, storage = {}, forHead = false) {
  const pair = loadVerifiedCurrentGeneration(resolveStorage(storage), resolveTrustedKeys(storage));
  if (!pair.ok) {
    const status = pair.code === "catalog_unavailable" ? 503 : 500;
    return errorResponse(status, pair.code, pair.message, undefined, forHead);
  }
  if (!acceptsRepresentation(request.headers.get("accept"), CATALOG_CONTENT_TYPE)) {
    return notAcceptable(forHead);
  }
  const etag = bodyEtag(pair.catalogBytes);
  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return notModified(etag, CATALOG_CACHE_CONTROL);
  }
  const headers = {
    "Content-Type": CATALOG_CONTENT_TYPE,
    "Cache-Control": CATALOG_CACHE_CONTROL,
    ETag: etag,
    ...BASE_HEADERS,
  };
  return respond(new Uint8Array(pair.catalogBytes), headers, 200, forHead);
}

/**
 * GET/HEAD /api/v2/catalog.json.sig — exact detached-signature envelope bytes.
 * @param {Request} request
 * @param {{ dir?: string, trustedKeysFile?: string } | string} [storage]
 * @param {boolean} [forHead]
 * @returns {Response}
 */
export function serveSignature(request, storage = {}, forHead = false) {
  const pair = loadVerifiedCurrentGeneration(resolveStorage(storage), resolveTrustedKeys(storage));
  if (!pair.ok) {
    const status = pair.code === "catalog_unavailable" ? 503 : 500;
    return errorResponse(status, pair.code, pair.message, undefined, forHead);
  }
  const envelopeCheck = validateEnvelopeBytes(pair.sigBytes);
  if (!envelopeCheck.ok) {
    return errorResponse(500, "catalog_invalid", "the deployed signature envelope is malformed", undefined, forHead);
  }
  if (!acceptsRepresentation(request.headers.get("accept"), SIGNATURE_CONTENT_TYPE)) {
    return notAcceptable(forHead);
  }
  const etag = bodyEtag(pair.sigBytes);
  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return notModified(etag, CATALOG_CACHE_CONTROL);
  }
  const headers = {
    "Content-Type": SIGNATURE_CONTENT_TYPE,
    "Cache-Control": CATALOG_CACHE_CONTROL,
    ETag: etag,
    ...BASE_HEADERS,
  };
  return respond(new Uint8Array(pair.sigBytes), headers, 200, forHead);
}

/**
 * GET/HEAD /api/v2/plugins — filtered, sorted, paginated discovery projection.
 * @param {Request} request
 * @param {{ dir?: string, trustedKeysFile?: string } | string} [storage]
 * @param {boolean} [forHead]
 * @returns {Response}
 */
export function serveSearch(request, storage = {}, forHead = false) {
  const pair = loadVerifiedCurrentGeneration(resolveStorage(storage), resolveTrustedKeys(storage));
  if (!pair.ok) {
    const status = pair.code === "catalog_unavailable" ? 503 : 500;
    return errorResponse(status, pair.code, pair.message, undefined, forHead);
  }
  if (!acceptsRepresentation(request.headers.get("accept"), SEARCH_CONTENT_TYPE)) {
    return notAcceptable(forHead);
  }
  const parsed = parseQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    return errorResponse(400, parsed.error.code, parsed.error.message, parsed.error.field, forHead);
  }
  const body = stringifyCanonical(runSearch(pair.catalog, parsed.query), "search");
  const etag = bodyEtag(body);
  if (ifNoneMatchMatches(request.headers.get("if-none-match"), etag)) {
    return notModified(etag, SEARCH_CACHE_CONTROL);
  }
  const headers = {
    "Content-Type": SEARCH_CONTENT_TYPE,
    "Cache-Control": SEARCH_CACHE_CONTROL,
    ETag: etag,
    ...BASE_HEADERS,
  };
  return respond(Buffer.from(body, "utf8"), headers, 200, forHead);
}
