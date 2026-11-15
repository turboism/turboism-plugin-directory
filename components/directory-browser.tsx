"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Download,
  PlusCircle,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DependencyPluginTarget, DirectoryListingEntry, PluginEntry, PluginTrust } from "@/lib/directory";
import {
  collectAvailableCategories,
  collectAvailableTags,
  filterPlugins,
  formatFrameworkRequirement,
  formatPluginVersionLabel,
  frameworkFloorOf,
  resolveLocalizedPlugin,
} from "@/lib/directory-view.mjs";
import { useLanguage } from "@/components/language-provider";
import { renderSafeReadmeMarkdown, selectLocalizedReadme } from "@/lib/readme-renderer";

const REPORT_URL =
  "https://github.com/turboism/turboism-plugin-directory/issues/new?template=directory-report.md";

/** README file per documentation locale; mirrors the published generation layout. */
const README_LOCALE_FILES: Record<string, string> = {
  en: "README.md",
  zh: "README_zh.md",
  ja: "README_ja.md",
  ko: "README_ko.md",
};

/** Maps a catalog locale onto the documentation locale used by README files. */
function readmeLocaleOf(catalogLocale: string): string {
  if (catalogLocale.startsWith("zh")) return "zh";
  if (catalogLocale.startsWith("ja")) return "ja";
  if (catalogLocale.startsWith("ko")) return "ko";
  return "en";
}

function normalizeTrustParam(rawTrust: string | null): PluginTrust | null {
  if (rawTrust === "official" || rawTrust === "reviewed-third-party") {
    return rawTrust;
  }
  return null;
}

export function trustBadgeClassName(trust: PluginTrust): string {
  if (trust === "official") {
    return "border-[var(--tb-border)] bg-[var(--tb-soft)] text-[var(--tb-violet)]";
  }
  return "border-amber-300 bg-amber-50 text-amber-900";
}

export type FrameworkChannelHeads = Record<string, string>;

