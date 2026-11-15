// Zero-dependency GitHub OAuth, GitHub App authentication, repository/release
// verification, bounded JAR download, and submission PR orchestration layer.
import { createHash, createPrivateKey, createSign, randomBytes } from "node:crypto";
import { closeSync, mkdirSync, openSync, rmSync, writeSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_PUBLIC_ORIGIN,
  isDevMockAuthEnabled,
} from "../auth/session.mjs";
import {
  MAX_ARTIFACT_SIZE,
  decodeUtf8Fatal,
  parseStrictJson,
} from "../catalog-v2/catalog.mjs";
import { formatBytecodeAuditMarkdown } from "./bytecode-scan.mjs";
import {
  PUBLISHERS_MANIFEST_PATH,
  verifyRepositoryPublisher,
} from "./ownership.mjs";
import { validateSubmissionManifest } from "./preflight.mjs";

export const DEFAULT_DIRECTORY_REPO = "turboism/turboism-plugin-directory";
export const DEFAULT_DIRECTORY_BASE_BRANCH = "main";
export const MAX_OPEN_SUBMISSION_PRS_PER_AUTHOR = 3;
export const MAX_RELEASE_REDIRECTS = 5;
export const ALLOWED_RELEASE_DOWNLOAD_HOSTS = Object.freeze([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);

export const LABEL_PLUGIN_SUBMISSION = "plugin-submission";
export const LABEL_AUTHOR_ID_PREFIX = "author-id:";
export const LABEL_SLUG_PREFIX = "slug:";
export const SUBMISSION_BRANCH_PREFIX = "submission/";
export const SUBMISSION_DIR_PREFIX = "catalog/v2/submissions";
export const GITHUB_APP_CLIENT_ID_PREFIX = "Iv";

export const ERROR_CODES = Object.freeze({
  GITHUB_OAUTH_CONFIG_MISSING: "github_oauth_config_missing",
  GITHUB_OAUTH_EXCHANGE_FAILED: "github_oauth_exchange_failed",
  GITHUB_USER_FETCH_FAILED: "github_user_fetch_failed",
  GITHUB_APP_CONFIG_MISSING: "github_app_config_missing",
  GITHUB_API_ERROR: "github_api_error",
  SUBMISSION_RATE_LIMITED: "submission_rate_limited",
  UNTRUSTED_DOWNLOAD_HOST: "untrusted_download_host",
  REDIRECT_LIMIT_EXCEEDED: "redirect_limit_exceeded",
  ARTIFACT_SIZE_INVALID: "artifact_size_invalid",
  TAG_RESOLUTION_FAILED: "tag_resolution_failed",
  INVALID_MANIFEST: "invalid_manifest",
});

const GITHUB_WEB_ORIGIN = "https://github.com";
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_OAUTH_AUTHORIZE_URL = `${GITHUB_WEB_ORIGIN}/login/oauth/authorize`;
const GITHUB_OAUTH_TOKEN_URL = `${GITHUB_WEB_ORIGIN}/login/oauth/access_token`;
const GITHUB_OAUTH_SCOPE = "read:user";
const GITHUB_PKCE_METHOD = "S256";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_API_ACCEPT = "application/vnd.github+json";
const GITHUB_RAW_ACCEPT = "application/vnd.github.raw+json";
const USER_AGENT_HEADER = "turboism-plugin-directory/1.0";

const JWT_HEADER_ENCODED = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }), "utf8").toString("base64url");
const JWT_CLOCK_DRIFT_SECONDS = 60;
const JWT_TTL_SECONDS = 9 * 60;
const MILLISECONDS_PER_SECOND = 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DOWNLOAD_REQUEST_TIMEOUT_MS = 30_000;
const MAX_API_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_PUBLISHERS_MANIFEST_BYTES = 64 * 1024;
const MAX_TAG_DEREF_DEPTH = 5;
const REPOS_PER_PAGE = 100;
const RELEASES_PER_PAGE = 30;
const ISSUES_PER_PAGE = 100;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RE_REPO_SLUG = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const RE_JAR_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.jar$/;
const RE_HEX_SHA_40 = /^[0-9a-f]{40}$/;
const RE_UTC_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

const DEV_EPHEMERAL_SESSION_SECRET = randomBytes(32).toString("hex");

function createCodedError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) {
    error.details = details;
  }
  return error;
}

