import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeZip } from "../catalog-v2/fixtures.mjs";
import { validateCatalogBytes } from "../../lib/catalog-v2/catalog.mjs";
import {
  OAUTH_FLOW_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  sealSession,
} from "../../lib/auth/session.mjs";
import {
  DEV_MOCK_REPO_FULL_NAME,
  DEV_MOCK_RELEASE_TAG,
} from "../../lib/submissions/dev-mock-fixtures.mjs";
import {
  ERROR_CODES,
  buildGitHubAuthorizeUrl,
  createGitHubAppJwt,
  createOrUpdateSubmissionPr,
  downloadGitHubReleaseJar,
} from "../../lib/submissions/github-client.mjs";
import {
  handleAuthGitHubCallback,
  handleAuthGitHubLogin,
  handleAuthLogout,
  handleAuthSession,
  handleSubmissionsMine,
  handleSubmissionsPreflight,
  handleSubmissionsReleases,
  handleSubmissionsRepos,
  handleSubmissionsSubmit,
} from "../../lib/submissions/http.mjs";
import {
  OWNERSHIP_FORMAT,
  OWNERSHIP_SCHEMA_VERSION,
  parseOwnershipRegistry,
} from "../../lib/submissions/ownership.mjs";
import { runSubmissionPreflight } from "../../lib/submissions/preflight.mjs";
import { runIngestSubmission } from "../../scripts/catalog-v2/ingest-submission.mjs";
import { syncMergedSubmissions } from "../../scripts/catalog-v2/sync-merged-submissions.mjs";

const PUBLIC_ORIGIN = "https://turboism.dev";
const TEST_SESSION_SECRET = "unit-test-session-secret-0123456789abcdef";
const TEST_REPO_OWNER = "acme";
const TEST_REPO_NAME = "turboism-mesh-helper";
const TEST_REPO_FULL_NAME = `${TEST_REPO_OWNER}/${TEST_REPO_NAME}`;
const TEST_REPO_ID = 551001;
const TEST_REPO_URL = `https://github.com/${TEST_REPO_FULL_NAME}`;
const TEST_TAG = "v1.0.0";
const TEST_ASSET_NAME = "mesh-helper-1.0.0.jar";
const TEST_SOURCE_SHA = "b".repeat(40);
const TEST_PUBLISHED_AT = "2026-10-05T08:30:00Z";
const TEST_USER = {
  githubId: 777001,
  login: "acme-maintainer",
  name: "Acme Maintainer",
  avatarUrl: "https://avatars.githubusercontent.com/u/777001",
};

