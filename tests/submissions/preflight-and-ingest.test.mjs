import test from "node:test";
import assert from "node:assert/strict";
import { makeZip } from "../catalog-v2/fixtures.mjs";
import { validateCatalogBytes } from "../../lib/catalog-v2/catalog.mjs";
import {
  formatBytecodeAuditMarkdown,
  scanClassBytes,
} from "../../lib/submissions/bytecode-scan.mjs";
import {
  OWNERSHIP_FORMAT,
  OWNERSHIP_SCHEMA_VERSION,
  parseOwnershipRegistry,
} from "../../lib/submissions/ownership.mjs";
import { runSubmissionPreflight } from "../../lib/submissions/preflight.mjs";
import { ingestSubmissionManifest } from "../../scripts/catalog-v2/ingest-submission.mjs";

const REPO_URL = "https://github.com/acme/turboism-mesh-helper";
const SOURCE_REV = "a".repeat(40);
const PUBLISHED_AT = "2026-09-10T10:00:00Z";

/**
 * Builds a valid JVM class file in memory containing optional Long/Double two-slot constants,
 * external method references, and optional native methods.
 */
function buildSyntheticClassBytes({
  thisClass = "com/acme/meshhelper/MeshHelperPlugin",
  superClass = "java/lang/Object",
  methodRefs = [],
  includeTwoSlotLongAndDouble = false,
  nativeMethodName = null,
} = {}) {
  const cpEntries = [];
  const addEntry = (buf) => {
    cpEntries.push(buf);
    return cpEntries.length;
  };
  const addUtf8 = (text) => {
    const strBuf = Buffer.from(text, "utf8");
    const header = Buffer.alloc(3);
    header.writeUInt8(1, 0);
    header.writeUInt16BE(strBuf.byteLength, 1);
    return addEntry(Buffer.concat([header, strBuf]));
  };
  const addClass = (internalName) => {
    const nameIdx = addUtf8(internalName);
    const buf = Buffer.alloc(3);
    buf.writeUInt8(7, 0);
    buf.writeUInt16BE(nameIdx, 1);
    return addEntry(buf);
  };
  const addNameAndType = (name, descriptor) => {
    const nameIdx = addUtf8(name);
    const descIdx = addUtf8(descriptor);
    const buf = Buffer.alloc(5);
    buf.writeUInt8(12, 0);
    buf.writeUInt16BE(nameIdx, 1);
    buf.writeUInt16BE(descIdx, 3);
    return addEntry(buf);
  };
  const addMethodRef = (owner, name, descriptor) => {
    const classIdx = addClass(owner);
    const natIdx = addNameAndType(name, descriptor);
    const buf = Buffer.alloc(5);
    buf.writeUInt8(10, 0);
    buf.writeUInt16BE(classIdx, 1);
    buf.writeUInt16BE(natIdx, 3);
    return addEntry(buf);
  };

  const thisClassIdx = addClass(thisClass);
  const superClassIdx = addClass(superClass);

  if (includeTwoSlotLongAndDouble) {
    const longBuf = Buffer.alloc(9);
    longBuf.writeUInt8(5, 0);
    cpEntries.push(longBuf);
    cpEntries.push(null); // Second slot reserved by JVMS 4.4.5 for CONSTANT_Long.
    const doubleBuf = Buffer.alloc(9);
    doubleBuf.writeUInt8(6, 0);
    cpEntries.push(doubleBuf);
    cpEntries.push(null); // Second slot reserved by JVMS 4.4.5 for CONSTANT_Double.
  }

  for (const ref of methodRefs) {
    addMethodRef(ref.owner, ref.name, ref.descriptor ?? "()V");
  }

  let nativeNameIdx = 0;
  let nativeDescIdx = 0;
  if (nativeMethodName) {
    nativeNameIdx = addUtf8(nativeMethodName);
    nativeDescIdx = addUtf8("()V");
  }

  const realPoolBytes = cpEntries.filter((entry) => entry !== null);
  const cpCount = cpEntries.length + 1;

  const header = Buffer.alloc(10);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(65, 6);
  header.writeUInt16BE(cpCount, 8);

  const afterCp = Buffer.alloc(10);
  afterCp.writeUInt16BE(0x0021, 0); // ACC_PUBLIC | ACC_SUPER
  afterCp.writeUInt16BE(thisClassIdx, 2);
  afterCp.writeUInt16BE(superClassIdx, 4);
  afterCp.writeUInt16BE(0, 6); // interfaces_count
  afterCp.writeUInt16BE(0, 8); // fields_count

  let methodsBuf;
  if (nativeMethodName) {
    methodsBuf = Buffer.alloc(10);
    methodsBuf.writeUInt16BE(1, 0); // methods_count
    methodsBuf.writeUInt16BE(0x0101, 2); // ACC_PUBLIC | ACC_NATIVE
    methodsBuf.writeUInt16BE(nativeNameIdx, 4);
    methodsBuf.writeUInt16BE(nativeDescIdx, 6);
    methodsBuf.writeUInt16BE(0, 8); // attributes_count
  } else {
    methodsBuf = Buffer.alloc(2);
    methodsBuf.writeUInt16BE(0, 0);
  }

  const classAttrs = Buffer.alloc(2);
  classAttrs.writeUInt16BE(0, 0);

  return Buffer.concat([header, ...realPoolBytes, afterCp, methodsBuf, classAttrs]);
}

