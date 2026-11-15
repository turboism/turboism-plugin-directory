import type { OwnershipRegistry } from "./ownership.d.mts";

export interface SubmissionRouteOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  catalog?: { plugins: Array<Record<string, unknown>> };
  ownership?: OwnershipRegistry;
  catalogPath?: string;
  ownershipPath?: string;
}

export type VerifySameOriginResult =
  | { ok: true; origin: string }
  | { ok: false; error: string };

export function verifySameOriginMutation(
  request: Request,
  env?: Record<string, string | undefined>,
): VerifySameOriginResult;

export function handleAuthGitHubLogin(
  request: Request,
  options?: Pick<SubmissionRouteOptions, "env">,
): Promise<Response>;

export function handleAuthGitHubCallback(
  request: Request,
  options?: Pick<SubmissionRouteOptions, "env" | "fetchImpl">,
): Promise<Response>;

export function handleAuthSession(
  request: Request,
  options?: Pick<SubmissionRouteOptions, "env">,
): Promise<Response>;

export function handleAuthLogout(
  request: Request,
  options?: Pick<SubmissionRouteOptions, "env">,
): Promise<Response>;

export function handleSubmissionsRepos(
  request: Request,
  options?: Pick<SubmissionRouteOptions, "env" | "fetchImpl">,
): Promise<Response>;

export function handleSubmissionsReleases(
  request: Request,
  options?: SubmissionRouteOptions,
): Promise<Response>;

export function handleSubmissionsPreflight(
  request: Request,
  options?: SubmissionRouteOptions,
): Promise<Response>;

export function handleSubmissionsSubmit(
  request: Request,
  options?: SubmissionRouteOptions,
): Promise<Response>;

export function handleSubmissionsMine(
  request: Request,
  options?: SubmissionRouteOptions,
): Promise<Response>;
