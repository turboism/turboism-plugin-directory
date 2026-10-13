export type PluginTrust = "official" | "reviewed-third-party";
export type PluginChannel = "stable" | "preview";
export type VerificationState = "verified" | "pending-current-version" | "withdrawn";
export type CatalogLocale = "en" | "zh-Hans" | "zh-Hant" | "ja" | "ko";

export const CATALOG_LOCALES: readonly CatalogLocale[];

export interface LocalizedPluginText {
  name: string;
  summary: string;
}

export type PluginLocalizations = Partial<Record<CatalogLocale, LocalizedPluginText>>;

export interface PluginDependencyEntry {
  id: string;
  version: string;
  type: "required" | "optional";
  ordering: "none" | "before" | "after";
  reason?: string;
}

export interface PluginPermissionEntry {
  id: string;
  scope: "application" | "user";
  reason: string;
}

export interface PluginReleaseEntry {
  version: string;
  channel: PluginChannel;
  status: "active" | "yanked";
  publishedAt: string;
  category: string;
  tags: string[];
  turboismApi: string;
  requiresCubism: boolean;
  cubismVersions: string[];
  platforms: string[];
  dependencies: PluginDependencyEntry[];
  permissions: PluginPermissionEntry[];
  releaseUrl: string;
  sourceRevision?: string;
  downloadUrl: string;
  fileName: string;
  sha256: string;
  descriptorSha256: string;
  size: number;
}

export interface PluginEntry {
  id: string;
  slug: string;
  name: string;
  summary: string;
  localizations: PluginLocalizations;
  trust: PluginTrust;
  author: string;
  license: string;
  repository: string;
  support: string;
  category: string;
  tags: string[];
  latestVersion: string;
  channel: PluginChannel;
  publishedAt: string;
  turboismApi: string;
  requiresCubism: boolean;
  cubismVersions: string[];
  platforms: string[];
  dependencies: PluginDependencyEntry[];
  permissions: PluginPermissionEntry[];
  releaseUrl: string;
  downloadUrl: string;
  fileName: string;
  sha256: string;
  descriptorSha256: string;
  size: number;
  sourceRevision?: string;
  releases: PluginReleaseEntry[];
  verifiedRelease: string;
  verifiedAgainst: string;
  verifiedOn: string;
  checksum: string;
  verification: VerificationState;
  warning?: string;
}

export interface DirectorySnapshot {
  generationId: string;
  catalogVersion: number;
  publishedAt: string;
  plugins: PluginEntry[];
  availableTags: string[];
  availableCategories: string[];
}

export interface RawCatalogV2 {
  format: string;
  schemaVersion: number;
  catalogVersion: number;
  publishedAt: string;
  plugins: unknown[];
}

export function normalizeCatalogLocale(
  locale: string | null | undefined,
  browserHint?: string | null,
): CatalogLocale;

export function resolveLocalizedPlugin(
  plugin: Pick<PluginEntry, "name" | "summary" | "localizations">,
  locale: string | null | undefined,
  browserHint?: string | null,
): LocalizedPluginText & { locale: CatalogLocale };

export function collectAvailableTags(entries: readonly PluginEntry[]): string[];
export function collectAvailableCategories(entries: readonly PluginEntry[]): string[];
export function projectCatalogToDirectory(
  catalog: RawCatalogV2,
  generationId?: string,
): DirectorySnapshot;
export function filterPlugins(
  entries: readonly PluginEntry[],
  query: string,
  selectedTag?: string | null,
  selectedCategory?: string | null,
  locale?: string,
): PluginEntry[];