function makeValidPluginDescriptor(overrides = {}) {
  return {
    format: "turboism.plugin.meta",
    schemaVersion: 3,
    id: "com.acme.mesh-helper",
    name: "Mesh Helper",
    version: "1.0.0",
    description: "Inspect and refine mesh weights.",
    entrypoints: ["com.acme.meshhelper.MeshHelperPlugin"],
    turboismApi: "[0.67.0,)",
    authors: [{ name: "Acme Studio" }],
    license: "MIT",
    website: REPO_URL,
    resources: ["assets/mesh-helper/"],
    i18n: {
      baseName: "assets/mesh-helper/messages",
      locales: ["zh_Hans", "ja", "ko"],
    },
    dependencies: [],
    permissions: [
      { id: "turboism.network.fetch", scope: "user", reason: "Fetch remote mesh presets." },
    ],
    environment: { requiresCubism: true, ui: "swing" },
    lifecycle: { hotReload: true },
    category: "modeling",
    tags: ["mesh", "helper"],
    ...overrides,
  };
}

function buildPluginJarEntries({
  descriptorOverrides = {},
  classMethodRefs = [{ owner: "java/net/http/HttpClient", name: "newHttpClient" }],
  includeTwoSlotLongAndDouble = true,
  nativeMethodName = null,
  extraEntries = [],
  includeCubismSidecar = true,
} = {}) {
  const descriptor = makeValidPluginDescriptor(descriptorOverrides);
  const classBytes = buildSyntheticClassBytes({
    methodRefs: classMethodRefs,
    includeTwoSlotLongAndDouble,
    nativeMethodName,
  });
  const cubismSidecar = {
    format: "turboism.plugin-cubism-versions/v1",
    plugin: descriptor.id,
    supportedVersions: ["5.3.00", "5.3.02"],
  };
  const entries = [
    { name: "META-INF/MANIFEST.MF", data: "Manifest-Version: 1.0\r\n\r\n" },
    { name: "META-INF/turboism/plugin.json", data: JSON.stringify(descriptor) },
    { name: "com/acme/meshhelper/MeshHelperPlugin.class", data: classBytes },
    { name: "assets/mesh-helper/messages.properties", data: "plugin.name=Mesh Helper\nplugin.description=Inspect and refine mesh weights.\n" },
    { name: "assets/mesh-helper/messages_zh_Hans.properties", data: "plugin.name=网格助手\nplugin.description=检查并优化网格权重。\n" },
    { name: "assets/mesh-helper/messages_ja.properties", data: "plugin.name=メッシュヘルパー\nplugin.description=メッシュウェイトを確認します。\n" },
    { name: "assets/mesh-helper/messages_ko.properties", data: "plugin.name=메시 도우미\nplugin.description=메시 가중치를 확인합니다.\n" },
    { name: "META-INF/turboism/readme/README.md", data: "# Mesh Helper\n\nDetailed documentation.\n" },
    ...extraEntries,
  ];
  if (includeCubismSidecar) {
    entries.push({ name: "META-INF/turboism/cubism-versions.json", data: JSON.stringify(cubismSidecar) });
  }
  return entries;
}