export function DirectoryBrowser({
  plugins = [],
  frameworkChannels = {},
}: {
  plugins?: DirectoryListingEntry[];
  frameworkChannels?: FrameworkChannelHeads;
}) {
  const { copy, catalogLocale } = useLanguage();
  const searchParams = useSearchParams();

  const authorParam = searchParams.get("author") || null;
  const licenseParam = searchParams.get("license") || null;
  const categoryParam = searchParams.get("category") || null;
  const tagParam = searchParams.get("tag") || null;
  const trustParam = normalizeTrustParam(searchParams.get("trust"));
  const qParam = searchParams.get("q") || "";

  const [userQuery, setUserQuery] = useState<string | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const query = userQuery ?? qParam;

  const pushQueryParams = (params: URLSearchParams) => {
    const qs = params.toString();
    const pathname = window.location.pathname;
    window.history.pushState(null, "", qs ? `${pathname}?${qs}` : pathname);
  };

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    pushQueryParams(params);
  };

  const clearAllFilters = () => {
    pushQueryParams(new URLSearchParams());
    setUserQuery("");
  };

  const selectedCategory = categoryParam;
  const selectedTag = tagParam;
  const selectedAuthor = authorParam;
  const selectedLicense = licenseParam;
  const selectedTrust = trustParam;

  const availableTags = useMemo(() => collectAvailableTags(plugins), [plugins]);
  const availableCategories = useMemo(() => collectAvailableCategories(plugins), [plugins]);
  const filteredPlugins = useMemo(
    () =>
      filterPlugins(
        plugins,
        query,
        selectedTag,
        selectedCategory,
        catalogLocale,
        selectedAuthor,
        selectedLicense,
        selectedTrust,
      ),
    [
      plugins,
      query,
      selectedTag,
      selectedCategory,
      catalogLocale,
      selectedAuthor,
      selectedLicense,
      selectedTrust,
    ],
  );

  const hasActiveFilters = Boolean(
    selectedAuthor || selectedLicense || selectedCategory || selectedTag || selectedTrust,
  );

  return (
    <section
      className="container mx-auto px-4 md:px-8 max-w-[1540px] pt-24"
      aria-label={copy.directoryLabel}
    >
      <div className="flex flex-col md:flex-row items-center gap-3 md:gap-4 mb-4">
        <label className="flex items-center gap-3 w-full flex-1 px-4 py-3 rounded-full border border-[var(--tb-border)] bg-white shadow-sm focus-within:border-[var(--tb-violet)] focus-within:ring-4 focus-within:ring-[var(--tb-violet)]/10 transition-all">
          <Search size={18} className="text-[var(--tb-muted)] shrink-0" />
          <span className="sr-only">{copy.search}</span>
          <input
            value={query}
            onChange={(event) => setUserQuery(event.target.value)}
            placeholder={copy.search}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[var(--tb-ink)] placeholder:text-[var(--tb-muted)] font-medium"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setUserQuery("");
                if (qParam) updateParam("q", null);
              }}
              aria-label={copy.clearSearch}
              className="inline-flex items-center justify-center min-h-11 min-w-11 p-1 text-[var(--tb-muted)] hover:text-[var(--tb-ink)] transition-colors rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tb-violet)]/50 cursor-pointer"
            >
              <X size={16} />
            </button>
          )}
        </label>
        <div className="flex items-center justify-center gap-3 shrink-0">
          <span className="hidden md:flex items-center gap-2 text-[var(--tb-muted)] font-mono text-xs uppercase font-semibold tracking-wider">
            <SlidersHorizontal size={14} /> {copy.filter}
          </span>
          <a
            href={REPORT_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 min-h-11 rounded-full border border-[var(--tb-border)] bg-white px-4 text-sm font-medium text-[var(--tb-ink)] transition-colors hover:border-[var(--tb-violet)] hover:text-[var(--tb-violet)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tb-violet)]/60 focus-visible:ring-offset-2"
          >
            {copy.report}
            <ArrowUpRight size={16} />
          </a>
        </div>
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 mb-4" aria-label={copy.activeFiltersLabel}>
          <span className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-wider">
            {copy.activeFiltersLabel}
          </span>
          {selectedTrust && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[var(--tb-soft)] text-[var(--tb-violet)] border border-[var(--tb-border)]">
              <span>
                {copy.sourceFilterLabel}:{" "}
                {selectedTrust === "official" ? copy.official : copy.reviewed}
              </span>
              <button
                type="button"
                onClick={() => updateParam("trust", null)}
                aria-label={`Remove ${copy.sourceFilterLabel} filter`}
                className="hover:text-[var(--tb-deep)] transition-colors p-0.5 cursor-pointer"
              >
                <X size={12} />
              </button>
            </span>
          )}
          {selectedAuthor && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[var(--tb-soft)] text-[var(--tb-violet)] border border-[var(--tb-border)]">
              <span>
                {copy.authorFilterLabel}: {selectedAuthor}
              </span>
              <button
                type="button"
                onClick={() => updateParam("author", null)}
                aria-label={`Remove ${copy.authorFilterLabel} filter`}
                className="hover:text-[var(--tb-deep)] transition-colors p-0.5 cursor-pointer"
              >
                <X size={12} />
              </button>
            </span>
          )}
          {selectedLicense && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[var(--tb-soft)] text-[var(--tb-violet)] border border-[var(--tb-border)]">
              <span>
                {copy.licenseFilterLabel}: {selectedLicense}
              </span>
              <button
                type="button"
                onClick={() => updateParam("license", null)}
                aria-label={`Remove ${copy.licenseFilterLabel} filter`}
                className="hover:text-[var(--tb-deep)] transition-colors p-0.5 cursor-pointer"
              >
                <X size={12} />
              </button>
            </span>
          )}
          {selectedCategory && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[var(--tb-soft)] text-[var(--tb-violet)] border border-[var(--tb-border)]">
              <span>
                {copy.categoryLabel}: {copy.categoryNames[selectedCategory] ?? selectedCategory}
              </span>
              <button
                type="button"
                onClick={() => updateParam("category", null)}
                aria-label="Remove category filter"
                className="hover:text-[var(--tb-deep)] transition-colors p-0.5 cursor-pointer"
              >
                <X size={12} />
              </button>
            </span>
          )}
          {selectedTag && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-[var(--tb-soft)] text-[var(--tb-violet)] border border-[var(--tb-border)]">
              <span>Tag: {selectedTag}</span>
              <button
                type="button"
                onClick={() => updateParam("tag", null)}
                aria-label="Remove tag filter"
                className="hover:text-[var(--tb-deep)] transition-colors p-0.5 cursor-pointer"
              >
                <X size={12} />
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-xs text-[var(--tb-muted)] hover:text-[var(--tb-ink)] underline ml-2 cursor-pointer"
          >
            {copy.clearAllFilters}
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label={copy.sourceFilterLabel}>
        <span className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--tb-muted)] mr-1">
          {copy.sourceFilterLabel}:
        </span>
        {(
          [
            { value: null, label: copy.allSources },
            { value: "official", label: copy.official },
            { value: "reviewed-third-party", label: copy.reviewed },
          ] as const
        ).map((option) => {
          const active = selectedTrust === option.value;
          return (
            <button
              key={option.value ?? "all"}
              type="button"
              aria-pressed={active}
              onClick={() => updateParam("trust", option.value)}
              className={`px-3.5 py-1.5 min-h-10 rounded-full text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tb-violet)]/40 cursor-pointer ${
                active
                  ? "bg-[var(--tb-soft)] text-[var(--tb-violet)] border-[var(--tb-violet)] shadow-sm font-semibold"
                  : "bg-white border-[var(--tb-border)] text-[var(--tb-muted)] hover:border-[var(--tb-violet)]/60 hover:text-[var(--tb-ink)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {availableCategories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3" aria-label={copy.categoriesLabel}>
          <button
            className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tb-violet)]/40 cursor-pointer ${!selectedCategory ? "bg-[var(--tb-soft)] text-[var(--tb-violet)] border-[var(--tb-violet)] shadow-sm font-semibold" : "bg-white border-[var(--tb-border)] text-[var(--tb-muted)] hover:border-[var(--tb-violet)]/60 hover:text-[var(--tb-ink)]"}`}
            type="button"
            aria-pressed={!selectedCategory}
            onClick={() => updateParam("category", null)}
          >
            {copy.allCategories}
          </button>
          {availableCategories.map((category) => (
            <button
              className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tb-violet)]/40 cursor-pointer ${selectedCategory === category ? "bg-[var(--tb-soft)] text-[var(--tb-violet)] border-[var(--tb-violet)] shadow-sm font-semibold" : "bg-white border-[var(--tb-border)] text-[var(--tb-muted)] hover:border-[var(--tb-violet)]/60 hover:text-[var(--tb-ink)]"}`}
              type="button"
              aria-pressed={selectedCategory === category}
              key={category}
              onClick={() => updateParam("category", selectedCategory === category ? null : category)}
            >
              {copy.categoryNames[category] ?? category}
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className={`md:hidden inline-flex items-center gap-1.5 min-h-11 ${tagsOpen ? "mb-3" : "mb-8"} px-4 rounded-full border border-[var(--tb-border)] bg-white text-sm font-medium text-[var(--tb-muted)] hover:border-[var(--tb-violet)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tb-violet)]/40 cursor-pointer`}
        aria-expanded={tagsOpen}
        aria-controls="plugin-tag-list"
        onClick={() => setTagsOpen((open) => !open)}
      >
        {tagsOpen ? copy.hideTags : copy.showTags} ({availableTags.length})
        <ChevronDown size={16} className={`transition-transform ${tagsOpen ? "rotate-180" : ""}`} />
      </button>

      <div
        id="plugin-tag-list"
        className={`${tagsOpen ? "flex" : "hidden"} md:flex flex-wrap gap-2 mb-8`}
        aria-label={copy.tagsLabel}
      >
        <button
          className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tb-violet)]/40 cursor-pointer ${!selectedTag ? "bg-[var(--tb-soft)] text-[var(--tb-violet)] border-[var(--tb-violet)] shadow-sm font-semibold" : "bg-white border-[var(--tb-border)] text-[var(--tb-muted)] hover:border-[var(--tb-violet)]/60 hover:text-[var(--tb-ink)]"}`}
          type="button"
          aria-pressed={!selectedTag}
          onClick={() => updateParam("tag", null)}
        >
          {copy.all}
        </button>
        {availableTags.map((tag) => (
          <button
            className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tb-violet)]/40 cursor-pointer ${selectedTag === tag ? "bg-[var(--tb-soft)] text-[var(--tb-violet)] border-[var(--tb-violet)] shadow-sm font-semibold" : "bg-white border-[var(--tb-border)] text-[var(--tb-muted)] hover:border-[var(--tb-violet)]/60 hover:text-[var(--tb-ink)]"}`}
            type="button"
            aria-pressed={selectedTag === tag}
            key={tag}
            onClick={() => updateParam("tag", selectedTag === tag ? null : tag)}
          >
            {tag}
          </button>
        ))}
      </div>

      <div className="min-h-[calc(100vh-20rem)]">
        {filteredPlugins.length === 0 ? (
          <EmptyDirectory
            query={query}
            selectedTag={selectedTag}
            selectedCategory={selectedCategory}
            selectedTrust={selectedTrust}
            selectedAuthor={selectedAuthor}
            selectedLicense={selectedLicense}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPlugins.map((plugin) => (
              <PluginCard key={plugin.id} plugin={plugin} frameworkChannels={frameworkChannels} />
            ))}
          </div>
        )}
      </div>

      <footer className="mt-12 mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--tb-border)] bg-white px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/submit"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--tb-violet)] px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--tb-deep)]"
          >
            <PlusCircle size={16} />
            {copy.nominateQualifying}
          </Link>
        </div>
        <a
          href={REPORT_URL}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--tb-muted)] hover:text-[var(--tb-violet)] transition-colors"
        >
          {copy.report}
          <ArrowUpRight size={15} />
        </a>
      </footer>
    </section>
  );
}

function EmptyDirectory({
  query,
  selectedTag,
  selectedCategory,
  selectedTrust,
  selectedAuthor,
  selectedLicense,
}: {
  query: string;
  selectedTag: string | null;
  selectedCategory: string | null;
  selectedTrust: PluginTrust | null;
  selectedAuthor: string | null;
  selectedLicense: string | null;
}) {
  const { copy } = useLanguage();
  const hasFilter = Boolean(
    query || selectedTag || selectedCategory || selectedTrust || selectedAuthor || selectedLicense,
  );

  return (
    <div className="flex flex-col items-center justify-center p-12 text-center rounded-3xl border border-dashed border-[var(--tb-border)] bg-white max-w-xl mx-auto my-12">
      <div className="w-12 h-12 rounded-full bg-[var(--tb-soft)] flex items-center justify-center text-[var(--tb-violet)] mb-4">
        <Search size={20} />
      </div>
      <h2 className="text-xl font-bold text-[var(--tb-ink)] mb-2">
        {hasFilter ? copy.noMatchTitle : copy.emptyTitle}
      </h2>
      <p className="text-[var(--tb-muted)] text-sm max-w-md mb-6 leading-relaxed">
        {hasFilter ? copy.noMatchGuidance : copy.emptyExplanation}
      </p>
      {!hasFilter && (
        <Link
          href="/submit"
          className="inline-flex items-center gap-2 rounded-full bg-[var(--tb-violet)] text-white px-5 py-2.5 text-sm font-medium hover:bg-[var(--tb-deep)] transition-colors shadow-sm"
        >
          <PlusCircle size={16} />
          {copy.nominateQualifying}
        </Link>
      )}
    </div>
  );
}

// "5.0.00" .. "5.3.04" -> "5.0–5.3"; a single major.minor stays as-is.
function formatCubismRange(entry: { cubismVersions: string[] }): string | null {
  if (entry.cubismVersions.length === 0) return null;
  const minors = [...new Set(entry.cubismVersions.map((v) => v.split(".").slice(0, 2).join(".")))];
  return minors.length === 1 ? minors[0] : `${minors[0]}–${minors[minors.length - 1]}`;
}

function PluginCard({
  plugin,
  frameworkChannels,
}: {
  plugin: DirectoryListingEntry;
  frameworkChannels: FrameworkChannelHeads;
}) {
  const { copy, catalogLocale } = useLanguage();
  const isOfficial = plugin.trust === "official";
  const localized = resolveLocalizedPlugin(plugin, catalogLocale);
  const categoryLabel = copy.categoryNames[plugin.category] ?? plugin.category;
  const cubismRange = formatCubismRange(plugin);
  const requirement = formatFrameworkRequirement(plugin.frameworkFloor, frameworkChannels);
  const requirementClass =
    requirement?.kind === "stable" || requirement?.kind === "unknown"
      ? "text-slate-700 bg-slate-100 border-slate-200"
      : "text-violet-700 bg-violet-50 border-violet-200";

  return (
    <article className="group flex flex-col p-6 rounded-2xl border border-[var(--tb-border)] bg-white shadow-sm hover:shadow-md hover:border-[var(--tb-violet)]/60 transition-all">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-2">
        {requirement && (
          <span
            className={`font-mono text-[11px] font-semibold whitespace-nowrap px-2 py-0.5 rounded border ${requirementClass}`}
            title={copy.frameworkRequirementLabel}
          >
            {requirement.label}
          </span>
        )}
        {cubismRange ? (
          <span
            className="font-mono text-[11px] font-semibold whitespace-nowrap text-orange-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-200"
            title={copy.cubismVersionsLabel}
          >
            Cubism {cubismRange}
          </span>
        ) : (
          <span
            className="font-mono text-[11px] font-semibold whitespace-nowrap text-[var(--tb-muted)] bg-[var(--tb-paper)] px-2 py-0.5 rounded border border-[var(--tb-border)]"
            title={copy.cubismVersionsLabel}
          >
            {copy.cubismAnyVersion}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <span
          className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider ${trustBadgeClassName(plugin.trust)}`}
        >
          {isOfficial ? copy.official : copy.reviewed}
        </span>
        <span className="whitespace-nowrap font-mono text-xs font-semibold uppercase tracking-wider text-[var(--tb-muted)]">
          {categoryLabel}
        </span>
      </div>

      <h2 className="text-xl font-bold text-[var(--tb-ink)] group-hover:text-[var(--tb-violet)] transition-colors mb-2 leading-snug">
        <Link href={`/${plugin.slug}`} className="focus-visible:outline-none focus-visible:underline">
          {localized.name}
        </Link>
      </h2>

      <p className="text-[var(--tb-muted)] text-sm leading-relaxed mb-6 flex-1 line-clamp-3">
        {localized.summary}
      </p>

      <div className="flex flex-wrap gap-1.5 mb-6">
        {plugin.tags.slice(0, 3).map((tag) => (
          <span
            className="px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--tb-soft)] text-[var(--tb-ink)] border border-[var(--tb-border)]"
            key={tag}
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="pt-4 border-t border-[var(--tb-border)] flex items-center justify-between gap-2">
        <Link
          href={`/${plugin.slug}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--tb-muted)] hover:text-[var(--tb-violet)] transition-colors"
        >
          {copy.viewDetails}
        </Link>
        <a
          href={plugin.recommendedDownloadUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--tb-violet)] text-white px-3.5 py-1.5 text-xs font-medium shadow-sm hover:bg-[var(--tb-deep)] transition-colors"
        >
          <Download size={13} />
          {copy.downloadJar}
        </a>
      </div>
    </article>
  );
}

export function PluginDetailView({
  plugin,
  readmes = {},
  frameworkChannels = {},
  readmeBasePath,
  dependencyPlugins = {},
}: {
  plugin: PluginEntry;
  readmes?: Record<string, string>;
  frameworkChannels?: FrameworkChannelHeads;
  readmeBasePath?: string;
  dependencyPlugins?: Record<string, DependencyPluginTarget>;
}) {
  const { copy, catalogLocale } = useLanguage();
  const isOfficial = plugin.trust === "official";
  const localized = resolveLocalizedPlugin(plugin, catalogLocale);
  const categoryLabel = copy.categoryNames[plugin.category] ?? plugin.category;
  const requirement = formatFrameworkRequirement(plugin.frameworkFloor, frameworkChannels);

  const [selectedVersion, setSelectedVersion] = useState(plugin.recommendedVersion);
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const [versionReadmes, setVersionReadmes] = useState<Record<string, string> | null>(null);
  const [readmeFailed, setReadmeFailed] = useState(false);

  const activeRelease = useMemo(
    () => plugin.releases.find((release) => release.version === selectedVersion),
    [plugin.releases, selectedVersion],
  );
  const activePermissions = activeRelease?.permissions ?? plugin.permissions;
  const activeDependencies = activeRelease?.dependencies ?? plugin.dependencies;

  const activeReadmes = versionReadmes ?? readmes;
  const { content: readmeContent } = selectLocalizedReadme(activeReadmes, catalogLocale);
  const readmeHtml = useMemo(
    () => (readmeContent ? renderSafeReadmeMarkdown(readmeContent, plugin.repository) : ""),
    [readmeContent, plugin.repository],
  );

  const selectVersion = async (version: string) => {
    if (version === selectedVersion) return;
    setSelectedVersion(version);
    setReadmeFailed(false);
    if (version === plugin.recommendedVersion || !readmeBasePath) {
      setVersionReadmes(null);
      return;
    }
    const locale = readmeLocaleOf(catalogLocale);
    // A version may ship without the visitor's language; English is the documented fallback.
    const candidates = locale === "en" ? ["en"] : [locale, "en"];
    for (const candidate of candidates) {
      try {
        const response = await fetch(`${readmeBasePath}/${version}/${README_LOCALE_FILES[candidate]}`);
        if (!response.ok) continue;
        setVersionReadmes({ [candidate]: await response.text() });
        return;
      } catch {
        // Try the next documentation locale.
      }
    }
    setVersionReadmes({});
    setReadmeFailed(true);
  };

  return (
    <div className="flex flex-col min-h-screen pt-12 pb-16">
      <main className="container mx-auto px-6 max-w-4xl flex-1">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[var(--tb-muted)] hover:text-[var(--tb-violet)] transition-colors mb-10 font-medium text-sm group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          {copy.backToDirectory}
        </Link>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold uppercase tracking-wider ${trustBadgeClassName(plugin.trust)}`}
          >
            {isOfficial ? copy.official : copy.reviewed}
          </span>
          <span className="text-[var(--tb-border)]">·</span>
          <Link
            href={`/?category=${encodeURIComponent(plugin.category)}`}
            className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--tb-muted)] hover:text-[var(--tb-violet)] transition-colors"
          >
            {categoryLabel} ({plugin.category})
          </Link>
          <span className="text-[var(--tb-border)]">·</span>
          {requirement && (
            <span
              className={`font-mono text-xs font-semibold px-2 py-0.5 rounded border ${
                requirement.kind === "stable" || requirement.kind === "unknown"
                  ? "text-slate-700 bg-slate-100 border-slate-200"
                  : "text-violet-700 bg-violet-50 border-violet-200"
              }`}
              title={copy.frameworkRequirementLabel}
            >
              {requirement.label}
            </span>
          )}
          <span className="font-mono text-xs font-semibold text-[var(--tb-ink)] bg-white px-2 py-0.5 rounded border border-[var(--tb-border)]">
            {formatPluginVersionLabel(plugin.recommendedVersion)}
          </span>
        </div>

        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-[var(--tb-ink)] mb-6 leading-tight">
          {localized.name}
        </h1>

        <p className="text-xl md:text-2xl text-[var(--tb-muted)] font-light leading-relaxed mb-6">
          {localized.summary}
        </p>

        <div className="flex flex-wrap gap-2 mb-8">
          {plugin.tags.map((tag) => (
            <Link
              key={tag}
              href={`/?tag=${encodeURIComponent(tag)}`}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-[var(--tb-soft)] text-[var(--tb-ink)] border border-[var(--tb-border)] hover:border-[var(--tb-violet)] hover:text-[var(--tb-violet)] transition-colors"
            >
              {tag}
            </Link>
          ))}
        </div>

        {!isOfficial && (
          <div
            role="note"
            className="flex gap-4 p-5 rounded-2xl border border-amber-300/80 bg-amber-50/80 mb-8"
          >
            <ShieldAlert size={22} className="text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-amber-950">{copy.thirdPartyNoticeTitle}</h2>
              <p className="text-sm text-amber-900 leading-relaxed">{copy.thirdPartyNoticeBody}</p>
            </div>
          </div>
        )}

        {plugin.warning && (
          <div className="flex gap-4 p-6 rounded-2xl border bg-amber-50/60 border-amber-200/70 mb-10">
            <AlertTriangle size={24} className="text-amber-500 shrink-0" />
            <p className="text-amber-800 text-sm">{plugin.warning}</p>
          </div>
        )}

        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 py-10 border-t border-b border-[var(--tb-border)] mb-10">
          <div>
            <dt className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest mb-1.5">
              {copy.maintainerLabel}
            </dt>
            <dd>
              <Link
                href={`/?author=${encodeURIComponent(plugin.author)}`}
                className="text-[var(--tb-violet)] font-medium hover:text-[var(--tb-deep)] hover:underline transition-colors"
              >
                {plugin.author}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest mb-1.5">
              {copy.licenseLabel}
            </dt>
            <dd>
              <Link
                href={`/?license=${encodeURIComponent(plugin.license)}`}
                className="text-[var(--tb-violet)] font-medium hover:text-[var(--tb-deep)] hover:underline transition-colors"
              >
                {plugin.license}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest mb-1.5">
              {copy.latestVersionLabel}
            </dt>
            <dd className="text-[var(--tb-ink)] font-mono text-sm">
              {formatPluginVersionLabel(plugin.recommendedVersion)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest mb-1.5">
              {copy.frameworkRequirementLabel}
            </dt>
            <dd className="text-[var(--tb-ink)] font-mono text-sm">
              {requirement ? requirement.label : "-"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest mb-1.5">
              {copy.categoryLabel}
            </dt>
            <dd>
              <Link
                href={`/?category=${encodeURIComponent(plugin.category)}`}
                className="text-[var(--tb-violet)] font-medium hover:text-[var(--tb-deep)] hover:underline transition-colors"
              >
                {categoryLabel} <span className="font-mono text-xs text-[var(--tb-muted)]">({plugin.category})</span>
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest mb-1.5">
              {copy.hotReloadLabel}
            </dt>
            <dd className="text-[var(--tb-ink)] font-medium flex items-center gap-2">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${plugin.hotReload ? "bg-emerald-500" : "bg-amber-500"}`}
                aria-hidden="true"
              />
              <span>{plugin.hotReload ? copy.hotUpdateSupported : copy.hotUpdateRequiredRestart}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest mb-1.5">
              {copy.cubismVersionsLabel}
            </dt>
            <dd className="font-mono text-sm text-[var(--tb-ink)] bg-white px-3 py-2 rounded-xl border border-[var(--tb-border)]">
              {plugin.requiresCubism && plugin.cubismVersions.length > 0
                ? plugin.cubismVersions.join(", ")
                : copy.cubismIndependent}
            </dd>
          </div>
          <div className="col-span-1 md:col-span-2">
            <dt className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest mb-1.5">
              {copy.sha256Label} ({plugin.fileName})
            </dt>
            <dd className="font-mono text-sm text-[var(--tb-ink)] bg-white px-3 py-2.5 rounded-xl border border-[var(--tb-border)] overflow-x-auto">
              {plugin.sha256}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest mb-1.5">
              {copy.sourceLabel}
            </dt>
            <dd>
              <a
                href={plugin.repository}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[var(--tb-violet)] font-medium hover:text-[var(--tb-deep)] transition-colors"
              >
                {copy.openRepository} <ArrowUpRight size={16} />
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest mb-1.5">
              {copy.supportLabel}
            </dt>
            <dd>
              <a
                href={plugin.support}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[var(--tb-violet)] font-medium hover:text-[var(--tb-deep)] transition-colors"
              >
                {copy.supportChannel} <ArrowUpRight size={16} />
              </a>
            </dd>
          </div>
        </dl>

        {activePermissions.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest mb-3">
              {copy.permissionsLabel}
            </h2>
            <ul className="space-y-2">
              {activePermissions.map((perm) => (
                <li
                  key={perm.id}
                  className="text-sm bg-white rounded-xl border border-[var(--tb-border)] px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-xs font-semibold text-[var(--tb-ink)]">{perm.id}</code>
                    <span className="rounded-full border border-[var(--tb-border)] bg-[var(--tb-soft)] px-2 py-0.5 font-mono text-[11px] text-[var(--tb-violet)]">
                      {copy.permissionScopeLabels[perm.scope] ?? perm.scope}
                    </span>
                  </div>
                  <span className="text-[var(--tb-muted)] text-xs">{perm.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {plugin.releases.length > 0 && (
          <section className="mb-10" aria-label={copy.versionHistoryLabel}>
            <button
              type="button"
              aria-expanded={versionHistoryOpen}
              aria-controls="plugin-version-history"
              onClick={() => setVersionHistoryOpen((open) => !open)}
              className="w-full flex items-center justify-between gap-3 rounded-xl border border-[var(--tb-border)] bg-white px-4 py-3 text-left hover:border-[var(--tb-violet)]/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--tb-violet)]/40 cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest">
                  {copy.versionHistoryLabel}
                </span>
                <span className="rounded-full bg-[var(--tb-soft)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--tb-violet)]">
                  {plugin.releases.length}
                </span>
              </span>
              <span className="flex items-center gap-2 font-mono text-xs text-[var(--tb-muted)]">
                <span>v{selectedVersion}</span>
                <ChevronDown
                  size={16}
                  className={`transition-transform ${versionHistoryOpen ? "rotate-180" : ""}`}
                />
              </span>
            </button>
            {versionHistoryOpen && (
              <div
                id="plugin-version-history"
                className="mt-3 overflow-x-auto rounded-xl border border-[var(--tb-border)] bg-white"
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--tb-border)] text-left text-[11px] font-mono font-bold uppercase tracking-widest text-[var(--tb-muted)]">
                      <th className="px-4 py-2.5">{copy.versionColumnLabel}</th>
                      <th className="px-4 py-2.5">{copy.channelLabel}</th>
                      <th className="px-4 py-2.5">{copy.frameworkRequirementLabel}</th>
                      <th className="px-4 py-2.5">{copy.cubismVersionsLabel}</th>
                      <th className="px-4 py-2.5">{copy.publishedColumnLabel}</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {plugin.releases.map((release) => {
                      const releaseRequirement = formatFrameworkRequirement(
                        frameworkFloorOf(release.turboismApi),
                        frameworkChannels,
                      );
                      const isRecommended = release.version === plugin.recommendedVersion;
                      const isSelected = release.version === selectedVersion;
                      return (
                        <tr
                          key={release.version}
                          className={`border-b border-[var(--tb-border)]/60 last:border-0 ${isSelected ? "bg-[var(--tb-soft)]/70" : ""}`}
                        >
                          <td className="px-4 py-2.5 font-mono whitespace-nowrap text-[var(--tb-ink)]">
                            <button
                              type="button"
                              onClick={() => void selectVersion(release.version)}
                              aria-pressed={isSelected}
                              className="inline-flex items-center gap-1.5 hover:text-[var(--tb-violet)] focus-visible:outline-none focus-visible:underline cursor-pointer"
                            >
                              v{release.version}
                              {isRecommended && (
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--tb-violet)]">
                                  {copy.recommendedLabel}
                                </span>
                              )}
                            </button>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-[var(--tb-muted)] whitespace-nowrap">
                            {release.channel}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap text-[var(--tb-ink)]">
                            {releaseRequirement ? releaseRequirement.label : "-"}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-[var(--tb-muted)] whitespace-nowrap">
                            {release.requiresCubism && release.cubismVersions.length > 0
                              ? formatCubismRange(release)
                              : copy.cubismIndependent}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-[var(--tb-muted)] whitespace-nowrap">
                            {release.publishedAt.slice(0, 10)}
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <a
                              href={release.downloadUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-medium text-[var(--tb-violet)] hover:text-[var(--tb-deep)] transition-colors"
                            >
                              <Download size={12} />
                              {copy.downloadJar}
                            </a>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {activeDependencies.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xs font-mono font-bold text-[var(--tb-muted)] uppercase tracking-widest mb-3">
              {copy.dependenciesLabel}
            </h2>
            <ul className="space-y-2">
              {activeDependencies.map((dep) => {
                const depTarget = dependencyPlugins[dep.id];
                const depName = depTarget
                  ? resolveLocalizedPlugin(
                      { name: depTarget.name, summary: "", localizations: depTarget.localizations },
                      catalogLocale,
                    ).name
                  : null;
                return (
                  <li
                    key={dep.id}
                    className="text-sm bg-white rounded-xl border border-[var(--tb-border)] px-4 py-2.5 flex flex-col md:flex-row md:items-center md:justify-between gap-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {depTarget && depName ? (
                        <Link
                          href={`/${depTarget.slug}`}
                          className="font-semibold text-[var(--tb-violet)] hover:text-[var(--tb-deep)] hover:underline transition-colors"
                        >
                          {depName}
                        </Link>
                      ) : null}
                      <code className="font-mono text-xs text-[var(--tb-muted)]">
                        {dep.id} {dep.version} ({dep.type})
                      </code>
                    </div>
                    {dep.reason && <span className="text-[var(--tb-muted)] text-xs">{dep.reason}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {readmeFailed && (
          <p className="mt-8 rounded-xl border border-amber-200/70 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
            {copy.readmeUnavailable}
          </p>
        )}

        {readmeHtml ? (
          <section className="mt-14 pt-10 border-t border-[var(--tb-border)]" aria-label="Plugin documentation">
            <div
              className="prose prose-slate max-w-none text-[var(--tb-ink)] leading-relaxed
                [&>h1]:text-3xl [&>h1]:font-extrabold [&>h1]:text-[var(--tb-ink)] [&>h1]:mt-8 [&>h1]:mb-4
                [&>h2]:text-2xl [&>h2]:font-bold [&>h2]:text-[var(--tb-ink)] [&>h2]:mt-8 [&>h2]:mb-3 [&>h2]:pb-2 [&>h2]:border-b [&>h2]:border-[var(--tb-border)]
                [&>h3]:text-xl [&>h3]:font-semibold [&>h3]:text-[var(--tb-ink)] [&>h3]:mt-6 [&>h3]:mb-2
                [&>p]:my-4 [&>p]:leading-relaxed
                [&>ul]:my-4 [&>ul]:list-disc [&>ul]:pl-6 [&>ul]:space-y-1.5
                [&>ol]:my-4 [&>ol]:list-decimal [&>ol]:pl-6 [&>ol]:space-y-1.5
                [&>blockquote]:my-4 [&>blockquote]:pl-4 [&>blockquote]:border-l-4 [&>blockquote]:border-[var(--tb-violet)] [&>blockquote]:italic [&>blockquote]:text-[var(--tb-muted)] [&>blockquote]:bg-[var(--tb-soft)]/50 [&>blockquote]:py-2 [&>blockquote]:rounded-r
                [&_table]:w-full [&_table]:my-6 [&_table]:border-collapse [&_table]:text-sm
                [&_th]:border [&_th]:border-[var(--tb-border)] [&_th]:bg-[var(--tb-soft)] [&_th]:px-3.5 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-[var(--tb-ink)]
                [&_td]:border [&_td]:border-[var(--tb-border)] [&_td]:px-3.5 [&_td]:py-2.5 [&_td]:text-[var(--tb-ink)]
                [&_tr:nth-child(even)]:bg-[var(--tb-paper)]
                [&_code]:font-mono [&_code]:text-xs [&_code]:bg-[var(--tb-soft)] [&_code]:text-[var(--tb-ink)] [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:border [&_code]:border-[var(--tb-border)]
                [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-4 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:my-4 [&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:text-slate-100"
              dangerouslySetInnerHTML={{ __html: readmeHtml }}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}
