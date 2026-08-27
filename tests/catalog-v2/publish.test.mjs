import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadTrustedKeys, signCatalogBytes, stringifyCanonical, verifyCatalogBytes } from "../../lib/catalog-v2/catalog.mjs";
import { commitPointer, loadCurrentGeneration, stageGeneration } from "../../lib/catalog-v2/storage.mjs";
import { deployPair, makeAllowlist, makeDescriptor, makeKeyPair, makePlugin, makeRelease, makeZip } from "./fixtures.mjs";

const ROOT = path.join(process.cwd());
const PUBLISH = path.join(ROOT, "scripts", "catalog-v2", "publish.mjs");

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "catalog-v2-publish-"));
}

function runPublish(args) {
  return execFileSync(process.execPath, [PUBLISH, ...args], { encoding: "utf8", cwd: ROOT });
}

/** An empty catalog: the first launch has zero releases (frozen source shape). */
function emptyCatalog(catalogVersion, publishedAt) {
  return { format: "turboism.plugin.catalog", schemaVersion: 2, catalogVersion, publishedAt, plugins: [] };
}

/** Recursive snapshot of every file under a directory: path -> exact bytes. */
function snapshotDir(dir) {
  const snapshot = new Map();
  const walk = (base) => {
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const full = path.join(base, entry.name);
      if (entry.isDirectory()) walk(full);
      else snapshot.set(path.relative(dir, full), readFileSync(full));
    }
  };
  if (existsSync(dir)) walk(dir);
  return snapshot;
}

/** Write the source catalog/manifest/key/allowlist files for an empty catalog publication. */
function writeEmptyPublication(dir, { catalogVersion, publishedAt, keys, allowlist }) {
  mkdirSync(dir, { recursive: true });
  const catalogBytes = Buffer.from(stringifyCanonical(emptyCatalog(catalogVersion, publishedAt), "catalog"), "utf8");
  const catalogFile = path.join(dir, "catalog.json");
  writeFileSync(catalogFile, catalogBytes);
  const manifestFile = path.join(dir, "jars.json");
  writeFileSync(manifestFile, "{}");
  const keyFile = path.join(dir, "signing.pem");
  writeFileSync(keyFile, keys.privateKey);
  const allowlistFile = path.join(dir, "trusted-keys.json");
  writeFileSync(allowlistFile, JSON.stringify(allowlist));
  return { catalogBytes, catalogFile, manifestFile, keyFile, allowlistFile };
}

