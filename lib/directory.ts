export type PluginTrust = "official" | "reviewed-third-party";
export type VerificationState = "verified" | "pending-current-version" | "withdrawn";

export interface PluginEntry {
  slug: string;
  name: string;
  summary: string;
  trust: PluginTrust;
  author: string;
  license: string;
  repository: string;
  support: string;
  releaseUrl: string;
  verifiedRelease: string;
  verifiedAgainst: string;
  verifiedOn: string;
  checksum: string;
  tags: string[];
  verification: VerificationState;
  warning?: string;
}

// Entries are intentionally empty at launch. Add only a Git-reviewed, qualifying release.
export const plugins: PluginEntry[] = [];

export const availableTags = [...new Set(plugins.flatMap((plugin) => plugin.tags))].sort();
