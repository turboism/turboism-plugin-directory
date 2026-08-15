import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkJarBinding, inspectJarFile, sha256Hex } from "../../lib/catalog-v2/catalog.mjs";
import { makeDescriptor, makeRelease, makeZip } from "./fixtures.mjs";

const DESCRIPTOR_ENTRY = "META-INF/turboism/plugin.json";

function tempDir() {
  return mkdtempSync(path.join(tmpdir(), "catalog-v2-jar-"));
}

/** Build a jar file on disk matching a release artifact; returns { jarPath, descriptor } with computed hashes. */
function deployJar(dir, { descriptorOverrides = {}, zipEntries = null, method = 8 } = {}) {
  const descriptor = makeDescriptor(descriptorOverrides);
  const entries =
    zipEntries ?? [
      { name: DESCRIPTOR_ENTRY, data: JSON.stringify(descriptor), method },
      { name: "dev/turboism/plugin/Inspector.class", data: Buffer.from([0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x3a]), method },
    ];
  const jarBytes = makeZip(entries);
  const jarPath = path.join(dir, "plugin.jar");
  writeFileSync(jarPath, jarBytes);
  const descriptorBytes = Buffer.from(JSON.stringify(descriptor), "utf8");
  return {
    jarPath,
    descriptor,
    jarBytes,
    artifact: {
      mediaType: "application/java-archive",
      fileName: "plugin.jar",
      url: "https://github.com/turboism/turboism-releases/releases/download/v0.1.0/plugin.jar",
      sha256: sha256Hex(jarBytes),
      descriptorSha256: sha256Hex(descriptorBytes),
      size: jarBytes.byteLength,
    },
  };
}

