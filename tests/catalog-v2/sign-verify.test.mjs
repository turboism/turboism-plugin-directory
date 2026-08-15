import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { signCatalogBytes, stringifyCanonical, validateCatalogBytes, verifyCatalogBytes } from "../../lib/catalog-v2/catalog.mjs";
import { makeAllowlist, makeCatalog, makeKeyPair } from "./fixtures.mjs";

const catalogBytes = Buffer.from(stringifyCanonical(makeCatalog(), "catalog"));

test("deterministic Ed25519 signing and verification round-trip", () => {
  const keys = makeKeyPair();
  const first = signCatalogBytes(catalogBytes, keys.privateKey, "turboism-test-v2");
  const second = signCatalogBytes(catalogBytes, keys.privateKey, "turboism-test-v2");
  assert.ok(first.ok);
  assert.deepEqual(first.envelope, second.envelope); // RFC 8032 deterministic nonce
  assert.deepEqual(Object.keys(first.envelope), ["format", "schemaVersion", "algorithm", "keyId", "catalogSha256", "signature"]);
  const envelopeBytes = Buffer.from(stringifyCanonical(first.envelope, "envelope"), "utf8");
  const verified = verifyCatalogBytes(catalogBytes, envelopeBytes, makeAllowlist("turboism-test-v2", keys.publicKey));
  assert.ok(verified.ok, JSON.stringify(verified.errors));
  assert.equal(verified.sha256, first.envelope.catalogSha256);
  assert.ok(validateCatalogBytes(catalogBytes).ok);
});

test("wrong key fails verification", () => {
  const signer = makeKeyPair();
  const other = makeKeyPair();
  const signed = signCatalogBytes(catalogBytes, signer.privateKey, "turboism-test-v2");
  const envelopeBytes = Buffer.from(stringifyCanonical(signed.envelope, "envelope"), "utf8");
  const verified = verifyCatalogBytes(catalogBytes, envelopeBytes, makeAllowlist("turboism-test-v2", other.publicKey));
  assert.ok(!verified.ok);
  assert.ok(verified.errors.some((issue) => issue.message.includes("verification failed")));
});

test("tampered catalog bytes fail on the hash comparison", () => {
  const keys = makeKeyPair();
  const signed = signCatalogBytes(catalogBytes, keys.privateKey, "turboism-test-v2");
  const envelopeBytes = Buffer.from(stringifyCanonical(signed.envelope, "envelope"), "utf8");
  const tampered = Buffer.from(catalogBytes);
  tampered[tampered.length - 1] = tampered[tampered.length - 1] === 0x7d ? 0x7e : 0x7d;
  const verified = verifyCatalogBytes(tampered, envelopeBytes, makeAllowlist("turboism-test-v2", keys.publicKey));
  assert.ok(!verified.ok);
  assert.ok(verified.errors.some((issue) => issue.message.includes("hash mismatch")));
});

test("tampered signature fails verification", () => {
  const keys = makeKeyPair();
  const signed = signCatalogBytes(catalogBytes, keys.privateKey, "turboism-test-v2");
  const envelope = { ...signed.envelope, signature: signed.envelope.signature === "A".repeat(88) ? "B".repeat(88) : "A".repeat(88) };
  const envelopeBytes = Buffer.from(stringifyCanonical(envelope, "envelope"), "utf8");
  const verified = verifyCatalogBytes(catalogBytes, envelopeBytes, makeAllowlist("turboism-test-v2", keys.publicKey));
  assert.ok(!verified.ok);
});

test("tampered catalogSha256 in the envelope fails", () => {
  const keys = makeKeyPair();
  const signed = signCatalogBytes(catalogBytes, keys.privateKey, "turboism-test-v2");
  const envelope = { ...signed.envelope, catalogSha256: "f".repeat(64) };
  const envelopeBytes = Buffer.from(stringifyCanonical(envelope, "envelope"), "utf8");
  const verified = verifyCatalogBytes(catalogBytes, envelopeBytes, makeAllowlist("turboism-test-v2", keys.publicKey));
  assert.ok(!verified.ok);
  assert.ok(verified.errors.some((issue) => issue.message.includes("hash mismatch")));
});

