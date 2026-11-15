export const OWNERSHIP_FORMAT: "turboism.plugin.ownership";
export const OWNERSHIP_SCHEMA_VERSION: 1;
export const PUBLISHERS_MANIFEST_PATH: ".github/turboism-publishers.json";
export const RESERVED_CORE_PLUGIN_ID: "dev.turboism.core";
export const RESERVED_TURBOISM_NAMESPACE_PREFIX: "dev.turboism.";
export const RETIRED_CLIENT_PLUGIN_IDS: readonly string[];
export const RESERVED_ROUTE_SLUGS: readonly string[];

export interface OwnershipClaim {
  slug: string;
  ownerGithubId: number;
  ownerLogin: string;
  repoId: number;
  repository: string;
  claimedAt: string;
}

export interface OwnershipRegistry {
  format: "turboism.plugin.ownership";
  schemaVersion: 1;
  claims: Record<string, OwnershipClaim>;
}

export interface OwnershipIssue {
  path: string;
  message: string;
}

export type ParseOwnershipResult =
  | { ok: true; registry: OwnershipRegistry }
  | { ok: false; errors: OwnershipIssue[] };

export interface NamespaceValidationInput {
  pluginId: string;
  slug: string;
  submitterGithubId: number;
  repoId: number;
  repositoryUrl: string;
  catalog: { plugins: Array<Record<string, unknown>> };
  ownership: OwnershipRegistry;
}

export type NamespaceValidationResult =
  | { ok: true; isFirstClaim: boolean; existingClaim: OwnershipClaim | null }
  | { ok: false; errors: OwnershipIssue[] };

export interface PublisherVerificationInput {
  submitter: {
    githubId: number;
    login: string;
  };
  repo: {
    private?: boolean;
    archived?: boolean;
    disabled?: boolean;
    owner?: {
      id?: number;
      type?: string;
      login?: string;
    };
  };
  isPublicOrgMember?: boolean;
  publishersFileContent?: string | Buffer | Uint8Array | null;
}

export type PublisherVerificationResult =
  | { ok: true; reason: "repo_owner" | "org_public_member" | "publishers_manifest" }
  | { ok: false; error: string };

export function isReservedOrRetiredPluginId(pluginId: string): boolean;
export function normalizeGitHubRepositoryUrl(rawUrl: unknown): string | null;
export function parseOwnershipRegistry(input: Buffer | Uint8Array | string | unknown): ParseOwnershipResult;
export function serializeOwnershipRegistry(registry: OwnershipRegistry): string;
export function validatePluginNamespaceAndOwnership(
  input: NamespaceValidationInput,
): NamespaceValidationResult;
export function verifyRepositoryPublisher(
  input: PublisherVerificationInput,
): PublisherVerificationResult;
