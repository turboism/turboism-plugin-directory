import type { BytecodeAuditReport } from "./bytecode-scan.d.mts";
import type { OwnershipRegistry } from "./ownership.d.mts";

export const SUBMISSION_FORMAT: "turboism.plugin.submission";
export const SUBMISSION_SCHEMA_VERSION: 1;
export const REVIEWED_THIRD_PARTY_TRUST: "reviewed-third-party";

export interface PreflightIssue {
  path: string;
  message: string;
}

export interface SubmissionSubmitterInput {
  githubId: number;
  login: string;
  name?: string;
  verificationReason?: "repo_owner" | "org_public_member" | "publishers_manifest";
}

export interface SubmissionRepositoryInput {
  id: number;
  url: string;
  releaseTag: string;
  fullName?: string;
  defaultBranch?: string;
}

export interface SubmissionPreflightInput {
  jarPathOrBytes: string | Buffer | Uint8Array;
  slug: string;
  assetFileName: string;
  artifactUrl: string;
  releaseUrl: string;
  channel?: "stable" | "preview";
  publishedAt: string;
  sourceRevision: string;
  submitter: SubmissionSubmitterInput;
  repository: SubmissionRepositoryInput;
  catalog: { plugins: Array<Record<string, unknown>> };
  ownership: OwnershipRegistry;
  repoReadmes?: Partial<Record<"en" | "zh" | "ja" | "ko", string>>;
  submittedAt?: string;
}

export interface SubmissionManifest {
  format: "turboism.plugin.submission";
  schemaVersion: 1;
  submittedAt: string;
  submitter: {
    githubId: number;
    login: string;
    name: string;
    verificationReason: string;
  };
  repository: {
    id: number;
    fullName: string;
    url: string;
    defaultBranch: string;
    releaseTag: string;
    releaseUrl: string;
    sourceRevision: string;
    publishedAt: string;
  };
  plugin: Record<string, unknown>;
  release: Record<string, unknown>;
  bytecodeAudit: BytecodeAuditReport;
  readmes: Partial<Record<"en" | "zh" | "ja" | "ko", string>>;
}

export type SubmissionPreflightResult =
  | { ok: true; manifest: SubmissionManifest; isFirstClaim: boolean }
  | { ok: false; errors: PreflightIssue[] };

export type ValidateSubmissionManifestResult =
  | { ok: true; manifest: SubmissionManifest }
  | { ok: false; errors: PreflightIssue[] };

export function parseJavaProperties(content: string): Record<string, string>;
export function validateSubmissionManifest(manifest: unknown): ValidateSubmissionManifestResult;
export function runSubmissionPreflight(input: SubmissionPreflightInput): SubmissionPreflightResult;