function makeBaseCatalog() {
  return {
    format: "turboism.plugin.catalog",
    schemaVersion: 2,
    catalogVersion: 1,
    publishedAt: "2026-09-01T00:00:00Z",
    plugins: [],
  };
}

function makeBaseOwnership() {
  return {
    format: OWNERSHIP_FORMAT,
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    claims: {},
  };
}

test("bytecode scanner parses constant pool across two-slot Long/Double, detects sensitive APIs and ACC_NATIVE, and formats Markdown", () => {
  const classBytes = buildSyntheticClassBytes({
    includeTwoSlotLongAndDouble: true,
    nativeMethodName: "nativeBind",
    methodRefs: [
      { owner: "java/lang/ProcessBuilder", name: "<init>" },
      { owner: "java/nio/file/Files", name: "writeString" },
      { owner: "java/net/Socket", name: "<init>" },
      { owner: "java/net/URLClassLoader", name: "<init>" },
      { owner: "sun/misc/Unsafe", name: "getUnsafe" },
    ],
  });

  const scanned = scanClassBytes(
    classBytes,
    "com/acme/meshhelper/MeshHelperPlugin.class",
    [{ id: "turboism.network.fetch" }],
  );
  const categories = new Set(scanned.findings.map((f) => f.category));
  assert.ok(categories.has("process_execution"));
  assert.ok(categories.has("filesystem_io"));
  assert.ok(categories.has("network_io"));
  assert.ok(categories.has("dynamic_loading_or_reflection"));
  assert.ok(categories.has("native_or_unsafe"));

  const networkFinding = scanned.findings.find((f) => f.category === "network_io");
  assert.equal(networkFinding.declaredPermissionMatched, true);
  const processFinding = scanned.findings.find((f) => f.category === "process_execution");
  assert.equal(processFinding.declaredPermissionMatched, false);

  const md = formatBytecodeAuditMarkdown({
    scannedClassCount: 1,
    riskLevel: "high",
    undeclaredCapabilities: ["process_execution"],
    findings: scanned.findings,
  });
  assert.ok(md.includes("| Category | Class | Symbol | Declared Permission |"));
  assert.ok(md.includes("process_execution"));
});

