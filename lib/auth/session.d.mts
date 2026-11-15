export const OAUTH_FLOW_COOKIE_NAME: "turboism_plugin_oauth_flow";
export const SESSION_COOKIE_NAME: "turboism_plugin_session";
export const OAUTH_FLOW_TTL_SECONDS: number;
export const SESSION_TTL_SECONDS: number;
export const AUTH_COOKIE_PATH: "/plugins";
export const DEFAULT_RETURN_TO: "/plugins";
export const DEFAULT_PUBLIC_ORIGIN: string;

export interface OAuthPkcePair {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export interface OAuthFlowInput {
  state: string;
  codeVerifier: string;
  returnTo?: string;
}

export interface OAuthFlowPayload {
  state: string;
  codeVerifier: string;
  returnTo: string;
  issuedAt: number;
  expiresAt: number;
}

export interface SessionUserInput {
  githubId: number;
  login: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface AuthSession {
  githubId: number;
  login: string;
  name: string;
  avatarUrl: string;
  issuedAt: number;
  expiresAt: number;
}

export interface SealTokenOptions {
  nowMs?: number;
  ttlSeconds?: number;
}

export interface VerifyTokenOptions {
  nowMs?: number;
}

export type VerifyOAuthFlowResult =
  | { ok: true; flow: OAuthFlowPayload }
  | { ok: false; error: string };

export type VerifySessionResult =
  | { ok: true; session: AuthSession }
  | { ok: false; error: string };

export interface AuthCookieOptions {
  maxAgeSeconds?: number;
  secure?: boolean;
  origin?: string;
  path?: string;
  httpOnly?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
}

export type HeaderSource =
  | Request
  | Headers
  | { headers?: Headers | Record<string, string | string[] | undefined>; url?: string }
  | Record<string, string | string[] | undefined>;

export function createOAuthPkcePair(): OAuthPkcePair;
export function sealOAuthFlow(payload: OAuthFlowInput, secret: string, options?: SealTokenOptions): string;
export function verifyOAuthFlow(token: string, secret: string, options?: VerifyTokenOptions): VerifyOAuthFlowResult;
export function sealSession(user: SessionUserInput, secret: string, options?: SealTokenOptions): string;
export function verifySession(token: string, secret: string, options?: VerifyTokenOptions): VerifySessionResult;
export function isDevMockAuthEnabled(env?: Record<string, string | undefined>): boolean;
export function resolvePublicOrigin(
  requestOrHeaders?: HeaderSource,
  env?: Record<string, string | undefined>,
): string;
export function sanitizeReturnTo(input: unknown): string;
export function serializeAuthCookie(name: string, value: string, options?: AuthCookieOptions): string;
export function clearAuthCookie(
  name: string,
  options?: Pick<AuthCookieOptions, "secure" | "origin" | "path">,
): string;
export function parseCookieHeader(cookieHeader: string | null | undefined): Record<string, string>;