function makeRsaKeyPair() {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

function buildMinimalClassBytes() {
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

  const thisClassIdx = addClass("com/acme/meshhelper/MeshHelperPlugin");
  const superClassIdx = addClass("java/lang/Object");
  addMethodRef("java/net/http/HttpClient", "newHttpClient", "()Ljava/net/http/HttpClient;");

  const header = Buffer.alloc(10);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt16BE(0, 4);
  header.writeUInt16BE(65, 6);
  header.writeUInt16BE(cpEntries.length + 1, 8);

  const body = Buffer.alloc(14);
  body.writeUInt16BE(0x0021, 0);
  body.writeUInt16BE(thisClassIdx, 2);
  body.writeUInt16BE(superClassIdx, 4);
  return Buffer.concat([header, ...cpEntries, body]);
}

function buildValidTestJarBytes() {
  const descriptor = {
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
    website: TEST_REPO_URL,
    resources: ["assets/mesh-helper/"],
    i18n: {
      baseName: "assets/mesh-helper/messages",
      locales: ["zh_Hans"],
    },
    dependencies: [],
    permissions: [
      { id: "turboism.network.fetch", scope: "user", reason: "Fetch remote mesh presets." },
    ],
    environment: { requiresCubism: false, ui: "swing" },
    lifecycle: { hotReload: true },
    category: "modeling",
    tags: ["mesh", "helper"],
  };

  return makeZip([
    { name: "META-INF/MANIFEST.MF", data: "Manifest-Version: 1.0\r\n\r\n" },
    { name: "META-INF/turboism/plugin.json", data: JSON.stringify(descriptor) },
    { name: "com/acme/meshhelper/MeshHelperPlugin.class", data: buildMinimalClassBytes() },
    { name: "assets/mesh-helper/messages.properties", data: "plugin.name=Mesh Helper\nplugin.description=Inspect and refine mesh weights.\n" },
    { name: "assets/mesh-helper/messages_zh_Hans.properties", data: "plugin.name=网格助手\nplugin.description=检查并优化网格权重。\n" },
    { name: "META-INF/turboism/readme/README.md", data: "# Mesh Helper\n\nSafe markdown docs.\n" },
  ]);
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

function extractCookiePairs(response) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  const map = {};
  for (const headerValue of setCookies) {
    const firstPart = headerValue.split(";")[0];
    const eqIdx = firstPart.indexOf("=");
    if (eqIdx > 0) {
      const name = firstPart.slice(0, eqIdx).trim();
      const value = firstPart.slice(eqIdx + 1).trim();
      // A clearing header carries an empty value; keep the real value when both appear.
      if (value.length > 0 || map[name] === undefined) {
        map[name] = value;
      }
    }
  }
  return map;
}

test("buildGitHubAuthorizeUrl includes scope for Ov* OAuth Apps and omits scope for Iv* GitHub Apps", () => {
  const baseParams = {
    redirectUri: `${PUBLIC_ORIGIN}/plugins/api/auth/github/callback`,
    state: "state_token_123",
    codeChallenge: "pkce_challenge_456",
  };

  const oauthAppUrl = new URL(buildGitHubAuthorizeUrl({
    clientId: "Ov23liClassicOAuthApp",
    ...baseParams,
  }));
  assert.equal(oauthAppUrl.origin, "https://github.com");
  assert.equal(oauthAppUrl.pathname, "/login/oauth/authorize");
  assert.equal(oauthAppUrl.searchParams.get("client_id"), "Ov23liClassicOAuthApp");
  assert.equal(oauthAppUrl.searchParams.get("redirect_uri"), baseParams.redirectUri);
  assert.equal(oauthAppUrl.searchParams.get("scope"), "read:user");
  assert.equal(oauthAppUrl.searchParams.get("state"), baseParams.state);
  assert.equal(oauthAppUrl.searchParams.get("code_challenge"), baseParams.codeChallenge);
  assert.equal(oauthAppUrl.searchParams.get("code_challenge_method"), "S256");

  for (const appClientId of ["Iv1.unifiedAppClient", "Iv23liUnifiedAppClient"]) {
    const githubAppUrl = new URL(buildGitHubAuthorizeUrl({
      clientId: appClientId,
      ...baseParams,
    }));
    assert.equal(githubAppUrl.origin, "https://github.com");
    assert.equal(githubAppUrl.pathname, "/login/oauth/authorize");
    assert.equal(githubAppUrl.searchParams.get("client_id"), appClientId);
    assert.equal(githubAppUrl.searchParams.get("redirect_uri"), baseParams.redirectUri);
    assert.equal(githubAppUrl.searchParams.has("scope"), false);
    assert.equal(githubAppUrl.searchParams.get("state"), baseParams.state);
    assert.equal(githubAppUrl.searchParams.get("code_challenge"), baseParams.codeChallenge);
    assert.equal(githubAppUrl.searchParams.get("code_challenge_method"), "S256");
  }
});

test("createGitHubAppJwt signs valid RS256 token with clock-drift backdate and 9-minute expiry", () => {
  const { privateKey, publicKey } = makeRsaKeyPair();
  const nowSec = 1_760_000_000;
  const jwt = createGitHubAppJwt({ appId: "123456", privateKeyPem: privateKey, nowSeconds: nowSec });
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);

  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  assert.deepEqual(header, { alg: "RS256", typ: "JWT" });
  assert.equal(claims.iss, "123456");
  assert.equal(claims.iat, nowSec - 60);
  assert.equal(claims.exp, nowSec + 540);

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`, "utf8");
  assert.equal(verifier.verify(publicKey, Buffer.from(parts[2], "base64url")), true);
});

test("downloadGitHubReleaseJar follows allowlisted redirects, rejects untrusted hosts, and cleans up oversized files", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "turboism-dl-test-"));
  try {
    const jarBytes = buildValidTestJarBytes();
    const validDest = path.join(workDir, "valid.jar");

    const okResult = await downloadGitHubReleaseJar({
      url: `https://github.com/${TEST_REPO_FULL_NAME}/releases/download/${TEST_TAG}/${TEST_ASSET_NAME}`,
      expectedSize: jarBytes.byteLength,
      destPath: validDest,
      fetchImpl: async (url) => {
        if (url.startsWith("https://github.com/")) {
          return new Response(null, {
            status: 302,
            headers: { location: "https://objects.githubusercontent.com/assets/mesh-helper.jar" },
          });
        }
        assert.equal(url, "https://objects.githubusercontent.com/assets/mesh-helper.jar");
        return new Response(jarBytes, {
          status: 200,
          headers: { "content-length": String(jarBytes.byteLength) },
        });
      },
    });
    assert.equal(okResult.size, jarBytes.byteLength);
    assert.equal(okResult.sha256, createHash("sha256").update(jarBytes).digest("hex"));
    assert.ok(existsSync(validDest));

    const blockedDest = path.join(workDir, "blocked.jar");
    await assert.rejects(
      () => downloadGitHubReleaseJar({
        url: `https://github.com/${TEST_REPO_FULL_NAME}/releases/download/${TEST_TAG}/${TEST_ASSET_NAME}`,
        destPath: blockedDest,
        fetchImpl: async () => new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/malware.jar" },
        }),
      }),
      (error) => error.code === ERROR_CODES.UNTRUSTED_DOWNLOAD_HOST,
    );
    assert.equal(existsSync(blockedDest), false);

    const oversizeDest = path.join(workDir, "oversize.jar");
    await assert.rejects(
      () => downloadGitHubReleaseJar({
        url: `https://github.com/${TEST_REPO_FULL_NAME}/releases/download/${TEST_TAG}/${TEST_ASSET_NAME}`,
        expectedSize: 16,
        destPath: oversizeDest,
        fetchImpl: async () => new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(10));
              controller.enqueue(new Uint8Array(20));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      }),
      (error) => error.code === ERROR_CODES.ARTIFACT_SIZE_INVALID,
    );
    assert.equal(existsSync(oversizeDest), false);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test("createOrUpdateSubmissionPr enforces per-author open PR limit for new submissions", async () => {
  const jarBytes = buildValidTestJarBytes();
  const preflight = runSubmissionPreflight({
    jarPathOrBytes: jarBytes,
    slug: "mesh-helper",
    assetFileName: TEST_ASSET_NAME,
    artifactUrl: `${TEST_REPO_URL}/releases/download/${TEST_TAG}/${TEST_ASSET_NAME}`,
    releaseUrl: `${TEST_REPO_URL}/releases/tag/${TEST_TAG}`,
    publishedAt: TEST_PUBLISHED_AT,
    sourceRevision: TEST_SOURCE_SHA,
    submitter: { ...TEST_USER, verificationReason: "repo_owner" },
    repository: {
      id: TEST_REPO_ID,
      fullName: TEST_REPO_FULL_NAME,
      url: TEST_REPO_URL,
      defaultBranch: "main",
      releaseTag: TEST_TAG,
    },
    catalog: makeBaseCatalog(),
    ownership: makeBaseOwnership(),
  });
  assert.equal(preflight.ok, true);

  const rateLimited = await createOrUpdateSubmissionPr({
    manifest: preflight.manifest,
    installationToken: "ghs_test_token",
    fetchImpl: async (url) => {
      if (url.includes("/pulls?state=open")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/issues?state=open")) {
        return new Response(
          JSON.stringify([
            { number: 1, pull_request: {} },
            { number: 2, pull_request: {} },
            { number: 3, pull_request: {} },
          ]),
          { status: 200 },
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });
  assert.equal(rateLimited.ok, false);
  assert.equal(rateLimited.code, ERROR_CODES.SUBMISSION_RATE_LIMITED);
});

test("OAuth login, callback, session, logout, state mismatch, CSRF guard, and dev mock switch", async () => {
  const oauthEnv = {
    NODE_ENV: "development",
    PUBLIC_APP_ORIGIN: PUBLIC_ORIGIN,
    GITHUB_OAUTH_CLIENT_ID: "gh_client_123",
    GITHUB_OAUTH_CLIENT_SECRET: "gh_secret_456",
    AUTH_SESSION_SECRET: TEST_SESSION_SECRET,
  };

  const loginRes = await handleAuthGitHubLogin(
    new Request(`${PUBLIC_ORIGIN}/plugins/api/auth/github/login?returnTo=/plugins/submit`),
    { env: oauthEnv },
  );
  assert.equal(loginRes.status, 302);
  const authRedirect = new URL(loginRes.headers.get("location"));
  assert.equal(authRedirect.origin, "https://github.com");
  assert.equal(authRedirect.searchParams.get("scope"), "read:user");
  assert.equal(authRedirect.searchParams.get("code_challenge_method"), "S256");
  const state = authRedirect.searchParams.get("state");
  const loginCookies = extractCookiePairs(loginRes);
  assert.ok(loginCookies[OAUTH_FLOW_COOKIE_NAME]);

  const badStateRes = await handleAuthGitHubCallback(
    new Request(`${PUBLIC_ORIGIN}/plugins/api/auth/github/callback?code=code_1&state=wrong_state`, {
      headers: { cookie: `${OAUTH_FLOW_COOKIE_NAME}=${loginCookies[OAUTH_FLOW_COOKIE_NAME]}` },
    }),
    { env: oauthEnv },
  );
  assert.equal(badStateRes.status, 400);
  const badStateJson = await badStateRes.json();
  assert.equal(badStateJson.error.code, "oauth_state_mismatch");

  const callbackRes = await handleAuthGitHubCallback(
    new Request(`${PUBLIC_ORIGIN}/plugins/api/auth/github/callback?code=code_ok&state=${encodeURIComponent(state)}`, {
      headers: { cookie: `${OAUTH_FLOW_COOKIE_NAME}=${loginCookies[OAUTH_FLOW_COOKIE_NAME]}` },
    }),
    {
      env: oauthEnv,
      fetchImpl: async (url) => {
        if (url === "https://github.com/login/oauth/access_token") {
          return new Response(JSON.stringify({ access_token: "gho_user_token", token_type: "bearer" }), { status: 200 });
        }
        if (url === "https://api.github.com/user") {
          return new Response(
            JSON.stringify({
              id: TEST_USER.githubId,
              login: TEST_USER.login,
              name: TEST_USER.name,
              avatar_url: TEST_USER.avatarUrl,
            }),
            { status: 200 },
          );
        }
        throw new Error(`Unexpected OAuth fetch URL: ${url}`);
      },
    },
  );
  assert.equal(callbackRes.status, 302);
  assert.equal(callbackRes.headers.get("location"), `${PUBLIC_ORIGIN}/plugins/submit`);
  const callbackCookies = extractCookiePairs(callbackRes);
  const sessionCookieValue = callbackCookies[SESSION_COOKIE_NAME];
  assert.ok(sessionCookieValue);

  const sessionRes = await handleAuthSession(
    new Request(`${PUBLIC_ORIGIN}/plugins/api/auth/session`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionCookieValue}` },
    }),
    { env: oauthEnv },
  );
  assert.equal(sessionRes.status, 200);
  assert.equal(sessionRes.headers.get("cache-control"), "private, no-store");
  const sessionJson = await sessionRes.json();
  assert.equal(sessionJson.authenticated, true);
  assert.equal(sessionJson.user.githubId, TEST_USER.githubId);
  assert.equal(sessionJson.capabilities.oauthConfigured, true);

  const csrfBlockedRes = await handleAuthLogout(
    new Request(`${PUBLIC_ORIGIN}/plugins/api/auth/logout`, {
      method: "POST",
      headers: { origin: "https://evil.attacker.example" },
    }),
    { env: oauthEnv },
  );
  assert.equal(csrfBlockedRes.status, 403);
  assert.equal((await csrfBlockedRes.json()).error.code, "csrf_origin_mismatch");

  const logoutRes = await handleAuthLogout(
    new Request(`${PUBLIC_ORIGIN}/plugins/api/auth/logout`, {
      method: "POST",
      headers: {
        origin: PUBLIC_ORIGIN,
        cookie: `${SESSION_COOKIE_NAME}=${sessionCookieValue}`,
      },
    }),
    { env: oauthEnv },
  );
  assert.equal(logoutRes.status, 200);
  const clearedCookies = extractCookiePairs(logoutRes);
  assert.equal(clearedCookies[SESSION_COOKIE_NAME], "");

  const prodMockEnv = {
    NODE_ENV: "production",
    ALLOW_DEV_MOCK_AUTH: "1",
    PUBLIC_APP_ORIGIN: PUBLIC_ORIGIN,
    AUTH_SESSION_SECRET: TEST_SESSION_SECRET,
  };
  const prodSessionRes = await handleAuthSession(
    new Request(`${PUBLIC_ORIGIN}/plugins/api/auth/session`),
    { env: prodMockEnv },
  );
  assert.equal((await prodSessionRes.json()).capabilities.devMockEnabled, false);
});

test("preflight and submit routes verify JAR on server, block CSRF, and open submission PR", async () => {
  const { privateKey } = makeRsaKeyPair();
  const jarBytes = buildValidTestJarBytes();
  const sessionToken = sealSession(TEST_USER, TEST_SESSION_SECRET);
  const env = {
    NODE_ENV: "production",
    PUBLIC_APP_ORIGIN: PUBLIC_ORIGIN,
    AUTH_SESSION_SECRET: TEST_SESSION_SECRET,
    GITHUB_OAUTH_CLIENT_ID: "gh_client",
    GITHUB_OAUTH_CLIENT_SECRET: "gh_secret",
    GITHUB_SUBMISSION_APP_ID: "998877",
    GITHUB_SUBMISSION_INSTALLATION_ID: "665544",
    GITHUB_SUBMISSION_PRIVATE_KEY_PEM: privateKey,
    GITHUB_DIRECTORY_REPO: "turboism/turboism-plugin-directory",
    GITHUB_DIRECTORY_BASE_BRANCH: "main",
  };

  let createdBranch = null;
  let committedFile = null;
  let createdPr = null;
  let appliedLabels = null;

  const mockGitHubFetch = async (url, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    if (url.startsWith(`https://api.github.com/users/${TEST_USER.login}/repos`)) {
      return new Response(
        JSON.stringify([
          {
            id: TEST_REPO_ID,
            name: TEST_REPO_NAME,
            full_name: TEST_REPO_FULL_NAME,
            html_url: TEST_REPO_URL,
            default_branch: "main",
            private: false,
            archived: false,
            disabled: false,
            updated_at: TEST_PUBLISHED_AT,
            owner: { id: TEST_USER.githubId, login: TEST_USER.login, type: "User" },
          },
        ]),
        { status: 200 },
      );
    }
    if (url === `https://api.github.com/repos/${TEST_REPO_FULL_NAME}`) {
      return new Response(
        JSON.stringify({
          id: TEST_REPO_ID,
          full_name: TEST_REPO_FULL_NAME,
          default_branch: "main",
          private: false,
          archived: false,
          disabled: false,
          owner: { id: TEST_USER.githubId, login: TEST_USER.login, type: "User" },
        }),
        { status: 200 },
      );
    }
    if (url.startsWith(`https://api.github.com/repos/${TEST_REPO_FULL_NAME}/releases`)) {
      return new Response(
        JSON.stringify([
          {
            id: 101,
            tag_name: TEST_TAG,
            name: "Mesh Helper 1.0.0",
            html_url: `${TEST_REPO_URL}/releases/tag/${TEST_TAG}`,
            draft: false,
            prerelease: false,
            published_at: TEST_PUBLISHED_AT,
            assets: [
              {
                id: 202,
                name: TEST_ASSET_NAME,
                size: jarBytes.byteLength,
                content_type: "application/java-archive",
                browser_download_url: `${TEST_REPO_URL}/releases/download/${TEST_TAG}/${TEST_ASSET_NAME}`,
              },
            ],
          },
        ]),
        { status: 200 },
      );
    }
    if (url === `https://api.github.com/repos/${TEST_REPO_FULL_NAME}/git/ref/tags/${encodeURIComponent(TEST_TAG)}`) {
      return new Response(JSON.stringify({ object: { type: "tag", sha: "c".repeat(40) } }), { status: 200 });
    }
    if (url === `https://api.github.com/repos/${TEST_REPO_FULL_NAME}/git/tags/${"c".repeat(40)}`) {
      return new Response(JSON.stringify({ object: { type: "commit", sha: TEST_SOURCE_SHA } }), { status: 200 });
    }
    if (url === `${TEST_REPO_URL}/releases/download/${TEST_TAG}/${TEST_ASSET_NAME}`) {
      return new Response(jarBytes, {
        status: 200,
        headers: { "content-length": String(jarBytes.byteLength) },
      });
    }
    if (url === "https://api.github.com/app/installations/665544/access_tokens" && method === "POST") {
      return new Response(JSON.stringify({ token: "ghs_install_tok", expires_at: "2026-10-05T09:30:00Z" }), { status: 201 });
    }
    if (url.startsWith("https://api.github.com/repos/turboism/turboism-plugin-directory/pulls?state=open")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.startsWith("https://api.github.com/repos/turboism/turboism-plugin-directory/issues?state=open")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url === "https://api.github.com/repos/turboism/turboism-plugin-directory/git/ref/heads/main") {
      return new Response(JSON.stringify({ object: { sha: "d".repeat(40) } }), { status: 200 });
    }
    if (url.startsWith("https://api.github.com/repos/turboism/turboism-plugin-directory/git/ref/heads/submission/")) {
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }
    if (url === "https://api.github.com/repos/turboism/turboism-plugin-directory/git/refs" && method === "POST") {
      createdBranch = JSON.parse(init.body);
      return new Response(JSON.stringify({ ref: createdBranch.ref }), { status: 201 });
    }
    if (url.startsWith("https://api.github.com/repos/turboism/turboism-plugin-directory/contents/catalog/v2/submissions/") && method === "GET") {
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }
    if (url.startsWith("https://api.github.com/repos/turboism/turboism-plugin-directory/contents/catalog/v2/submissions/") && method === "PUT") {
      committedFile = JSON.parse(init.body);
      return new Response(JSON.stringify({ content: { path: url } }), { status: 201 });
    }
    if (url === "https://api.github.com/repos/turboism/turboism-plugin-directory/pulls" && method === "POST") {
      createdPr = JSON.parse(init.body);
      return new Response(JSON.stringify({ number: 42, html_url: "https://github.com/turboism/turboism-plugin-directory/pull/42" }), { status: 201 });
    }
    if (url === "https://api.github.com/repos/turboism/turboism-plugin-directory/issues/42/labels" && method === "POST") {
      appliedLabels = JSON.parse(init.body);
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (url.startsWith("https://api.github.com/repos/turboism/turboism-plugin-directory/issues?state=all")) {
      return new Response(
        JSON.stringify([
          {
            number: 42,
            title: createdPr?.title ?? "submission",
            html_url: "https://github.com/turboism/turboism-plugin-directory/pull/42",
            state: "open",
            created_at: TEST_PUBLISHED_AT,
            updated_at: TEST_PUBLISHED_AT,
            labels: [{ name: "plugin-submission" }, { name: `author-id:${TEST_USER.githubId}` }, { name: "slug:mesh-helper" }],
            pull_request: { merged_at: null },
          },
        ]),
        { status: 200 },
      );
    }
    throw new Error(`Unhandled fetch ${method} ${url}`);
  };

  const catalog = makeBaseCatalog();
  const ownership = makeBaseOwnership();

  const reposRes = await handleSubmissionsRepos(
    new Request(`${PUBLIC_ORIGIN}/plugins/api/submissions/repos`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
    }),
    { env, fetchImpl: mockGitHubFetch },
  );
  assert.equal(reposRes.status, 200);
  assert.equal((await reposRes.json()).repositories[0].fullName, TEST_REPO_FULL_NAME);

  const releasesRes = await handleSubmissionsReleases(
    new Request(`${PUBLIC_ORIGIN}/plugins/api/submissions/releases?repo=${encodeURIComponent(TEST_REPO_FULL_NAME)}`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
    }),
    { env, fetchImpl: mockGitHubFetch, catalog, ownership },
  );
  assert.equal(releasesRes.status, 200);
  const releasesJson = await releasesRes.json();
  assert.equal(releasesJson.releases[0].sourceRevision, TEST_SOURCE_SHA);

  const preflightRes = await handleSubmissionsPreflight(
    new Request(`${PUBLIC_ORIGIN}/plugins/api/submissions/preflight`, {
      method: "POST",
      headers: {
        origin: PUBLIC_ORIGIN,
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repository: TEST_REPO_FULL_NAME,
        tag: TEST_TAG,
      }),
    }),
    { env, fetchImpl: mockGitHubFetch, catalog, ownership },
  );
  assert.equal(preflightRes.status, 200);
  const preflightJson = await preflightRes.json();
  assert.equal(preflightJson.ok, true);
  assert.equal(preflightJson.manifest.plugin.slug, "mesh-helper");
  assert.ok(preflightJson.preview.readmesHtml.en.includes("<h1>Mesh Helper</h1>"));

  const submitRes = await handleSubmissionsSubmit(
    new Request(`${PUBLIC_ORIGIN}/plugins/api/submissions/submit`, {
      method: "POST",
      headers: {
        origin: PUBLIC_ORIGIN,
        cookie: `${SESSION_COOKIE_NAME}=${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repository: TEST_REPO_FULL_NAME,
        tag: TEST_TAG,
        // Tampered client field must be ignored because server re-runs full preflight.
        bytecodeAudit: { riskLevel: "low", findings: [] },
      }),
    }),
    { env, fetchImpl: mockGitHubFetch, catalog, ownership },
  );
  assert.equal(submitRes.status, 201);
  const submitJson = await submitRes.json();
  assert.equal(submitJson.pr.prNumber, 42);
  assert.equal(createdBranch.ref, "refs/heads/submission/mesh-helper-v1.0.0");
  assert.ok(committedFile.content);
  assert.ok(createdPr.body.includes("Reviewed third-party"));
  assert.ok(createdPr.body.includes("### Bytecode Static Audit"));
  assert.deepEqual(appliedLabels.labels, [
    "plugin-submission",
    `author-id:${TEST_USER.githubId}`,
    "slug:mesh-helper",
  ]);

  const mineRes = await handleSubmissionsMine(
    new Request(`${PUBLIC_ORIGIN}/plugins/api/submissions/mine`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionToken}` },
    }),
    { env, fetchImpl: mockGitHubFetch, catalog, ownership },
  );
  assert.equal(mineRes.status, 200);
  const mineJson = await mineRes.json();
  assert.equal(mineJson.prIntegrationConfigured, true);
  assert.equal(mineJson.submissions[0].number, 42);
});

