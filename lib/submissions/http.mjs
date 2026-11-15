// Web-API Route Handler implementations for GitHub OAuth authentication and
// third-party plugin submission preflight, PR automation, and author dashboard.
import { lstatSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  OAUTH_FLOW_COOKIE_NAME,
  OAUTH_FLOW_TTL_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  clearAuthCookie,
  createOAuthPkcePair,
  parseCookieHeader,
  resolvePublicOrigin,
  sanitizeReturnTo,
  sealOAuthFlow,
  sealSession,
  serializeAuthCookie,
  verifyOAuthFlow,
  verifySession,
} from "../auth/session.mjs";
import {
  MAX_CATALOG_BYTES,
  validateCatalogBytes,
} from "../catalog-v2/catalog.mjs";
import { renderSafeReadmeMarkdown } from "../readme-renderer.ts";
import {
  buildDevMockJarBytes,
  buildDevMockSimulatedPr,
  getDevMockReleases,
  getDevMockRepositories,
  getDevMockRepositoryByFullName,
  getDevMockUser,
  isDevMockRepository,
} from "./dev-mock-fixtures.mjs";
import {
  ERROR_CODES,
  buildGitHubAuthorizeUrl,
  buildSubmissionPrPayload,
  createInstallationAccessToken,
  createOrUpdateSubmissionPr,
  downloadGitHubReleaseJar,
  exchangeGitHubOAuthCode,
  fetchAuthenticatedGitHubUser,
  listAuthorSubmissions,
  listEligibleRepositoryReleases,
  listPublicUserRepositories,
  resolveSubmissionRuntimeConfig,
  verifyRemoteRepositoryPublisher,
} from "./github-client.mjs";
import { parseOwnershipRegistry } from "./ownership.mjs";
import { runSubmissionPreflight } from "./preflight.mjs";

