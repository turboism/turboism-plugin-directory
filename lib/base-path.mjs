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
