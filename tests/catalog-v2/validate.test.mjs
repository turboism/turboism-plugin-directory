import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ARTIFACT_SIZE,
  MAX_CATALOG_BYTES,
  MAX_SIGNATURE_BYTES,
  OFFICIAL_CATEGORIES,
  loadTrustedKeys,
  validateCatalogBytes,
  validateEnvelopeBytes,
  validateParsedCatalog,
} from "../../lib/catalog-v2/catalog.mjs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCatalog, makeKeyPair, makePlugin, makeRelease } from "./fixtures.mjs";

const ok = (bytes) => {
  const result = validateCatalogBytes(bytes);
  assert.ok(result.ok, `expected valid catalog: ${JSON.stringify(result.errors ?? null)}`);
  return result.catalog;
};

const invalid = (bytes) => {
  const result = validateCatalogBytes(bytes);
  assert.ok(!result.ok, "expected catalog to be rejected");
  return result.errors;
};

test("empty catalog from the contract example validates", () => {
  const catalog = ok(
    Buffer.from(
      JSON.stringify({
        format: "turboism.plugin.catalog",
        schemaVersion: 2,
        catalogVersion: 1,
        publishedAt: "2026-08-15T00:00:00Z",
        plugins: [],
      }),
    ),
  );
  assert.equal(catalog.plugins.length, 0);
});

test("populated catalog with official category validates and preserves tag order", () => {
  const catalog = ok(Buffer.from(JSON.stringify(makeCatalog())));
  assert.equal(catalog.plugins[0].releases[0].tags[0], "project");
});

test("unknown fields reject at every object level", () => {
  const cases = [
    makeCatalog({ extra: true }),
    makeCatalog({ plugins: [makePlugin({ extra: true })] }),
    makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ extra: true })] })] }),
    makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ artifact: { ...makeRelease().artifact, extra: true } })] })] }),
    makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ dependencies: [{ ...makeRelease().dependencies[0], extra: true }] })] })] }),
    makeCatalog({ plugins: [makePlugin({ localizations: { "zh-Hans": { name: "a", summary: "b", extra: true } } })] }),
  ];
  for (const catalog of cases) {
    const errors = invalid(Buffer.from(JSON.stringify(catalog)));
    assert.ok(errors.some((issue) => issue.message.includes("unknown field")), `expected unknown-field issue in ${JSON.stringify(errors)}`);
  }
});

test("canonical key order is enforced", () => {
  const catalog = makeCatalog();
  const reordered = {
    format: catalog.format,
    catalogVersion: catalog.catalogVersion,
    schemaVersion: catalog.schemaVersion,
    publishedAt: catalog.publishedAt,
    plugins: catalog.plugins,
  };
  const errors = invalid(Buffer.from(JSON.stringify(reordered)));
  assert.ok(errors.some((issue) => issue.message.includes("out of canonical key order")));
});

test("missing required fields reject", () => {
  const catalog = makeCatalog();
  delete catalog.plugins;
  const errors = invalid(Buffer.from(JSON.stringify(catalog)));
  assert.ok(errors.some((issue) => issue.message.includes('missing required field "plugins"')));
});

test("wrong format and schema version reject", () => {
  invalid(Buffer.from(JSON.stringify(makeCatalog({ format: "turboism.plugin.catalog.v2" }))));
  invalid(Buffer.from(JSON.stringify(makeCatalog({ schemaVersion: 1 }))));
  const sig = { format: "turboism.plugin.catalog.signature", schemaVersion: 1, algorithm: "Ed25519", keyId: "a-b", catalogSha256: "0".repeat(64), signature: "A".repeat(88) };
  const envelopeCheck = validateEnvelopeBytes(Buffer.from(JSON.stringify(sig)));
  assert.ok(!envelopeCheck.ok);
  assert.ok(envelopeCheck.errors.some((issue) => issue.path === "signature.schemaVersion"));
});

test("duplicate plugin ids, slugs, and release versions reject", () => {
  const plugin = makePlugin();
  const duplicateId = makePlugin({ id: "dev.turboism.plugin.other" });
  duplicateId.id = plugin.id;
  invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [plugin, duplicateId] }))));
  const duplicateSlug = makePlugin({ slug: "project-inspector" });
  invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [plugin, duplicateSlug] }))));
  const releases = [makeRelease(), makeRelease({ version: "0.1.0" })];
  const errors = invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases })] }))));
  assert.ok(errors.some((issue) => issue.message.includes("duplicate release version")));
});

