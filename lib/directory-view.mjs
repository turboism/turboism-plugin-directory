export const CATALOG_LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "ko"];

const FALLBACK_CHAINS = {
  en: ["en"],
  "zh-Hans": ["zh-Hans", "zh-Hant", "en"],
  "zh-Hant": ["zh-Hant", "zh-Hans", "en"],
  ja: ["ja", "en"],
  ko: ["ko", "en"],
};

function isTraditionalChineseTag(tag) {
  if (!tag) return false;
  const lower = tag.trim().toLowerCase().replace(/_/g, "-");
  return (
    lower === "zh-hant" ||
    lower.startsWith("zh-hant-") ||
    lower === "zh-tw" ||
    lower === "zh-hk" ||
    lower === "zh-mo"
  );
}

export function normalizeCatalogLocale(locale, browserHint) {
  if (!locale) return "en";
  const trimmed = locale.trim();
  if (trimmed === "zh-Hant" || isTraditionalChineseTag(trimmed)) return "zh-Hant";
  if (trimmed === "zh-Hans") return "zh-Hans";
  const lower = trimmed.toLowerCase().replace(/_/g, "-");
  if (lower === "zh" || lower.startsWith("zh-")) {
    return isTraditionalChineseTag(browserHint) ? "zh-Hant" : "zh-Hans";
  }
  if (lower === "ja" || lower.startsWith("ja-")) return "ja";
  if (lower === "ko" || lower.startsWith("ko-")) return "ko";
  return "en";
}

export function resolveLocalizedPlugin(plugin, locale, browserHint) {
  const target = normalizeCatalogLocale(locale, browserHint);
  const chain = FALLBACK_CHAINS[target];
  let resolvedName = "";
  let resolvedSummary = "";
  let matchedLocale = "en";

  for (const candidate of chain) {
    const entry =
      candidate === "en"
        ? plugin.localizations?.en ?? { name: plugin.name, summary: plugin.summary }
        : plugin.localizations?.[candidate];
    if (!entry) continue;
    if (!resolvedName && typeof entry.name === "string" && entry.name.trim()) {
      resolvedName = entry.name;
      matchedLocale = candidate;
    }
    if (!resolvedSummary && typeof entry.summary === "string" && entry.summary.trim()) {
      resolvedSummary = entry.summary;
    }
    if (resolvedName && resolvedSummary) break;
  }

  return {
    name: resolvedName || plugin.name,
    summary: resolvedSummary || plugin.summary,
    locale: matchedLocale,
  };
}