test("unknown key id fails before any signature work", () => {
  const keys = makeKeyPair();
  const signed = signCatalogBytes(catalogBytes, keys.privateKey, "turboism-test-v2");
  const envelopeBytes = Buffer.from(stringifyCanonical(signed.envelope, "envelope"), "utf8");
  const verified = verifyCatalogBytes(catalogBytes, envelopeBytes, makeAllowlist("other-key", keys.publicKey));
  assert.ok(!verified.ok);
  assert.equal(verified.errors[0].message, 'unknown key id "turboism-test-v2"');
});

test("normative order: unknown algorithm is rejected before key lookup", () => {
  const keys = makeKeyPair();
  const signed = signCatalogBytes(catalogBytes, keys.privateKey, "turboism-test-v2");
  const envelope = { ...signed.envelope, algorithm: "RSA-PSS" };
  const envelopeBytes = Buffer.from(stringifyCanonical(envelope, "envelope"), "utf8");
  const verified = verifyCatalogBytes(catalogBytes, envelopeBytes, makeAllowlist("turboism-test-v2", keys.publicKey));
  assert.ok(!verified.ok);
  assert.ok(verified.errors.some((issue) => issue.path === "signature.algorithm"));
});

test("requireProduction rejects test-purpose keys", () => {
  const keys = makeKeyPair();
  const signed = signCatalogBytes(catalogBytes, keys.privateKey, "turboism-test-v2");
  const envelopeBytes = Buffer.from(stringifyCanonical(signed.envelope, "envelope"), "utf8");
  const verified = verifyCatalogBytes(catalogBytes, envelopeBytes, makeAllowlist("turboism-test-v2", keys.publicKey, "test"), { requireProduction: true });
  assert.ok(!verified.ok);
  assert.ok(verified.errors.some((issue) => issue.message.includes("non-production key")));
  const production = verifyCatalogBytes(catalogBytes, envelopeBytes, makeAllowlist("turboism-test-v2", keys.publicKey, "production"), { requireProduction: true });
  assert.ok(production.ok);
});

test("empty allowlist fails closed", () => {
  const keys = makeKeyPair();
  const signed = signCatalogBytes(catalogBytes, keys.privateKey, "turboism-test-v2");
  const envelopeBytes = Buffer.from(stringifyCanonical(signed.envelope, "envelope"), "utf8");
  const verified = verifyCatalogBytes(catalogBytes, envelopeBytes, {});
  assert.ok(!verified.ok);
  assert.equal(verified.errors[0].message, 'unknown key id "turboism-test-v2"');
});

test("signing rejects a non-Ed25519 key and a malformed catalog", () => {
  const { privateKey: rsa } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signed = signCatalogBytes(catalogBytes, rsa.export({ type: "pkcs8", format: "pem" }).toString(), "turboism-test-v2");
  assert.ok(!signed.ok);
  assert.ok(signed.errors.some((issue) => issue.message.includes("Ed25519")));
  const invalid = signCatalogBytes(Buffer.from('{"format":"wrong"}'), makeKeyPair().privateKey, "turboism-test-v2");
  assert.ok(!invalid.ok);
});

test("verification order: catalog schema is validated only after signature passes", () => {
  const keys = makeKeyPair();
  // Sign the schema-broken bytes directly (signCatalogBytes would refuse): a
  // valid signature over invalid-schema bytes must fail on the schema step,
  // proving schema validation happens after signature verification.
  const schemaBroken = Buffer.from(JSON.stringify(makeCatalog({ schemaVersion: 1 })));
  const signature = sign(null, schemaBroken, createPrivateKey(keys.privateKey)).toString("base64");
  const envelope = {
    format: "turboism.plugin.catalog.signature",
    schemaVersion: 2,
    algorithm: "Ed25519",
    keyId: "turboism-test-v2",
    catalogSha256: createHash("sha256").update(schemaBroken).digest("hex"),
    signature,
  };
  const envelopeBytes = Buffer.from(stringifyCanonical(envelope, "envelope"), "utf8");
  const verified = verifyCatalogBytes(schemaBroken, envelopeBytes, makeAllowlist("turboism-test-v2", keys.publicKey));
  assert.ok(!verified.ok);
  assert.ok(verified.errors.some((issue) => issue.path === "catalog.schemaVersion"));
});