test("release versions must be strictly ascending", () => {
  const releases = [makeRelease({ version: "0.2.0", publishedAt: "2026-08-16T00:00:00Z" }), makeRelease({ version: "0.1.0", publishedAt: "2026-08-15T00:00:00Z" })];
  const errors = invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases })] }))));
  assert.ok(errors.some((issue) => issue.message.includes("strictly ascending")));
});

test("version grammar rejects prerelease and leading zeros", () => {
  for (const version of ["0.1.0-beta", "01.0.0", "1.0", "1.0.0.1", "v1.0.0"]) {
    invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ version })] })] }))));
  }
});

test("catalog body cap: 5 MiB", () => {
  const catalog = makeCatalog();
  const big = makePlugin({ summary: "x".repeat(500), name: "y".repeat(120) });
  catalog.plugins = [];
  while (Buffer.byteLength(JSON.stringify(catalog)) < MAX_CATALOG_BYTES + 1024) {
    catalog.plugins.push(big);
  }
  const errors = invalid(Buffer.from(JSON.stringify(catalog)));
  assert.ok(errors.some((issue) => issue.message.includes("at most")));
});

test("plugin count cap: 10,000 (unreachable through bytes; checked on the parsed object)", () => {
  const plugin = makePlugin();
  const plugins = [];
  for (let i = 0; i < 10001; i += 1) {
    plugins.push(plugin);
  }
  const errors = validateParsedCatalog(makeCatalog({ plugins }));
  assert.ok(!errors.ok);
  assert.ok(errors.errors.some((issue) => issue.message.includes("between 0 and 10000 items")));
});

test("release count cap: 100 per plugin", () => {
  const releases = [];
  for (let i = 0; i < 101; i += 1) {
    releases.push(makeRelease({ version: `0.1.${i}`, publishedAt: `2026-08-15T00:00:0${i % 10}Z` }));
  }
  const errors = invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases })] }))));
  assert.ok(errors.some((issue) => issue.message.includes("between 1 and 100 items")));
});

test("tag bounds: count, length, duplicate, grammar; empty tags are valid", () => {
  ok(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ tags: [] })] })] }))));
  const tagCases = [
    { tags: ["a"] },
    { tags: ["x".repeat(33)] },
    { tags: ["project", "project"] },
    { tags: ["Project"] },
    { tags: Array.from({ length: 13 }, (_, i) => `tag-${i}`) },
  ];
  for (const overrides of tagCases) {
    invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease(overrides)] })] }))));
  }
});

test("category bounds and grammar", () => {
  for (const category of ["a", "x".repeat(33), "Development", "dev tools"]) {
    invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ category })] })] }))));
  }
});

test("official trust requires a registered category; reviewed third-party accepts unknown valid tokens", () => {
  for (const category of OFFICIAL_CATEGORIES) {
    ok(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ category })] })] }))));
  }
  const outside = invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ category: "rendering" })] })] }))));
  assert.ok(outside.some((issue) => issue.message.includes("reviewed registry")));
  ok(
    Buffer.from(
      JSON.stringify(makeCatalog({ plugins: [makePlugin({ trust: "reviewed-third-party", releases: [makeRelease({ category: "rendering" })] })] })),
    ),
  );
});

test("requiresCubism / cubismVersions agreement", () => {
  invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ requiresCubism: true, cubismVersions: [] })] })] }))));
  invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ requiresCubism: false, cubismVersions: ["5.3.02"] })] })] }))));
  invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ cubismVersions: ["5.3.02", "5.3.02"] })] })] }))));
  ok(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ requiresCubism: false, cubismVersions: [] })] })] }))));
});

test("artifact bounds: hashes, size, media type, file name, URL scheme", () => {
  const base = makeRelease().artifact;
  const cases = [
    { sha256: "A".repeat(64) },
    { sha256: "abc" },
    { descriptorSha256: "f".repeat(63) },
    { size: 0 },
    { size: MAX_ARTIFACT_SIZE + 1 },
    { size: 1.5 },
    { mediaType: "application/zip" },
    { fileName: "plugin.zip" },
    { fileName: "x.jar.tmp" },
    { url: "http://example.com/plugin.jar" },
    { url: "https://" },
  ];
  for (const artifact of cases) {
    const errors = invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ artifact: { ...base, ...artifact } })] })] }))));
    assert.ok(errors.length > 0, `expected rejection for ${JSON.stringify(artifact)}`);
  }
});

