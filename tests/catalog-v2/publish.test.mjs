import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadTrustedKeys, stringifyCanonical, verifyCatalogBytes } from "../../lib/catalog-v2/catalog.mjs";
import { makeAllowlist, makeDescriptor, makeKeyPair, makePlugin, makeRelease, makeZip } from "./fixtures.mjs";

const ROOT = path.join(process.cwd());
const PUBLISH = path.join(ROOT, "scripts", "catalog-v2", "publish.mjs");

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "catalog-v2-publish-"));
}

function runPublish(args) {
  return execFileSync(process.execPath, [PUBLISH, ...args], { encoding: "utf8", cwd: ROOT });
}

test("publish pipeline publishes a verifiable pair for a descriptor-bound catalog", () => {
  const dir = tempDir();
  try {
    const keys = makeKeyPair();
    const descriptor = makeDescriptor();
    const jarBytes = makeZip([
      { name: "META-INF/turboism/plugin.json", data: JSON.stringify(descriptor) },
      { name: "dev/turboism/plugin/Inspector.class", data: Buffer.from([0xca, 0xfe, 0xba, 0xbe]) },
    ]);
    const jarPath = path.join(dir, "plugin.jar");
    writeFileSync(jarPath, jarBytes);
    const descriptorBytes = Buffer.from(JSON.stringify(descriptor), "utf8");
    const artifact = {
      mediaType: "application/java-archive",
      fileName: "plugin.jar",
      url: "https://github.com/turboism/turboism-releases/releases/download/v0.1.0/plugin.jar",
      sha256: createHash("sha256").update(jarBytes).digest("hex"),
      descriptorSha256: createHash("sha256").update(descriptorBytes).digest("hex"),
      size: jarBytes.byteLength,
    };
    const catalog = {
      format: "turboism.plugin.catalog",
      schemaVersion: 2,
      catalogVersion: 1,
      publishedAt: "2026-08-15T00:00:00Z",
      plugins: [makePlugin({ releases: [makeRelease({ artifact })] })],
    };
    const catalogFile = path.join(dir, "catalog-source.json");
    writeFileSync(catalogFile, stringifyCanonical(catalog, "catalog"));
    const manifestFile = path.join(dir, "jars.json");
    writeFileSync(manifestFile, JSON.stringify({ "dev.turboism.plugin.project-inspector@0.1.0": jarPath }));
    const keyFile = path.join(dir, "signing.pem");
    writeFileSync(keyFile, keys.privateKey);
    const allowlistFile = path.join(dir, "trusted-keys.json");
    writeFileSync(allowlistFile, JSON.stringify(makeAllowlist("turboism-official-v1", keys.publicKey, "production")));
    const outDir = path.join(dir, "out");
    const out = runPublish(["--catalog", catalogFile, "--jars", manifestFile, "--key", keyFile, "--key-id", "turboism-official-v1", "--keys", allowlistFile, "--out", outDir]);
    assert.ok(out.includes("published pair"), out);

    const publishedCatalog = readFileSync(path.join(outDir, "catalog.json"));
    const publishedSig = readFileSync(path.join(outDir, "catalog.json.sig"));
    const verified = verifyCatalogBytes(publishedCatalog, publishedSig, loadTrustedKeys(allowlistFile).keys, { requireProduction: true });
    assert.ok(verified.ok, JSON.stringify(verified.errors));
    assert.equal(publishedCatalog.toString("utf8"), stringifyCanonical(catalog, "catalog"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("publish refuses a .tplugin artifact and non-.jar manifest entries", () => {
  const dir = tempDir();
  try {
    const keys = makeKeyPair();
    const manifestFile = path.join(dir, "jars.json");
    writeFileSync(manifestFile, JSON.stringify({ "dev.turboism.plugin.project-inspector@0.1.0": path.join(dir, "plugin.tplugin") }));
    const keyFile = path.join(dir, "signing.pem");
    writeFileSync(keyFile, keys.privateKey);
    const allowlistFile = path.join(dir, "trusted-keys.json");
    writeFileSync(allowlistFile, JSON.stringify(makeAllowlist("turboism-official-v1", keys.publicKey, "production")));
    const catalogFile = path.join(dir, "catalog-source.json");
    writeFileSync(catalogFile, stringifyCanonical({ format: "turboism.plugin.catalog", schemaVersion: 2, catalogVersion: 1, publishedAt: "2026-08-15T00:00:00Z", plugins: [makePlugin()] }, "catalog"));
    assert.throws(() => runPublish(["--catalog", catalogFile, "--jars", manifestFile, "--key", keyFile, "--key-id", "turboism-official-v1", "--keys", allowlistFile, "--out", path.join(dir, "out")]), /must be a \.jar file/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("publish fails when the allowlist cannot verify the staged bytes", () => {
  const dir = tempDir();
  try {
    const signer = makeKeyPair();
    const other = makeKeyPair();
    const jarBytes = makeZip([{ name: "META-INF/turboism/plugin.json", data: JSON.stringify(makeDescriptor()) }]);
    const jarPath = path.join(dir, "plugin.jar");
    writeFileSync(jarPath, jarBytes);
    const descriptorBytes = Buffer.from(JSON.stringify(makeDescriptor()), "utf8");
    const artifact = {
      mediaType: "application/java-archive",
      fileName: "plugin.jar",
      url: "https://github.com/turboism/turboism-releases/releases/download/v0.1.0/plugin.jar",
      sha256: createHash("sha256").update(jarBytes).digest("hex"),
      descriptorSha256: createHash("sha256").update(descriptorBytes).digest("hex"),
      size: jarBytes.byteLength,
    };
    const catalogFile = path.join(dir, "catalog-source.json");
    writeFileSync(catalogFile, stringifyCanonical({ format: "turboism.plugin.catalog", schemaVersion: 2, catalogVersion: 1, publishedAt: "2026-08-15T00:00:00Z", plugins: [makePlugin({ releases: [makeRelease({ artifact })] })] }, "catalog"));
    const manifestFile = path.join(dir, "jars.json");
    writeFileSync(manifestFile, JSON.stringify({ "dev.turboism.plugin.project-inspector@0.1.0": jarPath }));
    const keyFile = path.join(dir, "signing.pem");
    writeFileSync(keyFile, signer.privateKey);
    const allowlistFile = path.join(dir, "trusted-keys.json");
    writeFileSync(allowlistFile, JSON.stringify(makeAllowlist("turboism-official-v1", other.publicKey, "production")));
    const outDir = path.join(dir, "out");
    assert.throws(() => runPublish(["--catalog", catalogFile, "--jars", manifestFile, "--key", keyFile, "--key-id", "turboism-official-v1", "--keys", allowlistFile, "--out", outDir]), /did not verify/);
    assert.ok(!existsSync(path.join(outDir, "catalog.json")));
    assert.ok(!existsSync(path.join(outDir, "catalog.json.sig")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("publish --dry-run writes nothing", () => {
  const dir = tempDir();
  try {
    const keys = makeKeyPair();
    const jarBytes = makeZip([{ name: "META-INF/turboism/plugin.json", data: JSON.stringify(makeDescriptor()) }]);
    const jarPath = path.join(dir, "plugin.jar");
    writeFileSync(jarPath, jarBytes);
    const artifact = {
      mediaType: "application/java-archive",
      fileName: "plugin.jar",
      url: "https://github.com/turboism/turboism-releases/releases/download/v0.1.0/plugin.jar",
      sha256: createHash("sha256").update(jarBytes).digest("hex"),
      descriptorSha256: createHash("sha256").update(Buffer.from(JSON.stringify(makeDescriptor()), "utf8")).digest("hex"),
      size: jarBytes.byteLength,
    };
    const catalogFile = path.join(dir, "catalog-source.json");
    writeFileSync(catalogFile, stringifyCanonical({ format: "turboism.plugin.catalog", schemaVersion: 2, catalogVersion: 1, publishedAt: "2026-08-15T00:00:00Z", plugins: [makePlugin({ releases: [makeRelease({ artifact })] })] }, "catalog"));
    const manifestFile = path.join(dir, "jars.json");
    writeFileSync(manifestFile, JSON.stringify({ "dev.turboism.plugin.project-inspector@0.1.0": jarPath }));
    const keyFile = path.join(dir, "signing.pem");
    writeFileSync(keyFile, keys.privateKey);
    const allowlistFile = path.join(dir, "trusted-keys.json");
    writeFileSync(allowlistFile, JSON.stringify(makeAllowlist("turboism-official-v1", keys.publicKey, "production")));
    const outDir = path.join(dir, "out");
    const out = runPublish(["--catalog", catalogFile, "--jars", manifestFile, "--key", keyFile, "--key-id", "turboism-official-v1", "--keys", allowlistFile, "--out", outDir, "--dry-run"]);
    assert.ok(out.includes("dry-run OK"), out);
    assert.ok(!existsSync(outDir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