function readTrimmedEnv(env, key) {
  const value = env?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function normalizePemValue(rawPem) {
  if (!rawPem) return "";
  return rawPem.replace(/\\n/g, "\n").trim();
}

function parseRepoSlug(fullName) {
  if (typeof fullName !== "string") return null;
  const match = RE_REPO_SLUG.exec(fullName.trim());
  if (!match) return null;
  const owner = match[1];
  const repo = match[2];
  if (owner === "." || owner === ".." || repo === "." || repo === "..") {
    return null;
  }
  return { owner, repo, fullName: `${owner}/${repo}` };
}

function normalizeIsoSecondTimestamp(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!RE_UTC_TIMESTAMP.test(trimmed)) return null;
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

function encodePathSegments(rawPath) {
  return String(rawPath)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function readResponseTextBounded(response, maxBytes, label) {
  const contentLengthHeader = response.headers?.get?.("content-length");
  if (contentLengthHeader !== null && contentLengthHeader !== undefined) {
    const declaredLength = Number(contentLengthHeader);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel?.().catch(() => {});
      throw createCodedError(ERROR_CODES.GITHUB_API_ERROR, `${label} response exceeds ${maxBytes} bytes.`);
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw createCodedError(ERROR_CODES.GITHUB_API_ERROR, `${label} response exceeds ${maxBytes} bytes.`);
    }
    return decodeUtf8Fatal(buffer);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw createCodedError(ERROR_CODES.GITHUB_API_ERROR, `${label} response exceeds ${maxBytes} bytes.`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  return decodeUtf8Fatal(Buffer.concat(chunks, totalBytes));
}

async function fetchGitHubJson(url, { fetchImpl = fetch, token = "", method = "GET", body = undefined, accept = GITHUB_API_ACCEPT } = {}) {
  const headers = {
    Accept: accept,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": USER_AGENT_HEADER,
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const response = await fetchImpl(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
  });
  const text = await readResponseTextBounded(response, MAX_API_RESPONSE_BYTES, url);
  if (!response.ok) {
    const error = createCodedError(
      ERROR_CODES.GITHUB_API_ERROR,
      `GitHub API ${method} ${url} failed with HTTP ${response.status}.`,
      { status: response.status, body: text.slice(0, 500) },
    );
    error.status = response.status;
    throw error;
  }
  if (text.trim().length === 0) {
    return null;
  }
  try {
    return parseStrictJson(text);
  } catch (error) {
    throw createCodedError(
      ERROR_CODES.GITHUB_API_ERROR,
      `GitHub API returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Resolves GitHub OAuth, GitHub App, directory target, and origin settings from environment variables.
 * @param {Record<string, string | undefined>} [env]
 */
export function resolveSubmissionRuntimeConfig(env = process.env) {
  const githubOAuthClientId = readTrimmedEnv(env, "GITHUB_OAUTH_CLIENT_ID");
  const githubOAuthClientSecret = readTrimmedEnv(env, "GITHUB_OAUTH_CLIENT_SECRET");
  const configuredSessionSecret = readTrimmedEnv(env, "AUTH_SESSION_SECRET");
  const githubSubmissionAppId = readTrimmedEnv(env, "GITHUB_SUBMISSION_APP_ID");
  const githubSubmissionInstallationId = readTrimmedEnv(env, "GITHUB_SUBMISSION_INSTALLATION_ID");
  const githubSubmissionPrivateKeyPem = normalizePemValue(readTrimmedEnv(env, "GITHUB_SUBMISSION_PRIVATE_KEY_PEM"));

  const rawDirectoryRepo = readTrimmedEnv(env, "GITHUB_DIRECTORY_REPO") || DEFAULT_DIRECTORY_REPO;
  const directoryRepo = parseRepoSlug(rawDirectoryRepo)?.fullName ?? DEFAULT_DIRECTORY_REPO;
  const directoryBaseBranch = readTrimmedEnv(env, "GITHUB_DIRECTORY_BASE_BRANCH") || DEFAULT_DIRECTORY_BASE_BRANCH;
  const publicAppOrigin = readTrimmedEnv(env, "PUBLIC_APP_ORIGIN") || DEFAULT_PUBLIC_ORIGIN;
  const devMockEnabled = isDevMockAuthEnabled(env);
  const authSessionSecret = configuredSessionSecret || (devMockEnabled ? DEV_EPHEMERAL_SESSION_SECRET : "");

  return Object.freeze({
    githubOAuthClientId,
    githubOAuthClientSecret,
    authSessionSecret,
    hasConfiguredSessionSecret: configuredSessionSecret.length > 0,
    githubSubmissionAppId,
    githubSubmissionInstallationId,
    githubSubmissionPrivateKeyPem,
    directoryRepo,
    directoryBaseBranch,
    publicAppOrigin,
    devMockEnabled,
    oauthConfigured: Boolean(githubOAuthClientId && githubOAuthClientSecret && authSessionSecret),
    submissionBotConfigured: Boolean(
      githubSubmissionAppId && githubSubmissionInstallationId && githubSubmissionPrivateKeyPem,
    ),
  });
}

/**
 * Builds the GitHub OAuth authorize URL with PKCE S256 and omits scope for GitHub App clients.
 * @param {{ clientId: string, redirectUri: string, state: string, codeChallenge: string }} params
 * @returns {string}
 */
export function buildGitHubAuthorizeUrl({ clientId, redirectUri, state, codeChallenge }) {
  if (!clientId || !redirectUri || !state || !codeChallenge) {
    throw createCodedError(
      ERROR_CODES.GITHUB_OAUTH_CONFIG_MISSING,
      "GitHub authorize URL requires clientId, redirectUri, state, and codeChallenge.",
    );
  }
  const url = new URL(GITHUB_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  // GitHub App user-to-server OAuth uses configured app permissions instead of classic OAuth scopes.
  if (!clientId.startsWith(GITHUB_APP_CLIENT_ID_PREFIX)) {
    url.searchParams.set("scope", GITHUB_OAUTH_SCOPE);
  }
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", GITHUB_PKCE_METHOD);
  return url.toString();
}

/**
 * Exchanges a GitHub OAuth authorization code and PKCE verifier for an access token.
 * @param {{ clientId: string, clientSecret: string, code: string, redirectUri: string, codeVerifier: string, fetchImpl?: typeof fetch }} params
 */
export async function exchangeGitHubOAuthCode({
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
  fetchImpl = fetch,
}) {
  if (!clientId || !clientSecret || !code || !redirectUri || !codeVerifier) {
    throw createCodedError(
      ERROR_CODES.GITHUB_OAUTH_EXCHANGE_FAILED,
      "OAuth code exchange requires client credentials, code, redirectUri, and codeVerifier.",
    );
  }
  const response = await fetchImpl(GITHUB_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT_HEADER,
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
  });
  const rawBody = await readResponseTextBounded(response, MAX_API_RESPONSE_BYTES, GITHUB_OAUTH_TOKEN_URL);
  if (!response.ok) {
    throw createCodedError(
      ERROR_CODES.GITHUB_OAUTH_EXCHANGE_FAILED,
      `GitHub OAuth token endpoint returned HTTP ${response.status}.`,
    );
  }
  let parsed;
  try {
    parsed = parseStrictJson(rawBody);
  } catch {
    throw createCodedError(
      ERROR_CODES.GITHUB_OAUTH_EXCHANGE_FAILED,
      "GitHub OAuth token endpoint returned invalid JSON.",
    );
  }
  if (!parsed || typeof parsed !== "object" || typeof parsed.access_token !== "string" || parsed.access_token.length === 0) {
    const oauthError = typeof parsed?.error_description === "string"
      ? parsed.error_description
      : typeof parsed?.error === "string"
        ? parsed.error
        : "Missing access_token in OAuth exchange response.";
    throw createCodedError(ERROR_CODES.GITHUB_OAUTH_EXCHANGE_FAILED, oauthError);
  }
  return {
    accessToken: parsed.access_token,
    tokenType: typeof parsed.token_type === "string" ? parsed.token_type : "bearer",
    scope: typeof parsed.scope === "string" ? parsed.scope : "",
  };
}

/**
 * Fetches and strictly validates the authenticated GitHub user profile.
 * @param {{ accessToken: string, fetchImpl?: typeof fetch }} params
 */
export async function fetchAuthenticatedGitHubUser({ accessToken, fetchImpl = fetch }) {
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw createCodedError(ERROR_CODES.GITHUB_USER_FETCH_FAILED, "Access token is required.");
  }
  const user = await fetchGitHubJson(`${GITHUB_API_ORIGIN}/user`, {
    fetchImpl,
    token: accessToken,
  });
  if (!user || typeof user !== "object" || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw createCodedError(
      ERROR_CODES.GITHUB_USER_FETCH_FAILED,
      "GitHub user profile is missing a positive integer id.",
    );
  }
  if (typeof user.login !== "string" || user.login.trim().length === 0) {
    throw createCodedError(
      ERROR_CODES.GITHUB_USER_FETCH_FAILED,
      "GitHub user profile is missing a login.",
    );
  }
  const avatarUrl = typeof user.avatar_url === "string" && user.avatar_url.startsWith("https://")
    ? user.avatar_url
    : "";
  return {
    githubId: user.id,
    login: user.login.trim(),
    name: typeof user.name === "string" ? user.name.trim() : "",
    avatarUrl,
  };
}

/**
 * Signs an RS256 GitHub App JWT with a 60-second clock-drift backdate and 9-minute lifetime.
 * @param {{ appId: string | number, privateKeyPem: string, nowSeconds?: number }} params
 * @returns {string}
 */
export function createGitHubAppJwt({ appId, privateKeyPem, nowSeconds }) {
  const normalizedAppId = String(appId ?? "").trim();
  const normalizedPem = normalizePemValue(privateKeyPem);
  if (!normalizedAppId || !normalizedPem) {
    throw createCodedError(
      ERROR_CODES.GITHUB_APP_CONFIG_MISSING,
      "GitHub App JWT generation requires appId and PEM credentials.",
    );
  }
  const currentSec = nowSeconds === undefined
    ? Math.floor(Date.now() / MILLISECONDS_PER_SECOND)
    : nowSeconds;
  if (!Number.isSafeInteger(currentSec) || currentSec < 0) {
    throw new Error("nowSeconds must be a non-negative integer.");
  }
  const claims = {
    iat: currentSec - JWT_CLOCK_DRIFT_SECONDS,
    exp: currentSec + JWT_TTL_SECONDS,
    iss: normalizedAppId,
  };
  const encodedClaims = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signingInput = `${JWT_HEADER_ENCODED}.${encodedClaims}`;
  const key = createPrivateKey(normalizedPem);
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput, "utf8");
  const signature = signer.sign(key).toString("base64url");
  return `${signingInput}.${signature}`;
}

/**
 * Mints a least-privilege GitHub App installation token scoped to contents and pull_requests write.
 * @param {{ appId: string | number, installationId: string | number, privateKeyPem: string, fetchImpl?: typeof fetch, nowSeconds?: number }} params
 */
export async function createInstallationAccessToken({
  appId,
  installationId,
  privateKeyPem,
  fetchImpl = fetch,
  nowSeconds,
}) {
  const normalizedInstallId = String(installationId ?? "").trim();
  if (!normalizedInstallId) {
    throw createCodedError(
      ERROR_CODES.GITHUB_APP_CONFIG_MISSING,
      "GitHub App installationId is required.",
    );
  }
  const appJwt = createGitHubAppJwt({ appId, privateKeyPem, nowSeconds });
  const url = `${GITHUB_API_ORIGIN}/app/installations/${encodeURIComponent(normalizedInstallId)}/access_tokens`;
  const payload = await fetchGitHubJson(url, {
    fetchImpl,
    token: appJwt,
    method: "POST",
    body: {
      permissions: {
        contents: "write",
        pull_requests: "write",
      },
    },
  });
  if (!payload || typeof payload.token !== "string" || payload.token.length === 0) {
    throw createCodedError(
      ERROR_CODES.GITHUB_API_ERROR,
      "GitHub App installation token response did not contain a token.",
    );
  }
  return {
    token: payload.token,
    expiresAt: typeof payload.expires_at === "string" ? payload.expires_at : "",
    permissions: payload.permissions ?? { contents: "write", pull_requests: "write" },
  };
}

/**
 * Lists active public, non-archived, non-disabled repositories accessible for the given GitHub login.
 * @param {{ login: string, fetchImpl?: typeof fetch, authToken?: string }} params
 */
export async function listPublicUserRepositories({ login, fetchImpl = fetch, authToken = "" }) {
  if (typeof login !== "string" || login.trim().length === 0) {
    throw new Error("GitHub login is required to list repositories.");
  }
  const url = `${GITHUB_API_ORIGIN}/users/${encodeURIComponent(login.trim())}/repos?type=all&sort=updated&per_page=${REPOS_PER_PAGE}`;
  const repos = await fetchGitHubJson(url, { fetchImpl, token: authToken });
  if (!Array.isArray(repos)) {
    throw createCodedError(ERROR_CODES.GITHUB_API_ERROR, "Unexpected repository list response from GitHub.");
  }
  return repos
    .filter((repo) => repo && repo.private === false && repo.archived !== true && repo.disabled !== true)
    .map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
      description: typeof repo.description === "string" ? repo.description : "",
      defaultBranch: typeof repo.default_branch === "string" && repo.default_branch ? repo.default_branch : "main",
      private: false,
      archived: false,
      disabled: false,
      updatedAt: typeof repo.updated_at === "string" ? repo.updated_at : "",
      owner: {
        id: repo.owner?.id,
        login: repo.owner?.login ?? "",
        type: repo.owner?.type ?? "User",
      },
    }));
}

/**
 * Verifies repository visibility and submitter publishing authority via owner, public org membership,
 * or default-branch .github/turboism-publishers.json manifest.
 * @param {{ owner: string, repo: string, submitter: { githubId: number, login: string }, fetchImpl?: typeof fetch, authToken?: string }} params
 */
export async function verifyRemoteRepositoryPublisher({
  owner,
  repo,
  submitter,
  fetchImpl = fetch,
  authToken = "",
}) {
  const parsedSlug = parseRepoSlug(`${owner}/${repo}`);
  if (!parsedSlug) {
    return { ok: false, error: "Invalid repository owner or name." };
  }
  const repoUrl = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(parsedSlug.owner)}/${encodeURIComponent(parsedSlug.repo)}`;
  const repoData = await fetchGitHubJson(repoUrl, { fetchImpl, token: authToken });

  if (repoData.private !== false || repoData.archived === true || repoData.disabled === true) {
    return verifyRepositoryPublisher({ submitter, repo: repoData });
  }

  let isPublicOrgMember = false;
  if (repoData.owner?.type === "Organization" && typeof repoData.owner?.login === "string") {
    const memberUrl = `${GITHUB_API_ORIGIN}/orgs/${encodeURIComponent(repoData.owner.login)}/public_members/${encodeURIComponent(submitter.login)}`;
    const memberResponse = await fetchImpl(memberUrl, {
      method: "GET",
      headers: {
        Accept: GITHUB_API_ACCEPT,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": USER_AGENT_HEADER,
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      redirect: "manual",
      signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
    });
    await memberResponse.body?.cancel?.().catch(() => {});
    isPublicOrgMember = memberResponse.status === 204;
  }

  let publishersFileContent = null;
  const isDirectOwner = repoData.owner?.type === "User" && repoData.owner?.id === submitter.githubId;
  if (!isDirectOwner && !isPublicOrgMember) {
    const defaultBranch = typeof repoData.default_branch === "string" && repoData.default_branch
      ? repoData.default_branch
      : "main";
    const manifestUrl = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(parsedSlug.owner)}/${encodeURIComponent(parsedSlug.repo)}/contents/${PUBLISHERS_MANIFEST_PATH}?ref=${encodeURIComponent(defaultBranch)}`;
    const manifestResponse = await fetchImpl(manifestUrl, {
      method: "GET",
      headers: {
        Accept: GITHUB_RAW_ACCEPT,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
        "User-Agent": USER_AGENT_HEADER,
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
    });
    if (manifestResponse.status === 200) {
      publishersFileContent = await readResponseTextBounded(
        manifestResponse,
        MAX_PUBLISHERS_MANIFEST_BYTES,
        PUBLISHERS_MANIFEST_PATH,
      );
    } else {
      await manifestResponse.body?.cancel?.().catch(() => {});
    }
  }

  const verification = verifyRepositoryPublisher({
    submitter,
    repo: repoData,
    isPublicOrgMember,
    publishersFileContent,
  });
  if (!verification.ok) {
    return verification;
  }

  return {
    ok: true,
    reason: verification.reason,
    repo: {
      id: repoData.id,
      fullName: repoData.full_name ?? parsedSlug.fullName,
      url: `${GITHUB_WEB_ORIGIN}/${repoData.full_name ?? parsedSlug.fullName}`,
      defaultBranch: typeof repoData.default_branch === "string" && repoData.default_branch
        ? repoData.default_branch
        : "main",
      owner: {
        id: repoData.owner?.id,
        login: repoData.owner?.login ?? parsedSlug.owner,
        type: repoData.owner?.type ?? "User",
      },
    },
  };
}

/**
 * Resolves a GitHub tag reference to its underlying 40-character commit SHA,
 * dereferencing annotated tag objects recursively up to a bounded depth.
 * @param {{ owner: string, repo: string, tagName: string, fetchImpl?: typeof fetch, authToken?: string }} params
 * @returns {Promise<string>}
 */
export async function resolveReleaseTagCommitSha({
  owner,
  repo,
  tagName,
  fetchImpl = fetch,
  authToken = "",
}) {
  const parsedSlug = parseRepoSlug(`${owner}/${repo}`);
  if (!parsedSlug || typeof tagName !== "string" || tagName.length === 0) {
    throw createCodedError(ERROR_CODES.TAG_RESOLUTION_FAILED, "Repository and tagName are required.");
  }
  const refUrl = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(parsedSlug.owner)}/${encodeURIComponent(parsedSlug.repo)}/git/ref/tags/${encodeURIComponent(tagName)}`;
  const refData = await fetchGitHubJson(refUrl, { fetchImpl, token: authToken });
  const targetRef = Array.isArray(refData)
    ? refData.find((entry) => entry?.ref === `refs/tags/${tagName}`)
    : refData;
  let currentObject = targetRef?.object;
  let depth = 0;

  while (currentObject && currentObject.type === "tag" && depth < MAX_TAG_DEREF_DEPTH) {
    const tagUrl = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(parsedSlug.owner)}/${encodeURIComponent(parsedSlug.repo)}/git/tags/${encodeURIComponent(currentObject.sha)}`;
    const tagData = await fetchGitHubJson(tagUrl, { fetchImpl, token: authToken });
    currentObject = tagData?.object;
    depth += 1;
  }

  if (!currentObject || currentObject.type !== "commit" || typeof currentObject.sha !== "string" || !RE_HEX_SHA_40.test(currentObject.sha)) {
    throw createCodedError(
      ERROR_CODES.TAG_RESOLUTION_FAILED,
      `Could not resolve tag "${tagName}" to a 40-character commit SHA.`,
    );
  }
  return currentObject.sha;
}

/**
 * Lists non-draft public GitHub Releases that contain at least one valid bounded .jar asset,
 * resolving each release tag to its immutable commit SHA.
 * @param {{ owner: string, repo: string, fetchImpl?: typeof fetch, authToken?: string }} params
 */
export async function listEligibleRepositoryReleases({
  owner,
  repo,
  fetchImpl = fetch,
  authToken = "",
}) {
  const parsedSlug = parseRepoSlug(`${owner}/${repo}`);
  if (!parsedSlug) {
    throw createCodedError(ERROR_CODES.GITHUB_API_ERROR, "Invalid repository slug.");
  }
  const releasesUrl = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(parsedSlug.owner)}/${encodeURIComponent(parsedSlug.repo)}/releases?per_page=${RELEASES_PER_PAGE}`;
  const releases = await fetchGitHubJson(releasesUrl, { fetchImpl, token: authToken });
  if (!Array.isArray(releases)) {
    throw createCodedError(ERROR_CODES.GITHUB_API_ERROR, "GitHub releases endpoint returned unexpected payload.");
  }

  const eligible = [];
  for (const release of releases) {
    if (!release || release.draft === true || typeof release.tag_name !== "string" || release.tag_name.length === 0) {
      continue;
    }
    const assets = Array.isArray(release.assets)
      ? release.assets
        .filter((asset) =>
          asset &&
          typeof asset.name === "string" &&
          RE_JAR_FILE_NAME.test(asset.name) &&
          Number.isSafeInteger(asset.size) &&
          asset.size >= 1 &&
          asset.size <= MAX_ARTIFACT_SIZE &&
          typeof asset.browser_download_url === "string" &&
          asset.browser_download_url.startsWith("https://"),
        )
        .map((asset) => ({
          id: asset.id,
          name: asset.name,
          size: asset.size,
          contentType: typeof asset.content_type === "string" ? asset.content_type : "application/java-archive",
          browserDownloadUrl: asset.browser_download_url,
        }))
      : [];

    if (assets.length === 0) {
      continue;
    }

    const publishedAt = normalizeIsoSecondTimestamp(release.published_at ?? release.created_at);
    if (!publishedAt) {
      continue;
    }

    const sourceRevision = await resolveReleaseTagCommitSha({
      owner: parsedSlug.owner,
      repo: parsedSlug.repo,
      tagName: release.tag_name,
      fetchImpl,
      authToken,
    });

    eligible.push({
      id: release.id,
      tagName: release.tag_name,
      name: typeof release.name === "string" && release.name ? release.name : release.tag_name,
      htmlUrl: typeof release.html_url === "string"
        ? release.html_url
        : `${GITHUB_WEB_ORIGIN}/${parsedSlug.fullName}/releases/tag/${release.tag_name}`,
      prerelease: Boolean(release.prerelease),
      channel: release.prerelease ? "preview" : "stable",
      publishedAt,
      sourceRevision,
      assets,
    });
  }

  return eligible;
}

function assertAllowedReleaseDownloadUrl(rawUrl, contextLabel) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw createCodedError(ERROR_CODES.UNTRUSTED_DOWNLOAD_HOST, `${contextLabel} is not a valid URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw createCodedError(ERROR_CODES.UNTRUSTED_DOWNLOAD_HOST, `${contextLabel} must use HTTPS.`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_RELEASE_DOWNLOAD_HOSTS.includes(hostname)) {
    throw createCodedError(
      ERROR_CODES.UNTRUSTED_DOWNLOAD_HOST,
      `${contextLabel} host "${hostname}" is not in the release download allowlist.`,
    );
  }
  return parsed;
}

/**
 * Downloads a release JAR with strict HTTPS host allowlisting across redirects and
 * a hard 16 MiB streaming cap written directly to destPath.
 * @param {{ url: string, expectedSize?: number, destPath: string, fetchImpl?: typeof fetch }} params
 */
export async function downloadGitHubReleaseJar({
  url,
  expectedSize,
  destPath,
  fetchImpl = fetch,
}) {
  if (typeof destPath !== "string" || destPath.length === 0) {
    throw new Error("destPath is required.");
  }
  if (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_ARTIFACT_SIZE)) {
    throw createCodedError(
      ERROR_CODES.ARTIFACT_SIZE_INVALID,
      `expectedSize must be between 1 and ${MAX_ARTIFACT_SIZE} bytes.`,
    );
  }

  let currentUrl = assertAllowedReleaseDownloadUrl(url, "Initial release download URL").href;
  let response = null;

  for (let hop = 0; hop <= MAX_RELEASE_REDIRECTS; hop += 1) {
    const candidate = await fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": USER_AGENT_HEADER },
      signal: AbortSignal.timeout(DOWNLOAD_REQUEST_TIMEOUT_MS),
    });

    if (REDIRECT_STATUSES.has(candidate.status)) {
      const location = candidate.headers?.get?.("location");
      await candidate.body?.cancel?.().catch(() => {});
      if (hop >= MAX_RELEASE_REDIRECTS) {
        throw createCodedError(
          ERROR_CODES.REDIRECT_LIMIT_EXCEEDED,
          `Release download exceeded ${MAX_RELEASE_REDIRECTS} redirects.`,
        );
      }
      if (!location) {
        throw createCodedError(ERROR_CODES.GITHUB_API_ERROR, "Redirect response is missing Location header.");
      }
      const nextUrl = new URL(location, currentUrl);
      assertAllowedReleaseDownloadUrl(nextUrl.href, "Release download redirect target");
      currentUrl = nextUrl.href;
      continue;
    }

    response = candidate;
    break;
  }

  if (!response || !response.ok) {
    const status = response?.status ?? 0;
    await response?.body?.cancel?.().catch(() => {});
    throw createCodedError(
      ERROR_CODES.GITHUB_API_ERROR,
      `Release asset download failed with HTTP ${status}.`,
    );
  }

  const declaredSizeHeader = response.headers?.get?.("content-length");
  if (declaredSizeHeader !== null && declaredSizeHeader !== undefined) {
    const declaredSize = Number(declaredSizeHeader);
    if (!Number.isFinite(declaredSize) || declaredSize < 1 || declaredSize > MAX_ARTIFACT_SIZE) {
      await response.body?.cancel?.().catch(() => {});
      throw createCodedError(
        ERROR_CODES.ARTIFACT_SIZE_INVALID,
        `Release asset Content-Length ${declaredSizeHeader} exceeds bounded limits.`,
      );
    }
    if (expectedSize !== undefined && declaredSize !== expectedSize) {
      await response.body?.cancel?.().catch(() => {});
      throw createCodedError(
        ERROR_CODES.ARTIFACT_SIZE_INVALID,
        `Release asset Content-Length ${declaredSize} does not match expected size ${expectedSize}.`,
      );
    }
  }

  const resolvedDest = path.resolve(destPath);
  mkdirSync(path.dirname(resolvedDest), { recursive: true });
  const hash = createHash("sha256");
  const sizeCap = expectedSize ?? MAX_ARTIFACT_SIZE;
  let totalBytes = 0;
  let fd = null;

  try {
    fd = openSync(resolvedDest, "w", 0o600);
    if (!response.body || typeof response.body.getReader !== "function") {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength < 1 || buffer.byteLength > sizeCap) {
        throw createCodedError(
          ERROR_CODES.ARTIFACT_SIZE_INVALID,
          `Release asset size ${buffer.byteLength} exceeds allowed bounds.`,
        );
      }
      writeSync(fd, buffer);
      hash.update(buffer);
      totalBytes = buffer.byteLength;
    } else {
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          totalBytes += chunk.byteLength;
          if (totalBytes > sizeCap) {
            await reader.cancel().catch(() => {});
            throw createCodedError(
              ERROR_CODES.ARTIFACT_SIZE_INVALID,
              `Release asset stream exceeded ${sizeCap} bytes.`,
            );
          }
          writeSync(fd, chunk);
          hash.update(chunk);
        }
      } finally {
        reader.releaseLock?.();
      }
    }

    if (totalBytes < 1 || (expectedSize !== undefined && totalBytes !== expectedSize)) {
      throw createCodedError(
        ERROR_CODES.ARTIFACT_SIZE_INVALID,
        `Downloaded release asset size ${totalBytes} does not match expected size ${expectedSize ?? ">=1"}.`,
      );
    }
  } catch (error) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // Ignore close failures during cleanup.
      }
      fd = null;
    }
    try {
      rmSync(resolvedDest, { force: true });
    } catch {
      // Ignore unlink failures during cleanup.
    }
    throw error;
  }

  if (fd !== null) {
    closeSync(fd);
  }

  return {
    path: resolvedDest,
    size: totalBytes,
    sha256: hash.digest("hex"),
  };
}

/**
 * Formats the Pull Request title, body, branch, file path, and labels for a SubmissionManifest.
 * @param {object} manifest
 */
export function buildSubmissionPrPayload(manifest) {
  const check = validateSubmissionManifest(manifest);
  if (!check.ok) {
    throw createCodedError(
      ERROR_CODES.INVALID_MANIFEST,
      check.errors.map((issue) => `${issue.path}: ${issue.message}`).join("; "),
    );
  }
  const slug = manifest.plugin.slug;
  const version = manifest.release.version;
  const githubId = manifest.submitter.githubId;
  const branchName = `${SUBMISSION_BRANCH_PREFIX}${slug}-v${version}`;
  const filePath = `${SUBMISSION_DIR_PREFIX}/${slug}/${version}.json`;
  const labels = [
    LABEL_PLUGIN_SUBMISSION,
    `${LABEL_AUTHOR_ID_PREFIX}${githubId}`,
    `${LABEL_SLUG_PREFIX}${slug}`,
  ];
  const title = `submission(${slug}): ${manifest.plugin.name} v${version}`;

  const permissions = Array.isArray(manifest.release.permissions) ? manifest.release.permissions : [];
  const permissionLines = permissions.length === 0
    ? ["No elevated runtime permissions declared."]
    : [
        "| Permission ID | Scope | Reason |",
        "|---|---|---|",
        ...permissions.map((perm) =>
          `| \`${perm.id}\` | \`${perm.scope ?? "application"}\` | ${String(perm.reason ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ")} |`,
        ),
      ];

  const auditMarkdown = formatBytecodeAuditMarkdown(manifest.bytecodeAudit);
  const body = [
    "## Third-Party Plugin Submission",
    "",
    "> **Notice**: This submission targets the **Reviewed third-party** (`reviewed-third-party`) tier. Inclusion in the Turboism Plugin Directory is not a security certification and does not imply ongoing compatibility support.",
    "",
    "### Metadata Summary",
    "",
    `- **Plugin ID**: \`${manifest.plugin.id}\``,
    `- **Slug**: \`${slug}\``,
    `- **Display Name**: ${manifest.plugin.name}`,
    `- **Version**: \`${version}\` (\`${manifest.release.channel}\`)`,
    `- **Trust Tier**: \`${manifest.plugin.trust}\``,
    `- **Author**: ${manifest.plugin.author}`,
    `- **License**: ${manifest.plugin.license}`,
    `- **Submitter**: @${manifest.submitter.login} (GitHub ID: \`${githubId}\`, verification: \`${manifest.submitter.verificationReason}\`)`,
    "",
    "### Source & Release Anchor",
    "",
    `- **Repository**: ${manifest.repository.url} (repo ID: \`${manifest.repository.id}\`)`,
    `- **Release Tag**: \`${manifest.repository.releaseTag}\` (${manifest.repository.releaseUrl})`,
    `- **Commit SHA**: \`${manifest.repository.sourceRevision}\``,
    `- **Artifact**: ${manifest.release.artifact.url}`,
    `- **Artifact SHA-256**: \`${manifest.release.artifact.sha256}\` (${manifest.release.artifact.size} bytes)`,
    "",
    "### Declared Permissions",
    "",
    ...permissionLines,
    "",
    auditMarkdown,
    "",
    "### Maintainer Review Checklist",
    "",
    "- [ ] Confirm `reviewed-third-party` copy avoids implying security certification or ongoing compatibility support",
    "- [ ] Verify source repository commit SHA matches the release artifact",
    "- [ ] Review declared permissions and bytecode audit findings above",
    "- [ ] Confirm automated `validate-submission` checks passed before merge",
  ].join("\n");

  return {
    branchName,
    filePath,
    labels,
    title,
    body,
    contentText: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

/**
 * Creates or updates a GitOps submission branch, manifest commit, and Pull Request on the directory repository.
 * Enforces the per-author open PR concurrency cap for new submissions.
 * @param {{ manifest: object, installationToken: string, directoryRepo?: string, baseBranch?: string, fetchImpl?: typeof fetch }} params
 */
export async function createOrUpdateSubmissionPr({
  manifest,
  installationToken,
  directoryRepo = DEFAULT_DIRECTORY_REPO,
  baseBranch = DEFAULT_DIRECTORY_BASE_BRANCH,
  fetchImpl = fetch,
}) {
  if (typeof installationToken !== "string" || installationToken.length === 0) {
    throw createCodedError(ERROR_CODES.GITHUB_APP_CONFIG_MISSING, "GitHub App installation token is required.");
  }
  const parsedRepo = parseRepoSlug(directoryRepo);
  if (!parsedRepo) {
    throw new Error(`Invalid directoryRepo "${directoryRepo}".`);
  }

  const payload = buildSubmissionPrPayload(manifest);
  const githubId = manifest.submitter.githubId;
  const authorLabel = `${LABEL_AUTHOR_ID_PREFIX}${githubId}`;

  const existingOpenPrsUrl = `${GITHUB_API_ORIGIN}/repos/${parsedRepo.fullName}/pulls?state=open&head=${encodeURIComponent(`${parsedRepo.owner}:${payload.branchName}`)}&base=${encodeURIComponent(baseBranch)}`;
  const matchingBranchPrs = await fetchGitHubJson(existingOpenPrsUrl, {
    fetchImpl,
    token: installationToken,
  });
  const existingPr = Array.isArray(matchingBranchPrs) && matchingBranchPrs.length > 0 ? matchingBranchPrs[0] : null;

  if (existingPr === null) {
    const authorIssuesUrl = `${GITHUB_API_ORIGIN}/repos/${parsedRepo.fullName}/issues?state=open&labels=${encodeURIComponent(`${LABEL_PLUGIN_SUBMISSION},${authorLabel}`)}&per_page=${ISSUES_PER_PAGE}`;
    const openAuthorIssues = await fetchGitHubJson(authorIssuesUrl, {
      fetchImpl,
      token: installationToken,
    });
    const openAuthorPrCount = Array.isArray(openAuthorIssues)
      ? openAuthorIssues.filter((item) => item && item.pull_request).length
      : 0;

    if (openAuthorPrCount >= MAX_OPEN_SUBMISSION_PRS_PER_AUTHOR) {
      return {
        ok: false,
        code: ERROR_CODES.SUBMISSION_RATE_LIMITED,
        message: `Author ${githubId} already has ${openAuthorPrCount} open plugin submission PRs (limit: ${MAX_OPEN_SUBMISSION_PRS_PER_AUTHOR}).`,
        details: {
          openCount: openAuthorPrCount,
          limit: MAX_OPEN_SUBMISSION_PRS_PER_AUTHOR,
        },
      };
    }
  }

  const baseRefUrl = `${GITHUB_API_ORIGIN}/repos/${parsedRepo.fullName}/git/ref/heads/${encodePathSegments(baseBranch)}`;
  const baseRef = await fetchGitHubJson(baseRefUrl, { fetchImpl, token: installationToken });
  const baseSha = baseRef?.object?.sha;
  if (typeof baseSha !== "string" || !RE_HEX_SHA_40.test(baseSha)) {
    throw createCodedError(ERROR_CODES.GITHUB_API_ERROR, `Base branch "${baseBranch}" did not resolve to a commit SHA.`);
  }

  const targetRefCheckUrl = `${GITHUB_API_ORIGIN}/repos/${parsedRepo.fullName}/git/ref/heads/${encodePathSegments(payload.branchName)}`;
  const targetRefResponse = await fetchImpl(targetRefCheckUrl, {
    method: "GET",
    headers: {
      Accept: GITHUB_API_ACCEPT,
      Authorization: `Bearer ${installationToken}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": USER_AGENT_HEADER,
    },
    signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
  });
  await targetRefResponse.body?.cancel?.().catch(() => {});

  if (targetRefResponse.status === 404) {
    await fetchGitHubJson(`${GITHUB_API_ORIGIN}/repos/${parsedRepo.fullName}/git/refs`, {
      fetchImpl,
      token: installationToken,
      method: "POST",
      body: {
        ref: `refs/heads/${payload.branchName}`,
        sha: baseSha,
      },
    });
  } else if (!targetRefResponse.ok) {
    throw createCodedError(
      ERROR_CODES.GITHUB_API_ERROR,
      `Failed to inspect submission branch "${payload.branchName}" (HTTP ${targetRefResponse.status}).`,
    );
  }

  const contentEndpoint = `${GITHUB_API_ORIGIN}/repos/${parsedRepo.fullName}/contents/${payload.filePath}`;
  const existingContentResponse = await fetchImpl(`${contentEndpoint}?ref=${encodeURIComponent(payload.branchName)}`, {
    method: "GET",
    headers: {
      Accept: GITHUB_API_ACCEPT,
      Authorization: `Bearer ${installationToken}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": USER_AGENT_HEADER,
    },
    signal: AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS),
  });
  let existingFileSha;
  if (existingContentResponse.status === 200) {
    const existingText = await readResponseTextBounded(
      existingContentResponse,
      MAX_API_RESPONSE_BYTES,
      payload.filePath,
    );
    const existingMeta = parseStrictJson(existingText);
    if (typeof existingMeta?.sha === "string") {
      existingFileSha = existingMeta.sha;
    }
  } else {
    await existingContentResponse.body?.cancel?.().catch(() => {});
  }

  await fetchGitHubJson(contentEndpoint, {
    fetchImpl,
    token: installationToken,
    method: "PUT",
    body: {
      message: `chore(submissions): submit ${manifest.plugin.id} v${manifest.release.version}`,
      content: Buffer.from(payload.contentText, "utf8").toString("base64"),
      branch: payload.branchName,
      ...(existingFileSha ? { sha: existingFileSha } : {}),
    },
  });

  let prRecord;
  let action;
  if (existingPr !== null) {
    action = "updated";
    prRecord = await fetchGitHubJson(`${GITHUB_API_ORIGIN}/repos/${parsedRepo.fullName}/pulls/${existingPr.number}`, {
      fetchImpl,
      token: installationToken,
      method: "PATCH",
      body: {
        title: payload.title,
        body: payload.body,
      },
    });
  } else {
    action = "created";
    prRecord = await fetchGitHubJson(`${GITHUB_API_ORIGIN}/repos/${parsedRepo.fullName}/pulls`, {
      fetchImpl,
      token: installationToken,
      method: "POST",
      body: {
        title: payload.title,
        body: payload.body,
        head: payload.branchName,
        base: baseBranch,
      },
    });
  }

  const prNumber = prRecord?.number;
  let labelsApplied = false;
  if (Number.isSafeInteger(prNumber) && prNumber > 0) {
    try {
      await fetchGitHubJson(`${GITHUB_API_ORIGIN}/repos/${parsedRepo.fullName}/issues/${prNumber}/labels`, {
        fetchImpl,
        token: installationToken,
        method: "POST",
        body: { labels: payload.labels },
      });
      labelsApplied = true;
    } catch {
      labelsApplied = false;
    }
  }

  return {
    ok: true,
    action,
    prNumber,
    prUrl: prRecord?.html_url ?? "",
    branchName: payload.branchName,
    filePath: payload.filePath,
    labelsApplied,
  };
}

/**
 * Aggregates locally cataloged plugins owned by githubId with remote submission Pull Requests.
 * Degrades gracefully when installationToken is absent.
 * @param {{ githubId: number, installationToken?: string, directoryRepo?: string, catalog: { plugins: Array<object> }, ownership: { claims: Record<string, object> }, fetchImpl?: typeof fetch }} params
 */
export async function listAuthorSubmissions({
  githubId,
  installationToken = "",
  directoryRepo = DEFAULT_DIRECTORY_REPO,
  catalog,
  ownership,
  fetchImpl = fetch,
}) {
  if (!Number.isSafeInteger(githubId) || githubId <= 0) {
    throw new Error("githubId must be a positive integer.");
  }
  const catalogPluginsById = new Map();
  for (const plugin of catalog?.plugins ?? []) {
    if (plugin && typeof plugin.id === "string") {
      catalogPluginsById.set(plugin.id, plugin);
    }
  }

  const catalogedPlugins = [];
  for (const [pluginId, claim] of Object.entries(ownership?.claims ?? {})) {
    if (!claim || claim.ownerGithubId !== githubId) continue;
    const entry = catalogPluginsById.get(pluginId);
    const releases = Array.isArray(entry?.releases) ? entry.releases : [];
    const latestRelease = releases.length > 0 ? releases[releases.length - 1] : null;
    catalogedPlugins.push({
      pluginId,
      slug: claim.slug,
      name: entry?.name ?? claim.slug,
      trust: entry?.trust ?? "reviewed-third-party",
      repository: claim.repository,
      claimedAt: claim.claimedAt,
      latestVersion: latestRelease?.version ?? null,
      releasesCount: releases.length,
    });
  }

  if (!installationToken) {
    return {
      catalogedPlugins,
      submissions: [],
      prIntegrationConfigured: false,
    };
  }

  const parsedRepo = parseRepoSlug(directoryRepo);
  if (!parsedRepo) {
    throw new Error(`Invalid directoryRepo "${directoryRepo}".`);
  }
  const authorLabel = `${LABEL_AUTHOR_ID_PREFIX}${githubId}`;
  const issuesUrl = `${GITHUB_API_ORIGIN}/repos/${parsedRepo.fullName}/issues?state=all&labels=${encodeURIComponent(authorLabel)}&per_page=${ISSUES_PER_PAGE}`;
  const issues = await fetchGitHubJson(issuesUrl, { fetchImpl, token: installationToken });
  const submissions = Array.isArray(issues)
    ? issues
      .filter((item) => item && item.pull_request)
      .map((item) => {
        const labels = Array.isArray(item.labels)
          ? item.labels.map((label) => (typeof label === "string" ? label : label?.name)).filter(Boolean)
          : [];
        const slugLabel = labels.find((label) => label.startsWith(LABEL_SLUG_PREFIX));
        const mergedAt = item.pull_request?.merged_at ?? null;
        return {
          number: item.number,
          title: item.title,
          htmlUrl: item.html_url,
          state: mergedAt ? "merged" : item.state,
          mergedAt,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          slug: slugLabel ? slugLabel.slice(LABEL_SLUG_PREFIX.length) : null,
          labels,
        };
      })
    : [];

  return {
    catalogedPlugins,
    submissions,
    prIntegrationConfigured: true,
  };
}