const HTTP_STATUS = Object.freeze({
  OK: 200,
  CREATED: 201,
  FOUND: 302,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

const PRIVATE_NO_STORE_CACHE = "private, no-store";
const JSON_CONTENT_TYPE = "application/json";
const NOSNIFF_VALUE = "nosniff";
const OAUTH_CALLBACK_PATH = "/plugins/api/auth/github/callback";
const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_OWNERSHIP_FILE_BYTES = 2 * 1024 * 1024;
const TEMP_DIR_PREFIX = "turboism-submission-";
const GITHUB_WEB_BASE = "https://github.com";

const RE_REPO_OWNER_NAME = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const RE_GITHUB_URL_PREFIX = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/i;
const RE_SLUG_SANITIZE = /[^a-z0-9-]+/g;

function defaultCatalogFilePath() {
  return path.join(process.cwd(), "catalog", "v2", "catalog.json");
}

function defaultOwnershipFilePath() {
  return path.join(process.cwd(), "catalog", "v2", "ownership.json");
}

function basePrivateHeaders(extra = {}) {
  return {
    "Cache-Control": PRIVATE_NO_STORE_CACHE,
    "X-Content-Type-Options": NOSNIFF_VALUE,
    ...extra,
  };
}

function jsonResponse(payload, status = HTTP_STATUS.OK, setCookies = []) {
  const headers = new Headers(basePrivateHeaders({ "Content-Type": JSON_CONTENT_TYPE }));
  for (const cookie of setCookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(JSON.stringify(payload), { status, headers });
}

function errorJsonResponse(status, code, message, details = undefined, setCookies = []) {
  const error = { code, message };
  if (details !== undefined) {
    error.details = details;
  }
  return jsonResponse({ error }, status, setCookies);
}

function redirectResponse(locationUrl, setCookies = []) {
  const headers = new Headers(basePrivateHeaders({ Location: locationUrl }));
  for (const cookie of setCookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(null, { status: HTTP_STATUS.FOUND, headers });
}

function readBoundedJsonFile(filePath, maxBytes, label) {
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch {
    throw new Error(`${label} is not readable.`);
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file.`);
  }
  if (stats.size > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} bytes.`);
  }
  return readFileSync(filePath);
}

function loadSourceCatalogAndOwnership(options = {}) {
  let catalog = options.catalog;
  if (!catalog) {
    const catalogPath = options.catalogPath ?? defaultCatalogFilePath();
    const bytes = readBoundedJsonFile(catalogPath, MAX_CATALOG_BYTES, "source catalog");
    const validated = validateCatalogBytes(bytes);
    if (!validated.ok) {
      throw new Error("Source catalog failed schema validation.");
    }
    catalog = validated.catalog;
  }

  let ownership = options.ownership;
  if (!ownership) {
    const ownershipPath = options.ownershipPath ?? defaultOwnershipFilePath();
    const bytes = readBoundedJsonFile(ownershipPath, MAX_OWNERSHIP_FILE_BYTES, "ownership registry");
    const parsed = parseOwnershipRegistry(bytes);
    if (!parsed.ok) {
      throw new Error("Ownership registry failed validation.");
    }
    ownership = parsed.registry;
  }

  return { catalog, ownership };
}

function readRequestCookies(request) {
  return parseCookieHeader(request.headers.get("cookie"));
}

function resolveSessionFromRequest(request, config) {
  if (!config.authSessionSecret) {
    return null;
  }
  const cookies = readRequestCookies(request);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;
  const verified = verifySession(rawToken, config.authSessionSecret);
  return verified.ok ? verified.session : null;
}

function normalizeRepositoryInput(rawRepo) {
  if (typeof rawRepo !== "string") return null;
  const trimmed = rawRepo.trim();
  const direct = RE_REPO_OWNER_NAME.exec(trimmed);
  if (direct) {
    const owner = direct[1];
    const repo = direct[2];
    if (owner === "." || owner === ".." || repo === "." || repo === "..") return null;
    return { owner, repo, fullName: `${owner}/${repo}` };
  }
  const urlMatch = RE_GITHUB_URL_PREFIX.exec(trimmed);
  if (urlMatch) {
    const owner = urlMatch[1];
    const repo = urlMatch[2];
    if (owner === "." || owner === ".." || repo === "." || repo === "..") return null;
    return { owner, repo, fullName: `${owner}/${repo}` };
  }
  return null;
}

function deriveDefaultSlug(repoName, ownership, repoId) {
  for (const claim of Object.values(ownership?.claims ?? {})) {
    if (claim && claim.repoId === repoId && typeof claim.slug === "string") {
      return claim.slug;
    }
  }
  const lower = repoName.toLowerCase();
  const stripped = lower.startsWith("turboism-plugin-")
    ? lower.slice("turboism-plugin-".length)
    : lower.startsWith("turboism-")
      ? lower.slice("turboism-".length)
      : lower;
  const candidate = stripped.replace(RE_SLUG_SANITIZE, "-").replace(/^-+|-+$/g, "");
  return candidate || lower.replace(RE_SLUG_SANITIZE, "-").replace(/^-+|-+$/g, "");
}

function findCatalogedPluginForRepo(repoFullName, catalog, ownership) {
  const repoUrl = `${GITHUB_WEB_BASE}/${repoFullName}`.toLowerCase();
  for (const [pluginId, claim] of Object.entries(ownership?.claims ?? {})) {
    if (!claim || typeof claim.repository !== "string") continue;
    if (claim.repository.toLowerCase() !== repoUrl) continue;
    const entry = (catalog?.plugins ?? []).find((item) => item.id === pluginId);
    const existingVersions = Array.isArray(entry?.releases) ? entry.releases.map((rel) => rel.version) : [];
    return {
      pluginId,
      slug: claim.slug,
      existingVersions,
    };
  }
  for (const entry of catalog?.plugins ?? []) {
    if (typeof entry?.repository === "string" && entry.repository.toLowerCase() === repoUrl) {
      return {
        pluginId: entry.id,
        slug: entry.slug,
        existingVersions: Array.isArray(entry.releases) ? entry.releases.map((rel) => rel.version) : [],
      };
    }
  }
  return null;
}

async function readJsonBodyBounded(request) {
  let rawText;
  try {
    rawText = await request.text();
  } catch {
    return { ok: false, error: "Request body could not be read." };
  }
  if (Buffer.byteLength(rawText, "utf8") > MAX_JSON_BODY_BYTES) {
    return { ok: false, error: `Request body exceeds ${MAX_JSON_BODY_BYTES} bytes.` };
  }
  if (rawText.trim().length === 0) {
    return { ok: false, error: "Request body must be a non-empty JSON object." };
  }
  try {
    const parsed = JSON.parse(rawText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, error: "Request body must be a JSON object." };
    }
    return { ok: true, body: parsed };
  } catch {
    return { ok: false, error: "Request body is not valid JSON." };
  }
}

function validatePreviewOverrides(body) {
  if (body.supportUrl !== undefined && body.supportUrl !== null && body.supportUrl !== "") {
    if (typeof body.supportUrl !== "string") {
      return { ok: false, error: "supportUrl must be a string." };
    }
    try {
      const parsed = new URL(body.supportUrl.trim());
      if (parsed.protocol !== "https:") {
        return { ok: false, error: "supportUrl must use HTTPS." };
      }
    } catch {
      return { ok: false, error: "supportUrl must be a valid HTTPS URL." };
    }
  }
  if (body.summaryOverrides !== undefined && body.summaryOverrides !== null) {
    if (typeof body.summaryOverrides !== "object" || Array.isArray(body.summaryOverrides)) {
      return { ok: false, error: "summaryOverrides must be an object keyed by locale." };
    }
    for (const [locale, text] of Object.entries(body.summaryOverrides)) {
      if (typeof text !== "string" || locale.length === 0) {
        return { ok: false, error: "summaryOverrides values must be strings." };
      }
    }
  }
  return { ok: true };
}

function buildPreviewPayload(manifest, body) {
  const readmesHtml = {};
  for (const [locale, markdown] of Object.entries(manifest.readmes ?? {})) {
    if (typeof markdown === "string" && markdown.trim().length > 0) {
      readmesHtml[locale] = renderSafeReadmeMarkdown(markdown, manifest.repository.url);
    }
  }
  const card = {
    id: manifest.plugin.id,
    slug: manifest.plugin.slug,
    name: manifest.plugin.name,
    summary: typeof body.summaryOverrides?.en === "string" && body.summaryOverrides.en.trim()
      ? body.summaryOverrides.en.trim().slice(0, 500)
      : manifest.plugin.summary,
    trust: manifest.plugin.trust,
    author: manifest.plugin.author,
    license: manifest.plugin.license,
    repository: manifest.plugin.repository,
    support: typeof body.supportUrl === "string" && body.supportUrl.trim()
      ? body.supportUrl.trim()
      : manifest.plugin.support,
    latestVersion: manifest.release.version,
    channel: manifest.release.channel,
    category: manifest.release.category,
    tags: manifest.release.tags,
  };
  return {
    card,
    localizations: manifest.plugin.localizations,
    permissions: manifest.release.permissions,
    bytecodeAudit: manifest.bytecodeAudit,
    readmesHtml,
  };
}

/**
 * Verifies that a mutation request carries an Origin header matching the resolved public origin.
 * @param {Request} request
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ ok: true, origin: string } | { ok: false, error: string }}
 */
export function verifySameOriginMutation(request, env = process.env) {
  const rawOrigin = request.headers.get("origin");
  if (!rawOrigin || rawOrigin.trim().length === 0 || rawOrigin.trim().toLowerCase() === "null") {
    return { ok: false, error: "Missing Origin header for mutation request." };
  }
  let parsedOrigin;
  try {
    parsedOrigin = new URL(rawOrigin.trim());
  } catch {
    return { ok: false, error: "Malformed Origin header." };
  }
  const expectedOrigin = resolvePublicOrigin(request, env);
  if (parsedOrigin.origin !== expectedOrigin) {
    return {
      ok: false,
      error: `Cross-origin mutation rejected (expected ${expectedOrigin}).`,
    };
  }
  return { ok: true, origin: expectedOrigin };
}

/**
 * Handles GET /api/auth/github/login with PKCE S256 redirect or controlled dev-mock login.
 * @param {Request} request
 * @param {{ env?: Record<string, string | undefined> }} [options]
 * @returns {Promise<Response>}
 */
export async function handleAuthGitHubLogin(request, options = {}) {
  const env = options.env ?? process.env;
  const config = resolveSubmissionRuntimeConfig(env);
  const publicOrigin = resolvePublicOrigin(request, env);
  const requestUrl = new URL(request.url);
  const returnTo = sanitizeReturnTo(requestUrl.searchParams.get("returnTo"));
  const forceMock = requestUrl.searchParams.get("mock") === "1";

  if (config.devMockEnabled && (!config.oauthConfigured || forceMock)) {
    const sessionToken = sealSession(getDevMockUser(), config.authSessionSecret);
    const sessionCookie = serializeAuthCookie(SESSION_COOKIE_NAME, sessionToken, {
      origin: publicOrigin,
      maxAgeSeconds: SESSION_TTL_SECONDS,
    });
    const destination = new URL(returnTo, publicOrigin).toString();
    return redirectResponse(destination, [sessionCookie]);
  }

  if (!config.oauthConfigured) {
    return errorJsonResponse(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODES.GITHUB_OAUTH_CONFIG_MISSING,
      "GitHub OAuth credentials are not configured.",
    );
  }

  const pkce = createOAuthPkcePair();
  const flowToken = sealOAuthFlow(
    {
      state: pkce.state,
      codeVerifier: pkce.codeVerifier,
      returnTo,
    },
    config.authSessionSecret,
  );
  const flowCookie = serializeAuthCookie(OAUTH_FLOW_COOKIE_NAME, flowToken, {
    origin: publicOrigin,
    maxAgeSeconds: OAUTH_FLOW_TTL_SECONDS,
  });
  const redirectUri = `${publicOrigin}${OAUTH_CALLBACK_PATH}`;
  const authorizeUrl = buildGitHubAuthorizeUrl({
    clientId: config.githubOAuthClientId,
    redirectUri,
    state: pkce.state,
    codeChallenge: pkce.codeChallenge,
  });
  return redirectResponse(authorizeUrl, [flowCookie]);
}

/**
 * Handles GET /api/auth/github/callback by validating state, exchanging the code, and sealing the session cookie.
 * @param {Request} request
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<Response>}
 */
export async function handleAuthGitHubCallback(request, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = resolveSubmissionRuntimeConfig(env);
  const publicOrigin = resolvePublicOrigin(request, env);
  const clearedFlowCookie = clearAuthCookie(OAUTH_FLOW_COOKIE_NAME, { origin: publicOrigin });

  if (!config.oauthConfigured) {
    return errorJsonResponse(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODES.GITHUB_OAUTH_CONFIG_MISSING,
      "GitHub OAuth credentials are not configured.",
      undefined,
      [clearedFlowCookie],
    );
  }

  const requestUrl = new URL(request.url);
  const oauthError = requestUrl.searchParams.get("error");
  if (oauthError) {
    return errorJsonResponse(
      HTTP_STATUS.BAD_REQUEST,
      "oauth_access_denied",
      "GitHub OAuth authorization was denied or failed.",
      { reason: oauthError },
      [clearedFlowCookie],
    );
  }

  const code = requestUrl.searchParams.get("code") ?? "";
  const state = requestUrl.searchParams.get("state") ?? "";
  const cookies = readRequestCookies(request);
  const flowToken = cookies[OAUTH_FLOW_COOKIE_NAME];

  const verifiedFlow = verifyOAuthFlow(flowToken, config.authSessionSecret);
  if (!verifiedFlow.ok) {
    return errorJsonResponse(
      HTTP_STATUS.BAD_REQUEST,
      "oauth_flow_invalid",
      verifiedFlow.error,
      undefined,
      [clearedFlowCookie],
    );
  }
  if (!state || state !== verifiedFlow.flow.state) {
    return errorJsonResponse(
      HTTP_STATUS.BAD_REQUEST,
      "oauth_state_mismatch",
      "OAuth state parameter does not match the active flow cookie.",
      undefined,
      [clearedFlowCookie],
    );
  }
  if (!code) {
    return errorJsonResponse(
      HTTP_STATUS.BAD_REQUEST,
      "oauth_code_missing",
      "Authorization code query parameter is required.",
      undefined,
      [clearedFlowCookie],
    );
  }

  try {
    const redirectUri = `${publicOrigin}${OAUTH_CALLBACK_PATH}`;
    const tokenResult = await exchangeGitHubOAuthCode({
      clientId: config.githubOAuthClientId,
      clientSecret: config.githubOAuthClientSecret,
      code,
      redirectUri,
      codeVerifier: verifiedFlow.flow.codeVerifier,
      fetchImpl,
    });
    const user = await fetchAuthenticatedGitHubUser({
      accessToken: tokenResult.accessToken,
      fetchImpl,
    });
    const sessionToken = sealSession(user, config.authSessionSecret);
    const sessionCookie = serializeAuthCookie(SESSION_COOKIE_NAME, sessionToken, {
      origin: publicOrigin,
      maxAgeSeconds: SESSION_TTL_SECONDS,
    });
    const destination = new URL(verifiedFlow.flow.returnTo, publicOrigin).toString();
    return redirectResponse(destination, [sessionCookie, clearedFlowCookie]);
  } catch (error) {
    return errorJsonResponse(
      HTTP_STATUS.BAD_REQUEST,
      error?.code ?? ERROR_CODES.GITHUB_OAUTH_EXCHANGE_FAILED,
      error instanceof Error ? error.message : "OAuth login failed.",
      undefined,
      [clearedFlowCookie],
    );
  }
}

/**
 * Handles GET /api/auth/session, returning authenticated user state and platform capabilities.
 * @param {Request} request
 * @param {{ env?: Record<string, string | undefined> }} [options]
 * @returns {Promise<Response>}
 */
export async function handleAuthSession(request, options = {}) {
  const env = options.env ?? process.env;
  const config = resolveSubmissionRuntimeConfig(env);
  const session = resolveSessionFromRequest(request, config);

  return jsonResponse({
    authenticated: session !== null,
    user: session
      ? {
          githubId: session.githubId,
          login: session.login,
          name: session.name,
          avatarUrl: session.avatarUrl,
        }
      : null,
    capabilities: {
      oauthConfigured: config.oauthConfigured,
      devMockEnabled: config.devMockEnabled,
      submissionBotConfigured: config.submissionBotConfigured,
    },
  });
}

/**
 * Handles POST /api/auth/logout with same-origin CSRF enforcement and cookie clearing.
 * @param {Request} request
 * @param {{ env?: Record<string, string | undefined> }} [options]
 * @returns {Promise<Response>}
 */
export async function handleAuthLogout(request, options = {}) {
  const env = options.env ?? process.env;
  const originCheck = verifySameOriginMutation(request, env);
  if (!originCheck.ok) {
    return errorJsonResponse(HTTP_STATUS.FORBIDDEN, "csrf_origin_mismatch", originCheck.error);
  }
  const publicOrigin = originCheck.origin;
  return jsonResponse(
    { ok: true },
    HTTP_STATUS.OK,
    [
      clearAuthCookie(SESSION_COOKIE_NAME, { origin: publicOrigin }),
      clearAuthCookie(OAUTH_FLOW_COOKIE_NAME, { origin: publicOrigin }),
    ],
  );
}

/**
 * Handles GET /api/submissions/repos, listing public active repositories for the logged-in developer.
 * @param {Request} request
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<Response>}
 */
export async function handleSubmissionsRepos(request, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = resolveSubmissionRuntimeConfig(env);
  const session = resolveSessionFromRequest(request, config);
  if (!session) {
    return errorJsonResponse(HTTP_STATUS.UNAUTHORIZED, "unauthorized", "Authentication required.");
  }

  const mockUser = getDevMockUser();
  if (config.devMockEnabled && session.githubId === mockUser.githubId) {
    return jsonResponse({ repositories: getDevMockRepositories() });
  }

  try {
    const repositories = await listPublicUserRepositories({ login: session.login, fetchImpl });
    if (config.devMockEnabled) {
      return jsonResponse({ repositories: [...getDevMockRepositories(), ...repositories] });
    }
    return jsonResponse({ repositories });
  } catch (error) {
    return errorJsonResponse(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      error?.code ?? ERROR_CODES.GITHUB_API_ERROR,
      error instanceof Error ? error.message : "Failed to load public repositories.",
    );
  }
}

/**
 * Handles GET /api/submissions/releases?repo=<owner>/<repo>, verifying ownership and listing eligible JAR releases.
 * @param {Request} request
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, catalog?: object, ownership?: object, catalogPath?: string, ownershipPath?: string }} [options]
 * @returns {Promise<Response>}
 */
export async function handleSubmissionsReleases(request, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = resolveSubmissionRuntimeConfig(env);
  const session = resolveSessionFromRequest(request, config);
  if (!session) {
    return errorJsonResponse(HTTP_STATUS.UNAUTHORIZED, "unauthorized", "Authentication required.");
  }

  const requestUrl = new URL(request.url);
  const parsedRepo = normalizeRepositoryInput(requestUrl.searchParams.get("repo"));
  if (!parsedRepo) {
    return errorJsonResponse(
      HTTP_STATUS.BAD_REQUEST,
      "invalid_repository",
      "Query parameter repo must be formatted as <owner>/<repo>.",
    );
  }

  let catalog;
  let ownership;
  try {
    ({ catalog, ownership } = loadSourceCatalogAndOwnership(options));
  } catch (error) {
    return errorJsonResponse(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "catalog_load_failed",
      error instanceof Error ? error.message : "Failed to load catalog state.",
    );
  }

  const catalogedPlugin = findCatalogedPluginForRepo(parsedRepo.fullName, catalog, ownership);

  if (config.devMockEnabled && isDevMockRepository(parsedRepo.fullName)) {
    const mockRepo = getDevMockRepositoryByFullName(parsedRepo.fullName);
    return jsonResponse({
      repository: {
        id: mockRepo.id,
        fullName: mockRepo.fullName,
        url: mockRepo.htmlUrl,
        defaultBranch: mockRepo.defaultBranch,
        owner: mockRepo.owner,
        isMock: true,
      },
      verificationReason: "repo_owner",
      releases: getDevMockReleases(parsedRepo.fullName),
      catalogedPlugin,
    });
  }

  try {
    const verification = await verifyRemoteRepositoryPublisher({
      owner: parsedRepo.owner,
      repo: parsedRepo.repo,
      submitter: session,
      fetchImpl,
    });
    if (!verification.ok) {
      return errorJsonResponse(
        HTTP_STATUS.FORBIDDEN,
        "publisher_verification_failed",
        verification.error ?? "Submitter is not authorized to publish from this repository.",
      );
    }

    const releases = await listEligibleRepositoryReleases({
      owner: parsedRepo.owner,
      repo: parsedRepo.repo,
      fetchImpl,
    });

    return jsonResponse({
      repository: verification.repo,
      verificationReason: verification.reason,
      releases,
      catalogedPlugin,
    });
  } catch (error) {
    return errorJsonResponse(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      error?.code ?? ERROR_CODES.GITHUB_API_ERROR,
      error instanceof Error ? error.message : "Failed to load repository releases.",
    );
  }
}

async function executeAuthoritativePreflight({
  body,
  session,
  config,
  catalog,
  ownership,
  fetchImpl,
}) {
  const parsedRepo = normalizeRepositoryInput(body.repository);
  if (!parsedRepo) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      code: "invalid_repository",
      message: "Field repository must be formatted as <owner>/<repo>.",
    };
  }
  const tag = typeof body.tag === "string" ? body.tag.trim() : "";
  if (!tag) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      code: "invalid_release_tag",
      message: "Field tag is required.",
    };
  }
  const overrideCheck = validatePreviewOverrides(body);
  if (!overrideCheck.ok) {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      code: "invalid_preview_overrides",
      message: overrideCheck.error,
    };
  }

  const isMockTarget = config.devMockEnabled && isDevMockRepository(parsedRepo.fullName);
  let verifiedRepo;
  let verificationReason;
  let releases;

  if (isMockTarget) {
    const mockRepo = getDevMockRepositoryByFullName(parsedRepo.fullName);
    verifiedRepo = {
      id: mockRepo.id,
      fullName: mockRepo.fullName,
      url: mockRepo.htmlUrl,
      defaultBranch: mockRepo.defaultBranch,
    };
    verificationReason = "repo_owner";
    releases = getDevMockReleases(parsedRepo.fullName);
  } else {
    const verification = await verifyRemoteRepositoryPublisher({
      owner: parsedRepo.owner,
      repo: parsedRepo.repo,
      submitter: session,
      fetchImpl,
    });
    if (!verification.ok) {
      return {
        ok: false,
        status: HTTP_STATUS.FORBIDDEN,
        code: "publisher_verification_failed",
        message: verification.error ?? "Publisher verification failed.",
      };
    }
    verifiedRepo = verification.repo;
    verificationReason = verification.reason;
    releases = await listEligibleRepositoryReleases({
      owner: parsedRepo.owner,
      repo: parsedRepo.repo,
      fetchImpl,
    });
  }

  const release = releases.find((item) => item.tagName === tag);
  if (!release) {
    return {
      ok: false,
      status: HTTP_STATUS.NOT_FOUND,
      code: "release_not_found",
      message: `Eligible non-draft release for tag "${tag}" was not found.`,
    };
  }

  const requestedAssetName = typeof body.assetFileName === "string" ? body.assetFileName.trim() : "";
  let selectedAsset = null;
  if (requestedAssetName) {
    selectedAsset = release.assets.find((item) => item.name === requestedAssetName) ?? null;
    if (!selectedAsset) {
      return {
        ok: false,
        status: HTTP_STATUS.NOT_FOUND,
        code: "asset_not_found",
        message: `JAR asset "${requestedAssetName}" was not found on release "${tag}".`,
      };
    }
  } else if (release.assets.length === 1) {
    selectedAsset = release.assets[0];
  } else {
    return {
      ok: false,
      status: HTTP_STATUS.BAD_REQUEST,
      code: "ambiguous_asset",
      message: "Multiple JAR assets exist on this release; specify assetFileName explicitly.",
    };
  }

  const requestedSlug = typeof body.slug === "string" && body.slug.trim().length > 0
    ? body.slug.trim()
    : deriveDefaultSlug(parsedRepo.repo, ownership, verifiedRepo.id);

  const canonicalReleaseUrl = `${GITHUB_WEB_BASE}/${parsedRepo.fullName}/releases/tag/${release.tagName}`;
  const canonicalArtifactUrl = `${GITHUB_WEB_BASE}/${parsedRepo.fullName}/releases/download/${release.tagName}/${selectedAsset.name}`;

  const tempDir = mkdtempSync(path.join(tmpdir(), TEMP_DIR_PREFIX));
  try {
    let jarInput;
    if (isMockTarget) {
      jarInput = buildDevMockJarBytes();
    } else {
      const destPath = path.join(tempDir, selectedAsset.name);
      await downloadGitHubReleaseJar({
        url: selectedAsset.browserDownloadUrl,
        expectedSize: selectedAsset.size,
        destPath,
        fetchImpl,
      });
      jarInput = destPath;
    }

    const preflight = runSubmissionPreflight({
      jarPathOrBytes: jarInput,
      slug: requestedSlug,
      assetFileName: selectedAsset.name,
      artifactUrl: canonicalArtifactUrl,
      releaseUrl: canonicalReleaseUrl,
      channel: release.channel,
      publishedAt: release.publishedAt,
      sourceRevision: release.sourceRevision,
      submitter: {
        githubId: session.githubId,
        login: session.login,
        name: session.name,
        verificationReason,
      },
      repository: {
        id: verifiedRepo.id,
        fullName: verifiedRepo.fullName,
        url: verifiedRepo.url,
        defaultBranch: verifiedRepo.defaultBranch,
        releaseTag: release.tagName,
      },
      catalog,
      ownership,
    });

    if (!preflight.ok) {
      return {
        ok: false,
        status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
        code: "preflight_failed",
        message: "Plugin JAR failed submission preflight checks.",
        details: { issues: preflight.errors },
      };
    }

    return {
      ok: true,
      manifest: preflight.manifest,
      isFirstClaim: preflight.isFirstClaim,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Handles POST /api/submissions/preflight with CSRF protection, bounded JAR download, and preview rendering.
 * @param {Request} request
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, catalog?: object, ownership?: object, catalogPath?: string, ownershipPath?: string }} [options]
 * @returns {Promise<Response>}
 */
