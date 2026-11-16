// Stateless GitHub OAuth PKCE, HMAC-SHA256 sealed cookies, and gateway-aware origin helpers.
// Zero third-party dependencies so Next.js routes, CLI tools, and node:test share one implementation.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parseStrictJson } from "../catalog-v2/catalog.mjs";

export const OAUTH_FLOW_COOKIE_NAME = "turboism_plugin_oauth_flow";
export const SESSION_COOKIE_NAME = "turboism_plugin_session";
export const OAUTH_FLOW_TTL_SECONDS = 10 * 60;
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
// The session cookie spans the whole apex host so sibling deployments (turboism.dev/download)
// can verify the same login. The short-lived OAuth flow cookie stays scoped to /plugins.
export const AUTH_COOKIE_PATH = "/";
export const OAUTH_FLOW_COOKIE_PATH = "/plugins";
export const DEFAULT_RETURN_TO = "/plugins";
const RETURN_TO_PATH_PREFIX = DEFAULT_RETURN_TO;
export const DEFAULT_PUBLIC_ORIGIN = "https://turboism.dev";

const TOKEN_FORMAT_VERSION = "v1";
const TOKEN_SEPARATOR = ".";
const HMAC_ALGORITHM = "sha256";
const HASH_ALGORITHM = "sha256";
const PKCE_VERIFIER_BYTES = 32;
const OAUTH_STATE_BYTES = 24;
const PKCE_CHALLENGE_METHOD = "S256";
const MAX_TOKEN_BYTES = 8192;
const MILLISECONDS_PER_SECOND = 1000;
const SAME_SITE_LAX = "Lax";
const DEV_MOCK_AUTH_ENABLED_FLAG = "1";
const PRODUCTION_NODE_ENV = "production";
const PLACEHOLDER_ORIGIN = "https://placeholder.invalid";

const TRUSTED_LOCAL_HOSTNAMES = Object.freeze(["localhost", "127.0.0.1", "::1", "[::1]"]);
const TRUSTED_TUNNEL_SUFFIX = ".trycloudflare.com";
const ALLOWED_PROTOCOLS = Object.freeze(["http", "https"]);

const RE_CONTROL_CHARS = /[\u0000-\u001F\u007F]/;
const RE_HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;
const RE_COOKIE_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function toBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(encoded) {
  if (typeof encoded !== "string" || encoded.length === 0 || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    return null;
  }
  const buffer = Buffer.from(encoded, "base64url");
  // Reject non-canonical base64url encodings that change on round-trip.
  if (buffer.toString("base64url") !== encoded) {
    return null;
  }
  return buffer;
}

function requireSecret(secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("Auth cookie secret must be a non-empty string.");
  }
  return secret;
}

function nowSeconds(nowMs) {
  const timestamp = nowMs === undefined ? Date.now() : nowMs;
  if (!Number.isFinite(timestamp) || timestamp < 0) {
    throw new Error("Timestamp must be a non-negative finite number.");
  }
  return Math.floor(timestamp / MILLISECONDS_PER_SECOND);
}

function signTokenPayload(payload, secret) {
  requireSecret(secret);
  const encodedPayload = toBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const signingInput = `${TOKEN_FORMAT_VERSION}${TOKEN_SEPARATOR}${encodedPayload}`;
  const digest = createHmac(HMAC_ALGORITHM, secret).update(signingInput, "utf8").digest();
  return `${signingInput}${TOKEN_SEPARATOR}${toBase64Url(digest)}`;
}

function verifyTokenEnvelope(token, secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    return { ok: false, error: "Auth secret is missing." };
  }
  if (typeof token !== "string" || token.length === 0 || Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) {
    return { ok: false, error: "Token is missing or exceeds size limits." };
  }
  const parts = token.split(TOKEN_SEPARATOR);
  if (parts.length !== 3 || parts[0] !== TOKEN_FORMAT_VERSION) {
    return { ok: false, error: "Token format is invalid." };
  }
  const encodedPayload = parts[1];
  const actualSignature = fromBase64Url(parts[2]);
  if (actualSignature === null) {
    return { ok: false, error: "Token signature encoding is invalid." };
  }
  const signingInput = `${parts[0]}${TOKEN_SEPARATOR}${encodedPayload}`;
  const expectedSignature = createHmac(HMAC_ALGORITHM, secret).update(signingInput, "utf8").digest();
  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    return { ok: false, error: "Token signature verification failed." };
  }
  const payloadBytes = fromBase64Url(encodedPayload);
  if (payloadBytes === null) {
    return { ok: false, error: "Token payload encoding is invalid." };
  }
  let parsed;
  try {
    parsed = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch {
    return { ok: false, error: "Token payload is not valid strict JSON." };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: "Token payload must be a JSON object." };
  }
  return { ok: true, payload: parsed };
}