test("verify rejects oversized catalog and signature bytes", () => {
  const keys = makeKeyPair();
  const oversized = Buffer.concat([catalogBytes, Buffer.alloc(5 * 1024 * 1024)]);
  const signed = signCatalogBytes(catalogBytes, keys.privateKey, "turboism-test-v2");
  const envelopeBytes = Buffer.from(stringifyCanonical(signed.envelope, "envelope"), "utf8");
  const bigEnvelope = Buffer.concat([envelopeBytes, Buffer.alloc(16 * 1024 + 1)]);
  assert.ok(!verifyCatalogBytes(oversized, envelopeBytes, makeAllowlist("turboism-test-v2", keys.publicKey)).ok);
  assert.ok(!verifyCatalogBytes(catalogBytes, bigEnvelope, makeAllowlist("turboism-test-v2", keys.publicKey)).ok);
});

test("malformed signature input never throws", () => {
  const keys = makeKeyPair();
  for (const bad of ["not json", "[]", '{"format":"turboism.plugin.catalog.signature"}', '{"format":"turboism.plugin.catalog.signature","schemaVersion":2,"algorithm":"Ed25519","keyId":"turboism-test-v2","catalogSha256":"0".repeat(64),"signature":"!!!"}']) {
    const verified = verifyCatalogBytes(catalogBytes, Buffer.from(bad), makeAllowlist("turboism-test-v2", keys.publicKey));
    assert.ok(!verified.ok, `expected rejection for ${bad.slice(0, 40)}`);
  }
});

test("duplicate envelope keys and fatal UTF-8 reject before any signature work", () => {
  const keys = makeKeyPair();
  const signed = signCatalogBytes(catalogBytes, keys.privateKey, "turboism-test-v2");
  const envelopeJson = stringifyCanonical(signed.envelope, "envelope");
  const dup = envelopeJson.replace('"keyId":"turboism-test-v2"', '"keyId":"turboism-test-v2","keyId":"turboism-test-v2"');
  const dupCheck = verifyCatalogBytes(catalogBytes, Buffer.from(dup), makeAllowlist("turboism-test-v2", keys.publicKey));
  assert.ok(!dupCheck.ok);
  assert.ok(dupCheck.errors.some((issue) => issue.message.includes("duplicate object key")));
  const badUtf8 = Buffer.concat([Buffer.from(envelopeJson, "utf8").subarray(0, 10), Buffer.from([0xc3, 0x28])]);
  const utf8Check = verifyCatalogBytes(catalogBytes, badUtf8, makeAllowlist("turboism-test-v2", keys.publicKey));
  assert.ok(!utf8Check.ok);
});

test("oversized catalog input fails closed without throwing (normative order: envelope first)", () => {
  const junk = Buffer.alloc(5 * 1024 * 1024 + 1, 0x61);
  const envelopeBytes2 = Buffer.from(stringifyCanonical(signCatalogBytes(catalogBytes, makeKeyPair().privateKey, "turboism-test-v2").envelope, "envelope"));
  // Envelope validation runs first, so the unknown-key error surfaces; the
  // catalog cap itself is enforced in validateCatalogBytes before any parse
  // (covered in validate.test.mjs). Either way it must fail closed.
  const check = verifyCatalogBytes(junk, envelopeBytes2, {});
  assert.ok(!check.ok);
  const withKeys = verifyCatalogBytes(junk, envelopeBytes2, makeAllowlist("turboism-test-v2", makeKeyPair().publicKey));
  assert.ok(!withKeys.ok);
});