test("exact schema-v3 JAR binding succeeds", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir);
    const release = makeRelease({ artifact });
    const bound = checkJarBinding(jarPath, release, "dev.turboism.plugin.project-inspector");
    assert.ok(bound.ok, JSON.stringify(bound.errors));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ordered-tag mismatch fails binding", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir, { descriptorOverrides: { tags: ["inspection", "project"] } });
    const bound = checkJarBinding(jarPath, makeRelease({ artifact }), "dev.turboism.plugin.project-inspector");
    assert.ok(!bound.ok);
    assert.ok(bound.errors.some((issue) => issue.path === "descriptor.tags"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("category mismatch fails binding", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir, { descriptorOverrides: { category: "workflow" } });
    const bound = checkJarBinding(jarPath, makeRelease({ artifact }), "dev.turboism.plugin.project-inspector");
    assert.ok(!bound.ok);
    assert.ok(bound.errors.some((issue) => issue.path === "descriptor.category"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("descriptor id and version mismatches fail binding", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir, { descriptorOverrides: { id: "dev.turboism.plugin.other" } });
    assert.ok(!checkJarBinding(jarPath, makeRelease({ artifact }), "dev.turboism.plugin.project-inspector").ok);
    const { jarPath: jar2, artifact: artifact2 } = deployJar(dir, { descriptorOverrides: { version: "0.2.0" } });
    assert.ok(!checkJarBinding(jar2, makeRelease({ artifact: artifact2 }), "dev.turboism.plugin.project-inspector").ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("descriptor schemaVersion other than 3 fails binding", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir, { descriptorOverrides: { schemaVersion: 2 } });
    const bound = checkJarBinding(jarPath, makeRelease({ artifact }), "dev.turboism.plugin.project-inspector");
    assert.ok(!bound.ok);
    assert.ok(bound.errors.some((issue) => issue.message.includes("exactly 3")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("JAR hash, size, and descriptor hash mismatches fail inspection", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir);
    const wrongHash = { ...artifact, sha256: "f".repeat(64) };
    assert.ok(!checkJarBinding(jarPath, makeRelease({ artifact: wrongHash }), "dev.turboism.plugin.project-inspector").ok);
    const wrongSize = { ...artifact, size: artifact.size + 1 };
    assert.ok(!checkJarBinding(jarPath, makeRelease({ artifact: wrongSize }), "dev.turboism.plugin.project-inspector").ok);
    const wrongDescriptorHash = { ...artifact, descriptorSha256: "e".repeat(64) };
    assert.ok(!checkJarBinding(jarPath, makeRelease({ artifact: wrongDescriptorHash }), "dev.turboism.plugin.project-inspector").ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing descriptor entry fails inspection", () => {
  const dir = tempDir();
  try {
    const jarPath = path.join(dir, "plugin.jar");
    writeFileSync(jarPath, makeZip([{ name: "dev/turboism/plugin/Inspector.class", data: Buffer.from([0xca, 0xfe]) }]));
    const inspected = inspectJarFile(jarPath, { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!inspected.ok);
    assert.ok(inspected.errors.some((issue) => issue.message.includes("missing")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two descriptor entries fail inspection", () => {
  const dir = tempDir();
  try {
    const descriptor = JSON.stringify(makeDescriptor());
    const jarPath = path.join(dir, "plugin.jar");
    writeFileSync(jarPath, makeZip([{ name: DESCRIPTOR_ENTRY, data: descriptor }, { name: DESCRIPTOR_ENTRY, data: descriptor }]));
    const inspected = inspectJarFile(jarPath, { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!inspected.ok);
    assert.ok(inspected.errors.some((issue) => issue.message.includes("more than one")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("path traversal entry names fail the strict JAR policy", () => {
  const dir = tempDir();
  try {
    const descriptor = JSON.stringify(makeDescriptor());
    const jarPath = path.join(dir, "plugin.jar");
    writeFileSync(
      jarPath,
      makeZip([
        { name: DESCRIPTOR_ENTRY, data: descriptor },
        { name: "../evil.txt", data: "boom" },
      ]),
    );
    const inspected = inspectJarFile(jarPath, { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!inspected.ok);
    assert.ok(inspected.errors.some((issue) => issue.message.includes("not a safe relative path")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("non-ZIP input and truncated ZIPs fail without throwing", () => {
  const dir = tempDir();
  try {
    const notZip = path.join(dir, "plugin.jar");
    writeFileSync(notZip, "this is not a zip file at all");
    const inspected = inspectJarFile(notZip, { sha256: "0".repeat(64), descriptorSha256: "0".repeat(64), size: 100 });
    assert.ok(!inspected.ok);
    const truncated = path.join(dir, "truncated.jar");
    const full = makeZip([{ name: DESCRIPTOR_ENTRY, data: "{}" }]);
    writeFileSync(truncated, full.subarray(0, full.length - 40));
    assert.ok(!inspectJarFile(truncated, { sha256: "0".repeat(64), descriptorSha256: "0".repeat(64), size: 100 }).ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stored (method 0) descriptors are accepted", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir, { method: 0 });
    const bound = checkJarBinding(jarPath, makeRelease({ artifact }), "dev.turboism.plugin.project-inspector");
    assert.ok(bound.ok, JSON.stringify(bound.errors));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unsupported ZIP method fails inspection", () => {
  const dir = tempDir();
  try {
    // Build a structurally valid stored-method zip, then declare method 99 in
    // both the local and central headers so the reader must reject it.
    const descriptor = JSON.stringify(makeDescriptor());
    const jarPath = path.join(dir, "plugin.jar");
    const bytes = makeZip([{ name: DESCRIPTOR_ENTRY, data: descriptor, method: 0 }]);
    bytes.writeUInt16LE(99, 8); // local header method
    const centralStart = bytes.readUInt32LE(bytes.length - 6);
    bytes.writeUInt16LE(99, centralStart + 10); // central directory method
    writeFileSync(jarPath, bytes);
    const inspected = inspectJarFile(jarPath, { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!inspected.ok);
    assert.ok(inspected.errors.some((issue) => issue.message.includes("unsupported ZIP method")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("descriptor larger than 1 MiB fails inspection", () => {
  const dir = tempDir();
  try {
    const bigDescriptor = makeDescriptor({ name: "x".repeat(1100 * 1024) });
    const jarPath = path.join(dir, "plugin.jar");
    writeFileSync(jarPath, makeZip([{ name: DESCRIPTOR_ENTRY, data: JSON.stringify(bigDescriptor) }]));
    const inspected = inspectJarFile(jarPath, { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!inspected.ok);
    assert.ok(inspected.errors.some((issue) => issue.message.includes("exceeds")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("bounded central directory: inflated cdSize is rejected without walking", () => {
  const dir = tempDir();
  try {
    const descriptor = JSON.stringify(makeDescriptor());
    const bytes = makeZip([{ name: DESCRIPTOR_ENTRY, data: descriptor }]);
    // Patch the EOCD central-directory size (uint32) to a huge value: the
    // reader must reject before iterating entries.
    const eocd = bytes.length - 22;
    bytes.writeUInt32LE(0xffffffff, eocd + 12);
    const jarPath = path.join(dir, "plugin.jar");
    writeFileSync(jarPath, bytes);
    const inspected = inspectJarFile(jarPath, { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!inspected.ok);
    assert.ok(inspected.errors.some((issue) => issue.message.includes("central directory exceeds file bounds")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalization: omitted permission scope and dependency type/ordering bind after defaults", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir, {
      descriptorOverrides: {
        permissions: [{ id: "dev.turboism.plugin.core" }],
        dependencies: [{ id: "dev.turboism.plugin.core", version: "[0.1.0,0.3.0)" }],
      },
    });
    const bound = checkJarBinding(jarPath, makeRelease({ artifact }), "dev.turboism.plugin.project-inspector");
    assert.ok(bound.ok, JSON.stringify(bound.errors));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("permission and dependency set mismatches fail binding", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir, {
      descriptorOverrides: {
        permissions: [{ id: "dev.turboism.plugin.other", scope: "user" }],
      },
    });
    const bound = checkJarBinding(jarPath, makeRelease({ artifact }), "dev.turboism.plugin.project-inspector");
    assert.ok(!bound.ok);
    assert.ok(bound.errors.some((issue) => issue.path === "descriptor.permissions"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("environment.requiresCubism disagreement fails binding", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir, { descriptorOverrides: { environment: { requiresCubism: false } } });
    const bound = checkJarBinding(jarPath, makeRelease({ artifact }), "dev.turboism.plugin.project-inspector");
    assert.ok(!bound.ok);
    assert.ok(bound.errors.some((issue) => issue.path === "descriptor.environment.requiresCubism"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("turboismApi disagreement fails binding", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir, { descriptorOverrides: { turboismApi: "[0.1.0,0.5.0)" } });
    const bound = checkJarBinding(jarPath, makeRelease({ artifact }), "dev.turboism.plugin.project-inspector");
    assert.ok(!bound.ok);
    assert.ok(bound.errors.some((issue) => issue.path === "descriptor.turboismApi"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