test("runSubmissionPreflight validates clean third-party JAR, extracts i18n/cubism/README, and ingests into catalog + ownership", () => {
  const jarBytes = makeZip(buildPluginJarEntries());
  const catalog = makeBaseCatalog();
  const ownership = makeBaseOwnership();

  const preflight = runSubmissionPreflight({
    jarPathOrBytes: jarBytes,
    slug: "mesh-helper",
    assetFileName: "mesh-helper-1.0.0.jar",
    artifactUrl: `${REPO_URL}/releases/download/v1.0.0/mesh-helper-1.0.0.jar`,
    releaseUrl: `${REPO_URL}/releases/tag/v1.0.0`,
    channel: "stable",
    publishedAt: PUBLISHED_AT,
    sourceRevision: SOURCE_REV,
    submitter: { githubId: 4242, login: "acme-bot", name: "Acme Maintainer", verificationReason: "repo_owner" },
    repository: { id: 8888, url: REPO_URL, releaseTag: "v1.0.0" },
    catalog,
    ownership,
  });

  assert.equal(preflight.ok, true, JSON.stringify(preflight.errors));
  assert.equal(preflight.isFirstClaim, true);
  assert.equal(preflight.manifest.plugin.trust, "reviewed-third-party");
  assert.deepEqual(preflight.manifest.release.cubismVersions, ["5.3.00", "5.3.02"]);
  assert.equal(preflight.manifest.plugin.localizations["zh-Hans"].name, "网格助手");
  assert.equal(preflight.manifest.plugin.localizations.ja.name, "メッシュヘルパー");
  assert.equal(preflight.manifest.plugin.localizations.ko.name, "메시 도우미");
  assert.equal(preflight.manifest.bytecodeAudit.scannedClassCount, 1);
  assert.equal(preflight.manifest.bytecodeAudit.riskLevel, "medium");
  assert.deepEqual(preflight.manifest.bytecodeAudit.undeclaredCapabilities, []);
  assert.ok(preflight.manifest.readmes.en.includes("# Mesh Helper"));

  const ingested = ingestSubmissionManifest({
    manifest: preflight.manifest,
    jarPathOrBytes: jarBytes,
    catalog,
    ownership,
  });
  assert.equal(ingested.ok, true, JSON.stringify(ingested.errors));
  assert.equal(ingested.catalog.catalogVersion, 2);
  assert.equal(validateCatalogBytes(ingested.catalogBytes).ok, true);
  const parsedOwnership = parseOwnershipRegistry(ingested.ownershipText);
  assert.equal(parsedOwnership.ok, true);
  assert.equal(parsedOwnership.registry.claims["com.acme.mesh-helper"].ownerGithubId, 4242);

  // Subsequent release must be strictly ascending and reuse existing claim lock.
  const v2Jar = makeZip(buildPluginJarEntries({ descriptorOverrides: { version: "1.1.0" } }));
  const v2Preflight = runSubmissionPreflight({
    jarPathOrBytes: v2Jar,
    slug: "mesh-helper",
    assetFileName: "mesh-helper-1.1.0.jar",
    artifactUrl: `${REPO_URL}/releases/download/v1.1.0/mesh-helper-1.1.0.jar`,
    releaseUrl: `${REPO_URL}/releases/tag/v1.1.0`,
    channel: "stable",
    publishedAt: "2026-09-12T10:00:00Z",
    sourceRevision: "b".repeat(40),
    submitter: { githubId: 4242, login: "acme-bot" },
    repository: { id: 8888, url: REPO_URL, releaseTag: "v1.1.0" },
    catalog: ingested.catalog,
    ownership: ingested.ownership,
  });
  assert.equal(v2Preflight.ok, true, JSON.stringify(v2Preflight.errors));
  assert.equal(v2Preflight.isFirstClaim, false);

  // Swapping JAR bytes after manifest creation must be rejected during ingest.
  const swappedBytes = makeZip(
    buildPluginJarEntries({
      classMethodRefs: [{ owner: "java/lang/ProcessBuilder", name: "<init>" }],
    }),
  );
  const tamperedIngest = ingestSubmissionManifest({
    manifest: preflight.manifest,
    jarPathOrBytes: swappedBytes,
    catalog,
    ownership,
  });
  assert.equal(tamperedIngest.ok, false);
});

