/**
 * Resolves the deployment base path so client requests reach files that Next
 * serves under it. Next injects the value during build; tests and local tooling
 * resolve to an empty prefix.
 */
export function deploymentBasePath() {
  const injected = process.env.__NEXT_ROUTER_BASEPATH;
  if (typeof injected !== "string" || injected === "/") return "";
  return injected;
}

/**
 * Prepends the deployment base path to an app-relative route or API path for
 * native fetch, anchor, and location transitions that bypass Next.js Link.
 * @param {string} pathname
 * @returns {string}
 */
export function withBasePath(pathname) {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const base = deploymentBasePath();
  if (!base) return normalized;
  if (normalized === base || normalized.startsWith(`${base}/`) || normalized.startsWith(`${base}?`)) {
    return normalized;
  }
  if (normalized === "/") return base;
  return `${base}${normalized}`;
}
