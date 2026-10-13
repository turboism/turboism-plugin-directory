import path from "node:path";
import { defaultProductionDir } from "./catalog-v2/catalog.mjs";
import { CATALOG_CACHE_CONTROL, loadVerifiedCurrentGeneration } from "./catalog-v2/http.mjs";
import {
  CATALOG_LOCALES,
  collectAvailableCategories,
  collectAvailableTags,
  filterPlugins,
  normalizeCatalogLocale,
  projectCatalogToDirectory,
  resolveLocalizedPlugin,
  type CatalogLocale,
  type DirectorySnapshot,
  type LocalizedPluginText,
  type PluginChannel,
  type PluginDependencyEntry,
  type PluginEntry,
  type PluginLocalizations,
  type PluginPermissionEntry,
  type PluginReleaseEntry,
  type PluginTrust,
  type RawCatalogV2,
  type VerificationState,
} from "./directory-view.mjs";

export {
  CATALOG_LOCALES,
  collectAvailableCategories,
  collectAvailableTags,
  filterPlugins,
  normalizeCatalogLocale,
  projectCatalogToDirectory,
  resolveLocalizedPlugin,
  type CatalogLocale,
  type DirectorySnapshot,
  type LocalizedPluginText,
  type PluginChannel,
  type PluginDependencyEntry,
  type PluginEntry,
  type PluginLocalizations,
  type PluginPermissionEntry,
  type PluginReleaseEntry,
  type PluginTrust,
  type RawCatalogV2,
  type VerificationState,
};

export interface DirectoryStorageOptions {
  dir?: string;
  trustedKeysFile?: string;
}

function defaultTrustedKeysFile(): string {
  return path.join(process.cwd(), "lib", "catalog-v2", "trusted-keys.json");
}

function resolveStoragePaths(storage?: DirectoryStorageOptions): { dir: string; trustedKeysFile: string } {
  return {
    dir: storage?.dir ?? defaultProductionDir(),
    trustedKeysFile: storage?.trustedKeysFile ?? defaultTrustedKeysFile(),
  };
}

export function loadDirectorySnapshot(storage?: DirectoryStorageOptions): DirectorySnapshot {
  const { dir, trustedKeysFile } = resolveStoragePaths(storage);
  const verified = loadVerifiedCurrentGeneration(dir, trustedKeysFile);
  if (!verified.ok) {
    throw new Error(`Verified catalog generation unavailable (${verified.code}): ${verified.message}`);
  }
  return projectCatalogToDirectory(verified.catalog as RawCatalogV2, verified.generationId);
}

export function getDirectoryPlugins(storage?: DirectoryStorageOptions): PluginEntry[] {
  return loadDirectorySnapshot(storage).plugins;
}

export function getDirectoryPluginBySlug(
  slug: string,
  storage?: DirectoryStorageOptions,
): PluginEntry | undefined {
  return getDirectoryPlugins(storage).find((entry) => entry.slug === slug);
}

export function serveLegacyPlugins(storage?: DirectoryStorageOptions): Response {
  const { dir, trustedKeysFile } = resolveStoragePaths(storage);
  const verified = loadVerifiedCurrentGeneration(dir, trustedKeysFile);
  if (!verified.ok) {
    const status = verified.code === "catalog_unavailable" ? 503 : 500;
    return Response.json(
      { error: { code: verified.code, message: verified.message } },
      {
        status,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  }
  const snapshot = projectCatalogToDirectory(verified.catalog as RawCatalogV2, verified.generationId);
  return Response.json(snapshot.plugins, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": CATALOG_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const initialSnapshot = loadDirectorySnapshot();

export const plugins: PluginEntry[] = initialSnapshot.plugins;
export const availableTags: string[] = initialSnapshot.availableTags;
export const availableCategories: string[] = initialSnapshot.availableCategories;
