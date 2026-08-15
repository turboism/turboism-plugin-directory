import test from "node:test";
import assert from "node:assert/strict";
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, rmSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
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
    assert.ok(inspected.errors.some((issue) => issue.message.includes("central directory must end exactly")));
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

test("symlink and non-regular JAR paths fail inspection", () => {
  const dir = tempDir();
  try {
    const target = path.join(dir, "real.jar");
    writeFileSync(target, makeZip([{ name: DESCRIPTOR_ENTRY, data: JSON.stringify(makeDescriptor()) }]));
    const link = path.join(dir, "link.jar");
    symlinkSync(target, link);
    const inspected = inspectJarFile(link, { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!inspected.ok);
    assert.ok(inspected.errors.some((issue) => issue.message.includes("symbolic link")));
    const dirJar = path.join(dir, "folder.jar");
    mkdirSync(dirJar);
    const notRegular = inspectJarFile(dirJar, { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!notRegular.ok);
    assert.ok(notRegular.errors.some((issue) => issue.message.includes("regular file")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("size cap is enforced before reading via fstat (a >16 MiB file is rejected)", () => {
  const dir = tempDir();
  try {
    const jarPath = path.join(dir, "big.jar");
    const fd = openSync(jarPath, "w");
    writeSync(fd, Buffer.alloc(1024));
    ftruncateSync(fd, 16 * 1024 * 1024 + 1);
    closeSync(fd);
    const inspected = inspectJarFile(jarPath, { sha256: "0".repeat(64), descriptorSha256: "0".repeat(64), size: 16 * 1024 * 1024 + 1 });
    assert.ok(!inspected.ok);
    assert.ok(inspected.errors.some((issue) => issue.message.includes("at most")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("strict EOCD endpoint: trailing junk and comment-embedded fake signatures fail closed", () => {
  const dir = tempDir();
  try {
    const descriptor = JSON.stringify(makeDescriptor());
    const base = makeZip([{ name: DESCRIPTOR_ENTRY, data: descriptor }]);
    // Trailing junk after the EOCD: the record no longer ends at EOF.
    const withJunk = path.join(dir, "junk.jar");
    writeFileSync(withJunk, Buffer.concat([base, Buffer.from("JUNK")]));
    const junkCheck = inspectJarFile(withJunk, { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!junkCheck.ok);
    assert.ok(junkCheck.errors.some((issue) => issue.message.includes("missing or misplaced")));
    // A declared comment is legal: patch commentLen so the EOCD still ends at EOF.
    const withComment = path.join(dir, "comment.jar");
    const comment = Buffer.alloc(10, 0x42);
    const commented = Buffer.concat([base, comment]);
    commented.writeUInt16LE(10, commented.length - 22 - 10 + 20); // commentLen field of the real EOCD
    writeFileSync(withComment, commented);
    const commentCheck = inspectJarFile(withComment, { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    // The descriptor is intact; only hash fields were faked, so a missing
    // descriptor hash error means the ZIP itself parsed.
    assert.ok(commentCheck.errors.some((issue) => issue.message.includes("descriptor SHA-256")) || commentCheck.errors.some((issue) => issue.message.includes("more than one")) || commentCheck.errors.some((issue) => issue.message.includes("missing")));
    // A comment whose bytes place a fake EOCD signature exactly at size-22
    // wins the backward scan and must fail closed on the central-directory
    // consistency checks.
    const fakeComment = Buffer.concat([Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(6), Buffer.alloc(10, 0x42)]);
    const faked = Buffer.concat([base, fakeComment]);
    faked.writeUInt16LE(fakeComment.length, faked.length - 22 - fakeComment.length + 20);
    const fakePath = path.join(dir, "fake-comment.jar");
    writeFileSync(fakePath, faked);
    const fakeCheck = inspectJarFile(fakePath, { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!fakeCheck.ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("multi-disk, ZIP64 markers, and encrypted entries fail inspection", () => {
  const dir = tempDir();
  try {
    const descriptor = JSON.stringify(makeDescriptor());
    const build = () => makeZip([{ name: DESCRIPTOR_ENTRY, data: descriptor }]);
    const multiDisk = build();
    multiDisk.writeUInt16LE(1, multiDisk.length - 22 + 4); // disk number
    writeFileSync(path.join(dir, "multi.jar"), multiDisk);
    const multi = inspectJarFile(path.join(dir, "multi.jar"), { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!multi.ok);
    assert.ok(multi.errors.some((issue) => issue.message.includes("multi-disk")));
    const zip64 = build();
    zip64.writeUInt16LE(0xffff, zip64.length - 22 + 10); // total entries marker
    zip64.writeUInt16LE(0xffff, zip64.length - 22 + 8); // entries on disk marker
    writeFileSync(path.join(dir, "zip64.jar"), zip64);
    const z64 = inspectJarFile(path.join(dir, "zip64.jar"), { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!z64.ok);
    assert.ok(z64.errors.some((issue) => issue.message.includes("ZIP64")));
    const encrypted = build();
    const eocd = encrypted.length - 22;
    const cdOffset = encrypted.readUInt32LE(eocd + 16);
    encrypted.writeUInt16LE(1, cdOffset + 8); // general purpose flag bit 0
    writeFileSync(path.join(dir, "enc.jar"), encrypted);
    const enc = inspectJarFile(path.join(dir, "enc.jar"), { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!enc.ok);
    assert.ok(enc.errors.some((issue) => issue.message.includes("encrypted")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local/central name, method, and flags must agree", () => {
  const dir = tempDir();
  try {
    const descriptor = JSON.stringify(makeDescriptor());
    const build = () => makeZip([{ name: DESCRIPTOR_ENTRY, data: descriptor }]);
    const methodMismatch = build();
    methodMismatch.writeUInt16LE(99, 8); // local header method
    writeFileSync(path.join(dir, "method.jar"), methodMismatch);
    const methodCheck = inspectJarFile(path.join(dir, "method.jar"), { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!methodCheck.ok);
    assert.ok(methodCheck.errors.some((issue) => issue.message.includes("flags/method differ")));
    const flagsMismatch = build();
    flagsMismatch.writeUInt16LE(0x0002, 6); // local header flags
    writeFileSync(path.join(dir, "flags.jar"), flagsMismatch);
    const flagsCheck = inspectJarFile(path.join(dir, "flags.jar"), { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!flagsCheck.ok);
    assert.ok(flagsCheck.errors.some((issue) => issue.message.includes("flags/method differ")));
    const nameMismatch = build();
    nameMismatch.write( "META-INF/turboism/other.json", 30, "utf8"); // local name differs
    writeFileSync(path.join(dir, "name.jar"), nameMismatch);
    const nameCheck = inspectJarFile(path.join(dir, "name.jar"), { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!nameCheck.ok);
    assert.ok(nameCheck.errors.some((issue) => issue.message.includes("names differ")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("descriptor bytes must equal the declared uncompressed size", () => {
  const dir = tempDir();
  try {
    const descriptor = JSON.stringify(makeDescriptor());
    const bytes = makeZip([{ name: DESCRIPTOR_ENTRY, data: descriptor }]);
    const eocd = bytes.length - 22;
    const cdOffset = bytes.readUInt32LE(eocd + 16);
    bytes.writeUInt32LE(bytes.readUInt32LE(cdOffset + 24) + 5, cdOffset + 24); // inflate declared size
    writeFileSync(path.join(dir, "sized.jar"), bytes);
    const inspected = inspectJarFile(path.join(dir, "sized.jar"), { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!inspected.ok);
    assert.ok(inspected.errors.some((issue) => issue.message.includes("declared uncompressed size")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("descriptor format must be exactly turboism.plugin.meta", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir, { descriptorOverrides: { format: "turboism.plugin.meta.v2" } });
    const bound = checkJarBinding(jarPath, makeRelease({ artifact }), "dev.turboism.plugin.project-inspector");
    assert.ok(!bound.ok);
    assert.ok(bound.errors.some((issue) => issue.path === "descriptor.format"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("empty descriptor tags bind to empty release tags", () => {
  const dir = tempDir();
  try {
    const { jarPath, artifact } = deployJar(dir, { descriptorOverrides: { tags: [] } });
    const bound = checkJarBinding(jarPath, makeRelease({ artifact, tags: [] }), "dev.turboism.plugin.project-inspector");
    assert.ok(bound.ok, JSON.stringify(bound.errors));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("descriptor with duplicate JSON keys is rejected", () => {
  const dir = tempDir();
  try {
    const descriptor = JSON.stringify(makeDescriptor());
    const dup = descriptor.replace('"schemaVersion":3', '"schemaVersion":3,"schemaVersion":3');
    const jarPath = path.join(dir, "dup.jar");
    writeFileSync(jarPath, makeZip([{ name: DESCRIPTOR_ENTRY, data: dup }]));
    const inspected = inspectJarFile(jarPath, { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!inspected.ok);
    assert.ok(inspected.errors.some((issue) => issue.message.includes("duplicate object key")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("central directory length and count must be exact", () => {
  const dir = tempDir();
  try {
    const descriptor = JSON.stringify(makeDescriptor());
    const bytes = makeZip([{ name: DESCRIPTOR_ENTRY, data: descriptor }]);
    const eocd = bytes.length - 22;
    bytes.writeUInt32LE(bytes.readUInt32LE(eocd + 12) + 4, eocd + 12); // inflate cdSize
    writeFileSync(path.join(dir, "cd.jar"), bytes);
    const inspected = inspectJarFile(path.join(dir, "cd.jar"), { sha256: sha256Hex(makeZip([])), descriptorSha256: "0".repeat(64), size: 0 });
    assert.ok(!inspected.ok);
    assert.ok(inspected.errors.some((issue) => issue.message.includes("central directory must end exactly")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