test("login clears the legacy /plugins session cookie so the host-wide session wins", async () => {
  const devEnv = {
    NODE_ENV: "development",
    ALLOW_DEV_MOCK_AUTH: "1",
    PUBLIC_APP_ORIGIN: "http://localhost:3000",
  };
  const loginRes = await handleAuthGitHubLogin(
    new Request("http://localhost:3000/plugins/api/auth/github/login?returnTo=/plugins/submit"),
    { env: devEnv },
  );
  assert.equal(loginRes.status, 302);
  const setCookies = loginRes.headers.getSetCookie();
  const legacyClear = setCookies.find(
    (value) => value.startsWith(`${SESSION_COOKIE_NAME}=;`) && value.includes("Path=/plugins;"),
  );
  assert.ok(legacyClear, "login must clear the pre-migration cookie scoped to /plugins");
  assert.ok(legacyClear.includes("Max-Age=0"));
  const hostWide = setCookies.find(
    (value) => value.startsWith(`${SESSION_COOKIE_NAME}=v1.`) && value.includes("Path=/;"),
  );
  assert.ok(hostWide, "login must issue the host-wide session cookie");
});

test("dev mock mode completes login, preflight, and simulated PR without GitHub secrets", async () => {
  const devEnv = {
    NODE_ENV: "development",
    ALLOW_DEV_MOCK_AUTH: "1",
    PUBLIC_APP_ORIGIN: "http://localhost:3000",
  };
  const loginRes = await handleAuthGitHubLogin(
    new Request("http://localhost:3000/plugins/api/auth/github/login?returnTo=/plugins/submit"),
    { env: devEnv },
  );
  assert.equal(loginRes.status, 302);
  const sessionCookie = extractCookiePairs(loginRes)[SESSION_COOKIE_NAME];
  assert.ok(sessionCookie);

  const submitRes = await handleSubmissionsSubmit(
    new Request("http://localhost:3000/plugins/api/submissions/submit", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `${SESSION_COOKIE_NAME}=${sessionCookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        repository: DEV_MOCK_REPO_FULL_NAME,
        tag: DEV_MOCK_RELEASE_TAG,
      }),
    }),
    {
      env: devEnv,
      catalog: makeBaseCatalog(),
      ownership: makeBaseOwnership(),
    },
  );
  assert.equal(submitRes.status, 200);
  const submitJson = await submitRes.json();
  assert.equal(submitJson.simulated, true);
  assert.equal(submitJson.mockSimulatedPr.slug, "mesh-inspector");
  assert.equal(submitJson.mockSimulatedPr.branchName, "submission/mesh-inspector-v1.0.0");
});

test("ingest-submission --dry-run and sync-merged-submissions verify remote JAR and merge idempotently", async () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "turboism-sync-test-"));
  try {
    const jarBytes = buildValidTestJarBytes();
    const preflight = runSubmissionPreflight({
      jarPathOrBytes: jarBytes,
      slug: "mesh-helper",
      assetFileName: TEST_ASSET_NAME,
      artifactUrl: `${TEST_REPO_URL}/releases/download/${TEST_TAG}/${TEST_ASSET_NAME}`,
      releaseUrl: `${TEST_REPO_URL}/releases/tag/${TEST_TAG}`,
      publishedAt: TEST_PUBLISHED_AT,
      sourceRevision: TEST_SOURCE_SHA,
      submitter: { ...TEST_USER, verificationReason: "repo_owner" },
      repository: {
        id: TEST_REPO_ID,
        fullName: TEST_REPO_FULL_NAME,
        url: TEST_REPO_URL,
        defaultBranch: "main",
        releaseTag: TEST_TAG,
      },
      catalog: makeBaseCatalog(),
      ownership: makeBaseOwnership(),
    });
    assert.equal(preflight.ok, true);

    const submissionsDir = path.join(workDir, "submissions");
    const manifestPath = path.join(submissionsDir, "mesh-helper", "1.0.0.json");
    const catalogPath = path.join(workDir, "catalog.json");
    const ownershipPath = path.join(workDir, "ownership.json");
    const summaryPath = path.join(workDir, "summary.md");

    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(preflight.manifest, null, 2)}\n`, "utf8");
    writeFileSync(catalogPath, `${JSON.stringify(makeBaseCatalog(), null, 2)}\n`, "utf8");
    writeFileSync(ownershipPath, `${JSON.stringify(makeBaseOwnership(), null, 2)}\n`, "utf8");

    const remoteJarFetch = async (url) => {
      assert.equal(url, `${TEST_REPO_URL}/releases/download/${TEST_TAG}/${TEST_ASSET_NAME}`);
      return new Response(jarBytes, {
        status: 200,
        headers: { "content-length": String(jarBytes.byteLength) },
      });
    };

    const dryRunResult = await runIngestSubmission({
      manifestPath,
      catalogPath,
      ownershipPath,
      summaryOut: summaryPath,
      dryRun: true,
      fetchImpl: remoteJarFetch,
    });
    assert.equal(dryRunResult.dryRun, true);
    assert.equal(dryRunResult.catalog.catalogVersion, 2);
    const summaryText = readFileSync(summaryPath, "utf8");
    assert.ok(summaryText.includes("### Bytecode Static Audit"));
    assert.ok(summaryText.includes("com.acme.mesh-helper@1.0.0"));

    const firstSync = await syncMergedSubmissions({
      submissionsDir,
      catalogPath,
      ownershipPath,
      fetchImpl: remoteJarFetch,
    });
    assert.equal(firstSync.changed, true);
    assert.equal(firstSync.ingested.length, 1);
    assert.equal(firstSync.catalogVersion, 2);

    const catalogValidation = validateCatalogBytes(readFileSync(catalogPath));
    assert.equal(catalogValidation.ok, true);
    assert.equal(catalogValidation.catalog.plugins.length, 1);
    const ownershipValidation = parseOwnershipRegistry(readFileSync(ownershipPath));
    assert.equal(ownershipValidation.ok, true);
    assert.equal(ownershipValidation.registry.claims["com.acme.mesh-helper"].ownerGithubId, TEST_USER.githubId);

    const secondSync = await syncMergedSubmissions({
      submissionsDir,
      catalogPath,
      ownershipPath,
      fetchImpl: () => {
        throw new Error("Idempotent sync should not re-download already cataloged JARs.");
      },
    });
    assert.equal(secondSync.changed, false);
    assert.equal(secondSync.ingested.length, 0);
    assert.equal(secondSync.skipped.length, 1);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
