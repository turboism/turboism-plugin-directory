// Pure JavaScript JVM .class constant-pool and method-flag static scanner for plugin JARs.
// Detects sensitive runtime capabilities and compares them against declared plugin.json permissions.
import { closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { MAX_ARTIFACT_SIZE, MAX_JAR_ENTRIES } from "../catalog-v2/catalog.mjs";

const CLASS_MAGIC = 0xcafebabe;
const ACC_NATIVE = 0x0100;
const MIN_CLASS_BYTES = 10;
const MAX_CLASS_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_CLASS_BYTES = 32 * 1024 * 1024;

const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_EOCD_SIZE = 22;
const ZIP_EOCD_MAX_SEARCH = 65557;
const ZIP_METHOD_STORED = 0;
const ZIP_METHOD_DEFLATE = 8;

const CP_TAG_UTF8 = 1;
const CP_TAG_INTEGER = 3;
const CP_TAG_FLOAT = 4;
const CP_TAG_LONG = 5;
const CP_TAG_DOUBLE = 6;
const CP_TAG_CLASS = 7;
const CP_TAG_STRING = 8;
const CP_TAG_FIELDREF = 9;
const CP_TAG_METHODREF = 10;
const CP_TAG_INTERFACE_METHODREF = 11;
const CP_TAG_NAME_AND_TYPE = 12;
const CP_TAG_METHOD_HANDLE = 15;
const CP_TAG_METHOD_TYPE = 16;
const CP_TAG_DYNAMIC = 17;
const CP_TAG_INVOKE_DYNAMIC = 18;
const CP_TAG_MODULE = 19;
const CP_TAG_PACKAGE = 20;

const FIXED_CP_TAG_SIZES = Object.freeze({
  [CP_TAG_INTEGER]: 4,
  [CP_TAG_FLOAT]: 4,
  [CP_TAG_CLASS]: 2,
  [CP_TAG_STRING]: 2,
  [CP_TAG_FIELDREF]: 4,
  [CP_TAG_METHODREF]: 4,
  [CP_TAG_INTERFACE_METHODREF]: 4,
  [CP_TAG_NAME_AND_TYPE]: 4,
  [CP_TAG_METHOD_HANDLE]: 3,
  [CP_TAG_METHOD_TYPE]: 2,
  [CP_TAG_DYNAMIC]: 4,
  [CP_TAG_INVOKE_DYNAMIC]: 4,
  [CP_TAG_MODULE]: 2,
  [CP_TAG_PACKAGE]: 2,
});

export const CAPABILITY_CATEGORIES = Object.freeze({
  PROCESS_EXECUTION: "process_execution",
  NETWORK_IO: "network_io",
  FILESYSTEM_IO: "filesystem_io",
  NATIVE_OR_UNSAFE: "native_or_unsafe",
  DYNAMIC_LOADING_OR_REFLECTION: "dynamic_loading_or_reflection",
});

export const RISK_LEVELS = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
});

const PERMISSION_PROCESS_RUN = "turboism.process.run";
const PERMISSION_NETWORK_FETCH = "turboism.network.fetch";
const PERMISSION_FILE_READ = "turboism.file.read";
const PERMISSION_FILE_WRITE = "turboism.file.write";
const PERMISSION_HOST_UNSAFE = "turboism.host.unsafe";

const FILES_WRITE_METHODS = new Set([
  "write",
  "writeString",
  "delete",
  "deleteIfExists",
  "move",
  "copy",
  "createDirectory",
  "createDirectories",
  "createFile",
  "createTempFile",
  "createTempDirectory",
  "newOutputStream",
  "newBufferedWriter",
  "setAttribute",
  "setPosixFilePermissions",
  "setLastModifiedTime",
  "setOwner",
  "createLink",
  "createSymbolicLink",
]);

const SYSTEM_NATIVE_LOAD_METHODS = new Set(["load", "loadLibrary"]);
const RUNTIME_PROCESS_METHODS = new Set(["exec"]);
const URL_NETWORK_METHODS = new Set(["openConnection", "openStream"]);
const CLASS_REFLECTION_METHODS = new Set(["forName"]);

