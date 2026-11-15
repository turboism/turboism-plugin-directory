import { withBasePath } from "@/lib/base-path.mjs";
import type { Copy } from "@/components/language-provider";
import type { BytecodeAuditReport } from "@/lib/submissions/bytecode-scan.d.mts";
import type { DevMockSimulatedPr } from "@/lib/submissions/dev-mock-fixtures.d.mts";
import type {
  AuthorCatalogedPlugin,
  AuthorSubmissionPrItem,
  EligibleRepositoryRelease,
  PublicRepositorySummary,
} from "@/lib/submissions/github-client.d.mts";
import type { PreflightIssue, SubmissionManifest } from "@/lib/submissions/preflight.d.mts";

export const AUTH_CHANGED_EVENT = "turboism:auth-changed";

const BYTES_PER_KIB = 1024;
const BYTES_PER_MIB = 1024 * 1024;

export interface SessionUser {
  githubId: number;
  login: string;
  name: string;
  avatarUrl: string;
}

export interface SessionCapabilities {
  oauthConfigured: boolean;
  devMockEnabled: boolean;
  submissionBotConfigured: boolean;
}

export interface AuthSessionState {
  authenticated: boolean;
  user: SessionUser | null;
  capabilities: SessionCapabilities;
}

export interface SubmissionApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
    details?: {
      issues?: PreflightIssue[];
      [key: string]: unknown;
    };
  };
}

export interface ReleasesLookupResponse {
  repository: {
    id: number;
    fullName: string;
    url: string;
    defaultBranch: string;
    owner?: {
      id?: number;
      login?: string;
      type?: string;
    };
    isMock?: boolean;
  };
  verificationReason: "repo_owner" | "org_public_member" | "publishers_manifest";
  releases: EligibleRepositoryRelease[];
  catalogedPlugin: {
    pluginId: string;
    slug: string;
    existingVersions: string[];
  } | null;
}

export interface PreflightSuccessResponse {
  ok: true;
  isFirstClaim: boolean;
  manifest: SubmissionManifest;
  preview: {
    card: {
      id: string;
      slug: string;
      name: string;
      summary: string;
      trust: string;
      author: string;
      license: string;
      repository: string;
      support: string;
      latestVersion: string;
      channel: string;
      category: string;
      tags: string[];
    };
    localizations: Record<string, { name: string; summary: string }>;
    permissions: Array<{ id: string; scope: string; reason: string }>;
    bytecodeAudit: BytecodeAuditReport;
    readmesHtml: Record<string, string>;
  };
}

export type SubmitPrSuccessResponse =
  | {
      ok: true;
      simulated: false;
      pr: {
        ok: true;
        action: "created" | "updated";
        prNumber: number;
        prUrl: string;
        branchName: string;
        filePath: string;
        labelsApplied: boolean;
      };
      manifest: SubmissionManifest;
    }
  | {
      ok: true;
      simulated: true;
      mockSimulatedPr: DevMockSimulatedPr;
      manifest: SubmissionManifest;
    };

export interface SubmissionsMineResponse {
  catalogedPlugins: AuthorCatalogedPlugin[];
  submissions: AuthorSubmissionPrItem[];
  prIntegrationConfigured: boolean;
  user: SessionUser;
}

/**
 * Fetches the current GitHub OAuth session state without caching.
 */
export async function fetchAuthSession(signal?: AbortSignal): Promise<AuthSessionState> {
  const response = await fetch(withBasePath("/api/auth/session"), {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new Error(`Session request failed with status ${response.status}`);
  }
  return (await response.json()) as AuthSessionState;
}

/**
 * Terminates the active session cookie and broadcasts an auth state refresh event.
 */
export async function logoutAuthSession(): Promise<boolean> {
  const response = await fetch(withBasePath("/api/auth/logout"), {
    method: "POST",
    credentials: "same-origin",
  });
  if (response.ok) {
    window.dispatchEvent(new CustomEvent(AUTH_CHANGED_EVENT));
    return true;
  }
  return false;
}

/**
 * Builds the login endpoint URL with a basePath-qualified return destination.
 */
export function buildGitHubLoginHref(returnPath: string, options?: { mock?: boolean }): string {
  const resolvedReturnTo = withBasePath(returnPath);
  const params = new URLSearchParams({ returnTo: resolvedReturnTo });
  if (options?.mock) {
    params.set("mock", "1");
  }
  return withBasePath(`/api/auth/github/login?${params.toString()}`);
}

/**
 * Resolves a localized message for a structured submission API error code.
 */
export function resolveSubmissionErrorMessage(
  copy: Copy,
  code: string | undefined,
  fallbackMessage?: string,
): string {
  if (code && code in copy.submissionErrors) {
    return copy.submissionErrors[code];
  }
  if (fallbackMessage && fallbackMessage.trim().length > 0) {
    return fallbackMessage;
  }
  return copy.submissionErrors.unknown;
}

/**
 * Formats byte sizes for release assets and JAR inspection summaries.
 */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < BYTES_PER_KIB) return `${bytes} B`;
  if (bytes < BYTES_PER_MIB) return `${(bytes / BYTES_PER_KIB).toFixed(1)} KiB`;
  return `${(bytes / BYTES_PER_MIB).toFixed(2)} MiB`;
}

/**
 * Validates that an avatar URL uses an allowed HTTPS or inline image data scheme.
 */
export function isSafeAvatarUrl(url: string | undefined): url is string {
  if (!url) return false;
  return url.startsWith("https://") || url.startsWith("data:image/");
}

/**
 * Extracts "<owner>/<repo>" from a canonical GitHub repository URL.
 */
export function extractRepoFullName(repositoryUrl: string): string {
  return repositoryUrl.replace(/^https:\/\/github\.com\//i, "").replace(/\/+$/, "");
}

export type { PublicRepositorySummary, EligibleRepositoryRelease, PreflightIssue, AuthorCatalogedPlugin, AuthorSubmissionPrItem };