test("publishedAt rejects rollover, non-UTC, and garbage", () => {
  for (const publishedAt of ["2026-02-30T00:00:00Z", "2026-08-15T00:00:00", "garbage", "2026-13-01T00:00:00Z", "2026-08-15T24:00:00Z"]) {
    invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ publishedAt })] })] }))));
  }
});

test("version range must be exact or half-open with a < b", () => {
  for (const turboismApi of ["[1.0.0,1.0.0)", "[2.0.0,1.0.0)", "1.0", "(1.0.0,2.0.0)", "[1.0.0,2.0.0]"]) {
    invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ turboismApi })] })] }))));
  }
});

test("duplicate dependency and permission ids reject", () => {
  const dependencies = [
    { id: "dev.turboism.plugin.core", version: "0.1.0", type: "required", ordering: "none" },
    { id: "dev.turboism.plugin.core", version: "0.2.0", type: "optional", ordering: "after" },
  ];
  const permissions = [
    { id: "dev.turboism.plugin.core", scope: "application", reason: "r1" },
    { id: "dev.turboism.plugin.core", scope: "user", reason: "r2" },
  ];
  const errors = invalid(
    Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ dependencies, permissions })] })] }))),
  );
  assert.ok(errors.some((issue) => issue.message.includes("duplicate dependency id")));
  assert.ok(errors.some((issue) => issue.message.includes("duplicate permission id")));
});

test("malformed JSON and non-object roots reject without throwing", () => {
  assert.ok(!validateCatalogBytes(Buffer.from("not json")).ok);
  assert.ok(!validateCatalogBytes(Buffer.from("[1,2]")).ok);
  assert.ok(!validateCatalogBytes(Buffer.from("null")).ok);
});

test("signature envelope: 16 KiB cap", () => {
  const over = Buffer.concat([Buffer.from("{}"), Buffer.alloc(MAX_SIGNATURE_BYTES + 1)]);
  assert.ok(!validateEnvelopeBytes(over).ok);
});

test("signature envelope: unknown fields and bad signature bytes reject", () => {
  const valid = { format: "turboism.plugin.catalog.signature", schemaVersion: 2, algorithm: "Ed25519", keyId: "turboism-official-v1", catalogSha256: "0".repeat(64), signature: Buffer.alloc(64).toString("base64") };
  assert.ok(validateEnvelopeBytes(Buffer.from(JSON.stringify(valid))).ok);
  const extra = { ...valid, extra: 1 };
  assert.ok(!validateEnvelopeBytes(Buffer.from(JSON.stringify(extra))).ok);
  const badSignature = { ...valid, signature: "A".repeat(44) };
  assert.ok(!validateEnvelopeBytes(Buffer.from(JSON.stringify(badSignature))).ok);
  const badKeyId = { ...valid, keyId: "Turboism!" };
  assert.ok(!validateEnvelopeBytes(Buffer.from(JSON.stringify(badKeyId))).ok);
});

test("strict JSON: duplicate object keys reject at every nesting level", () => {
  const catalog = makeCatalog();
  const duplicated = `{"format":"turboism.plugin.catalog","format":"turboism.plugin.catalog",${JSON.stringify(catalog).slice(1)}`;
  const errors = invalid(Buffer.from(duplicated));
  assert.ok(errors.some((issue) => issue.message.includes("duplicate object key")));
  // Inject a duplicate key at the byte level (JSON.parse would collapse it).
  const withDupVersion = JSON.stringify(makeCatalog()).replace('"version":"0.1.0"', '"version":"0.1.0","version":"0.1.0"');
  const dupErrors = invalid(Buffer.from(withDupVersion));
  assert.ok(dupErrors.some((issue) => issue.message.includes("duplicate object key")));
  const valid = { format: "turboism.plugin.catalog.signature", schemaVersion: 2, algorithm: "Ed25519", keyId: "turboism-official-v1", catalogSha256: "0".repeat(64), signature: Buffer.alloc(64).toString("base64") };
  const dupEnvelope = `{"format":"turboism.plugin.catalog.signature","format":"turboism.plugin.catalog.signature",${JSON.stringify(valid).slice(1)}`;
  const envelopeCheck = validateEnvelopeBytes(Buffer.from(dupEnvelope));
  assert.ok(!envelopeCheck.ok);
  assert.ok(envelopeCheck.errors.some((issue) => issue.message.includes("duplicate object key")));
});