const CAPABILITY_RULES = Object.freeze([
  {
    category: CAPABILITY_CATEGORIES.PROCESS_EXECUTION,
    matchType: "exact",
    owner: "java/lang/ProcessBuilder",
    methods: null,
    permissions: Object.freeze([PERMISSION_PROCESS_RUN]),
  },
  {
    category: CAPABILITY_CATEGORIES.PROCESS_EXECUTION,
    matchType: "exact",
    owner: "java/lang/Runtime",
    methods: RUNTIME_PROCESS_METHODS,
    permissions: Object.freeze([PERMISSION_PROCESS_RUN]),
  },
  {
    category: CAPABILITY_CATEGORIES.NETWORK_IO,
    matchType: "prefix",
    owner: "java/net/http/",
    methods: null,
    permissions: Object.freeze([PERMISSION_NETWORK_FETCH]),
  },
  {
    category: CAPABILITY_CATEGORIES.NETWORK_IO,
    matchType: "exact",
    owner: "java/net/Socket",
    methods: null,
    permissions: Object.freeze([PERMISSION_NETWORK_FETCH]),
  },
  {
    category: CAPABILITY_CATEGORIES.NETWORK_IO,
    matchType: "exact",
    owner: "java/net/ServerSocket",
    methods: null,
    permissions: Object.freeze([PERMISSION_NETWORK_FETCH]),
  },
  {
    category: CAPABILITY_CATEGORIES.NETWORK_IO,
    matchType: "exact",
    owner: "java/net/URLConnection",
    methods: null,
    permissions: Object.freeze([PERMISSION_NETWORK_FETCH]),
  },
  {
    category: CAPABILITY_CATEGORIES.NETWORK_IO,
    matchType: "exact",
    owner: "java/net/HttpURLConnection",
    methods: null,
    permissions: Object.freeze([PERMISSION_NETWORK_FETCH]),
  },
  {
    category: CAPABILITY_CATEGORIES.NETWORK_IO,
    matchType: "prefix",
    owner: "javax/net/ssl/",
    methods: null,
    permissions: Object.freeze([PERMISSION_NETWORK_FETCH]),
  },
  {
    category: CAPABILITY_CATEGORIES.NETWORK_IO,
    matchType: "exact",
    owner: "java/net/URL",
    methods: URL_NETWORK_METHODS,
    permissions: Object.freeze([PERMISSION_NETWORK_FETCH]),
  },
  {
    category: CAPABILITY_CATEGORIES.FILESYSTEM_IO,
    matchType: "exact",
    owner: "java/nio/file/Files",
    methods: null,
    permissions: Object.freeze([PERMISSION_FILE_READ, PERMISSION_FILE_WRITE]),
  },
  {
    category: CAPABILITY_CATEGORIES.FILESYSTEM_IO,
    matchType: "exact",
    owner: "java/io/FileOutputStream",
    methods: null,
    permissions: Object.freeze([PERMISSION_FILE_WRITE]),
  },
  {
    category: CAPABILITY_CATEGORIES.FILESYSTEM_IO,
    matchType: "exact",
    owner: "java/io/FileWriter",
    methods: null,
    permissions: Object.freeze([PERMISSION_FILE_WRITE]),
  },
  {
    category: CAPABILITY_CATEGORIES.FILESYSTEM_IO,
    matchType: "exact",
    owner: "java/io/RandomAccessFile",
    methods: null,
    permissions: Object.freeze([PERMISSION_FILE_READ, PERMISSION_FILE_WRITE]),
  },
  {
    category: CAPABILITY_CATEGORIES.NATIVE_OR_UNSAFE,
    matchType: "exact",
    owner: "sun/misc/Unsafe",
    methods: null,
    permissions: Object.freeze([PERMISSION_HOST_UNSAFE]),
  },
  {
    category: CAPABILITY_CATEGORIES.NATIVE_OR_UNSAFE,
    matchType: "exact",
    owner: "jdk/internal/misc/Unsafe",
    methods: null,
    permissions: Object.freeze([PERMISSION_HOST_UNSAFE]),
  },
  {
    category: CAPABILITY_CATEGORIES.NATIVE_OR_UNSAFE,
    matchType: "prefix",
    owner: "java/lang/foreign/",
    methods: null,
    permissions: Object.freeze([PERMISSION_HOST_UNSAFE]),
  },
  {
    category: CAPABILITY_CATEGORIES.NATIVE_OR_UNSAFE,
    matchType: "exact",
    owner: "java/lang/System",
    methods: SYSTEM_NATIVE_LOAD_METHODS,
    permissions: Object.freeze([PERMISSION_HOST_UNSAFE]),
  },
  {
    category: CAPABILITY_CATEGORIES.DYNAMIC_LOADING_OR_REFLECTION,
    matchType: "exact",
    owner: "java/net/URLClassLoader",
    methods: null,
    permissions: Object.freeze([PERMISSION_HOST_UNSAFE]),
  },
  {
    category: CAPABILITY_CATEGORIES.DYNAMIC_LOADING_OR_REFLECTION,
    matchType: "exact",
    owner: "java/lang/ClassLoader",
    methods: null,
    permissions: Object.freeze([PERMISSION_HOST_UNSAFE]),
  },
  {
    category: CAPABILITY_CATEGORIES.DYNAMIC_LOADING_OR_REFLECTION,
    matchType: "prefix",
    owner: "java/lang/reflect/",
    methods: null,
    permissions: Object.freeze([PERMISSION_HOST_UNSAFE]),
  },
  {
    category: CAPABILITY_CATEGORIES.DYNAMIC_LOADING_OR_REFLECTION,
    matchType: "exact",
    owner: "java/lang/invoke/MethodHandles$Lookup",
    methods: null,
    permissions: Object.freeze([PERMISSION_HOST_UNSAFE]),
  },
  {
    category: CAPABILITY_CATEGORIES.DYNAMIC_LOADING_OR_REFLECTION,
    matchType: "prefix",
    owner: "javax/script/",
    methods: null,
    permissions: Object.freeze([PERMISSION_HOST_UNSAFE]),
  },
  {
    category: CAPABILITY_CATEGORIES.DYNAMIC_LOADING_OR_REFLECTION,
    matchType: "exact",
    owner: "java/lang/Class",
    methods: CLASS_REFLECTION_METHODS,
    permissions: Object.freeze([PERMISSION_HOST_UNSAFE]),
  },
]);