test("runSubmissionPreflight rejects contamination, undeclared resources, missing entrypoints, agent manifests, missing cubism sidecar, and version regressions", () => {
  const baseArgs = {
    slug: "mesh-helper",
    assetFileName: "mesh-helper-1.0.0.jar",
    artifactUrl: `${REPO_URL}/releases/download/v1.0.0/mesh-helper-1.0.0.jar`,
    releaseUrl: `${REPO_URL}/releases/tag/v1.0.0`,
    publishedAt: PUBLISHED_AT,
    sourceRevision: SOURCE_REV,
    submitter: { githubId: 4242, login: "acme-bot" },
    repository: { id: 8888, url: REPO_URL, releaseTag: "v1.0.0" },
    catalog: makeBaseCatalog(),
    ownership: makeBaseOwnership(),
  };

  // Native binary contamination
  assert.equal(
    runSubmissionPreflight({
      ...baseArgs,
      jarPathOrBytes: makeZip(buildPluginJarEntries({ extraEntries: [{ name: "assets/mesh-helper/native.dll", data: "MZ" }] })),
    }).ok,
    false,
  );

  // Forbidden internal package prefix
  assert.equal(
    runSubmissionPreflight({
      ...baseArgs,
      jarPathOrBytes: makeZip(buildPluginJarEntries({ extraEntries: [{ name: "dev/turboism/sdk/Shadow.class", data: "bad" }] })),
    }).ok,
    false,
  );

  // Undeclared resource outside resources/ and i18n
  assert.equal(
    runSubmissionPreflight({
      ...baseArgs,
      jarPathOrBytes: makeZip(buildPluginJarEntries({ extraEntries: [{ name: "undeclared/secret.txt", data: "oops" }] })),
    }).ok,
    false,
  );

  // Premain-Class in MANIFEST.MF
  const agentEntries = buildPluginJarEntries().map((entry) =>
    entry.name === "META-INF/MANIFEST.MF"
      ? { name: entry.name, data: "Manifest-Version: 1.0\r\nPremain-Class: com.acme.Agent\r\n\r\n" }
      : entry,
  );
  assert.equal(runSubmissionPreflight({ ...baseArgs, jarPathOrBytes: makeZip(agentEntries) }).ok, false);

  // Missing entrypoint class
  assert.equal(
    runSubmissionPreflight({
      ...baseArgs,
      jarPathOrBytes: makeZip(buildPluginJarEntries({ descriptorOverrides: { entrypoints: ["com.acme.MissingEntrypoint"] } })),
    }).ok,
    false,
  );

  // Missing cubism-versions.json when requiresCubism is true
  assert.equal(
    runSubmissionPreflight({
      ...baseArgs,
      jarPathOrBytes: makeZip(buildPluginJarEntries({ includeCubismSidecar: false })),
    }).ok,
    false,
  );

  // Non-monotonic version when catalog already has 1.0.0
  const existingCatalog = {
    format: "turboism.plugin.catalog",
    schemaVersion: 2,
    catalogVersion: 2,
    publishedAt: PUBLISHED_AT,
    plugins: [
      {
        id: "com.acme.mesh-helper",
        slug: "mesh-helper",
        name: "Mesh Helper",
        summary: "Inspect and refine mesh weights.",
        trust: "reviewed-third-party",
        author: "Acme Studio",
        license: "MIT",
        repository: REPO_URL,
        support: `${REPO_URL}/issues`,
        localizations: {},
        releases: [
          {
            version: "1.0.0",
            channel: "stable",
            status: "active",
            publishedAt: PUBLISHED_AT,
            category: "modeling",
            tags: ["mesh"],
            turboismApi: "[0.67.0,)",
            requiresCubism: false,
            cubismVersions: [],
            platforms: ["windows-x64"],
            dependencies: [],
            permissions: [],
            releaseUrl: `${REPO_URL}/releases/tag/v1.0.0`,
            artifact: {
              mediaType: "application/java-archive",
              fileName: "mesh-helper-1.0.0.jar",
              url: `${REPO_URL}/releases/download/v1.0.0/mesh-helper-1.0.0.jar`,
              sha256: "0".repeat(64),
              descriptorSha256: "1".repeat(64),
              size: 123,
            },
          },
        ],
      },
    ],
  };
  const existingOwnership = {
    format: OWNERSHIP_FORMAT,
    schemaVersion: OWNERSHIP_SCHEMA_VERSION,
    claims: {
      "com.acme.mesh-helper": {
        slug: "mesh-helper",
        ownerGithubId: 4242,
        ownerLogin: "acme-bot",
        repoId: 8888,
        repository: REPO_URL,
        claimedAt: PUBLISHED_AT,
      },
    },
  };
  assert.equal(
    runSubmissionPreflight({
      ...baseArgs,
      jarPathOrBytes: makeZip(buildPluginJarEntries()),
      catalog: existingCatalog,
      ownership: existingOwnership,
    }).ok,
    false,
  );
});
