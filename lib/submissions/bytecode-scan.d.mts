export type CapabilityCategory =
  | "process_execution"
  | "network_io"
  | "filesystem_io"
  | "native_or_unsafe"
  | "dynamic_loading_or_reflection";

export type BytecodeRiskLevel = "low" | "medium" | "high";

export const CAPABILITY_CATEGORIES: Readonly<{
  PROCESS_EXECUTION: "process_execution";
  NETWORK_IO: "network_io";
  FILESYSTEM_IO: "filesystem_io";
  NATIVE_OR_UNSAFE: "native_or_unsafe";
  DYNAMIC_LOADING_OR_REFLECTION: "dynamic_loading_or_reflection";
}>;

export const RISK_LEVELS: Readonly<{
  LOW: "low";
  MEDIUM: "medium";
  HIGH: "high";
}>;

export interface BytecodeFinding {
  category: CapabilityCategory;
  className: string;
  symbol: string;
  declaredPermissionMatched: boolean;
}

export interface ClassScanResult {
  className: string;
  findings: BytecodeFinding[];
}

export interface BytecodeAuditReport {
  scannedClassCount: number;
  riskLevel: BytecodeRiskLevel;
  undeclaredCapabilities: CapabilityCategory[];
  findings: BytecodeFinding[];
}

export type DeclaredPermissionInput = string | { id: string };

export function scanClassBytes(
  classBytes: Buffer | Uint8Array,
  entryName?: string,
  declaredPermissions?: readonly DeclaredPermissionInput[],
): ClassScanResult;

export function scanJarBytecode(
  jarPathOrBytes: string | Buffer | Uint8Array,
  declaredPermissions?: readonly DeclaredPermissionInput[],
): BytecodeAuditReport;

export function formatBytecodeAuditMarkdown(report: BytecodeAuditReport): string;