class ClassReader {
  constructor(bytes, label) {
    this.bytes = bytes;
    this.label = label;
    this.offset = 0;
  }

  ensure(length) {
    if (this.offset + length > this.bytes.byteLength) {
      throw new Error(`Truncated class file "${this.label}" at byte ${this.offset}.`);
    }
  }

  u1() {
    this.ensure(1);
    const value = this.bytes.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  u2() {
    this.ensure(2);
    const value = this.bytes.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  u4() {
    this.ensure(4);
    const value = this.bytes.readUInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  skip(length) {
    this.ensure(length);
    this.offset += length;
  }

  utf8(length) {
    this.ensure(length);
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice.toString("utf8");
  }
}

function normalizeDeclaredPermissions(declaredPermissions) {
  const set = new Set();
  if (!Array.isArray(declaredPermissions)) return set;
  for (const item of declaredPermissions) {
    if (typeof item === "string" && item.length > 0) {
      set.add(item);
    } else if (typeof item === "object" && item !== null && typeof item.id === "string" && item.id.length > 0) {
      set.add(item.id);
    }
  }
  return set;
}

function resolveUtf8(pool, index) {
  const entry = pool[index];
  if (!entry || entry.tag !== CP_TAG_UTF8) return null;
  return entry.value;
}

function resolveClassName(pool, classIndex) {
  const entry = pool[classIndex];
  if (!entry || entry.tag !== CP_TAG_CLASS) return null;
  return resolveUtf8(pool, entry.nameIndex);
}

function resolveNameAndType(pool, index) {
  const entry = pool[index];
  if (!entry || entry.tag !== CP_TAG_NAME_AND_TYPE) return null;
  const name = resolveUtf8(pool, entry.nameIndex);
  const descriptor = resolveUtf8(pool, entry.descriptorIndex);
  if (name === null || descriptor === null) return null;
  return { name, descriptor };
}

function requiredPermissionsForFinding(rule, memberName) {
  if (rule.owner === "java/nio/file/Files" && memberName !== null) {
    if (FILES_WRITE_METHODS.has(memberName)) {
      return [PERMISSION_FILE_WRITE];
    }
  }
  if (rule.owner === "java/io/RandomAccessFile") {
    return [PERMISSION_FILE_WRITE];
  }
  return rule.permissions;
}

function matchesRule(rule, owner, memberName) {
  if (rule.matchType === "prefix") {
    if (!owner.startsWith(rule.owner)) return false;
  } else if (owner !== rule.owner) {
    return false;
  }
  if (rule.methods !== null) {
    return memberName !== null && rule.methods.has(memberName);
  }
  return true;
}

/**
 * Parses a JVM .class buffer, extracts sensitive constant-pool references and ACC_NATIVE methods,
 * and evaluates them against declared plugin.json permission identifiers.
 * @param {Buffer | Uint8Array} classBytes
 * @param {string} [entryName]
 * @param {Array<string | { id: string }>} [declaredPermissions]
 * @returns {{ className: string, findings: Array<{ category: string, className: string, symbol: string, declaredPermissionMatched: boolean }> }}
 */
export function scanClassBytes(classBytes, entryName = "<class>", declaredPermissions = []) {
  const bytes = Buffer.isBuffer(classBytes) ? classBytes : Buffer.from(classBytes);
  if (bytes.byteLength < MIN_CLASS_BYTES || bytes.byteLength > MAX_CLASS_BYTES) {
    throw new Error(`Invalid class size for "${entryName}": ${bytes.byteLength} bytes.`);
  }
  const reader = new ClassReader(bytes, entryName);
  const magic = reader.u4();
  if (magic !== CLASS_MAGIC) {
    throw new Error(`Invalid JVM class magic in "${entryName}".`);
  }
  reader.u2(); // minor_version
  reader.u2(); // major_version
  const cpCount = reader.u2();
  if (cpCount < 1) {
    throw new Error(`Invalid constant pool count in "${entryName}".`);
  }

  const pool = new Array(cpCount).fill(null);
  for (let i = 1; i < cpCount; i += 1) {
    const tag = reader.u1();
    if (tag === CP_TAG_UTF8) {
      const length = reader.u2();
      pool[i] = { tag, value: reader.utf8(length) };
      continue;
    }
    if (tag === CP_TAG_LONG || tag === CP_TAG_DOUBLE) {
      reader.skip(8);
      pool[i] = { tag };
      // JVMS 4.4.5: Long and Double constants occupy two constant-pool slots.
      i += 1;
      if (i >= cpCount) {
        throw new Error(`Two-slot constant exceeds pool bounds in "${entryName}".`);
      }
      continue;
    }
    if (tag === CP_TAG_CLASS) {
      pool[i] = { tag, nameIndex: reader.u2() };
      continue;
    }
    if (tag === CP_TAG_FIELDREF || tag === CP_TAG_METHODREF || tag === CP_TAG_INTERFACE_METHODREF) {
      pool[i] = { tag, classIndex: reader.u2(), nameAndTypeIndex: reader.u2() };
      continue;
    }
    if (tag === CP_TAG_NAME_AND_TYPE) {
      pool[i] = { tag, nameIndex: reader.u2(), descriptorIndex: reader.u2() };
      continue;
    }
    const fixedSize = FIXED_CP_TAG_SIZES[tag];
    if (fixedSize === undefined) {
      throw new Error(`Unsupported constant pool tag ${tag} in "${entryName}".`);
    }
    reader.skip(fixedSize);
    pool[i] = { tag };
  }

  reader.u2(); // access_flags
  const thisClassIndex = reader.u2();
  const className = resolveClassName(pool, thisClassIndex) ?? entryName.replace(/\.class$/, "");
  reader.u2(); // super_class

  const interfacesCount = reader.u2();
  reader.skip(interfacesCount * 2);

  const fieldsCount = reader.u2();
  for (let i = 0; i < fieldsCount; i += 1) {
    reader.u2();
    reader.u2();
    reader.u2();
    const attrCount = reader.u2();
    for (let a = 0; a < attrCount; a += 1) {
      reader.u2();
      const attrLen = reader.u4();
      reader.skip(attrLen);
    }
  }

  const nativeMethodSymbols = [];
  const methodsCount = reader.u2();
  for (let i = 0; i < methodsCount; i += 1) {
    const accessFlags = reader.u2();
    const nameIndex = reader.u2();
    const descriptorIndex = reader.u2();
    if ((accessFlags & ACC_NATIVE) !== 0) {
      const methodName = resolveUtf8(pool, nameIndex) ?? "<unknown>";
      const methodDesc = resolveUtf8(pool, descriptorIndex) ?? "";
      nativeMethodSymbols.push(`${className}.${methodName}${methodDesc}`);
    }
    const attrCount = reader.u2();
    for (let a = 0; a < attrCount; a += 1) {
      reader.u2();
      const attrLen = reader.u4();
      reader.skip(attrLen);
    }
  }

  const permissionSet = normalizeDeclaredPermissions(declaredPermissions);
  const findings = [];
  const seenKeys = new Set();
  const ownersWithMemberFindings = new Set();

  const addFinding = (category, symbol, requiredPermissions) => {
    const key = `${category}\u0000${className}\u0000${symbol}`;
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const declaredPermissionMatched = requiredPermissions.some((perm) => permissionSet.has(perm));
    findings.push({ category, className, symbol, declaredPermissionMatched });
  };

  for (const symbol of nativeMethodSymbols) {
    addFinding(CAPABILITY_CATEGORIES.NATIVE_OR_UNSAFE, symbol, [PERMISSION_HOST_UNSAFE]);
  }

  for (let i = 1; i < cpCount; i += 1) {
    const entry = pool[i];
    if (!entry) continue;
    if (
      entry.tag === CP_TAG_METHODREF ||
      entry.tag === CP_TAG_INTERFACE_METHODREF ||
      entry.tag === CP_TAG_FIELDREF
    ) {
      const owner = resolveClassName(pool, entry.classIndex);
      const nameAndType = resolveNameAndType(pool, entry.nameAndTypeIndex);
      if (!owner || !nameAndType) continue;
      for (const rule of CAPABILITY_RULES) {
        if (matchesRule(rule, owner, nameAndType.name)) {
          ownersWithMemberFindings.add(owner);
          addFinding(
            rule.category,
            `${owner}.${nameAndType.name}`,
            requiredPermissionsForFinding(rule, nameAndType.name),
          );
        }
      }
    }
  }

  for (let i = 1; i < cpCount; i += 1) {
    const entry = pool[i];
    if (!entry || entry.tag !== CP_TAG_CLASS || i === thisClassIndex) continue;
    const owner = resolveUtf8(pool, entry.nameIndex);
    if (!owner || ownersWithMemberFindings.has(owner)) continue;
    for (const rule of CAPABILITY_RULES) {
      if (matchesRule(rule, owner, null)) {
        addFinding(rule.category, owner, requiredPermissionsForFinding(rule, null));
      }
    }
  }

  return { className, findings };
}

function findZipEocd(bytes) {
  const size = bytes.byteLength;
  const start = Math.max(0, size - ZIP_EOCD_MAX_SEARCH);
  for (let i = size - ZIP_EOCD_SIZE; i >= start; i -= 1) {
    if (bytes.readUInt32LE(i) !== ZIP_EOCD_SIG) continue;
    const commentLen = bytes.readUInt16LE(i + 20);
    if (i + ZIP_EOCD_SIZE + commentLen !== size) continue;
    if (i >= 20 && bytes.readUInt32LE(i - 20) === 0x07064b50) return null;
    return i;
  }
  return null;
}

function readJarBuffer(jarPathOrBytes) {
  if (Buffer.isBuffer(jarPathOrBytes)) {
    if (jarPathOrBytes.byteLength > MAX_ARTIFACT_SIZE) {
      throw new Error(`JAR exceeds ${MAX_ARTIFACT_SIZE} bytes.`);
    }
    return jarPathOrBytes;
  }
  if (jarPathOrBytes instanceof Uint8Array) {
    if (jarPathOrBytes.byteLength > MAX_ARTIFACT_SIZE) {
      throw new Error(`JAR exceeds ${MAX_ARTIFACT_SIZE} bytes.`);
    }
    return Buffer.from(jarPathOrBytes);
  }
  const lstat = lstatSync(jarPathOrBytes);
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    throw new Error(`JAR path "${jarPathOrBytes}" must be a regular non-symlink file.`);
  }
  const fd = openSync(jarPathOrBytes, "r");
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile() || stats.size > MAX_ARTIFACT_SIZE) {
      throw new Error(`JAR size exceeds ${MAX_ARTIFACT_SIZE} bytes.`);
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function computeRiskLevel(findings, undeclaredCapabilities) {
  if (findings.length === 0) {
    return RISK_LEVELS.LOW;
  }
  const hasHighRiskCategory = findings.some(
    (finding) =>
      finding.category === CAPABILITY_CATEGORIES.PROCESS_EXECUTION ||
      finding.category === CAPABILITY_CATEGORIES.NATIVE_OR_UNSAFE,
  );
  if (hasHighRiskCategory) {
    return RISK_LEVELS.HIGH;
  }
  if (
    undeclaredCapabilities.includes(CAPABILITY_CATEGORIES.DYNAMIC_LOADING_OR_REFLECTION) ||
    undeclaredCapabilities.length >= 2
  ) {
    return RISK_LEVELS.HIGH;
  }
  return RISK_LEVELS.MEDIUM;
}

/**
 * Scans every .class entry inside a plugin JAR and builds a structured capability audit report.
 * @param {string | Buffer | Uint8Array} jarPathOrBytes
 * @param {Array<string | { id: string }>} [declaredPermissions]
 * @returns {{ scannedClassCount: number, riskLevel: "low" | "medium" | "high", undeclaredCapabilities: string[], findings: Array<{ category: string, className: string, symbol: string, declaredPermissionMatched: boolean }> }}
 */
export function scanJarBytecode(jarPathOrBytes, declaredPermissions = []) {
  const bytes = readJarBuffer(jarPathOrBytes);
  const eocd = findZipEocd(bytes);
  if (eocd === null) {
    throw new Error("Invalid JAR: missing end-of-central-directory record.");
  }
  const totalEntries = bytes.readUInt16LE(eocd + 10);
  const cdSize = bytes.readUInt32LE(eocd + 12);
  const cdOffset = bytes.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize !== eocd || totalEntries > MAX_JAR_ENTRIES) {
    throw new Error("Invalid JAR: malformed central directory.");
  }

  let offset = cdOffset;
  let totalDecompressedClassBytes = 0;
  let scannedClassCount = 0;
  const allFindings = [];

  for (let i = 0; i < totalEntries; i += 1) {
    if (offset + 46 > bytes.byteLength || bytes.readUInt32LE(offset) !== ZIP_CENTRAL_SIG) {
      throw new Error("Invalid JAR: malformed central directory entry.");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLen = bytes.readUInt16LE(offset + 28);
    const extraLen = bytes.readUInt16LE(offset + 30);
    const commentLen = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const nameStart = offset + 46;
    const name = bytes.toString("utf8", nameStart, nameStart + nameLen);
    offset = nameStart + nameLen + extraLen + commentLen;

    if (!name.endsWith(".class")) continue;
    if ((flags & 0x0001) !== 0) {
      throw new Error(`Encrypted class entry "${name}" is not allowed.`);
    }
    if (uncompressedSize > MAX_CLASS_BYTES) {
      throw new Error(`Class entry "${name}" exceeds ${MAX_CLASS_BYTES} bytes.`);
    }
    totalDecompressedClassBytes += uncompressedSize;
    if (totalDecompressedClassBytes > MAX_TOTAL_CLASS_BYTES) {
      throw new Error(`Total decompressed class bytes exceed ${MAX_TOTAL_CLASS_BYTES} bytes.`);
    }
    if (localOffset + 30 > bytes.byteLength || bytes.readUInt32LE(localOffset) !== ZIP_LOCAL_SIG) {
      throw new Error(`Malformed local header for "${name}".`);
    }
    const localNameLen = bytes.readUInt16LE(localOffset + 26);
    const localExtraLen = bytes.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > bytes.byteLength) {
      throw new Error(`Class entry "${name}" exceeds file bounds.`);
    }
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let classBytes;
    if (method === ZIP_METHOD_STORED) {
      classBytes = Buffer.from(compressed);
    } else if (method === ZIP_METHOD_DEFLATE) {
      classBytes = inflateRawSync(compressed, { maxOutputLength: MAX_CLASS_BYTES });
    } else {
      throw new Error(`Unsupported compression method ${method} for "${name}".`);
    }
    if (classBytes.byteLength !== uncompressedSize) {
      throw new Error(`Decompressed size mismatch for "${name}".`);
    }
    const scanned = scanClassBytes(classBytes, name, declaredPermissions);
    scannedClassCount += 1;
    allFindings.push(...scanned.findings);
  }

  allFindings.sort((a, b) => {
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    if (a.className !== b.className) return a.className < b.className ? -1 : 1;
    return a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0;
  });

  const undeclaredCapabilities = [
    ...new Set(
      allFindings
        .filter((finding) => !finding.declaredPermissionMatched)
        .map((finding) => finding.category),
    ),
  ].sort();

  const riskLevel = computeRiskLevel(allFindings, undeclaredCapabilities);

  return {
    scannedClassCount,
    riskLevel,
    undeclaredCapabilities,
    findings: allFindings,
  };
}

function escapeMarkdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/`/g, "\\`").replace(/\r?\n/g, " ");
}

/**
 * Formats a bytecode audit report as a Markdown summary and table for PR review.
 * @param {{ scannedClassCount: number, riskLevel: string, undeclaredCapabilities: string[], findings: Array<{ category: string, className: string, symbol: string, declaredPermissionMatched: boolean }> }} report
 * @returns {string}
 */
export function formatBytecodeAuditMarkdown(report) {
  const undeclaredLabel =
    report.undeclaredCapabilities.length > 0 ? report.undeclaredCapabilities.join(", ") : "none";
  const lines = [
    "### Bytecode Static Audit",
    "",
    `- **Scanned classes**: ${report.scannedClassCount}`,
    `- **Risk level**: \`${report.riskLevel}\``,
    `- **Undeclared capabilities**: ${undeclaredLabel}`,
    "",
  ];
  if (report.findings.length === 0) {
    lines.push("No sensitive JVM API references or native methods were detected.");
    return lines.join("\n");
  }
  lines.push("| Category | Class | Symbol | Declared Permission |");
  lines.push("|---|---|---|---|");
  for (const finding of report.findings) {
    const matched = finding.declaredPermissionMatched ? "yes" : "no";
    lines.push(
      `| \`${escapeMarkdownCell(finding.category)}\` | \`${escapeMarkdownCell(finding.className)}\` | \`${escapeMarkdownCell(finding.symbol)}\` | ${matched} |`,
    );
  }
  return lines.join("\n");
}