function publishArgs({ catalogFile, manifestFile, keyFile, keyId, allowlistFile, outDir }) {
  return ["--catalog", catalogFile, "--jars", manifestFile, "--key", keyFile, "--key-id", keyId, "--keys", allowlistFile, "--out", outDir];
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
    assert.ok(out.includes("published generation 00000001"), out);

    const publishedCatalog = readFileSync(path.join(outDir, "generations", "00000001", "catalog.json"));
    const publishedSig = readFileSync(path.join(outDir, "generations", "00000001", "catalog.json.sig"));
    const verified = verifyCatalogBytes(publishedCatalog, publishedSig, loadTrustedKeys(allowlistFile).keys, { requireProduction: true });
    assert.ok(verified.ok, JSON.stringify(verified.errors));
    assert.equal(publishedCatalog.toString("utf8"), stringifyCanonical(catalog, "catalog"));
    // The pointer names the committed generation and the pair loads as current.
    assert.equal(readFileSync(path.join(outDir, "current"), "utf8"), "00000001");
    const loaded = loadCurrentGeneration(outDir);
    assert.ok(loaded.ok);
    assert.equal(loaded.generationId, "00000001");
    assert.ok(loaded.catalogBytes.equals(publishedCatalog));
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
    assert.ok(!existsSync(outDir));
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

test("replacement publishes a new generation and switches the pointer atomically", () => {
  const dir = tempDir();
  try {
    const keys = makeKeyPair();
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
    const catalog = (catalogVersion) => ({
      format: "turboism.plugin.catalog",
      schemaVersion: 2,
      catalogVersion,
      publishedAt: "2026-08-15T00:00:00Z",
      plugins: [makePlugin({ releases: [makeRelease({ artifact })] })],
    });
    const manifestFile = path.join(dir, "jars.json");
    writeFileSync(manifestFile, JSON.stringify({ "dev.turboism.plugin.project-inspector@0.1.0": jarPath }));
    const keyFile = path.join(dir, "signing.pem");
    writeFileSync(keyFile, keys.privateKey);
    const allowlistFile = path.join(dir, "trusted-keys.json");
    writeFileSync(allowlistFile, JSON.stringify(makeAllowlist("turboism-official-v1", keys.publicKey, "production")));
    const outDir = path.join(dir, "out");
    const catalogFile = (version) => {
      const file = path.join(dir, `catalog-source-${version}.json`);
      writeFileSync(file, stringifyCanonical(catalog(version), "catalog"));
      return file;
    };
    const first = runPublish(["--catalog", catalogFile(1), "--jars", manifestFile, "--key", keyFile, "--key-id", "turboism-official-v1", "--keys", allowlistFile, "--out", outDir]);
    assert.ok(first.includes("generation 00000001"), first);
    const second = runPublish(["--catalog", catalogFile(2), "--jars", manifestFile, "--key", keyFile, "--key-id", "turboism-official-v1", "--keys", allowlistFile, "--out", outDir]);
    assert.ok(second.includes("generation 00000002"), second);
    assert.equal(readFileSync(path.join(outDir, "current"), "utf8"), "00000002");
    assert.ok(existsSync(path.join(outDir, "generations", "00000001", "catalog.json")), "generation 1 must remain immutable");
    const loaded = loadCurrentGeneration(outDir);
    assert.ok(loaded.ok);
    assert.equal(JSON.parse(loaded.catalogBytes.toString("utf8")).catalogVersion, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("injected fault before the pointer commit leaves the old generation served", async () => {
  const dir = tempDir();
  try {
    const first = deployPair(dir);
    const loadedBefore = loadCurrentGeneration(dir);
    assert.ok(loadedBefore.ok);
    assert.equal(loadedBefore.generationId, "00000001");
    // Stage a second generation (valid bytes) but never commit the pointer:
    // this simulates a fault after staging. The old pair must keep serving.
    const secondCatalog = JSON.parse(first.catalogBytes.toString("utf8"));
    secondCatalog.catalogVersion = 2;
    const secondBytes = Buffer.from(stringifyCanonical(secondCatalog, "catalog"));
    const staged = stageGeneration(dir, "00000002", secondBytes, first.sigBytes);
    assert.ok(staged.ok, staged.message);
    const afterFault = loadCurrentGeneration(dir);
    assert.ok(afterFault.ok);
    assert.equal(afterFault.generationId, "00000001");
    assert.ok(afterFault.catalogBytes.equals(first.catalogBytes));
    // A torn pointer file also fails closed and can be healed by re-committing.
    writeFileSync(path.join(dir, "current"), "00000002x");
    assert.ok(!loadCurrentGeneration(dir).ok);
    assert.ok(commitPointer(dir, "00000001").ok);
    assert.ok(loadCurrentGeneration(dir).ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("frozen invariant: identical bytes + same keyId is idempotent and writes nothing", () => {
  const dir = tempDir();
  try {
    const deployed = deployPair(dir, { catalog: emptyCatalog(1, "2026-08-16T08:48:40Z"), keyId: "turboism-official-v1" });
    const files = writeEmptyPublication(dir, {
      catalogVersion: 1,
      publishedAt: "2026-08-16T08:48:40Z",
      keys: deployed.keys,
      allowlist: deployed.allowlist,
    });
    assert.ok(files.catalogBytes.equals(deployed.catalogBytes), "source bytes must match the deployed pair");
    const before = snapshotDir(dir);
    const out = runPublish(publishArgs({ ...files, keyId: "turboism-official-v1", outDir: dir }));
    assert.ok(out.includes("idempotent"), out);
    assert.ok(out.includes("nothing written"), out);
    assert.deepEqual(snapshotDir(dir), before, "an idempotent run must not write a single byte");
    assert.equal(readFileSync(path.join(dir, "current"), "utf8"), "00000001");
    assert.deepEqual(readdirSync(path.join(dir, "generations")), ["00000001"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("frozen invariant: identical bytes + a different keyId rotates the key at the same catalogVersion", () => {
  const dir = tempDir();
  try {
    const first = deployPair(dir, { catalog: emptyCatalog(1, "2026-08-16T08:48:40Z"), keyId: "turboism-official-v1" });
    const rotated = makeKeyPair();
    const allowlist = {
      "turboism-official-v1": first.allowlist["turboism-official-v1"],
      "turboism-official-v2": makeAllowlist("turboism-official-v2", rotated.publicKey, "production")["turboism-official-v2"],
    };
    const files = writeEmptyPublication(dir, {
      catalogVersion: 1,
      publishedAt: "2026-08-16T08:48:40Z",
      keys: rotated,
      allowlist,
    });
    assert.ok(files.catalogBytes.equals(first.catalogBytes), "rotation keeps the identical catalog bytes");
    const out = runPublish(publishArgs({ ...files, keyId: "turboism-official-v2", outDir: dir }));
    assert.ok(out.includes("generation 00000002"), out);
    assert.equal(readFileSync(path.join(dir, "current"), "utf8"), "00000002");
    // Identical bytes never increment catalogVersion.
    const rotatedCatalog = JSON.parse(readFileSync(path.join(dir, "generations", "00000002", "catalog.json"), "utf8"));
    assert.equal(rotatedCatalog.catalogVersion, 1);
    // The new pair verifies under the new key; generation 1 stays immutable.
    const verified = verifyCatalogBytes(
      readFileSync(path.join(dir, "generations", "00000002", "catalog.json")),
      readFileSync(path.join(dir, "generations", "00000002", "catalog.json.sig")),
      loadTrustedKeys(files.allowlistFile).keys,
      { requireProduction: true },
    );
    assert.ok(verified.ok, JSON.stringify(verified.errors));
    assert.equal(verified.envelope.keyId, "turboism-official-v2");
    assert.ok(readFileSync(path.join(dir, "generations", "00000001", "catalog.json")).equals(first.catalogBytes));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("frozen invariant: changed bytes must advance catalogVersion by exactly one; equal, lower, and skipped versions fail before writing", () => {
  const dir = tempDir();
  try {
    const first = deployPair(path.join(dir, "out"), { catalog: emptyCatalog(1, "2026-08-16T08:48:40Z"), keyId: "turboism-official-v1" });
    const outDir = path.join(dir, "out");
    const filesFor = (catalogVersion, publishedAt) =>
      writeEmptyPublication(path.join(dir, "src"), {
        catalogVersion,
        publishedAt,
        keys: first.keys,
        allowlist: first.allowlist,
      });
    // Equal version with different bytes (publishedAt changed) is refused.
    const before = snapshotDir(outDir);
    assert.throws(() => runPublish(publishArgs({ ...filesFor(1, "2026-08-16T09:00:00Z"), keyId: "turboism-official-v1", outDir })), /catalogVersion/);
    assert.deepEqual(snapshotDir(outDir), before, "a refused version must not write anything");
    // Skipped version (1 -> 3) is refused.
    assert.throws(() => runPublish(publishArgs({ ...filesFor(3, "2026-08-16T09:00:00Z"), keyId: "turboism-official-v1", outDir })), /catalogVersion/);
    assert.deepEqual(snapshotDir(outDir), before, "a refused version must not write anything");
    // Exactly current + 1 succeeds.
    const ok = runPublish(publishArgs({ ...filesFor(2, "2026-08-16T09:00:00Z"), keyId: "turboism-official-v1", outDir }));
    assert.ok(ok.includes("generation 00000002"), ok);
    assert.equal(readFileSync(path.join(outDir, "current"), "utf8"), "00000002");
    // A LOWER version after the increment is refused.
    const after = snapshotDir(outDir);
    assert.throws(() => runPublish(publishArgs({ ...filesFor(1, "2026-08-16T09:00:00Z"), keyId: "turboism-official-v1", outDir })), /catalogVersion/);
    assert.deepEqual(snapshotDir(outDir), after, "a refused version must not write anything");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("frozen invariant: a malformed partial publication root is not treated as initial", () => {
  const dir = tempDir();
  try {
    // A staged generation with NO current pointer: the crash window between
    // staging and the pointer commit. It must never be treated as a first
    // launch.
    const keys = makeKeyPair();
    const catalogBytes = Buffer.from(stringifyCanonical(emptyCatalog(1, "2026-08-16T08:48:40Z"), "catalog"), "utf8");
    const signed = signCatalogBytes(catalogBytes, keys.privateKey, "turboism-official-v1");
    assert.ok(signed.ok, signed.errors?.[0]?.message);
    const sigBytes = Buffer.from(stringifyCanonical(signed.envelope, "envelope"), "utf8");
    const partial = path.join(dir, "partial");
    const staged = stageGeneration(partial, "00000001", catalogBytes, sigBytes);
    assert.ok(staged.ok, staged.message);
    const files = writeEmptyPublication(dir, {
      catalogVersion: 1,
      publishedAt: "2026-08-16T08:48:40Z",
      keys,
      allowlist: makeAllowlist("turboism-official-v1", keys.publicKey, "production"),
    });
    const before = snapshotDir(partial);
    assert.throws(() => runPublish(publishArgs({ ...files, keyId: "turboism-official-v1", outDir: partial })), /partial publication root|initial publication is not allowed/);
    assert.deepEqual(snapshotDir(partial), before, "a partial root must not be completed around");
    // A stray file with no pointer is also not an initial root.
    const stray = path.join(dir, "stray");
    mkdirSync(stray);
    writeFileSync(path.join(stray, "leftover.tmp"), "junk");
    assert.throws(() => runPublish(publishArgs({ ...files, keyId: "turboism-official-v1", outDir: stray })), /not empty/);
    assert.equal(existsSync(path.join(stray, "current")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("frozen invariant: a torn or invalid current pair fails closed and is never overwritten", () => {
  const dir = tempDir();
  try {
    const deployed = deployPair(dir, { catalog: emptyCatalog(1, "2026-08-16T08:48:40Z"), keyId: "turboism-official-v1" });
    const files = writeEmptyPublication(dir, {
      catalogVersion: 1,
      publishedAt: "2026-08-16T08:48:40Z",
      keys: deployed.keys,
      allowlist: deployed.allowlist,
    });
    const args = publishArgs({ ...files, keyId: "turboism-official-v1", outDir: dir });
    // Torn pointer: fails closed, nothing written.
    writeFileSync(path.join(dir, "current"), "00000002x");
    const torn = snapshotDir(dir);
    assert.throws(() => runPublish(args), /missing or torn/);
    assert.deepEqual(snapshotDir(dir), torn, "a torn current pair must never be repaired implicitly");
    // Tampered catalog bytes under a still-valid pointer: production
    // verification of the current pair fails and the publisher refuses to
    // overwrite around it.
    writeFileSync(path.join(dir, "current"), "00000001");
    writeFileSync(path.join(dir, "generations", "00000001", "catalog.json"), stringifyCanonical(emptyCatalog(2, "2026-08-16T09:00:00Z"), "catalog"));
    const tampered = snapshotDir(dir);
    assert.throws(() => runPublish(args), /failed production verification/);
    assert.deepEqual(snapshotDir(dir), tampered, "the invalid pair must not be overwritten");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("frozen invariant: a non-ENOENT root error fails closed before signing and writes nothing", () => {
  const dir = tempDir();
  try {
    const keys = makeKeyPair();
    const files = writeEmptyPublication(path.join(dir, "src"), {
      catalogVersion: 1,
      publishedAt: "2026-08-16T08:48:40Z",
      keys,
      allowlist: makeAllowlist("turboism-official-v1", keys.publicKey, "production"),
    });
    // The output root is a regular FILE: inspecting "<root>/current" and
    // reading the root yield ENOTDIR, not ENOENT. Only ENOENT means
    // absent/initial; any other filesystem error must fail the invariant.
    const fileRoot = path.join(dir, "out-file");
    writeFileSync(fileRoot, "not a directory");
    const before = readFileSync(fileRoot);
    assert.throws(
      () => runPublish(publishArgs({ ...files, keyId: "turboism-official-v1", outDir: fileRoot })),
      /cannot inspect the publication root|refusing to publish/,
    );
    assert.deepEqual(readFileSync(fileRoot), before, "nothing may be written around a non-ENOENT root error");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("publisher workflow static assertions: trigger, guard, permissions, environment, pins, timeout, and single-step key lifetime", () => {
  const workflow = readFileSync(path.join(ROOT, ".github", "workflows", "publish-plugin-directory-v2.yml"), "utf8");
  // Step blocks: each "- name:" line until the next one at the same indent.
  const stepBlocks = workflow
    .split("\n      - name: ")
    .slice(1)
    .map((chunk) => {
      const [name, ...bodyLines] = chunk.split("\n");
      return { name, body: bodyLines.join("\n") };
    });
  assert.ok(stepBlocks.length >= 8, "expected the full step list");
  const publishBlock = stepBlocks.find((s) => s.name === "Publish the catalog/signature pair");
  assert.ok(publishBlock, "publish step must exist");
  // Trigger structure: workflow_dispatch ONLY (no pull_request/push/schedule).
  const onBlock = workflow.match(/^on:\n((?:[ \t]+\S[^\n]*\n?)*)/m);
  assert.ok(onBlock, "on: trigger block must be present");
  assert.match(onBlock[1], /workflow_dispatch/);
  assert.doesNotMatch(onBlock[1], /pull_request|push|schedule/);
  // Ref guard, signing environment, and bounded job timeout.
  assert.match(workflow, /github\.ref\s*!=\s*'refs\/heads\/main'/);
  assert.match(workflow, /environment:\s*catalog-signing/);
  assert.match(workflow, /runs-on:\s*ubuntu-latest\n\s+timeout-minutes:\s*\d+/);
  assert.match(workflow, /timeout-minutes:\s*30/);
  // Exactly the two pinned actions, nothing else.
  const uses = [...workflow.matchAll(/^\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.deepEqual(uses, [
    "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
    "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
  ]);
  // Permissions block: contents: write ONLY.
  const permissions = workflow.match(/permissions:\n((?:[ \t]+\S[^\n]*\n)+)/);
  assert.ok(permissions, "permissions block must be present");
  assert.deepEqual(
    permissions[1].trim().split("\n").map((l) => l.trim()),
    ["contents: write"],
  );
  // One concurrency group, never cancelled.
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /group:\s*publish-plugin-directory-v2/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.doesNotMatch(workflow, /upload-artifact/);
  // Single-step key lifetime: the secret-scoped publish step materializes
  // the key (umask 077, $RUNNER_TEMP, trap BEFORE the write) and invokes the
  // publisher in the SAME step; no later step may access the key or secret.
  assert.match(publishBlock.body, /secrets\.PLUGIN_CATALOG_ED25519_PRIVATE_KEY_PEM/);
  assert.match(publishBlock.body, /umask 077/);
  assert.match(publishBlock.body, /\$RUNNER_TEMP/);
  assert.equal((workflow.match(/secrets\.PLUGIN_CATALOG_ED25519_PRIVATE_KEY_PEM/g) || []).length, 1, "the secret must be referenced exactly once");
  const trapIndex = publishBlock.body.indexOf("trap cleanup EXIT");
  const writeIndex = publishBlock.body.indexOf('> "$KEY_FILE"');
  const publishIndex = publishBlock.body.indexOf("publish.mjs");
  assert.ok(trapIndex !== -1 && writeIndex !== -1 && publishIndex !== -1, "trap, key write, and publisher invocation must exist in the publish step");
  assert.ok(trapIndex < writeIndex, "cleanup trap must be installed BEFORE the key write");
  assert.ok(writeIndex < publishIndex, "key write must precede the publisher invocation");
  for (const step of stepBlocks) {
    if (step === publishBlock) continue;
    assert.doesNotMatch(step.body, /KEY_FILE|PLUGIN_CATALOG_ED25519_PRIVATE_KEY_PEM/, `step "${step.name}" must not access the key or the secret`);
  }
  // Gates run before the publisher; publisher uses the committed
  // source/manifest/allowlist, the fixed keyId, and out public/api/v2.
  for (const gate of ["npm test", "npm run validate:directory", "npm run typecheck", "npm run lint", "npm run build"]) {
    assert.ok(workflow.indexOf(gate) < workflow.indexOf("publish.mjs"), `${gate} must run before publish`);
  }
  assert.match(publishBlock.body, /--catalog catalog\/v2\/catalog\.json/);
  assert.match(publishBlock.body, /--jars "\$RUNNER_TEMP\/market-jars\/jars\.json"/);
  assert.match(publishBlock.body, /--key-id turboism-official-v1/);
  assert.match(publishBlock.body, /--keys lib\/catalog-v2\/trusted-keys\.json/);
  assert.match(publishBlock.body, /--out public\/api\/v2/);
  // Scope gate: EVERY porcelain entry is validated by path. Tracked
  // (modified) and untracked entries under public/api/v2/ are accepted;
  // anything outside the root is rejected. Simulates the exact gate command
  // for both the initial (all-untracked) and subsequent (tracked pointer
  // update) publication forms.
  const gatePatterns = [...workflow.matchAll(/-e '([^']*)'/g)].map((m) => m[1]);
  assert.equal(gatePatterns.length, 2, "scope gate must filter both allowed roots");
  const gateRe = new RegExp(gatePatterns.join("|"));
  const gateRejects = (porcelain) => porcelain.split("\n").filter((l) => l !== "").some((l) => !gateRe.test(l));
  // Initial publication: all-untracked pair under public/api/v2 is accepted.
  assert.ok(!gateRejects("?? public/api/v2/generations/00000001/catalog.json\n?? public/api/v2/generations/00000001/catalog.json.sig\n?? public/api/v2/current"));
  // Subsequent publication: tracked pointer update under public/api/v2 is accepted.
  assert.ok(!gateRejects(" M public/api/v2/current"));
  assert.ok(!gateRejects("M  public/api/v2/current\n?? public/api/v2/generations/00000002/catalog.json\n M public/api/v2/generations/00000002/catalog.json.sig"));
  // Anything outside the root is rejected.
  assert.ok(gateRejects(" M scripts/catalog-v2/publish.mjs"));
  assert.ok(gateRejects("?? public/api/v3/current"));
  assert.ok(gateRejects(" M public/api/v2-current"));
  assert.ok(gateRejects("?? public/api/v2/x\n M scripts/catalog-v2/publish.mjs"));
  // Post-publish: diff check, marker scan, scoped commit as
  // github-actions[bot], non-force push to main.
  assert.match(workflow, /git diff --check/);
  // Marker scan regression: the uppercase marker is assembled at shell
  // runtime from adjacent quoted fragments, so the workflow source contains
  // zero contiguous uppercase occurrence and can never self-match, while
  // grep still searches the whole repository (workflow included) for the
  // exact marker with the unchanged Markdown/test exclusions.
  assert.doesNotMatch(workflow, /PRIVATE KEY/, "workflow source must not contain the contiguous uppercase marker");
  const markerFrag = workflow.match(/marker='([^']*)''([^']*)'/);
  assert.ok(markerFrag, "marker must be assembled at shell runtime from adjacent quoted fragments");
  assert.equal(markerFrag[1] + markerFrag[2], "PRIVATE KEY", "the fragments must assemble to the exact uppercase marker");
  assert.match(workflow, /-e "\$marker" \./);
  assert.match(workflow, /grep -rI -n/);
  assert.match(workflow, /--exclude='\*\.md' --exclude-dir=tests/);
  assert.match(workflow, /git add public\/api\/v2 catalog\/v2\/catalog\.json/);
  assert.match(workflow, /github-actions\[bot\]/);
  assert.match(workflow, /git push origin HEAD:refs\/heads\/main/);
  // The push must never be forced.
  assert.doesNotMatch(workflow, /git push[^\n]*(--force|\s-f(\s|$))/);
});

test("publisher workflow static assertions: automated lane inputs, all-or-none gate, token scope, no-clobber, hydration, and allowed diff", () => {
  const workflow = readFileSync(path.join(ROOT, ".github", "workflows", "publish-plugin-directory-v2.yml"), "utf8");
  const stepBlocks = workflow
    .split("\n      - name: ")
    .slice(1)
    .map((chunk) => {
      const [name, ...bodyLines] = chunk.split("\n");
      return { name, body: bodyLines.join("\n") };
    });
  const step = (name) => stepBlocks.find((s) => s.name === name);

  // Protected source-lane dispatch contract: exactly the three optional
  // strings emitted by Turboism core, with no Provider-only additions.
  const inputsBlock = workflow.match(/^on:\n((?:[ \t]+\S[^\n]*\n?)*)/m)[1];
  const dispatchInputs = [...inputsBlock.matchAll(/^      ([a-z0-9_]+):$/gm)].map((match) => match[1]);
  assert.deepEqual(dispatchInputs, ["source_run_id", "source_sha", "artifact_name"]);
  for (const input of dispatchInputs) {
    assert.match(inputsBlock, new RegExp(`${input}:\\n(?:[ \t]+(?:description|required|type|default):[^\n]*\\n)+`));
    assert.match(inputsBlock, new RegExp(`${input}:\\n(?:[ \t]+[^\n]*\\n)*[ \t]+type: string`));
    assert.match(inputsBlock, new RegExp(`${input}:\\n(?:[ \t]+[^\n]*\\n)*[ \t]+required: false`));
    assert.match(inputsBlock, new RegExp(`${input}:\\n(?:[ \t]+[^\n]*\\n)*[ \t]+default: ""`));
  }
  // Turboism core dispatches this exact Provider workflow/ref with these exact
  // JSON input names; keep the protected source-lane contract visible here.
  assert.match(workflow, /workflow_dispatch ONLY/);
  assert.match(workflow, /\.github\/workflows\/publish-selected-plugins\.yml on main/);
  assert.match(workflow, /this exact workflow filename\/ref and input set/);
  assert.match(workflow, /source_run_id, source_sha, and/);
  assert.match(workflow, /artifact_name/);
  const gate = step("Validate dispatch inputs are all-or-none");
  assert.ok(gate, "all-or-none gate step must exist");
  // R1: inputs are evaluated in YAML env: values only; run: blocks reference
  // quoted shell variables and never interpolate ${{ inputs.* }} directly.
  assert.match(gate.body, /SOURCE_RUN_ID: \$\{\{ inputs\.source_run_id \}\}/);
  assert.match(gate.body, /SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(gate.body, /ARTIFACT_NAME: \$\{\{ inputs\.artifact_name \}\}/);
  assert.match(gate.body, /for value in "\$SOURCE_RUN_ID" "\$SOURCE_SHA" "\$ARTIFACT_NAME"/);
  assert.match(gate.body, /present=0/);
  assert.match(gate.body, /-ne 0/);
  assert.match(gate.body, /-ne 3/);
  assert.match(gate.body, /exit 1/);
  for (const block of stepBlocks) {
    const runIndex = block.body.indexOf("run: |");
    if (runIndex === -1) continue;
    const runBody = block.body.slice(runIndex);
    assert.doesNotMatch(runBody, /\$\{\{ inputs\./, `step "${block.name}" must never interpolate inputs into shell`);
  }

  // Automated steps run only when source_run_id is present; hydrate always
  // runs (manual mode must hydrate non-empty catalogs too).
  for (const name of ["Verify source run and download its artifact", "Validate the source bundle", "Create or resume public plugin Releases", "Ingest accepted releases into the source catalog"]) {
    assert.ok(step(name), `${name} step must exist`);
    assert.match(step(name).body, /if: inputs\.source_run_id != ''/, `${name} must be automated-only`);
  }
  const hydrate = step("Hydrate the local JAR manifest");
  assert.ok(hydrate);
  assert.doesNotMatch(hydrate.body, /^\s*if: /, "hydrate must run in manual mode too");
  assert.match(hydrate.body, /SOURCE_RUN_ID: \$\{\{ inputs\.source_run_id \}\}/);
  assert.match(hydrate.body, /if \[ -n "\$SOURCE_RUN_ID" \]/);
  assert.match(hydrate.body, /--manifest-out "\$RUNNER_TEMP\/market-jars\/jars\.json"/);
  assert.match(hydrate.body, /--bundle \$RUNNER_TEMP\/market-bundle-normalized\.json/);

  // Private-source token scope: TURBOISM_RELEASE_ARTIFACT_READ_TOKEN appears
  // exactly once as a secret reference, in the verify step's env only.
  const verify = step("Verify source run and download its artifact");
  assert.match(verify.body, /TURBOISM_RELEASE_ARTIFACT_READ_TOKEN: \$\{\{ secrets\.TURBOISM_RELEASE_ARTIFACT_READ_TOKEN \}\}/);
  assert.match(verify.body, /SOURCE_RUN_ID: \$\{\{ inputs\.source_run_id \}\}/);
  assert.match(verify.body, /SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(verify.body, /ARTIFACT_NAME: \$\{\{ inputs\.artifact_name \}\}/);
  assert.match(verify.body, /verify-run/);
  assert.match(verify.body, /--run-id "\$SOURCE_RUN_ID"/);
  assert.match(verify.body, /--sha "\$SOURCE_SHA"/);
  assert.match(verify.body, /--artifact-name "\$ARTIFACT_NAME"/);
  assert.match(verify.body, /--out "\$RUNNER_TEMP\/market-bundle"/);
  assert.equal((workflow.match(/secrets\.TURBOISM_RELEASE_ARTIFACT_READ_TOKEN/g) || []).length, 1, "the private-source token secret must be referenced exactly once");
  for (const s of stepBlocks) {
    if (s === verify) continue;
    assert.doesNotMatch(s.body, /TURBOISM_RELEASE_ARTIFACT_READ_TOKEN/, `step "${s.name}" must never touch the private-source token`);
  }
  // The signing secret is still referenced exactly once, in the publish step.
  assert.equal((workflow.match(/secrets\.PLUGIN_CATALOG_ED25519_PRIVATE_KEY_PEM/g) || []).length, 1);

  // R2: the bundle validation binds the sidecar revision to the verified SHA.
  const validate = step("Validate the source bundle");
  assert.match(validate.body, /SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/);
  assert.match(validate.body, /--expected-revision "\$SOURCE_SHA"/);

  // R3: the read-only preflight step exists, is automated-only, and runs
  // BEFORE any public Release mutation.
  const preflight = step("Preflight catalog conflicts (read-only)");
  assert.ok(preflight, "preflight step must exist");
  assert.match(preflight.body, /if: inputs\.source_run_id != ''/);
  assert.match(preflight.body, /ingest-official-release\.mjs preflight/);
  assert.match(preflight.body, /--catalog catalog\/v2\/catalog\.json/);
  assert.ok(
    workflow.indexOf("Preflight catalog conflicts (read-only)") < workflow.indexOf("Create or resume public plugin Releases"),
    "preflight must precede release sync",
  );
  const syncIndex = workflow.indexOf("Create or resume public plugin Releases");
  const ingestIndex = workflow.indexOf("Ingest accepted releases into the source catalog");
  assert.ok(syncIndex < ingestIndex, "release sync must precede ingest");

  // R4: release sync carries the signed catalog as authoritative context.
  const sync = step("Create or resume public plugin Releases");
  assert.match(sync.body, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(sync.body, /--catalog catalog\/v2\/catalog\.json/);
  assert.doesNotMatch(workflow, /--clobber/);
  assert.doesNotMatch(sync.body, /DELETE|PATCH/);

  // The publisher consumes the hydrated temp manifest, never the committed one.
  const publish = step("Publish the catalog/signature pair");
  assert.match(publish.body, /--jars "\$RUNNER_TEMP\/market-jars\/jars\.json"/);
  assert.ok(workflow.indexOf("Hydrate the local JAR manifest") < workflow.indexOf('--jars "$RUNNER_TEMP'), "hydration must precede publish");

  // Allowed post-publish diff: catalog/v2/catalog.json and public/api/v2/** only.
  const allowed = step("Verify only the allowed paths changed");
  assert.ok(allowed);
  const gatePatterns = [...workflow.matchAll(/-e '([^']*)'/g)].map((m) => m[1]);
  const gateRe = new RegExp(gatePatterns.join("|"));
  const gateRejects = (porcelain) => porcelain.split("\n").filter((l) => l !== "").some((l) => !gateRe.test(l));
  assert.ok(!gateRejects(" M catalog/v2/catalog.json"), "source catalog modification is allowed");
  assert.ok(!gateRejects("?? catalog/v2/catalog.json\n M public/api/v2/current"), "catalog plus pair is allowed");
  assert.ok(gateRejects(" M catalog/v2/catalog.json.evil"), "sibling files must be rejected");
  assert.ok(gateRejects(" M catalog/v2/jars.json"), "the committed JAR manifest must never change");
  assert.ok(gateRejects(" M catalog/v2/catalog.json\n M scripts/catalog-v2/publish.mjs"), "anything outside the roots must be rejected");

  // Commit: the pair and the source catalog are committed together once;
  // an idempotent run commits nothing; the push is never forced.
  const commit = step("Commit the generated pair and push to main");
  assert.ok(commit);
  assert.match(commit.body, /if git diff --quiet && \[ -z "\$\(git status --porcelain --untracked-files=all\)" \]/);
  assert.match(commit.body, /nothing to commit/);
  assert.match(commit.body, /git add public\/api\/v2 catalog\/v2\/catalog\.json/);
  assert.match(commit.body, /git push origin HEAD:refs\/heads\/main/);
  assert.doesNotMatch(commit.body, /--force|\s-f\s/);
});
