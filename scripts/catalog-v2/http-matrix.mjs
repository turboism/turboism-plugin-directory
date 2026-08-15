#!/usr/bin/env node
// Bounded fail-closed HTTP acceptance matrix for the v2 provider endpoints.
// Run against a local production server (next build && next start):
//
//   node scripts/catalog-v2/http-matrix.mjs <base-url>
//
// The server must be UNPROVISIONED (no public/api/v2 pair): every v2 endpoint
// must return the stable 503 catalog_unavailable envelope, HEAD must mirror
// GET (same status and Content-Length, no body), unsupported methods must be
// rejected, and the fail-closed state must dominate Accept negotiation even
// with hostile CATALOG_V2_* environment variables set on the server (the
// routes never consult them). Provisioned-path behavior is covered by
// tests/catalog-v2/http.test.mjs with explicitly injected storage objects.
//
// Exits non-zero when any gate fails.
const baseUrl = process.argv[2];
if (!baseUrl) {
  console.error("usage: node scripts/catalog-v2/http-matrix.mjs <base-url>");
  process.exit(2);
}

const CATALOG_CT = "application/vnd.turboism.plugin-catalog+json;version=2";
const ERROR_CT = "application/json";

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
    response.status === 503 && response.headers.get("content-type") === ERROR_CT && response.headers.get("x-content-type-options") === "nosniff",
  );
  const head = await request("HEAD", url);
  report(
    `HEAD ${name} mirrors GET: 503, no body, same Content-Length`,
    head.status === 503 &&
      head.body.byteLength === 0 &&
      head.headers.get("content-length") === String(response.body.byteLength),
    `status ${head.status} body ${head.body.byteLength} length ${head.headers.get("content-length")}`,
  );
}

const post = await request("POST", catalogUrl);
report("POST catalog is rejected (405)", post.status === 405, `status ${post.status}`);

const v1Accept = await request("GET", catalogUrl, { Accept: "application/vnd.turboism.plugin-catalog+json;version=1" });
report("unprovisioned version=1 Accept still fails closed with 503", v1Accept.status === 503 && jsonEnvelope(v1Accept.body)?.error?.code === "catalog_unavailable", `status ${v1Accept.status}`);

const q0Accept = await request("GET", catalogUrl, { Accept: `${CATALOG_CT};q=0` });
report("unprovisioned q=0 Accept still fails closed with 503", q0Accept.status === 503, `status ${q0Accept.status}`);

const home = await request("GET", baseUrl);
report("site homepage still serves 200", home.status === 200, `status ${home.status}`);

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures === 0 ? 0 : 1);
