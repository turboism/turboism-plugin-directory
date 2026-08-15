import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  CATALOG_CACHE_CONTROL,
  CATALOG_CONTENT_TYPE,
  SEARCH_CACHE_CONTROL,
  SEARCH_CONTENT_TYPE,
  SIGNATURE_CONTENT_TYPE,
  serveCatalog,
  serveSignature,
  serveSearch,
} from "../../lib/catalog-v2/http.mjs";
import { verifyCatalogBytes } from "../../lib/catalog-v2/catalog.mjs";
import { deployPair, makePlugin, makeRelease } from "./fixtures.mjs";

const BASE = "https://plugin.turboism.dev";

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "catalog-v2-http-"));
}

const request = (pathname, { method = "GET", headers = {} } = {}) =>
  new Request(`${BASE}${pathname}`, { method, headers });

const storageFor = (dir) => ({ dir, trustedKeysFile: path.join(dir, "trusted-keys.json") });

test("without a provisioned pair every endpoint fails closed with 503 catalog_unavailable", async () => {
  const dir = tempDir();
  try {
    const storage = storageFor(dir);
    for (const [pathname, serve] of [
      ["/api/v2/catalog.json", serveCatalog],
      ["/api/v2/catalog.json.sig", serveSignature],
      ["/api/v2/plugins", serveSearch],
    ]) {
      const response = serve(request(pathname), storage);
      assert.equal(response.status, 503);
      const envelope = JSON.parse(await response.text());
      assert.equal(envelope.error.code, "catalog_unavailable");
      assert.equal(response.headers.get("content-type"), "application/json");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(response.headers.get("cache-control"), null);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fail-closed errors never leak paths or stacks", async () => {
  const dir = tempDir();
  try {
    const response = serveCatalog(request("/api/v2/catalog.json"), storageFor(dir));
    const body = await response.text();
    assert.ok(!body.includes(dir));
    assert.ok(!body.includes("Error"));
    assert.ok(!body.includes("public"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("catalog endpoint serves exact identity bytes with v2 media type, ETag, and cache policy", async () => {
  const dir = tempDir();
  try {
    const deployed = deployPair(dir);
    const storage = storageFor(dir);
    const response = serveCatalog(request("/api/v2/catalog.json"), storage);
    assert.equal(response.status, 200);
    const body = Buffer.from(await response.arrayBuffer());
    assert.ok(body.equals(deployed.catalogBytes));
    assert.equal(response.headers.get("content-type"), CATALOG_CONTENT_TYPE);
    assert.equal(response.headers.get("cache-control"), CATALOG_CACHE_CONTROL);
    assert.equal(response.headers.get("etag"), `"${createHash("sha256").update(deployed.catalogBytes).digest("hex")}"`);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("signature endpoint serves exact envelope bytes", async () => {
  const dir = tempDir();
  try {
    deployPair(dir);
    const storage = storageFor(dir);
    const response = serveSignature(request("/api/v2/catalog.json.sig"), storage);
    assert.equal(response.status, 200);
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.toString("utf8"), readFileSync(path.join(dir, "catalog.json.sig"), "utf8"));
    assert.equal(response.headers.get("content-type"), SIGNATURE_CONTENT_TYPE);
    assert.equal(response.headers.get("cache-control"), CATALOG_CACHE_CONTROL);
    assert.ok(response.headers.get("etag"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HEAD returns the same headers with no body and a Content-Length", async () => {
  const dir = tempDir();
  try {
    const deployed = deployPair(dir);
    const storage = storageFor(dir);
    const get = serveCatalog(request("/api/v2/catalog.json"), storage);
    const head = serveCatalog(request("/api/v2/catalog.json", { method: "HEAD" }), storage, true);
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(head.headers.get("etag"), get.headers.get("etag"));
    assert.equal(head.headers.get("content-length"), String(deployed.catalogBytes.byteLength));
    const searchHead = serveSearch(request("/api/v2/plugins", { method: "HEAD" }), storage, true);
    assert.equal(searchHead.status, 200);
    assert.equal((await searchHead.arrayBuffer()).byteLength, 0);
    assert.ok(Number(searchHead.headers.get("content-length")) > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("If-None-Match returns 304 with no body on every endpoint", async () => {
  const dir = tempDir();
  try {
    deployPair(dir);
    const storage = storageFor(dir);
    for (const [pathname, serve] of [
      ["/api/v2/catalog.json", serveCatalog],
      ["/api/v2/catalog.json.sig", serveSignature],
      ["/api/v2/plugins", serveSearch],
    ]) {
      const first = serve(request(pathname), storage);
      const etag = first.headers.get("etag");
      const revalidated = serve(request(pathname, { headers: { "If-None-Match": etag } }), storage);
      assert.equal(revalidated.status, 304, pathname);
      assert.equal((await revalidated.arrayBuffer()).byteLength, 0);
      assert.equal(revalidated.headers.get("etag"), etag);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("If-None-Match with a weak or star value also revalidates", async () => {
  const dir = tempDir();
  try {
    deployPair(dir);
    const storage = storageFor(dir);
    const etag = serveCatalog(request("/api/v2/catalog.json"), storage).headers.get("etag");
    assert.equal(serveCatalog(request("/api/v2/catalog.json", { headers: { "If-None-Match": `W/${etag}` } }), storage).status, 304);
    assert.equal(serveCatalog(request("/api/v2/catalog.json", { headers: { "If-None-Match": "*" } }), storage).status, 304);
    assert.equal(serveCatalog(request("/api/v2/catalog.json", { headers: { "If-None-Match": '"not-the-tag"' } }), storage).status, 200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Accept negotiation: version=1 and unrelated media types return 406 not_acceptable", async () => {
  const dir = tempDir();
  try {
    deployPair(dir);
    const storage = storageFor(dir);
    const versionOne = serveCatalog(request("/api/v2/catalog.json", { headers: { Accept: "application/vnd.turboism.plugin-catalog+json;version=1" } }), storage);
    assert.equal(versionOne.status, 406);
    const envelope = JSON.parse(await versionOne.text());
    assert.equal(envelope.error.code, "not_acceptable");
    const html = serveSearch(request("/api/v2/plugins", { headers: { Accept: "text/html" } }), storage);
    assert.equal(html.status, 406);
    const json = serveSearch(request("/api/v2/plugins", { headers: { Accept: "application/json" } }), storage);
    assert.equal(json.status, 200);
    const star = serveCatalog(request("/api/v2/catalog.json", { headers: { Accept: "*/*" } }), storage);
    assert.equal(star.status, 200);
    const v2 = serveCatalog(request("/api/v2/catalog.json", { headers: { Accept: "application/vnd.turboism.plugin-catalog+json;version=2" } }), storage);
    assert.equal(v2.status, 200);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search endpoint returns the canonical discovery response and 400 invalid_query with field", async () => {
  const dir = tempDir();
  try {
    const plugins = [
      makePlugin({
        releases: [
          makeRelease({ version: "0.1.0", publishedAt: "2026-08-15T00:00:00Z" }),
          makeRelease({ version: "0.2.0", publishedAt: "2026-08-20T00:00:00Z" }),
        ],
      }),
      makePlugin({
        id: "dev.acme.plugin.palette-helper",
        slug: "palette-helper",
        name: "Palette Helper",
        trust: "reviewed-third-party",
        author: "Acme Studio",
        releases: [makeRelease({ version: "0.1.0", channel: "stable", publishedAt: "2026-08-12T00:00:00Z", category: "rendering", tags: ["color", "palette"], requiresCubism: false, cubismVersions: [] })],
      }),
    ];
    deployPair(dir, { plugins });
    const storage = storageFor(dir);
    const response = serveSearch(request("/api/v2/plugins?q=palette&pageSize=1"), storage);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), SEARCH_CONTENT_TYPE);
    assert.equal(response.headers.get("cache-control"), SEARCH_CACHE_CONTROL);
    const body = JSON.parse(await response.text());
    assert.equal(body.format, "turboism.plugin.search");
    assert.equal(body.schemaVersion, 2);
    assert.equal(body.query.q, "palette");
    assert.deepEqual(body.pagination, { page: 1, pageSize: 1, totalItems: 1, totalPages: 1, hasPrevious: false, hasNext: false });
    assert.equal(body.items[0].id, "dev.acme.plugin.palette-helper");
    assert.equal(body.items[0].latestCompatibleRelease.category, "rendering");
    assert.ok(!("category" in body.items[0]));

    const invalid = serveSearch(request("/api/v2/plugins?unknown=1"), storage);
    assert.equal(invalid.status, 400);
    const errorEnvelope = JSON.parse(await invalid.text());
    assert.deepEqual(errorEnvelope.error, { code: "invalid_query", message: "unknown query parameter", field: "unknown" });
    assert.deepEqual(Object.keys(errorEnvelope), ["error"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tampered deployed catalog fails closed with 500 catalog_invalid", async () => {
  const dir = tempDir();
  try {
    deployPair(dir);
    const catalogFile = path.join(dir, "catalog.json");
    const bytes = Buffer.from(readFileSync(catalogFile, "utf8"));
    bytes[bytes.length - 1] = bytes[bytes.length - 1] === 0x7d ? 0x7e : 0x7d;
    writeFileSync(catalogFile, bytes);
    const storage = storageFor(dir);
    for (const [pathname, serve] of [
      ["/api/v2/catalog.json", serveCatalog],
      ["/api/v2/catalog.json.sig", serveSignature],
      ["/api/v2/plugins", serveSearch],
    ]) {
      const response = serve(request(pathname), storage);
      assert.equal(response.status, 500);
      const envelope = JSON.parse(await response.text());
      assert.equal(envelope.error.code, "catalog_invalid");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a pair signed with a test-purpose key is rejected by production routes", async () => {
  const dir = tempDir();
  try {
    deployPair(dir, { purpose: "test" });
    const storage = storageFor(dir);
    const response = serveCatalog(request("/api/v2/catalog.json"), storage);
    assert.equal(response.status, 500);
    const envelope = JSON.parse(await response.text());
    assert.equal(envelope.error.code, "catalog_invalid");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the committed production allowlist is empty, so the default routes fail closed", async () => {
  const allowlist = JSON.parse(readFileSync(path.join(process.cwd(), "lib", "catalog-v2", "trusted-keys.json"), "utf8"));
  assert.deepEqual(allowlist, {});
});

test("served catalog and signature form a verifiable pair", async () => {
  const dir = tempDir();
  try {
    const deployed = deployPair(dir);
    const storage = storageFor(dir);
    const catalogResponse = serveCatalog(request("/api/v2/catalog.json"), storage);
    const sigResponse = serveSignature(request("/api/v2/catalog.json.sig"), storage);
    const verified = verifyCatalogBytes(
      Buffer.from(await catalogResponse.arrayBuffer()),
      Buffer.from(await sigResponse.arrayBuffer()),
      deployed.allowlist,
      { requireProduction: true },
    );
    assert.ok(verified.ok, JSON.stringify(verified.errors));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search with a yanked-only catalog still serves a valid response", async () => {
  const dir = tempDir();
  try {
    deployPair(dir, { plugins: [] });
    const storage = storageFor(dir);
    const response = serveSearch(request("/api/v2/plugins"), storage);
    assert.equal(response.status, 200);
    const body = JSON.parse(await response.text());
    assert.deepEqual(body.items, []);
    assert.equal(body.pagination.totalPages, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("catalog key order in deployed bytes is canonical and deterministic", async () => {
  const dir = tempDir();
  try {
    const first = deployPair(dir);
    const second = deployPair(path.join(dir, "again"));
    assert.equal(first.catalogBytes.toString("utf8"), second.catalogBytes.toString("utf8"));
    const parsed = JSON.parse(first.catalogBytes.toString("utf8"));
    assert.deepEqual(Object.keys(parsed), ["format", "schemaVersion", "catalogVersion", "publishedAt", "plugins"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