test("fatal UTF-8: invalid byte sequences reject instead of being replaced", () => {
  const catalog = makeCatalog();
  const bytes = Buffer.from(JSON.stringify(catalog), "utf8");
  const corrupted = Buffer.concat([bytes.subarray(0, 40), Buffer.from([0xc3, 0x28]), bytes.subarray(40)]);
  const errors = invalid(corrupted);
  assert.ok(errors.some((issue) => issue.message.includes("valid UTF-8")));
  const envelope = Buffer.from('{"format":"turboism.plugin.catalog.signature","schemaVersion":2,"algorithm":"Ed25519","keyId":"a","catalogSha256":"' + "0".repeat(64) + '","signature":"' + Buffer.alloc(64).toString("base64") + '"}');
  const badEnvelope = Buffer.concat([envelope.subarray(0, 20), Buffer.from([0xff]), envelope.subarray(20)]);
  const envelopeCheck = validateEnvelopeBytes(badEnvelope);
  assert.ok(!envelopeCheck.ok);
});

test("caps are enforced BEFORE parsing: oversized non-JSON reports the cap", () => {
  const junk = Buffer.alloc(MAX_CATALOG_BYTES + 1, 0x61);
  const errors = invalid(junk);
  assert.ok(errors.some((issue) => issue.message.includes("at most")));
});

test("artifact URL must be an exact GitHub releases download URL matching fileName", () => {
  const base = makeRelease().artifact;
  const cases = [
    { url: "https://example.com/turboism/turboism-releases/releases/download/v0.1.0/plugin.jar" },
    { url: "https://github.com/turboism/turboism-releases/releases/tag/v0.1.0" },
    { url: "https://github.com/turboism/turboism-releases/releases/download/v0.1.0/plugin.zip" },
    { url: "https://github.com/turboism/turboism-releases/releases/download/v0.1.0/other.jar" },
    { url: "https://github.com/turboism/turboism-releases/releases/download/v0.1.0/plugin.jar?download=1" },
    { url: "https://github.com/turboism/turboism-releases/releases/download/v0.1.0/plugin.jar#frag" },
    { url: "https://user:pass@github.com/turboism/turboism-releases/releases/download/v0.1.0/plugin.jar" },
    { url: "http://github.com/turboism/turboism-releases/releases/download/v0.1.0/plugin.jar" },
  ];
  for (const artifact of cases) {
    const errors = invalid(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ artifact: { ...base, ...artifact } })] })] }))));
    assert.ok(errors.length > 0, `expected rejection for ${artifact.url}`);
  }
  // Matching fileName in the URL is required and accepted.
  ok(Buffer.from(JSON.stringify(makeCatalog({ plugins: [makePlugin({ releases: [makeRelease({ artifact: { ...base, fileName: "plugin.jar", url: "https://github.com/turboism/turboism-releases/releases/download/v0.1.0/plugin.jar" } })] })] }))));
});

test("trusted-keys manifest: mandatory purpose, bounds, duplicate keys, and strict JSON", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "catalog-v2-keys-"));
  try {
    const publicKey = makeKeyPair().publicKey;
    const write = (name, content) => writeFileSync(path.join(dir, name), content);
    // Missing purpose is rejected (never defaults to production).
    write("no-purpose.json", JSON.stringify({ "turboism-test-v2": { pem: publicKey } }));
    assert.ok(!loadTrustedKeys(path.join(dir, "no-purpose.json")).ok);
    // Explicit test purpose is accepted.
    write("test-purpose.json", JSON.stringify({ "turboism-test-v2": { pem: publicKey, purpose: "test" } }));
    assert.ok(loadTrustedKeys(path.join(dir, "test-purpose.json")).ok);
    // Duplicate keys reject.
    write("dup.json", `{"turboism-test-v2":${JSON.stringify({ pem: publicKey, purpose: "test" })},\n"turboism-test-v2":${JSON.stringify({ pem: publicKey, purpose: "test" })}}`);
    assert.ok(!loadTrustedKeys(path.join(dir, "dup.json")).ok);
    // Invalid purpose rejects.
    write("bad-purpose.json", JSON.stringify({ "turboism-test-v2": { pem: publicKey, purpose: "preview" } }));
    assert.ok(!loadTrustedKeys(path.join(dir, "bad-purpose.json")).ok);
    // Invalid key id rejects.
    write("bad-id.json", JSON.stringify({ "Turboism!": { pem: publicKey, purpose: "test" } }));
    assert.ok(!loadTrustedKeys(path.join(dir, "bad-id.json")).ok);
    // Non-JSON rejects.
    write("junk.json", "not json");
    assert.ok(!loadTrustedKeys(path.join(dir, "junk.json")).ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