export async function handleSubmissionsPreflight(request, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = resolveSubmissionRuntimeConfig(env);
  const session = resolveSessionFromRequest(request, config);
  if (!session) {
    return errorJsonResponse(HTTP_STATUS.UNAUTHORIZED, "unauthorized", "Authentication required.");
  }
  const originCheck = verifySameOriginMutation(request, env);
  if (!originCheck.ok) {
    return errorJsonResponse(HTTP_STATUS.FORBIDDEN, "csrf_origin_mismatch", originCheck.error);
  }
  const parsedBody = await readJsonBodyBounded(request);
  if (!parsedBody.ok) {
    return errorJsonResponse(HTTP_STATUS.BAD_REQUEST, "invalid_request_body", parsedBody.error);
  }

  let catalog;
  let ownership;
  try {
    ({ catalog, ownership } = loadSourceCatalogAndOwnership(options));
  } catch (error) {
    return errorJsonResponse(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "catalog_load_failed",
      error instanceof Error ? error.message : "Failed to load catalog state.",
    );
  }

  try {
    const result = await executeAuthoritativePreflight({
      body: parsedBody.body,
      session,
      config,
      catalog,
      ownership,
      fetchImpl,
    });
    if (!result.ok) {
      return errorJsonResponse(result.status, result.code, result.message, result.details);
    }
    return jsonResponse({
      ok: true,
      isFirstClaim: result.isFirstClaim,
      manifest: result.manifest,
      preview: buildPreviewPayload(result.manifest, parsedBody.body),
    });
  } catch (error) {
    return errorJsonResponse(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      error?.code ?? ERROR_CODES.GITHUB_API_ERROR,
      error instanceof Error ? error.message : "Preflight execution failed.",
    );
  }
}

