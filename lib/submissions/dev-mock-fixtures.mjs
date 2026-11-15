// Controlled non-production fixtures for exercising the third-party submission
// pipeline before GitHub OAuth or App secrets are provisioned.
import { crc32 } from "node:zlib";
import { SUBMISSION_FORMAT } from "./preflight.mjs";

export const DEV_MOCK_USER = Object.freeze({
  githubId: 900001,
  login: "demo-plugin-author",
  name: "Demo Plugin Author",
  avatarUrl: "https://avatars.githubusercontent.com/u/900001",
});

export const DEV_MOCK_REPO_OWNER = "demo-plugin-author";
export const DEV_MOCK_REPO_NAME = "turboism-mesh-inspector";
export const DEV_MOCK_REPO_FULL_NAME = `${DEV_MOCK_REPO_OWNER}/${DEV_MOCK_REPO_NAME}`;
export const DEV_MOCK_REPO_ID = 910001;
export const DEV_MOCK_REPO_URL = `https://github.com/${DEV_MOCK_REPO_FULL_NAME}`;
export const DEV_MOCK_DEFAULT_BRANCH = "main";
export const DEV_MOCK_PLUGIN_ID = "com.example.mesh-inspector";
export const DEV_MOCK_PLUGIN_SLUG = "mesh-inspector";
export const DEV_MOCK_PLUGIN_VERSION = "1.0.0";
export const DEV_MOCK_RELEASE_TAG = `v${DEV_MOCK_PLUGIN_VERSION}`;
export const DEV_MOCK_ASSET_FILE_NAME = `${DEV_MOCK_PLUGIN_SLUG}-${DEV_MOCK_PLUGIN_VERSION}.jar`;
export const DEV_MOCK_RELEASE_URL = `${DEV_MOCK_REPO_URL}/releases/tag/${DEV_MOCK_RELEASE_TAG}`;
export const DEV_MOCK_ARTIFACT_URL = `${DEV_MOCK_REPO_URL}/releases/download/${DEV_MOCK_RELEASE_TAG}/${DEV_MOCK_ASSET_FILE_NAME}`;
export const DEV_MOCK_PUBLISHED_AT = "2026-10-01T12:00:00Z";
export const DEV_MOCK_SOURCE_REVISION = "1".repeat(40);

const ZIP_LOCAL_HEADER_SIZE = 30;
const ZIP_CENTRAL_HEADER_SIZE = 46;
const ZIP_EOCD_SIZE = 22;
const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_VERSION_NEEDED = 20;
const ZIP_METHOD_STORED = 0;

const CLASS_MAGIC = 0xcafebabe;
const CLASS_MAJOR_JAVA_21 = 65;
const CLASS_PUBLIC_SUPER_FLAGS = 0x0021;
const CP_TAG_UTF8 = 1;
const CP_TAG_CLASS = 7;
const CP_TAG_METHODREF = 10;
const CP_TAG_NAME_AND_TYPE = 12;

const DEMO_REPOSITORY = Object.freeze({
  id: DEV_MOCK_REPO_ID,
  name: DEV_MOCK_REPO_NAME,
  fullName: DEV_MOCK_REPO_FULL_NAME,
  htmlUrl: DEV_MOCK_REPO_URL,
  description: "Sample third-party Turboism plugin repository for local preview verification.",
  defaultBranch: DEV_MOCK_DEFAULT_BRANCH,
  private: false,
  archived: false,
  disabled: false,
  updatedAt: DEV_MOCK_PUBLISHED_AT,
  owner: Object.freeze({
    id: DEV_MOCK_USER.githubId,
    login: DEV_MOCK_USER.login,
    type: "User",
  }),
  isMock: true,
});

const DEMO_RELEASE = Object.freeze({
  id: 920001,
  tagName: DEV_MOCK_RELEASE_TAG,
  name: `Mesh Inspector ${DEV_MOCK_PLUGIN_VERSION}`,
  htmlUrl: DEV_MOCK_RELEASE_URL,
  prerelease: false,
  channel: "stable",
  publishedAt: DEV_MOCK_PUBLISHED_AT,
  sourceRevision: DEV_MOCK_SOURCE_REVISION,
  isMock: true,
  assets: Object.freeze([
    Object.freeze({
      id: 930001,
      name: DEV_MOCK_ASSET_FILE_NAME,
      size: 0,
      contentType: "application/java-archive",
      browserDownloadUrl: DEV_MOCK_ARTIFACT_URL,
    }),
  ]),
});

let cachedJarBytes = null;

function buildStoredZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const dataBytes = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const checksum = crc32(dataBytes) >>> 0;

    const local = Buffer.alloc(ZIP_LOCAL_HEADER_SIZE);
    local.writeUInt32LE(ZIP_LOCAL_SIG, 0);
    local.writeUInt16LE(ZIP_VERSION_NEEDED, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(ZIP_METHOD_STORED, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(dataBytes.byteLength, 18);
    local.writeUInt32LE(dataBytes.byteLength, 22);
    local.writeUInt16LE(nameBytes.byteLength, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, dataBytes);

    const central = Buffer.alloc(ZIP_CENTRAL_HEADER_SIZE);
    central.writeUInt32LE(ZIP_CENTRAL_SIG, 0);
    central.writeUInt16LE(ZIP_VERSION_NEEDED, 4);
    central.writeUInt16LE(ZIP_VERSION_NEEDED, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(ZIP_METHOD_STORED, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(dataBytes.byteLength, 20);
    central.writeUInt32LE(dataBytes.byteLength, 24);
    central.writeUInt16LE(nameBytes.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);

    offset += ZIP_LOCAL_HEADER_SIZE + nameBytes.byteLength + dataBytes.byteLength;
  }

  const localBuffer = Buffer.concat(localParts);
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(ZIP_EOCD_SIZE);
  eocd.writeUInt32LE(ZIP_EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.byteLength, 12);
  eocd.writeUInt32LE(localBuffer.byteLength, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localBuffer, centralBuffer, eocd]);
}

function buildDemoClassBytes() {
  const cpEntries = [];
  const addEntry = (buf) => {
    cpEntries.push(buf);
    return cpEntries.length;
  };
  const addUtf8 = (text) => {
    const strBuf = Buffer.from(text, "utf8");
    const header = Buffer.alloc(3);
    header.writeUInt8(CP_TAG_UTF8, 0);
    header.writeUInt16BE(strBuf.byteLength, 1);
    return addEntry(Buffer.concat([header, strBuf]));
  };
  const addClass = (internalName) => {
    const nameIdx = addUtf8(internalName);
    const buf = Buffer.alloc(3);
    buf.writeUInt8(CP_TAG_CLASS, 0);
    buf.writeUInt16BE(nameIdx, 1);
    return addEntry(buf);
  };
  const addNameAndType = (name, descriptor) => {
    const nameIdx = addUtf8(name);
    const descIdx = addUtf8(descriptor);
    const buf = Buffer.alloc(5);
    buf.writeUInt8(CP_TAG_NAME_AND_TYPE, 0);
    buf.writeUInt16BE(nameIdx, 1);
    buf.writeUInt16BE(descIdx, 3);
    return addEntry(buf);
  };
  const addMethodRef = (owner, name, descriptor) => {
    const classIdx = addClass(owner);
    const natIdx = addNameAndType(name, descriptor);
    const buf = Buffer.alloc(5);
    buf.writeUInt8(CP_TAG_METHODREF, 0);
    buf.writeUInt16BE(classIdx, 1);
    buf.writeUInt16BE(natIdx, 3);
    return addEntry(buf);
  };

  const thisClassIdx = addClass("com/example/meshinspector/MeshInspectorPlugin");
  const superClassIdx = addClass("java/lang/Object");
  addMethodRef("java/net/http/HttpClient", "newHttpClient", "()Ljava/net/http/HttpClient;");

  const header = Buffer.alloc(10);
  header.writeUInt32BE(CLASS_MAGIC, 0);
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(CLASS_MAJOR_JAVA_21, 6);
  header.writeUInt16BE(cpEntries.length + 1, 8);

  const body = Buffer.alloc(14);
  body.writeUInt16BE(CLASS_PUBLIC_SUPER_FLAGS, 0);
  body.writeUInt16BE(thisClassIdx, 2);
  body.writeUInt16BE(superClassIdx, 4);
  body.writeUInt16BE(0, 6);
  body.writeUInt16BE(0, 8);
  body.writeUInt16BE(0, 10);
  body.writeUInt16BE(0, 12);

  return Buffer.concat([header, ...cpEntries, body]);
}

/**
 * Generates an in-memory compliant third-party plugin JAR for non-production preview runs.
 * @returns {Buffer}
 */
export function buildDevMockJarBytes() {
  if (cachedJarBytes !== null) {
    return cachedJarBytes;
  }
  const descriptor = {
    format: "turboism.plugin.meta",
    schemaVersion: 3,
    id: DEV_MOCK_PLUGIN_ID,
    name: "Mesh Inspector",
    version: DEV_MOCK_PLUGIN_VERSION,
    description: "Inspect ArtMesh geometry density and UV bounds in real time.",
    entrypoints: ["com.example.meshinspector.MeshInspectorPlugin"],
    turboismApi: "[0.67.0,)",
    authors: [{ name: "Demo Plugin Author" }],
    license: "MIT",
    website: DEV_MOCK_REPO_URL,
    resources: ["assets/mesh-inspector/"],
    i18n: {
      baseName: "assets/mesh-inspector/messages",
      locales: ["zh_Hans", "ja", "ko"],
    },
    dependencies: [],
    permissions: [
      {
        id: "turboism.network.fetch",
        scope: "user",
        reason: "Fetch shared mesh inspection presets when requested by the user.",
      },
    ],
    environment: {
      requiresCubism: true,
      ui: "swing",
    },
    lifecycle: {
      hotReload: true,
    },
    category: "analysis",
    tags: ["mesh", "inspector"],
  };

  const cubismSidecar = {
    format: "turboism.plugin-cubism-versions/v1",
    plugin: DEV_MOCK_PLUGIN_ID,
    supportedVersions: ["5.3.00", "5.3.02"],
  };

  cachedJarBytes = buildStoredZipBuffer([
    { name: "META-INF/MANIFEST.MF", data: "Manifest-Version: 1.0\r\n\r\n" },
    { name: "META-INF/turboism/plugin.json", data: JSON.stringify(descriptor, null, 2) },
    { name: "META-INF/turboism/cubism-versions.json", data: JSON.stringify(cubismSidecar, null, 2) },
    { name: "com/example/meshinspector/MeshInspectorPlugin.class", data: buildDemoClassBytes() },
    {
      name: "assets/mesh-inspector/messages.properties",
      data: "plugin.name=Mesh Inspector\nplugin.description=Inspect ArtMesh geometry density and UV bounds in real time.\n",
    },
    {
      name: "assets/mesh-inspector/messages_zh_Hans.properties",
      data: "plugin.name=网格检查器\nplugin.description=实时检查 ArtMesh 几何密度与 UV 边界。\n",
    },
    {
      name: "assets/mesh-inspector/messages_ja.properties",
      data: "plugin.name=メッシュインスペクター\nplugin.description=ArtMesh のジオメトリ密度と UV 境界をリアルタイムで確認します。\n",
    },
    {
      name: "assets/mesh-inspector/messages_ko.properties",
      data: "plugin.name=메시 검사기\nplugin.description=ArtMesh 지오메트리 밀도와 UV 경계를 실시간으로 검사합니다.\n",
    },
    {
      name: "META-INF/turboism/readme/README.md",
      data: "# Mesh Inspector\n\nInspect ArtMesh geometry density and UV bounds.\n",
    },
    {
      name: "META-INF/turboism/readme/README_zh.md",
      data: "# 网格检查器\n\n实时检查 ArtMesh 几何密度与 UV 边界。\n",
    },
  ]);
  return cachedJarBytes;
}

/**
 * Returns the controlled developer profile used when mock auth is active.
 */
export function getDevMockUser() {
  return { ...DEV_MOCK_USER };
}

/**
 * Checks whether a repository full name matches the built-in preview fixture.
 * @param {string} fullName
 * @returns {boolean}
 */
export function isDevMockRepository(fullName) {
  return typeof fullName === "string" && fullName.trim().toLowerCase() === DEV_MOCK_REPO_FULL_NAME.toLowerCase();
}

/**
 * Returns the demo repository record when fullName matches, or null.
 * @param {string} fullName
 */
export function getDevMockRepositoryByFullName(fullName) {
  if (!isDevMockRepository(fullName)) return null;
  return structuredClone(DEMO_REPOSITORY);
}

/**
 * Lists built-in demo repositories for non-production preview sessions.
 */
export function getDevMockRepositories() {
  return [structuredClone(DEMO_REPOSITORY)];
}

/**
 * Lists eligible releases for the built-in demo repository.
 * @param {string} fullName
 */
export function getDevMockReleases(fullName) {
  if (!isDevMockRepository(fullName)) return [];
  const jarBytes = buildDevMockJarBytes();
  const release = structuredClone(DEMO_RELEASE);
  release.assets[0].size = jarBytes.byteLength;
  return [release];
}

/**
 * Builds a simulated PR preview object when GitHub App credentials are absent in dev mock mode.
 * @param {{ manifest: object, directoryRepo: string, baseBranch: string, title: string, body: string, labels: string[], branchName: string, filePath: string }} params
 */
export function buildDevMockSimulatedPr({
  manifest,
  directoryRepo,
  baseBranch,
  title,
  body,
  labels,
  branchName,
  filePath,
}) {
  if (!manifest || manifest.format !== SUBMISSION_FORMAT) {
    throw new Error("Simulated PR requires a validated SubmissionManifest.");
  }
  return {
    simulated: true,
    directoryRepo,
    baseBranch,
    branchName,
    filePath,
    title,
    body,
    labels: [...labels],
    pluginId: manifest.plugin.id,
    slug: manifest.plugin.slug,
    version: manifest.release.version,
  };
}