const FRAMEWORK_FLOOR_PATTERN = /^\[([0-9]+\.[0-9]+\.[0-9]+),/;
const STRICT_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const PRERELEASE_CHANNELS = ["beta", "nightly"];

/**
 * Extracts the inclusive lower bound of an API requirement. A half-open range
 * such as "[0.67.0,1.0.0)" yields its lower bound; an exact version yields
 * itself. Returns null when the requirement carries no comparable bound.
 */
export function frameworkFloorOf(turboismApi) {
  const text = (turboismApi ?? "").trim();
  const rangeMatch = FRAMEWORK_FLOOR_PATTERN.exec(text);
  if (rangeMatch) return rangeMatch[1];
  return STRICT_VERSION_PATTERN.test(text) ? text : null;
}

/**
 * Selects the release the directory advertises. A stable release wins so that a
 * visitor without a preview framework still sees a version they can install;
 * preview-only plugins fall back to their newest release.
 */
export function selectRecommendedRelease(activeReleases) {
  if (!activeReleases || activeReleases.length === 0) return null;
  const sortedDesc = [...activeReleases].sort((a, b) => compareStrictVersions(b.version, a.version));
  const stable = sortedDesc.filter((release) => release.channel === "stable");
  return stable.length > 0 ? stable[0] : sortedDesc[0];
}

const BETA_PRERELEASE_PATTERN = /-beta\.([0-9]+)$/;

/**
 * Formats a plugin release version as a plain version string without channel
 * suffixes, because plugin descriptors carry no channel metadata.
 */
export function formatPluginVersionLabel(version) {
  return version ? String(version) : "";
}

/**
 * Normalizes a framework prerelease version for display, shortening
 * "-beta.N" to ".bN" (for example "0.68.1-beta.11" -> "0.68.1.b11").
 */
export function formatFrameworkHeadLabel(version) {
  if (!version) return "";
  return String(version).replace(BETA_PRERELEASE_PATTERN, ".b$1");
}

/**
 * Renders the framework requirement badge. The stable channel answers with an
 * open-ended floor ("0.67.0+"). A prerelease-only answer names the exact build
 * because the plain version does not exist on that channel yet.
 */
export function formatFrameworkRequirement(floor, channelHeads = {}) {
  if (!floor) return null;
  const stableHead = channelHeads.stable;
  if (stableHead && compareStrictVersions(stableHead, floor) >= 0) {
    return { label: `${floor}+`, kind: "stable" };
  }
  for (const channel of PRERELEASE_CHANNELS) {
    const head = channelHeads[channel];
    if (!head) continue;
    if (compareStrictVersions(head, floor) >= 0) {
      const label = channel === "beta" ? formatFrameworkHeadLabel(head) : head;
      return { label, kind: channel };
    }
  }
  return { label: `${floor}+`, kind: "unknown" };
}

function parseVersionParts(version) {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function compareStrictVersions(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function mapRelease(release) {
  const entry = {
    version: release.version,
    channel: release.channel,
    status: release.status,
    publishedAt: release.publishedAt,
    category: release.category,
    tags: [...release.tags],
    turboismApi: release.turboismApi,
    requiresCubism: release.requiresCubism,
    cubismVersions: [...release.cubismVersions],
    platforms: [...release.platforms],
    dependencies: release.dependencies.map((dep) => ({ ...dep })),
    permissions: release.permissions.map((perm) => ({ ...perm })),
    releaseUrl: release.releaseUrl,
    downloadUrl: release.artifact.url,
    fileName: release.artifact.fileName,
    sha256: release.artifact.sha256,
    descriptorSha256: release.artifact.descriptorSha256,
    size: release.artifact.size,
    hotReload: Boolean(release.hotReload),
  };
  if (release.sourceRevision !== undefined) {
    entry.sourceRevision = release.sourceRevision;
  }
  return entry;
}

export function collectAvailableTags(entries) {
  return [...new Set(entries.flatMap((plugin) => plugin.tags))].sort();
}

export function collectAvailableCategories(entries) {
  return [...new Set(entries.map((plugin) => plugin.category).filter(Boolean))].sort();
}

export function projectCatalogToDirectory(catalog, generationId = "00000001") {
  const plugins = [];

  for (const rawPlugin of catalog.plugins ?? []) {
    const activeReleases = (rawPlugin.releases ?? []).filter((release) => release.status === "active");
    if (activeReleases.length === 0) continue;

    const sortedActiveDesc = [...activeReleases].sort((a, b) => compareStrictVersions(b.version, a.version));
    const latest = sortedActiveDesc[0];

    const localizations = {
      en: { name: rawPlugin.name, summary: rawPlugin.summary },
    };
    for (const locale of ["zh-Hans", "zh-Hant", "ja", "ko"]) {
      const item = rawPlugin.localizations?.[locale];
      if (item && typeof item.name === "string" && typeof item.summary === "string") {
        localizations[locale] = { name: item.name, summary: item.summary };
      }
    }

    const mappedLatest = mapRelease(latest);
    const mappedRecommended = mapRelease(selectRecommendedRelease(sortedActiveDesc));
    const entry = {
      id: rawPlugin.id,
      slug: rawPlugin.slug,
      name: rawPlugin.name,
      summary: rawPlugin.summary,
      localizations,
      trust: rawPlugin.trust,
      author: rawPlugin.author,
      license: rawPlugin.license,
      repository: rawPlugin.repository,
      support: rawPlugin.support,
      category: mappedLatest.category,
      tags: mappedLatest.tags,
      latestVersion: mappedLatest.version,
      channel: mappedLatest.channel,
      recommendedVersion: mappedRecommended.version,
      recommendedChannel: mappedRecommended.channel,
      recommendedDownloadUrl: mappedRecommended.downloadUrl,
      recommendedReleaseUrl: mappedRecommended.releaseUrl,
      frameworkFloor: frameworkFloorOf(mappedRecommended.turboismApi),
      publishedAt: mappedLatest.publishedAt,
      turboismApi: mappedLatest.turboismApi,
      requiresCubism: mappedLatest.requiresCubism,
      cubismVersions: mappedLatest.cubismVersions,
      platforms: mappedLatest.platforms,
      dependencies: mappedLatest.dependencies,
      permissions: mappedLatest.permissions,
      releaseUrl: mappedLatest.releaseUrl,
      downloadUrl: mappedLatest.downloadUrl,
      fileName: mappedLatest.fileName,
      sha256: mappedLatest.sha256,
      descriptorSha256: mappedLatest.descriptorSha256,
      size: mappedLatest.size,
      hotReload: mappedLatest.hotReload,
      releases: sortedActiveDesc.map(mapRelease),
      verifiedRelease: mappedLatest.version,
      verifiedAgainst: mappedLatest.turboismApi,
      verifiedOn: mappedLatest.publishedAt.slice(0, 10),
      checksum: mappedLatest.sha256,
      verification: "verified",
    };
    if (mappedLatest.sourceRevision !== undefined) {
      entry.sourceRevision = mappedLatest.sourceRevision;
    }
    plugins.push(entry);
  }

  plugins.sort((a, b) => {
    const byDate = b.publishedAt.localeCompare(a.publishedAt);
    if (byDate !== 0) return byDate;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return {
    generationId,
    catalogVersion: catalog.catalogVersion,
    publishedAt: catalog.publishedAt,
    plugins,
    availableTags: collectAvailableTags(plugins),
    availableCategories: collectAvailableCategories(plugins),
  };
}

export function filterPlugins(
  entries,
  query,
  selectedTag = null,
  selectedCategory = null,
  locale = "en",
  selectedAuthor = null,
  selectedLicense = null,
) {
  const normalized = query.normalize("NFKC").trim().toLowerCase();
  return entries.filter((plugin) => {
    if (selectedTag && !plugin.tags.includes(selectedTag)) return false;
    if (selectedCategory && plugin.category !== selectedCategory) return false;
    if (selectedAuthor && plugin.author !== selectedAuthor) return false;
    if (selectedLicense && plugin.license !== selectedLicense) return false;
    if (!normalized) return true;

    const localized = resolveLocalizedPlugin(plugin, locale);
    const localizedTexts = Object.values(plugin.localizations ?? {}).flatMap((item) =>
      item ? [item.name, item.summary] : [],
    );
    const candidates = [
      plugin.id,
      plugin.slug,
      plugin.name,
      plugin.summary,
      localized.name,
      localized.summary,
      ...localizedTexts,
      plugin.author,
      plugin.category,
      plugin.latestVersion,
      ...plugin.tags,
      ...plugin.cubismVersions,
    ];
    return candidates.some((text) => text.normalize("NFKC").toLowerCase().includes(normalized));
  });
}
