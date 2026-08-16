import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createPublicKey } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
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
import { deployPair, makeCatalog, makeKeyPair, makePlugin, makeRelease } from "./fixtures.mjs";
import { stringifyCanonical } from "../../lib/catalog-v2/catalog.mjs";

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
    assert.equal(body.toString("utf8"), readFileSync(path.join(dir, "generations", "00000001", "catalog.json.sig"), "utf8"));
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
    const catalogFile = path.join(dir, "generations", "00000001", "catalog.json");
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

test("the committed production allowlist carries exactly the reviewed turboism-official-v1 public key", async () => {
  const allowlist = JSON.parse(readFileSync(path.join(process.cwd(), "lib", "catalog-v2", "trusted-keys.json"), "utf8"));
  // Exactly one key, no extras.
  assert.deepEqual(Object.keys(allowlist), ["turboism-official-v1"]);
  const entry = allowlist["turboism-official-v1"];
  assert.equal(entry.purpose, "production");
  assert.equal(typeof entry.pem, "string");
  // Public-only: no private-key marker may exist in the allowlist.
  assert.doesNotMatch(entry.pem, /PRIVATE KEY/, "the committed allowlist must never carry private-key material");
  // A valid Ed25519 SPKI public key.
  const publicKey = createPublicKey(entry.pem);
  assert.equal(publicKey.asymmetricKeyType, "ed25519");
  // Frozen ceremony fingerprints: public PEM and SPKI DER SHA-256.
  assert.equal(
    createHash("sha256").update(entry.pem).digest("hex"),
    "7d143588b7402d233d374e6701b7dd818503c899f69aa28f7ae21461ef639718",
  );
  const spkiDer = Buffer.from(entry.pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
  assert.equal(
    createHash("sha256").update(spkiDer).digest("hex"),
    "53bcd1e36aa9d8af00de14be0619079136e3cfe0078dc5ad85d5d2328ed0eb83",
  );
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

test("hostile CATALOG_V2_* environment variables are NEVER consulted by routes", async () => {
  const provisionedDir = tempDir();
  const emptyDir = tempDir();
  try {
    deployPair(provisionedDir);
    const previousStorage = process.env.CATALOG_V2_STORAGE_DIR;
    const previousKeys = process.env.CATALOG_V2_TRUSTED_KEYS_FILE;
    process.env.CATALOG_V2_STORAGE_DIR = provisionedDir;
    process.env.CATALOG_V2_TRUSTED_KEYS_FILE = path.join(provisionedDir, "trusted-keys.json");
    try {
      // Default storage (no injected object) must ignore the hostile env and
      // read the real production root: an empty dir fails closed with 503.
      const response = serveCatalog(request("/api/v2/catalog.json"));
      assert.equal(response.status, 503);
      const envelope = JSON.parse(await response.text());
      assert.equal(envelope.error.code, "catalog_unavailable");
      const search = serveSearch(request("/api/v2/plugins"));
      assert.equal(search.status, 503);
    } finally {
      if (previousStorage === undefined) delete process.env.CATALOG_V2_STORAGE_DIR;
      else process.env.CATALOG_V2_STORAGE_DIR = previousStorage;
      if (previousKeys === undefined) delete process.env.CATALOG_V2_TRUSTED_KEYS_FILE;
      else process.env.CATALOG_V2_TRUSTED_KEYS_FILE = previousKeys;
    }
  } finally {
    rmSync(provisionedDir, { recursive: true, force: true });
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("HEAD mirrors GET for error responses: same status, Content-Length, no body", async () => {
  const dir = tempDir();
  try {
    // 503: unprovisioned storage.
    const storage = storageFor(dir);
    const get = serveCatalog(request("/api/v2/catalog.json"), storage);
    assert.equal(get.status, 503);
    const getBody = await get.text();
    const head = serveCatalog(request("/api/v2/catalog.json", { method: "HEAD" }), storage, true);
    assert.equal(head.status, 503);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.equal(head.headers.get("content-length"), String(Buffer.byteLength(getBody)));
    // 400: provisioned storage with an invalid query.
    deployPair(dir);
    const getSearch = serveSearch(request("/api/v2/plugins?unknown=1"), storage);
    assert.equal(getSearch.status, 400);
    const headSearch = serveSearch(request("/api/v2/plugins?unknown=1", { method: "HEAD" }), storage, true);
    assert.equal(headSearch.status, 400);
    assert.equal(headSearch.headers.get("content-length"), String(Buffer.byteLength(await getSearch.text())));
    // 500: provisioned storage with a tampered catalog.
    const catalogFile = path.join(dir, "generations", "00000001", "catalog.json");
    const bytes = Buffer.from(readFileSync(catalogFile, "utf8"));
    bytes[bytes.length - 1] = bytes[bytes.length - 1] === 0x7d ? 0x7e : 0x7d;
    writeFileSync(catalogFile, bytes);
    const getBroken = serveCatalog(request("/api/v2/catalog.json"), storage);
    assert.equal(getBroken.status, 500);
    const headBroken = serveCatalog(request("/api/v2/catalog.json", { method: "HEAD" }), storage, true);
    assert.equal(headBroken.status, 500);
    assert.equal(headBroken.headers.get("content-length"), String(Buffer.byteLength(await getBroken.text())));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Accept negotiation honors q=0, malformed qvalues, and requires vendor version=2", async () => {
  const dir = tempDir();
  try {
    deployPair(dir);
    const storage = storageFor(dir);
    const cases = [
      [{ Accept: "application/vnd.turboism.plugin-catalog+json;version=2;q=0" }, 406],
      [{ Accept: "application/json;q=0" }, 406],
      [{ Accept: "*/*;q=0" }, 406],
      [{ Accept: "application/*;q=0" }, 406],
      [{ Accept: "application/json;q=banana" }, 406],
      [{ Accept: "application/json;q=0.5" }, 200],
      [{ Accept: "application/vnd.turboism.plugin-catalog+json" }, 406], // vendor type requires version=2
      [{ Accept: "application/vnd.turboism.plugin-catalog+json;version=2;q=0.5" }, 200],
      [{ Accept: "text/html, application/json;q=0.8" }, 200],
      [{ Accept: "application/json;q=0, */*;q=0" }, 406],
      [{ Accept: "application/json; version=2" }, 200], // irrelevant params on generic types are fine
      [{ Accept: "application/json;q=1.000" }, 200],
      [{ Accept: "application/json;q=0.000" }, 406],
      [{ Accept: "application/vnd.turboism.plugin-catalog+json;version=1" }, 406],
      [{ Accept: "application/vnd.turboism.plugin-catalog+json;version=2;version=2" }, 406], // duplicate param
      [{ Accept: "application/vnd.turboism.plugin-catalog+json;version" }, 406], // missing value
      [{ Accept: "broken" }, 406],
    ];
    for (const [headers, expected] of cases) {
      const response = serveCatalog(request("/api/v2/catalog.json", { headers }), storage);
      assert.equal(response.status, expected, JSON.stringify(headers));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("generation pointer: missing, torn, escaping, and symlinked pointers fail closed", async () => {
  const dir = tempDir();
  try {
    const { commitPointer, loadCurrentGeneration, POINTER_FILE } = await import("../../lib/catalog-v2/storage.mjs");
    deployPair(dir);
    const storage = storageFor(dir);
    assert.equal(serveCatalog(request("/api/v2/catalog.json"), storage).status, 200);
    // Missing pointer -> 503.
    rmSync(path.join(dir, POINTER_FILE));
    assert.equal(serveCatalog(request("/api/v2/catalog.json"), storage).status, 503);
    // Torn pointer (garbage) -> 503.
    writeFileSync(path.join(dir, POINTER_FILE), "00000002x!");
    assert.equal(serveCatalog(request("/api/v2/catalog.json"), storage).status, 503);
    assert.equal(loadCurrentGeneration(dir).ok, false);
    // Escaping pointer -> 503 (traversal is rejected by the id grammar).
    writeFileSync(path.join(dir, POINTER_FILE), "../escape");
    assert.equal(serveCatalog(request("/api/v2/catalog.json"), storage).status, 503);
    // Pointer to a missing generation -> 503.
    writeFileSync(path.join(dir, POINTER_FILE), "00000099");
    assert.equal(serveCatalog(request("/api/v2/catalog.json"), storage).status, 503);
    // Pointer whose generation directory is a symlink -> 503 (symlink escape).
    const outside = tempDir();
    try {
      writeFileSync(path.join(dir, POINTER_FILE), "00000007");
      symlinkSync(outside, path.join(dir, "generations", "00000007"));
      const response = serveCatalog(request("/api/v2/catalog.json"), storage);
      assert.equal(response.status, 503);
      const envelope = JSON.parse(await response.text());
      assert.equal(envelope.error.code, "catalog_unavailable");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
    // Restore a valid pointer for subsequent assertions.
    const restored = commitPointer(dir, "00000001");
    assert.ok(restored.ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("replacement and rollback: the pointer is the single atomic switch", async () => {
  const dir = tempDir();
  try {
    const { commitPointer, stageGeneration } = await import("../../lib/catalog-v2/storage.mjs");
    const first = deployPair(dir);
    const storage = storageFor(dir);
    const firstResponse = serveCatalog(request("/api/v2/catalog.json"), storage);
    const firstBody = Buffer.from(await firstResponse.arrayBuffer());
    assert.ok(firstBody.equals(first.catalogBytes));
    // Publish a second generation with different bytes, signed with its own
    // key id; both keys stay in the allowlist so each generation verifies.
    const secondCatalog = makeCatalog({ catalogVersion: 2 });
    const secondBytes = Buffer.from(stringifyCanonical(secondCatalog, "catalog"));
    const secondKeys = makeKeyPair();
    const { signCatalogBytes } = await import("../../lib/catalog-v2/catalog.mjs");
    const signed = signCatalogBytes(secondBytes, secondKeys.privateKey, "turboism-test-v2-b");
    assert.ok(signed.ok);
    const secondSig = Buffer.from(stringifyCanonical(signed.envelope, "envelope"), "utf8");
    const combinedAllowlist = { ...first.allowlist, "turboism-test-v2-b": { pem: secondKeys.publicKey, purpose: "production" } };
    writeFileSync(path.join(dir, "trusted-keys.json"), JSON.stringify(combinedAllowlist));
    const staged = stageGeneration(dir, "00000002", secondBytes, secondSig);
    assert.ok(staged.ok);
    // Fault injection: the pointer was NOT committed; the old generation is served.
    const stillOld = serveCatalog(request("/api/v2/catalog.json"), storage);
    assert.ok(Buffer.from(await stillOld.arrayBuffer()).equals(first.catalogBytes));
    // Commit the pointer: the new generation is served atomically.
    assert.ok(commitPointer(dir, "00000002").ok);
    const nowNew = serveCatalog(request("/api/v2/catalog.json"), storage);
    const newBody = Buffer.from(await nowNew.arrayBuffer());
    assert.ok(newBody.equals(secondBytes));
    assert.equal(JSON.parse(newBody.toString("utf8")).catalogVersion, 2);
    // Rollback: point back at generation 1; the old pair is served again.
    assert.ok(commitPointer(dir, "00000001").ok);
    const rolledBack = serveCatalog(request("/api/v2/catalog.json"), storage);
    assert.ok(Buffer.from(await rolledBack.arrayBuffer()).equals(first.catalogBytes));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("publish staging refuses to overwrite an existing generation", async () => {
  const dir = tempDir();
  try {
    const { stageGeneration } = await import("../../lib/catalog-v2/storage.mjs");
    deployPair(dir);
    const staged = stageGeneration(dir, "00000001", Buffer.from("x"), Buffer.from("y"));
    assert.ok(!staged.ok);
    assert.ok(staged.message.includes("already exists"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