/**
 * Handles POST /api/submissions/submit by re-running authoritative preflight and opening a submission PR.
 * @param {Request} request
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, catalog?: object, ownership?: object, catalogPath?: string, ownershipPath?: string }} [options]
 * @returns {Promise<Response>}
 */
export async function handleSubmissionsSubmit(request, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = resolveSubmissionRuntimeConfig(env);
  const session = resolveSessionFromRequest(request, config);
  if (!session) {
    return errorJsonResponse(HTTP_STATUS.UNAUTHORIZED, "unauthorized", "Authentication required.");
  }
  const originCheck = verifySameOriginMutation(request, env);
  if (!originCheck.ok) {
    return errorJsonResponse(HTTP_STATUS.FORBIDDEN, "csrf_origin_mismatch", originCheck.error);
  }
  const parsedBody = await readJsonBodyBounded(request);
  if (!parsedBody.ok) {
    return errorJsonResponse(HTTP_STATUS.BAD_REQUEST, "invalid_request_body", parsedBody.error);
  }

  let catalog;
  let ownership;
  try {
    ({ catalog, ownership } = loadSourceCatalogAndOwnership(options));
  } catch (error) {
    return errorJsonResponse(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "catalog_load_failed",
      error instanceof Error ? error.message : "Failed to load catalog state.",
    );
  }

  try {
    const result = await executeAuthoritativePreflight({
      body: parsedBody.body,
      session,
      config,
      catalog,
      ownership,
      fetchImpl,
    });
    if (!result.ok) {
      return errorJsonResponse(result.status, result.code, result.message, result.details);
    }

    if (config.submissionBotConfigured) {
      const tokenResult = await createInstallationAccessToken({
        appId: config.githubSubmissionAppId,
        installationId: config.githubSubmissionInstallationId,
        privateKeyPem: config.githubSubmissionPrivateKeyPem,
        fetchImpl,
      });
      const prResult = await createOrUpdateSubmissionPr({
        manifest: result.manifest,
        installationToken: tokenResult.token,
        directoryRepo: config.directoryRepo,
        baseBranch: config.directoryBaseBranch,
        fetchImpl,
      });
      if (!prResult.ok) {
        return errorJsonResponse(
          HTTP_STATUS.TOO_MANY_REQUESTS,
          prResult.code,
          prResult.message,
          prResult.details,
        );
      }
      return jsonResponse(
        {
          ok: true,
          simulated: false,
          pr: prResult,
          manifest: result.manifest,
        },
        prResult.action === "created" ? HTTP_STATUS.CREATED : HTTP_STATUS.OK,
      );
    }

    if (config.devMockEnabled) {
      const prPayload = buildSubmissionPrPayload(result.manifest);
      const mockSimulatedPr = buildDevMockSimulatedPr({
        manifest: result.manifest,
        directoryRepo: config.directoryRepo,
        baseBranch: config.directoryBaseBranch,
        title: prPayload.title,
        body: prPayload.body,
        labels: prPayload.labels,
        branchName: prPayload.branchName,
        filePath: prPayload.filePath,
      });
      return jsonResponse({
        ok: true,
        simulated: true,
        mockSimulatedPr,
        manifest: result.manifest,
      });
    }

    return errorJsonResponse(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      ERROR_CODES.GITHUB_APP_CONFIG_MISSING,
      "GitHub submission bot is not configured.",
    );
  } catch (error) {
    return errorJsonResponse(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      error?.code ?? ERROR_CODES.GITHUB_API_ERROR,
      error instanceof Error ? error.message : "Submission failed.",
    );
  }
}

