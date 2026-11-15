import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  AUTH_COOKIE_PATH,
  OAUTH_FLOW_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  clearAuthCookie,
  createOAuthPkcePair,
  isDevMockAuthEnabled,
  parseCookieHeader,
  resolvePublicOrigin,
  sanitizeReturnTo,
  sealOAuthFlow,
  sealSession,
  serializeAuthCookie,
  verifyOAuthFlow,
  verifySession,
} from "../../lib/auth/session.mjs";

const TEST_SECRET = "test-hmac-secret-for-unit-tests-only";

test("createOAuthPkcePair produces RFC 7636 S256 verifier, challenge, and state", () => {
  const pair = createOAuthPkcePair();
  assert.equal(pair.codeChallengeMethod, "S256");
  assert.ok(pair.codeVerifier.length >= 43);
  assert.ok(pair.state.length >= 24);
  const expectedChallenge = createHash("sha256").update(pair.codeVerifier, "ascii").digest("base64url");
  assert.equal(pair.codeChallenge, expectedChallenge);
});

test("sealOAuthFlow and verifyOAuthFlow enforce HMAC integrity, returnTo sanitization, and TTL", () => {
  const nowMs = 1_750_000_000_000;
  const token = sealOAuthFlow(
    { state: "state-123", codeVerifier: "verifier-abc", returnTo: "//evil.com/phish" },
    TEST_SECRET,
    { nowMs },
  );

  const verified = verifyOAuthFlow(token, TEST_SECRET, { nowMs: nowMs + 60_000 });
  assert.equal(verified.ok, true);
  assert.equal(verified.flow.state, "state-123");
  assert.equal(verified.flow.codeVerifier, "verifier-abc");
  assert.equal(verified.flow.returnTo, "/plugins");

  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  assert.equal(verifyOAuthFlow(tampered, TEST_SECRET, { nowMs }).ok, false);
  assert.equal(verifyOAuthFlow(token, "wrong-secret", { nowMs }).ok, false);
  assert.equal(verifyOAuthFlow(token, TEST_SECRET, { nowMs: nowMs + 11 * 60 * 1000 }).ok, false);
});

test("sealSession and verifySession require positive integer githubId and reject expired or tampered tokens", () => {
  const nowMs = 1_750_000_000_000;
  assert.throws(
    () => sealSession({ githubId: 0, login: "octocat" }, TEST_SECRET, { nowMs }),
    /positive integer githubId/,
  );
  assert.throws(
    () => sealSession({ githubId: "123", login: "octocat" }, TEST_SECRET, { nowMs }),
    /positive integer githubId/,
  );

  const token = sealSession(
    { githubId: 42, login: "octocat", name: "The Octocat", avatarUrl: "https://avatars.githubusercontent.com/u/42" },
    TEST_SECRET,
    { nowMs },
  );
  const valid = verifySession(token, TEST_SECRET, { nowMs: nowMs + 86_400_000 });
  assert.equal(valid.ok, true);
  assert.equal(valid.session.githubId, 42);
  assert.equal(valid.session.login, "octocat");

  const expired = verifySession(token, TEST_SECRET, { nowMs: nowMs + 8 * 86_400_000 });
  assert.equal(expired.ok, false);

  const parts = token.split(".");
  const forgedPayload = Buffer.from(
    JSON.stringify({ githubId: 99, login: "mallory", name: "", avatarUrl: "", issuedAt: 100, expiresAt: 9_999_999_999 }),
    "utf8",
  ).toString("base64url");
  assert.equal(verifySession(`${parts[0]}.${forgedPayload}.${parts[2]}`, TEST_SECRET, { nowMs }).ok, false);
});

test("isDevMockAuthEnabled only permits mock auth outside production with ALLOW_DEV_MOCK_AUTH=1", () => {
  assert.equal(isDevMockAuthEnabled({ NODE_ENV: "development", ALLOW_DEV_MOCK_AUTH: "1" }), true);
  assert.equal(isDevMockAuthEnabled({ NODE_ENV: "development", ALLOW_DEV_MOCK_AUTH: "0" }), false);
  assert.equal(isDevMockAuthEnabled({ NODE_ENV: "production", ALLOW_DEV_MOCK_AUTH: "1" }), false);
});

test("sanitizeReturnTo blocks open redirects and keeps valid /plugins relative targets", () => {
  assert.equal(sanitizeReturnTo("/plugins/submit?step=2#preview"), "/plugins/submit?step=2#preview");
  assert.equal(sanitizeReturnTo("/plugins"), "/plugins");
  assert.equal(sanitizeReturnTo("https://evil.example/plugins"), "/plugins");
  assert.equal(sanitizeReturnTo("//evil.example/plugins"), "/plugins");
  assert.equal(sanitizeReturnTo("/\\evil.example/plugins"), "/plugins");
  assert.equal(sanitizeReturnTo("/plugins/../admin"), "/plugins");
  assert.equal(sanitizeReturnTo("/docs"), "/plugins");
  assert.equal(sanitizeReturnTo(null), "/plugins");
});

test("resolvePublicOrigin prefers PUBLIC_APP_ORIGIN and permits only trusted proxy hosts in dev", () => {
  assert.equal(
    resolvePublicOrigin(
      { headers: { host: "evil.example" } },
      { NODE_ENV: "development", PUBLIC_APP_ORIGIN: "https://turboism.dev/plugins" },
    ),
    "https://turboism.dev",
  );
  assert.equal(
    resolvePublicOrigin(
      { headers: { "x-forwarded-host": "preview-123.trycloudflare.com", "x-forwarded-proto": "https" } },
      { NODE_ENV: "development" },
    ),
    "https://preview-123.trycloudflare.com",
  );
  assert.equal(
    resolvePublicOrigin(
      { headers: { host: "localhost:3000" } },
      { NODE_ENV: "development" },
    ),
    "http://localhost:3000",
  );
  assert.equal(
    resolvePublicOrigin(
      { headers: { "x-forwarded-host": "evil.attacker.com", "x-forwarded-proto": "https" } },
      { NODE_ENV: "development" },
    ),
    "https://turboism.dev",
  );
});

test("serializeAuthCookie and parseCookieHeader enforce host-only Path=/plugins HttpOnly SameSite=Lax", () => {
  const cookie = serializeAuthCookie(SESSION_COOKIE_NAME, "abc.def.ghi", {
    origin: "https://turboism.dev",
    maxAgeSeconds: 3600,
  });
  assert.ok(cookie.includes(`${SESSION_COOKIE_NAME}=abc.def.ghi`));
  assert.ok(cookie.includes(`Path=${AUTH_COOKIE_PATH}`));
  assert.ok(cookie.includes("SameSite=Lax"));
  assert.ok(cookie.includes("HttpOnly"));
  assert.ok(cookie.includes("Secure"));
  assert.ok(!cookie.includes("Domain="));

  const cleared = clearAuthCookie(OAUTH_FLOW_COOKIE_NAME, { origin: "http://localhost:3000" });
  assert.ok(cleared.includes("Max-Age=0"));
  assert.ok(!cleared.includes("Secure"));

  const parsed = parseCookieHeader(`${OAUTH_FLOW_COOKIE_NAME}=tok1; ${SESSION_COOKIE_NAME}=tok2`);
  assert.deepEqual(parsed, {
    [OAUTH_FLOW_COOKIE_NAME]: "tok1",
    [SESSION_COOKIE_NAME]: "tok2",
  });
});
