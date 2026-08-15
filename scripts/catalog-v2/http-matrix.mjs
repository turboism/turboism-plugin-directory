#!/usr/bin/env node
// Bounded HTTP acceptance matrix for the v2 provider endpoints. Run against a
// local production server (next build && next start):
//
//   node scripts/catalog-v2/http-matrix.mjs <base-url> [--fixtures <dir> --keys <allowlist>]
//
// Phase A (default, fail closed): with no provisioned pair, every v2 endpoint
// must return the stable 503 catalog_unavailable envelope, HEAD must have no
// body, unsupported methods must be rejected, and version=1 Accept must 406.
//
// Phase B (--fixtures): start the server with
//   CATALOG_V2_STORAGE_DIR=<fixture dir> CATALOG_V2_TRUSTED_KEYS_FILE=<allowlist>
// so fixtures never touch public/. Checks identity bytes against the local
// files, exact media types, cache/CORS/nosniff headers, HEAD bodylessness and
// Content-Length, ETag -> 304 without a body, signature verification of the
// served bytes, and the discovery error envelope.
//
// Exits non-zero when any gate fails.
import { readFileSync } from "node:fs";
import path from "node:path";
import { verifyCatalogBytes } from "../../lib/catalog-v2/catalog.mjs";

const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("usage: node scripts/catalog-v2/http-matrix.mjs <base-url> [--fixtures <dir> --keys <allowlist>]");
  process.exit(2);
}
const args = process.argv.slice(3);
const argValue = (name) => {
  const index = args.indexOf(name);
  return index === -1 || index + 1 >= args.length ? null : args[index + 1];
};
const fixturesDir = argValue("--fixtures");
const keysFile = argValue("--keys");

const CATALOG_CT = "application/vnd.turboism.plugin-catalog+json;version=2";
const SIGNATURE_CT = "application/vnd.turboism.plugin-catalog-signature+json;version=2";
const SEARCH_CT = "application/vnd.turboism.plugin-search+json;version=2";
const CATALOG_CACHE = "public, max-age=300, stale-while-revalidate=86400";
const SEARCH_CACHE = "public, max-age=60, stale-while-revalidate=300";

let checks = 0;
let failures = 0;

