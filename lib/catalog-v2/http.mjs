// Turboism Plugin Directory v2 HTTP response builders. Web-API only (Request /
// Response), so the App Router routes are thin wrappers and the node:test
// suite exercises the exact production response semantics without a server.
// All endpoints are read-only: GET and HEAD; unsupported methods are rejected
// by Next.js with 405 and never mutate state.
import {
  bodyEtag,
  defaultProductionDir,
  ifNoneMatchMatches,
  loadProductionPair,
  loadTrustedKeys,
  parseQuery,
  runSearch,
  stringifyCanonical,
  validateEnvelopeBytes,
  verifyCatalogBytes,
} from "./catalog.mjs";
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

/**
 * Accept negotiation: absent Accept, application/json, wildcard application and
 * star media types, or the exact v2 vendor media type (version parameter must
 * be 2 when present).
 * @param {string|null} accept
 * @param {string} vndContentType the exact "type;version=2" this endpoint serves
 */
export function acceptsRepresentation(accept, vndContentType) {
  if (accept === null || accept === undefined || accept.trim() === "") return true;
  const vndBase = VND_BASE[vndContentType];
  return accept.split(",").some((part) => {
    const [type, ...parameterParts] = part.trim().split(";");
    const mediaType = type.trim().toLowerCase();
    if (mediaType === "*/*" || mediaType === "application/*" || mediaType === "application/json") return true;
    if (mediaType !== vndBase) return false;
    for (const parameter of parameterParts) {
      const [name, value] = parameter.trim().split("=");
      if (name.trim().toLowerCase() === "version") {
        return value.trim() === "2";
      }
    }
    return true;
  });
}

/**
 * Fail-closed production storage: reads the deployed pair from `dir` and
 * verifies it against the committed trusted-key allowlist (production purpose
 * only). Returns the verified catalog/envelope or a fail-closed error code.
 * @param {string} dir
 * @param {string} trustedKeysFile
 * @returns {{ ok: true, catalogBytes: Buffer, sigBytes: Buffer, catalog: object } | { ok: false, code: string, message: string }}
 */
export function loadVerifiedProductionPair(dir, trustedKeysFile) {
  const loaded = loadProductionPair(dir);
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

function errorResponse(status, code, message, field, forHead = false) {
  const error = { code, message };
  if (field !== undefined) error.field = field;
  const headers = { "Content-Type": ERROR_CONTENT_TYPE, ...BASE_HEADERS };
  return new Response(forHead ? null : stringifyCanonical({ error }, "errorEnvelope"), {
    status,
    headers,
  });
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

function okResponse(body, headers) {
  return new Response(body, { status: 200, headers });
}

function headOf(response, contentLength) {
  const headers = new Headers(response.headers);
  if (contentLength !== null && contentLength !== undefined) {
    headers.set("Content-Length", String(contentLength));
  }
  return new Response(null, { status: response.status, headers });
}

function resolveStorage(storage) {
  // CATALOG_V2_STORAGE_DIR is a local test seam for the HTTP matrix so
  // fixtures never touch public/; production deployments do not set it.
  if (typeof storage === "object" && storage !== null && storage.dir !== undefined) return storage.dir;
  if (typeof storage === "string") return storage;
  return process.env.CATALOG_V2_STORAGE_DIR ?? defaultProductionDir();
}

function resolveTrustedKeys(storage) {
  if (typeof storage === "object" && storage !== null && storage.trustedKeysFile !== undefined) return storage.trustedKeysFile;
  return process.env.CATALOG_V2_TRUSTED_KEYS_FILE ?? path.join(process.cwd(), "lib", "catalog-v2", "trusted-keys.json");
}

/**
 * GET/HEAD /api/v2/catalog.json — exact identity-encoded catalog bytes.
 * @param {Request} request
 * @param {{ dir?: string, trustedKeysFile?: string } | string} [storage]
 * @param {boolean} [forHead]
 * @returns {Response}
 */
export function serveCatalog(request, storage = {}, forHead = false) {
  const pair = loadVerifiedProductionPair(resolveStorage(storage), resolveTrustedKeys(storage));
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
  const response = okResponse(new Uint8Array(pair.catalogBytes), headers);
  return forHead ? headOf(response, pair.catalogBytes.byteLength) : response;
}

/**
 * GET/HEAD /api/v2/catalog.json.sig — exact detached-signature envelope bytes.
 * @param {Request} request
 * @param {{ dir?: string, trustedKeysFile?: string } | string} [storage]
 * @param {boolean} [forHead]
 * @returns {Response}
 */
export function serveSignature(request, storage = {}, forHead = false) {
  const pair = loadVerifiedProductionPair(resolveStorage(storage), resolveTrustedKeys(storage));
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
  const response = okResponse(new Uint8Array(pair.sigBytes), headers);
  return forHead ? headOf(response, pair.sigBytes.byteLength) : response;
}

/**
 * GET/HEAD /api/v2/plugins — filtered, sorted, paginated discovery projection.
 * @param {Request} request
 * @param {{ dir?: string, trustedKeysFile?: string } | string} [storage]
 * @param {boolean} [forHead]
 * @returns {Response}
 */
export function serveSearch(request, storage = {}, forHead = false) {
  const pair = loadVerifiedProductionPair(resolveStorage(storage), resolveTrustedKeys(storage));
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
  const response = okResponse(body, headers);
  return forHead ? headOf(response, Buffer.byteLength(body)) : response;
}