function isPositiveSafeInt(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/**
 * Generates an RFC 7636 S256 PKCE verifier/challenge pair and an OAuth CSRF state token.
 * @returns {{ state: string, codeVerifier: string, codeChallenge: string, codeChallengeMethod: "S256" }}
 */
export function createOAuthPkcePair() {
  const codeVerifier = toBase64Url(randomBytes(PKCE_VERIFIER_BYTES));
  const codeChallenge = toBase64Url(createHash(HASH_ALGORITHM).update(codeVerifier, "ascii").digest());
  const state = toBase64Url(randomBytes(OAUTH_STATE_BYTES));
  return {
    state,
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: PKCE_CHALLENGE_METHOD,
  };
}

/**
 * Seals an OAuth flow payload with HMAC-SHA256 for short-lived cookie storage.
 * @param {{ state: string, codeVerifier: string, returnTo?: string }} payload
 * @param {string} secret
 * @param {{ nowMs?: number, ttlSeconds?: number }} [options]
 * @returns {string}
 */
export function sealOAuthFlow(payload, secret, options = {}) {
  if (!payload || !isNonEmptyString(payload.state) || !isNonEmptyString(payload.codeVerifier)) {
    throw new Error("OAuth flow payload requires non-empty state and codeVerifier.");
  }
  const issuedAt = nowSeconds(options.nowMs);
  const ttlSeconds = options.ttlSeconds ?? OAUTH_FLOW_TTL_SECONDS;
  if (!isPositiveSafeInt(ttlSeconds)) {
    throw new Error("OAuth flow TTL must be a positive safe integer.");
  }
  const canonicalPayload = {
    state: payload.state,
    codeVerifier: payload.codeVerifier,
    returnTo: sanitizeReturnTo(payload.returnTo),
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
  };
  return signTokenPayload(canonicalPayload, secret);
}

/**
 * Verifies an HMAC-sealed OAuth flow token and rejects expired or malformed payloads.
 * @param {string} token
 * @param {string} secret
 * @param {{ nowMs?: number }} [options]
 * @returns {{ ok: true, flow: { state: string, codeVerifier: string, returnTo: string, issuedAt: number, expiresAt: number } } | { ok: false, error: string }}
 */
export function verifyOAuthFlow(token, secret, options = {}) {
  const verified = verifyTokenEnvelope(token, secret);
  if (!verified.ok) return verified;
  const { state, codeVerifier, returnTo, issuedAt, expiresAt } = verified.payload;
  if (!isNonEmptyString(state) || !isNonEmptyString(codeVerifier) || typeof returnTo !== "string") {
    return { ok: false, error: "OAuth flow payload is missing required fields." };
  }
  if (!isPositiveSafeInt(issuedAt) || !isPositiveSafeInt(expiresAt) || expiresAt <= issuedAt) {
    return { ok: false, error: "OAuth flow timestamps are invalid." };
  }
  if (nowSeconds(options.nowMs) >= expiresAt) {
    return { ok: false, error: "OAuth flow token has expired." };
  }
  return {
    ok: true,
    flow: {
      state,
      codeVerifier,
      returnTo: sanitizeReturnTo(returnTo),
      issuedAt,
      expiresAt,
    },
  };
}

/**
 * Seals an authenticated GitHub user session with HMAC-SHA256.
 * @param {{ githubId: number, login: string, name?: string | null, avatarUrl?: string | null }} user
 * @param {string} secret
 * @param {{ nowMs?: number, ttlSeconds?: number }} [options]
 * @returns {string}
 */
export function sealSession(user, secret, options = {}) {
  if (!user || !isPositiveSafeInt(user.githubId) || !isNonEmptyString(user.login)) {
    throw new Error("Session requires a positive integer githubId and a non-empty login.");
  }
  if (user.name !== undefined && user.name !== null && typeof user.name !== "string") {
    throw new Error("Session name must be a string or null.");
  }
  if (user.avatarUrl !== undefined && user.avatarUrl !== null && typeof user.avatarUrl !== "string") {
    throw new Error("Session avatarUrl must be a string or null.");
  }
  const issuedAt = nowSeconds(options.nowMs);
  const ttlSeconds = options.ttlSeconds ?? SESSION_TTL_SECONDS;
  if (!isPositiveSafeInt(ttlSeconds)) {
    throw new Error("Session TTL must be a positive safe integer.");
  }
  const canonicalPayload = {
    githubId: user.githubId,
    login: user.login,
    name: user.name ?? "",
    avatarUrl: user.avatarUrl ?? "",
    issuedAt,
    expiresAt: issuedAt + ttlSeconds,
  };
  return signTokenPayload(canonicalPayload, secret);
}

/**
 * Verifies an HMAC-sealed login session token and enforces positive numeric githubId and expiry.
 * @param {string} token
 * @param {string} secret
 * @param {{ nowMs?: number }} [options]
 * @returns {{ ok: true, session: { githubId: number, login: string, name: string, avatarUrl: string, issuedAt: number, expiresAt: number } } | { ok: false, error: string }}
 */
export function verifySession(token, secret, options = {}) {
  const verified = verifyTokenEnvelope(token, secret);
  if (!verified.ok) return verified;
  const { githubId, login, name, avatarUrl, issuedAt, expiresAt } = verified.payload;
  if (!isPositiveSafeInt(githubId) || !isNonEmptyString(login)) {
    return { ok: false, error: "Session identity fields are invalid." };
  }
  if (typeof name !== "string" || typeof avatarUrl !== "string") {
    return { ok: false, error: "Session profile fields must be strings." };
  }
  if (!isPositiveSafeInt(issuedAt) || !isPositiveSafeInt(expiresAt) || expiresAt <= issuedAt) {
    return { ok: false, error: "Session timestamps are invalid." };
  }
  if (nowSeconds(options.nowMs) >= expiresAt) {
    return { ok: false, error: "Session token has expired." };
  }
  return {
    ok: true,
    session: { githubId, login, name, avatarUrl, issuedAt, expiresAt },
  };
}

/**
 * Allows mock authentication only outside production when explicitly enabled.
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function isDevMockAuthEnabled(env = process.env) {
  return env.NODE_ENV !== PRODUCTION_NODE_ENV && env.ALLOW_DEV_MOCK_AUTH === DEV_MOCK_AUTH_ENABLED_FLAG;
}

function readHeaderValue(source, name) {
  if (!source) return null;
  const headers = typeof source.headers === "object" && source.headers !== null ? source.headers : source;
  if (typeof headers.get === "function") {
    return headers.get(name);
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== lower) continue;
    if (Array.isArray(value)) return value[0] ?? null;
    return typeof value === "string" ? value : null;
  }
  return null;
}

function parseTrustedHostList(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function extractHostname(hostHeaderValue) {
  if (hostHeaderValue.startsWith("[")) {
    const closeIdx = hostHeaderValue.indexOf("]");
    if (closeIdx === -1) return null;
    return hostHeaderValue.slice(0, closeIdx + 1).toLowerCase();
  }
  const colonIdx = hostHeaderValue.indexOf(":");
  const hostname = colonIdx === -1 ? hostHeaderValue : hostHeaderValue.slice(0, colonIdx);
  return hostname.toLowerCase();
}

function isTrustedProxyHost(hostHeaderValue, env) {
  const trimmed = hostHeaderValue.split(",")[0].trim();
  if (trimmed.length === 0 || RE_CONTROL_CHARS.test(trimmed) || /[\s/@\\?#]/.test(trimmed)) {
    return null;
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(`http://${trimmed}`);
  } catch {
    return null;
  }
  if (parsedUrl.host.toLowerCase() !== trimmed.toLowerCase()) {
    return null;
  }
  const hostname = extractHostname(trimmed);
  if (!hostname) return null;
  if (TRUSTED_LOCAL_HOSTNAMES.includes(hostname)) {
    return trimmed;
  }
  if (hostname.endsWith(TRUSTED_TUNNEL_SUFFIX) && hostname.length > TRUSTED_TUNNEL_SUFFIX.length) {
    const prefix = hostname.slice(0, -TRUSTED_TUNNEL_SUFFIX.length);
    if (RE_HOST_LABEL_PATTERN.test(prefix)) {
      return trimmed;
    }
  }
  const extraHosts = parseTrustedHostList(env.TRUSTED_PROXY_HOSTS);
  if (extraHosts.includes(hostname) || extraHosts.includes(trimmed.toLowerCase())) {
    return trimmed;
  }
  return null;
}

/**
 * Resolves the canonical public origin, preferring PUBLIC_APP_ORIGIN and falling back to
 * trusted preview proxy headers outside production.
 * @param {Request | Headers | Record<string, string | string[] | undefined>} [requestOrHeaders]
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function resolvePublicOrigin(requestOrHeaders, env = process.env) {
  const configured = env.PUBLIC_APP_ORIGIN;
  if (typeof configured === "string" && configured.trim().length > 0) {
    try {
      const parsed = new URL(configured.trim());
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        parsed.username === "" &&
        parsed.password === "" &&
        parsed.hostname !== ""
      ) {
        return parsed.origin;
      }
    } catch {
      // Ignore malformed configured origin and fall back safely.
    }
  }
  if (env.NODE_ENV === PRODUCTION_NODE_ENV) {
    return DEFAULT_PUBLIC_ORIGIN;
  }
  const rawForwardedHost = readHeaderValue(requestOrHeaders, "x-forwarded-host");
  const rawHost = readHeaderValue(requestOrHeaders, "host");
  const candidateHost = rawForwardedHost ?? rawHost;
  if (candidateHost) {
    const trustedHost = isTrustedProxyHost(candidateHost, env);
    if (trustedHost !== null) {
      const rawProto = readHeaderValue(requestOrHeaders, "x-forwarded-proto")?.split(",")[0].trim().toLowerCase();
      let protocol = rawProto && ALLOWED_PROTOCOLS.includes(rawProto) ? rawProto : null;
      if (protocol === null && typeof requestOrHeaders?.url === "string") {
        try {
          const reqProto = new URL(requestOrHeaders.url).protocol.replace(":", "");
          if (ALLOWED_PROTOCOLS.includes(reqProto)) protocol = reqProto;
        } catch {
          // Ignore unparseable request URLs.
        }
      }
      if (protocol === null) {
        const hostname = extractHostname(trustedHost);
        protocol = hostname && TRUSTED_LOCAL_HOSTNAMES.includes(hostname) ? "http" : "https";
      }
      return `${protocol}://${trustedHost}`;
    }
  }
  return DEFAULT_PUBLIC_ORIGIN;
}

/**
 * Restricts returnTo redirects to relative paths under /plugins to prevent open redirects.
 * @param {unknown} input
 * @returns {string}
 */
export function sanitizeReturnTo(input) {
  if (typeof input !== "string") return DEFAULT_RETURN_TO;
  const trimmed = input.trim();
  if (
    trimmed.length === 0 ||
    RE_CONTROL_CHARS.test(trimmed) ||
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.includes("\\")
  ) {
    return DEFAULT_RETURN_TO;
  }
  let parsed;
  try {
    parsed = new URL(trimmed, PLACEHOLDER_ORIGIN);
  } catch {
    return DEFAULT_RETURN_TO;
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN || parsed.username !== "" || parsed.password !== "") {
    return DEFAULT_RETURN_TO;
  }
  const normalizedPath = parsed.pathname;
  if (normalizedPath !== RETURN_TO_PATH_PREFIX && !normalizedPath.startsWith(`${RETURN_TO_PATH_PREFIX}/`)) {
    return DEFAULT_RETURN_TO;
  }
  return `${normalizedPath}${parsed.search}${parsed.hash}`;
}

/**
 * Serializes a Host-only, HttpOnly, SameSite=Lax cookie string. The default path is the
 * session-wide scope; pass `path` for narrower cookies such as the OAuth flow cookie.
 * @param {string} name
 * @param {string} value
 * @param {{ maxAgeSeconds?: number, secure?: boolean, origin?: string, path?: string, httpOnly?: boolean, sameSite?: "Lax" | "Strict" | "None" }} [options]
 * @returns {string}
 */
export function serializeAuthCookie(name, value, options = {}) {
  if (!isNonEmptyString(name) || !RE_COOKIE_TOKEN.test(name)) {
    throw new Error("Cookie name contains invalid characters.");
  }
  if (typeof value !== "string" || RE_CONTROL_CHARS.test(value) || value.includes(";")) {
    throw new Error("Cookie value contains invalid characters.");
  }
  const cookiePath = options.path ?? AUTH_COOKIE_PATH;
  const httpOnly = options.httpOnly ?? true;
  const sameSite = options.sameSite ?? SAME_SITE_LAX;
  const secure = options.secure ?? (typeof options.origin === "string" && options.origin.startsWith("https://"));
  const parts = [`${name}=${value}`, `Path=${cookiePath}`, `SameSite=${sameSite}`];
  if (options.maxAgeSeconds !== undefined) {
    if (!Number.isInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 0) {
      throw new Error("Cookie Max-Age must be a non-negative integer.");
    }
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Serializes an expired Set-Cookie header value that clears the named auth cookie.
 * @param {string} name
 * @param {{ secure?: boolean, origin?: string, path?: string }} [options]
 * @returns {string}
 */
export function clearAuthCookie(name, options = {}) {
  return serializeAuthCookie(name, "", { ...options, maxAgeSeconds: 0 });
}

/**
 * Parses an HTTP Cookie header string into a plain key-value map.
 * @param {string | null | undefined} cookieHeader
 * @returns {Record<string, string>}
 */
export function parseCookieHeader(cookieHeader) {
  const cookies = {};
  if (typeof cookieHeader !== "string" || cookieHeader.trim().length === 0) {
    return cookies;
  }
  for (const segment of cookieHeader.split(";")) {
    const eqIndex = segment.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = segment.slice(0, eqIndex).trim();
    const val = segment.slice(eqIndex + 1).trim();
    if (key.length > 0 && !(key in cookies)) {
      cookies[key] = val;
    }
  }
  return cookies;
}
