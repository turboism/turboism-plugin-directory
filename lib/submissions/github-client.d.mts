import type { OwnershipRegistry } from "./ownership.d.mts";
import type { SubmissionManifest } from "./preflight.d.mts";

export const DEFAULT_DIRECTORY_REPO: string;
export const DEFAULT_DIRECTORY_BASE_BRANCH: string;
export const MAX_OPEN_SUBMISSION_PRS_PER_AUTHOR: number;
export const MAX_RELEASE_REDIRECTS: number;
export const ALLOWED_RELEASE_DOWNLOAD_HOSTS: readonly string[];

export const LABEL_PLUGIN_SUBMISSION: string;
export const LABEL_AUTHOR_ID_PREFIX: string;
export const LABEL_SLUG_PREFIX: string;
export const SUBMISSION_BRANCH_PREFIX: string;
export const SUBMISSION_DIR_PREFIX: string;

export const ERROR_CODES: Readonly<{
  GITHUB_OAUTH_CONFIG_MISSING: "github_oauth_config_missing";
  GITHUB_OAUTH_EXCHANGE_FAILED: "github_oauth_exchange_failed";
  GITHUB_USER_FETCH_FAILED: "github_user_fetch_failed";
  GITHUB_APP_CONFIG_MISSING: "github_app_config_missing";
  GITHUB_API_ERROR: "github_api_error";
  SUBMISSION_RATE_LIMITED: "submission_rate_limited";
  UNTRUSTED_DOWNLOAD_HOST: "untrusted_download_host";
  REDIRECT_LIMIT_EXCEEDED: "redirect_limit_exceeded";
  ARTIFACT_SIZE_INVALID: "artifact_size_invalid";
  TAG_RESOLUTION_FAILED: "tag_resolution_failed";
  INVALID_MANIFEST: "invalid_manifest";
}>;

export interface SubmissionRuntimeConfig {
  githubOAuthClientId: string;
  githubOAuthClientSecret: string;
  authSessionSecret: string;
  hasConfiguredSessionSecret: boolean;
  githubSubmissionAppId: string;
  githubSubmissionInstallationId: string;
  githubSubmissionPrivateKeyPem: string;
  directoryRepo: string;
  directoryBaseBranch: string;
  publicAppOrigin: string;
  devMockEnabled: boolean;
  oauthConfigured: boolean;
  submissionBotConfigured: boolean;
}

export interface AuthenticatedGitHubUser {
  githubId: number;
  login: string;
  name: string;
  avatarUrl: string;
}

export interface PublicRepositorySummary {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  disabled: boolean;
  updatedAt: string;
  owner: {
    id: number;
    login: string;
    type: string;
  };
  isMock?: boolean;
}

export interface RemotePublisherVerificationResult {
  ok: boolean;
  reason?: "repo_owner" | "org_public_member" | "publishers_manifest";
  error?: string;
  repo?: {
    id: number;
    fullName: string;
    url: string;
    defaultBranch: string;
    owner: {
      id: number;
      login: string;
      type: string;
    };
  };
}

export interface EligibleReleaseAsset {
  id: number;
  name: string;
  size: number;
  contentType: string;
  browserDownloadUrl: string;
}

export interface EligibleRepositoryRelease {
  id: number;
  tagName: string;
  name: string;
  htmlUrl: string;
  prerelease: boolean;
  channel: "stable" | "preview";
  publishedAt: string;
  sourceRevision: string;
  isMock?: boolean;
  assets: EligibleReleaseAsset[];
}

export interface SubmissionPrPayload {
  branchName: string;
  filePath: string;
  labels: string[];
  title: string;
  body: string;
  contentText: string;
}

export type CreateOrUpdateSubmissionPrResult =
  | {
      ok: true;
      action: "created" | "updated";
      prNumber: number;
      prUrl: string;
      branchName: string;
      filePath: string;
      labelsApplied: boolean;
    }
  | {
      ok: false;
      code: "submission_rate_limited";
      message: string;
      details?: Record<string, unknown>;
    };

export interface AuthorCatalogedPlugin {
  pluginId: string;
  slug: string;
  name: string;
  trust: string;
  repository: string;
  claimedAt: string;
  latestVersion: string | null;
  releasesCount: number;
}

export interface AuthorSubmissionPrItem {
  number: number;
  title: string;
  htmlUrl: string;
  state: string;
  mergedAt: string | null;
  createdAt: string;
  updatedAt: string;
  slug: string | null;
  labels: string[];
}

export interface AuthorSubmissionsResult {
  catalogedPlugins: AuthorCatalogedPlugin[];
  submissions: AuthorSubmissionPrItem[];
  prIntegrationConfigured: boolean;
}

export function resolveSubmissionRuntimeConfig(
  env?: Record<string, string | undefined>,
): SubmissionRuntimeConfig;

export function buildGitHubAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string;

export function exchangeGitHubOAuthCode(params: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<{ accessToken: string; tokenType: string; scope: string }>;

export function fetchAuthenticatedGitHubUser(params: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<AuthenticatedGitHubUser>;

export function createGitHubAppJwt(params: {
  appId: string | number;
  privateKeyPem: string;
  nowSeconds?: number;
}): string;

export function createInstallationAccessToken(params: {
  appId: string | number;
  installationId: string | number;
  privateKeyPem: string;
  fetchImpl?: typeof fetch;
  nowSeconds?: number;
}): Promise<{ token: string; expiresAt: string; permissions: Record<string, string> }>;

export function listPublicUserRepositories(params: {
  login: string;
  fetchImpl?: typeof fetch;
  authToken?: string;
}): Promise<PublicRepositorySummary[]>;

export function verifyRemoteRepositoryPublisher(params: {
  owner: string;
  repo: string;
  submitter: { githubId: number; login: string };
  fetchImpl?: typeof fetch;
  authToken?: string;
}): Promise<RemotePublisherVerificationResult>;

export function resolveReleaseTagCommitSha(params: {
  owner: string;
  repo: string;
  tagName: string;
  fetchImpl?: typeof fetch;
  authToken?: string;
}): Promise<string>;

export function listEligibleRepositoryReleases(params: {
  owner: string;
  repo: string;
  fetchImpl?: typeof fetch;
  authToken?: string;
}): Promise<EligibleRepositoryRelease[]>;

export function downloadGitHubReleaseJar(params: {
  url: string;
  expectedSize?: number;
  destPath: string;
  fetchImpl?: typeof fetch;
}): Promise<{ path: string; size: number; sha256: string }>;

export function buildSubmissionPrPayload(manifest: SubmissionManifest): SubmissionPrPayload;

export function createOrUpdateSubmissionPr(params: {
  manifest: SubmissionManifest;
  installationToken: string;
  directoryRepo?: string;
  baseBranch?: string;
  fetchImpl?: typeof fetch;
}): Promise<CreateOrUpdateSubmissionPrResult>;

export function listAuthorSubmissions(params: {
  githubId: number;
  installationToken?: string;
  directoryRepo?: string;
  catalog: { plugins: Array<Record<string, unknown>> };
  ownership: OwnershipRegistry;
  fetchImpl?: typeof fetch;
}): Promise<AuthorSubmissionsResult>;