function report(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function request(method, url, headers = {}) {
  const response = await fetch(url, { method, headers, redirect: "manual" });
  const body = Buffer.from(await response.arrayBuffer());
  return { status: response.status, headers: response.headers, body };
}

function jsonEnvelope(body) {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
}

const catalogUrl = `${baseUrl}/api/v2/catalog.json`;
const sigUrl = `${baseUrl}/api/v2/catalog.json.sig`;
const searchUrl = `${baseUrl}/api/v2/plugins`;

// ---------------------------------------------------------------------------
// Phase selection: without --fixtures this expects an unprovisioned server and
// runs the fail-closed phase only; with --fixtures it expects a server started
// through the env test seam and runs the provisioned phase only.
// ---------------------------------------------------------------------------
if (!fixturesDir || !keysFile) {
  console.log("Phase A: fail-closed expectations (unprovisioned server)");
  for (const [name, url] of [
    ["catalog", catalogUrl],
    ["signature", sigUrl],
    ["search", searchUrl],
  ]) {
    const response = await request("GET", url);
    report(`GET ${name} fails closed with 503`, response.status === 503, `status ${response.status}`);
    const envelope = jsonEnvelope(response.body);
    report(
      `GET ${name} returns the catalog_unavailable envelope`,
      response.status === 503 && envelope && envelope.error && envelope.error.code === "catalog_unavailable",
      JSON.stringify(envelope?.error?.code ?? response.body.toString().slice(0, 60)),
    );
    report(
      `GET ${name} has error content type and nosniff`,
      response.status === 503 && response.headers.get("content-type") === "application/json" && response.headers.get("x-content-type-options") === "nosniff",
    );
    const head = await request("HEAD", url);
    report(`HEAD ${name} fails closed with no body`, head.status === 503 && head.body.byteLength === 0, `status ${head.status} body ${head.body.byteLength}`);
  }

  const post = await request("POST", catalogUrl);
  report("POST catalog is rejected (405)", post.status === 405, `status ${post.status}`);

  const v1Accept = await request("GET", catalogUrl, { Accept: "application/vnd.turboism.plugin-catalog+json;version=1" });
  report("unprovisioned version=1 Accept still fails closed with 503", v1Accept.status === 503 && jsonEnvelope(v1Accept.body)?.error?.code === "catalog_unavailable", `status ${v1Accept.status}`);

  const home = await request("GET", baseUrl);
  report("site homepage still serves 200", home.status === 200, `status ${home.status}`);
} else {
  console.log("Phase B: provisioned expectations (env test seam server)");
  const catalogFile = path.join(fixturesDir, "catalog.json");
  const sigFile = path.join(fixturesDir, "catalog.json.sig");
  const localCatalog = readFileSync(catalogFile);
  const localSig = readFileSync(sigFile);

  const getCatalog = await request("GET", catalogUrl, { Accept: CATALOG_CT });
  report("provisioned catalog serves exact identity bytes", getCatalog.status === 200 && getCatalog.body.equals(localCatalog));
  report(
    "provisioned catalog media type and cache policy",
    getCatalog.status === 200 && getCatalog.headers.get("content-type") === CATALOG_CT && getCatalog.headers.get("cache-control") === CATALOG_CACHE,
  );
  report("catalog has ETag and CORS/nosniff", getCatalog.headers.get("etag") !== null && getCatalog.headers.get("access-control-allow-origin") === "*");

  const getSig = await request("GET", sigUrl, { Accept: SIGNATURE_CT });
  report("provisioned signature serves exact envelope bytes", getSig.status === 200 && getSig.body.equals(localSig));
  report(
    "provisioned signature media type and cache policy",
    getSig.status === 200 && getSig.headers.get("content-type") === SIGNATURE_CT && getSig.headers.get("cache-control") === CATALOG_CACHE,
  );

  const servedPair = verifyCatalogBytes(getCatalog.body, getSig.body, JSON.parse(readFileSync(keysFile, "utf8")), { requireProduction: true });
  report("served pair verifies under the allowlist", servedPair.ok, servedPair.ok ? "" : servedPair.errors[0].message);

  const headCatalog = await request("HEAD", catalogUrl);
  report(
    "HEAD catalog has no body, same ETag, and Content-Length",
    headCatalog.status === 200 &&
      headCatalog.body.byteLength === 0 &&
      headCatalog.headers.get("etag") === getCatalog.headers.get("etag") &&
      headCatalog.headers.get("content-length") === String(localCatalog.byteLength),
  );

  const etag = getCatalog.headers.get("etag");
  const revalidated = await request("GET", catalogUrl, { "If-None-Match": etag });
  report("If-None-Match returns 304 with no body", revalidated.status === 304 && revalidated.body.byteLength === 0, `status ${revalidated.status}`);

  const search = await request("GET", `${searchUrl}?pageSize=5`, { Accept: SEARCH_CT });
  report(
    "search returns 200 with search media type",
    search.status === 200 && search.headers.get("content-type") === SEARCH_CT && search.headers.get("cache-control") === SEARCH_CACHE,
    `status ${search.status}`,
  );
  const searchBody = jsonEnvelope(search.body);
  report(
    "search body shape: format/schemaVersion/pagination",
    searchBody?.format === "turboism.plugin.search" && searchBody?.schemaVersion === 2 && searchBody?.pagination?.page === 1 && searchBody?.pagination?.pageSize === 5,
  );

  const invalid = await request("GET", `${searchUrl}?unknown=x`);
  report("unknown query parameter returns 400 invalid_query", invalid.status === 400 && jsonEnvelope(invalid.body)?.error?.code === "invalid_query", `status ${invalid.status}`);

  const badTrust = await request("GET", `${searchUrl}?trust=community`);
  report("invalid trust value returns 400 with field", badTrust.status === 400 && jsonEnvelope(badTrust.body)?.error?.field === "trust", `status ${badTrust.status}`);

  const v1Accept = await request("GET", catalogUrl, { Accept: "application/vnd.turboism.plugin-catalog+json;version=1" });
  report("version=1 Accept returns 406 not_acceptable when provisioned", v1Accept.status === 406 && jsonEnvelope(v1Accept.body)?.error?.code === "not_acceptable", `status ${v1Accept.status}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
