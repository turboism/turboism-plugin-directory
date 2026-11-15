// Build-time framework channel heads used to label plugin framework floors.
//
// A catalog release states a strict API floor such as 0.68.1, but that floor
// may exist only as a prerelease build. The directory resolves the floor
// against the head of each framework channel so the badge never promises a
// stable version that was never published.

const CHANNEL_METADATA_URLS = {
  stable: "https://api.turboism.dev/v1/releases/stable.json",
  beta: "https://api.turboism.dev/v1/releases/beta.json",
  nightly: "https://api.turboism.dev/v1/releases/nightly.json",
};

const FETCH_TIMEOUT_MS = 5000;

/**
 * Reads the published framework version from one channel metadata document.
 * Returns null when the document has no usable release.
 */
export function parseChannelHeadVersion(payload) {
  const version = payload?.release?.version;
  if (typeof version !== "string") return null;
  const trimmed = version.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Resolves the published head of every framework channel. A failed channel is
 * omitted so the caller degrades to a plain version floor instead of failing
 * the build.
 */
export async function loadFrameworkChannelHeads(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const entries = await Promise.all(
    Object.entries(CHANNEL_METADATA_URLS).map(async ([channel, url]) => {
      try {
        const response = await fetchImpl(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          console.warn(`framework channel ${channel} responded ${response.status}; floor badge falls back`);
          return null;
        }
        const version = parseChannelHeadVersion(await response.json());
        if (!version) {
          console.warn(`framework channel ${channel} has no release version; floor badge falls back`);
          return null;
        }
        return [channel, version];
      } catch (failure) {
        console.warn(`framework channel ${channel} is unreachable (${failure.message}); floor badge falls back`);
        return null;
      }
    }),
  );
  return Object.fromEntries(entries.filter((entry) => entry !== null));
}