/**
 * Handles GET /api/submissions/mine, aggregating locally cataloged owned plugins and remote submission PRs.
 * @param {Request} request
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch, catalog?: object, ownership?: object, catalogPath?: string, ownershipPath?: string }} [options]
 * @returns {Promise<Response>}
 */
export async function handleSubmissionsMine(request, options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = resolveSubmissionRuntimeConfig(env);
  const session = resolveSessionFromRequest(request, config);
  if (!session) {
    return errorJsonResponse(HTTP_STATUS.UNAUTHORIZED, "unauthorized", "Authentication required.");
  }

  let catalog;
  let ownership;
  try {
    ({ catalog, ownership } = loadSourceCatalogAndOwnership(options));
  } catch (error) {
    return errorJsonResponse(
      HTTP_STATUS.INTERNAL_SERVER_ERROR,
      "catalog_load_failed",
      error instanceof Error ? error.message : "Failed to load catalog state.",
    );
  }

  try {
    let installationToken = "";
    if (config.submissionBotConfigured) {
      const tokenResult = await createInstallationAccessToken({
        appId: config.githubSubmissionAppId,
        installationId: config.githubSubmissionInstallationId,
        privateKeyPem: config.githubSubmissionPrivateKeyPem,
        fetchImpl,
      });
      installationToken = tokenResult.token;
    }

    const overview = await listAuthorSubmissions({
      githubId: session.githubId,
      installationToken,
      directoryRepo: config.directoryRepo,
      catalog,
      ownership,
      fetchImpl,
    });

    return jsonResponse({
      ...overview,
      user: {
        githubId: session.githubId,
        login: session.login,
        name: session.name,
        avatarUrl: session.avatarUrl,
      },
    });
  } catch (error) {
    return errorJsonResponse(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      error?.code ?? ERROR_CODES.GITHUB_API_ERROR,
      error instanceof Error ? error.message : "Failed to load author submissions.",
    );
  }
}
