"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowUpRight, AlertTriangle, ChevronDown, Download, Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { PluginEntry, DirectoryListingEntry } from "@/lib/directory";
import {
  collectAvailableCategories,
  collectAvailableTags,
  filterPlugins,
  resolveLocalizedPlugin,
} from "@/lib/directory-view.mjs";
import { useLanguage } from "@/components/language-provider";
import { renderSafeReadmeMarkdown, selectLocalizedReadme } from "@/lib/readme-renderer";

const REPORT_URL = "https://github.com/turboism/turboism-plugin-directory/issues/new?template=directory-report.md";

export function DirectoryBrowser({ plugins = [] }: { plugins?: DirectoryListingEntry[] }) {
  const { copy, catalogLocale } = useLanguage();
  const router = useRouter();
  const searchParams = useSearchParams();

  const authorParam = searchParams.get("author") || null;
  const licenseParam = searchParams.get("license") || null;
  const categoryParam = searchParams.get("category") || null;
  const tagParam = searchParams.get("tag") || null;
  const qParam = searchParams.get("q") || "";

  const [userQuery, setUserQuery] = useState<string | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  const query = userQuery ?? qParam;

  const updateParam = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const qs = params.toString();
    router.push(qs ? `/?${qs}` : "/", { scroll: false });
  };

  const clearAllFilters = () => {
    router.push("/", { scroll: false });
    setUserQuery("");
  };

  const selectedCategory = categoryParam;
  const selectedTag = tagParam;
  const selectedAuthor = authorParam;
  const selectedLicense = licenseParam;

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
      ),
    [plugins, query, selectedTag, selectedCategory, catalogLocale, selectedAuthor, selectedLicense],
  );

  const hasActiveFilters = Boolean(selectedAuthor || selectedLicense || selectedCategory || selectedTag);

  return (
    <section className="container mx-auto px-4 md:px-8 max-w-[1540px] pt-24" aria-label={copy.directoryLabel}>
      <div className="flex flex-col md:flex-row items-center gap-3 md:gap-4 mb-4">
        <label className="flex items-center gap-3 w-full flex-1 px-4 py-3 rounded-full border border-slate-200 bg-white/60 backdrop-blur-sm shadow-sm focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/10 transition-all">
          <Search size={18} className="text-slate-400 shrink-0" />
          <span className="sr-only">{copy.search}</span>
          <input
            value={query}
            onChange={(event) => setUserQuery(event.target.value)}
            placeholder={copy.search}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-slate-900 placeholder:text-slate-400 font-medium"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setUserQuery("");
                if (qParam) updateParam("q", null);
              }}
              aria-label={copy.clearSearch}
              className="inline-flex items-center justify-center min-h-11 min-w-11 p-1 text-slate-400 hover:text-slate-600 transition-colors rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 cursor-pointer"
            >
              <X size={16} />
            </button>
          )}
        </label>
        <div className="flex items-center justify-center gap-3 shrink-0">
          <span className="hidden md:flex items-center gap-2 text-slate-400 font-mono text-xs uppercase font-semibold tracking-wider">
            <SlidersHorizontal size={14} /> {copy.filter}
          </span>
          <a
            href={REPORT_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 min-h-11 rounded-full border border-slate-200 bg-white/60 px-4 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2"
          >
            {copy.report}
            <ArrowUpRight size={16} />
          </a>
        </div>
      </div>

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2 mb-4" aria-label={copy.activeFiltersLabel}>
          <span className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">
            {copy.activeFiltersLabel}
          </span>
          {selectedAuthor && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
              <span>
                {copy.authorFilterLabel}: {selectedAuthor}
              </span>
              <button
                type="button"
                onClick={() => updateParam("author", null)}
                aria-label={`Remove ${copy.authorFilterLabel} filter`}
                className="hover:text-blue-900 transition-colors p-0.5 cursor-pointer"
              >
                <X size={12} />
              </button>
            </span>
          )}
          {selectedLicense && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
              <span>
                {copy.licenseFilterLabel}: {selectedLicense}
              </span>
              <button
                type="button"
                onClick={() => updateParam("license", null)}
                aria-label={`Remove ${copy.licenseFilterLabel} filter`}
                className="hover:text-blue-900 transition-colors p-0.5 cursor-pointer"
              >
                <X size={12} />
              </button>
            </span>
          )}
          {selectedCategory && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
              <span>
                {copy.categoryLabel}: {copy.categoryNames[selectedCategory] ?? selectedCategory}
              </span>
              <button
                type="button"
                onClick={() => updateParam("category", null)}
                aria-label="Remove category filter"
                className="hover:text-blue-900 transition-colors p-0.5 cursor-pointer"
              >
                <X size={12} />
              </button>
            </span>
          )}
          {selectedTag && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
              <span>Tag: {selectedTag}</span>
              <button
                type="button"
                onClick={() => updateParam("tag", null)}
                aria-label="Remove tag filter"
                className="hover:text-blue-900 transition-colors p-0.5 cursor-pointer"
              >
                <X size={12} />
              </button>
            </span>
          )}
          <button
            type="button"
            onClick={clearAllFilters}
            className="text-xs text-slate-500 hover:text-slate-800 underline ml-2 cursor-pointer"
          >
            {copy.clearAllFilters}
          </button>
        </div>
      )}

      {availableCategories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3" aria-label={copy.categoriesLabel}>
          <button
            className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 cursor-pointer ${!selectedCategory ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm font-semibold" : "bg-white/50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white"}`}
            type="button"
            aria-pressed={!selectedCategory}
            onClick={() => updateParam("category", null)}
          >
            {copy.allCategories}
          </button>
          {availableCategories.map((category) => (
            <button
              className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 cursor-pointer ${selectedCategory === category ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm font-semibold" : "bg-white/50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white"}`}
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
        className={`md:hidden inline-flex items-center gap-1.5 min-h-11 ${tagsOpen ? "mb-3" : "mb-8"} px-4 rounded-full border border-slate-200 bg-white/50 text-sm font-medium text-slate-600 hover:border-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 cursor-pointer`}
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
          className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 cursor-pointer ${!selectedTag ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm font-semibold" : "bg-white/50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white"}`}
          type="button"
          aria-pressed={!selectedTag}
          onClick={() => updateParam("tag", null)}
        >
          {copy.all}
        </button>
        {availableTags.map((tag) => (
          <button
            className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 cursor-pointer ${selectedTag === tag ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm font-semibold" : "bg-white/50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white"}`}
            type="button"
            aria-pressed={selectedTag === tag}
            key={tag}
            onClick={() => updateParam("tag", selectedTag === tag ? null : tag)}
          >
            {tag}
          </button>
        ))}
      </div>

      <div className="min-h-[calc(100vh-16rem)]">
        {filteredPlugins.length === 0 ? (
          <EmptyDirectory query={query} selectedTag={selectedTag} selectedCategory={selectedCategory} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPlugins.map((plugin) => (
              <PluginCard key={plugin.id} plugin={plugin} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyDirectory({
  query,
  selectedTag,
  selectedCategory,
}: {
  query: string;
  selectedTag: string | null;
  selectedCategory: string | null;
}) {
  const { copy } = useLanguage();
  const hasFilter = query || selectedTag || selectedCategory;

  return (
    <div className="flex flex-col items-center justify-center p-12 text-center rounded-3xl border border-dashed border-slate-200 bg-white/30 backdrop-blur-sm max-w-xl mx-auto my-12">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-4">
        <Search size={20} />
      </div>
      <h2 className="text-xl font-bold text-slate-800 mb-2">{hasFilter ? copy.noMatchTitle : copy.emptyTitle}</h2>
      <p className="text-slate-500 text-sm max-w-md mb-6 leading-relaxed">
        {hasFilter ? copy.noMatchGuidance : copy.emptyExplanation}
      </p>
      {!hasFilter && (
        <a
          href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-slate-900 text-white px-5 py-2.5 text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm"
        >
          {copy.nominateQualifying} <ArrowUpRight size={16} />
        </a>
      )}
    </div>
  );
}

// "5.0.00" .. "5.3.04" -> "5.0–5.3"; a single major.minor stays as-is.
function formatCubismRange(plugin: DirectoryListingEntry): string | null {
  if (plugin.cubismVersions.length === 0) return null;
  const minors = [...new Set(plugin.cubismVersions.map((v) => v.split(".").slice(0, 2).join(".")))];
  return minors.length === 1 ? minors[0] : `${minors[0]}–${minors[minors.length - 1]}`;
}

function PluginCard({ plugin }: { plugin: DirectoryListingEntry }) {
  const { copy, catalogLocale } = useLanguage();
  const isOfficial = plugin.trust === "official";
  const localized = resolveLocalizedPlugin(plugin, catalogLocale);
  const categoryLabel = copy.categoryNames[plugin.category] ?? plugin.category;
  const cubismRange = formatCubismRange(plugin);

  return (
    <article className="group flex flex-col p-6 rounded-2xl border border-slate-200/80 bg-white/70 backdrop-blur-sm shadow-sm hover:shadow-md hover:border-blue-200/80 transition-all">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mb-2">
        <span
          className="font-mono text-[11px] font-semibold whitespace-nowrap text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200"
          title={copy.latestVersionLabel}
        >
          v{plugin.latestVersion} ({plugin.channel})
        </span>
        {cubismRange && (
          <span
            className="font-mono text-[11px] font-semibold whitespace-nowrap text-orange-700 bg-orange-50 px-2 py-0.5 rounded border border-orange-200"
            title={copy.cubismVersionsLabel}
          >
            Cubism {cubismRange}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
        <span className="text-blue-600 whitespace-nowrap font-mono text-xs font-semibold uppercase tracking-wider">
          {isOfficial ? copy.official : copy.reviewed}
        </span>
        <span className="whitespace-nowrap font-mono text-xs font-semibold uppercase tracking-wider text-slate-600">
          {categoryLabel}
        </span>
      </div>

      <h2 className="text-xl font-bold text-slate-900 group-hover:text-blue-600 transition-colors mb-2 leading-snug">
        <Link href={`/${plugin.slug}`} className="focus-visible:outline-none focus-visible:underline">
          {localized.name}
        </Link>
      </h2>

      <p className="text-slate-500 text-sm leading-relaxed mb-6 flex-1 line-clamp-3">{localized.summary}</p>

      <div className="flex flex-wrap gap-1.5 mb-6">
        {plugin.tags.slice(0, 3).map((tag) => (
          <span
            className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200/50"
            key={tag}
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
        <Link
          href={`/${plugin.slug}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 transition-colors"
        >
          {copy.viewDetails}
        </Link>
        <a
          href={plugin.downloadUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 text-white px-3.5 py-1.5 text-xs font-medium shadow-sm hover:bg-blue-700 transition-colors"
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
}: {
  plugin: PluginEntry;
  readmes?: Record<string, string>;
}) {
  const { copy, catalogLocale } = useLanguage();
  const isOfficial = plugin.trust === "official";
  const localized = resolveLocalizedPlugin(plugin, catalogLocale);
  const categoryLabel = copy.categoryNames[plugin.category] ?? plugin.category;

  const { content: readmeContent } = selectLocalizedReadme(readmes, catalogLocale);
  const readmeHtml = useMemo(
    () => (readmeContent ? renderSafeReadmeMarkdown(readmeContent, plugin.repository) : ""),
    [readmeContent, plugin.repository],
  );

  return (
    <div className="flex flex-col min-h-screen pt-24 pb-16">
      <main className="container mx-auto px-6 max-w-4xl flex-1">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-slate-400 hover:text-blue-600 transition-colors mb-12 font-medium text-sm group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          {copy.backToDirectory}
        </Link>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-blue-600 font-mono text-xs font-semibold uppercase tracking-widest">
            {isOfficial ? copy.official : copy.reviewed}
          </span>
          <span className="text-slate-300">·</span>
          <Link
            href={`/?category=${encodeURIComponent(plugin.category)}`}
            className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-600 hover:text-blue-600 transition-colors"
          >
            {categoryLabel} ({plugin.category})
          </Link>
          <span className="text-slate-300">·</span>
          <span className="font-mono text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
            v{plugin.latestVersion} ({plugin.channel})
          </span>
        </div>

        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 mb-6 leading-tight">
          {localized.name}
        </h1>

        <p className="text-xl md:text-2xl text-slate-500 font-light leading-relaxed mb-6">{localized.summary}</p>

        <div className="flex flex-wrap gap-2 mb-10">
          {plugin.tags.map((tag) => (
            <Link
              key={tag}
              href={`/?tag=${encodeURIComponent(tag)}`}
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100/80 text-slate-600 border border-slate-200/60 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 transition-colors"
            >
              {tag}
            </Link>
          ))}
        </div>

        {plugin.warning && (
          <div className="flex gap-4 p-6 rounded-2xl border bg-amber-50/60 backdrop-blur-sm border-amber-200/70 mb-10">
            <AlertTriangle size={24} className="text-amber-500 shrink-0" />
            <p className="text-amber-800 text-sm">{plugin.warning}</p>
          </div>
        )}

        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 py-10 border-t border-b border-slate-100/80 mb-10">
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              {copy.maintainerLabel}
            </dt>
            <dd>
              <Link
                href={`/?author=${encodeURIComponent(plugin.author)}`}
                className="text-blue-600 font-medium hover:text-blue-800 hover:underline transition-colors"
              >
                {plugin.author}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              {copy.licenseLabel}
            </dt>
            <dd>
              <Link
                href={`/?license=${encodeURIComponent(plugin.license)}`}
                className="text-blue-600 font-medium hover:text-blue-800 hover:underline transition-colors"
              >
                {plugin.license}
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              {copy.latestVersionLabel}
            </dt>
            <dd className="text-slate-900 font-mono text-sm">
              v{plugin.latestVersion} ({plugin.channel})
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              {copy.categoryLabel}
            </dt>
            <dd>
              <Link
                href={`/?category=${encodeURIComponent(plugin.category)}`}
                className="text-blue-600 font-medium hover:text-blue-800 hover:underline transition-colors"
              >
                {categoryLabel} <span className="font-mono text-xs text-slate-500">({plugin.category})</span>
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              {copy.hotReloadLabel}
            </dt>
            <dd className="text-slate-900 font-medium flex items-center gap-2">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${plugin.hotReload ? "bg-emerald-500" : "bg-amber-500"}`}
                aria-hidden="true"
              />
              <span>{plugin.hotReload ? copy.hotUpdateSupported : copy.hotUpdateRequiredRestart}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              {copy.cubismVersionsLabel}
            </dt>
            <dd className="font-mono text-sm text-slate-700 bg-slate-50/80 px-3 py-2 rounded-xl border border-slate-200/80">
              {plugin.requiresCubism && plugin.cubismVersions.length > 0
                ? plugin.cubismVersions.join(", ")
                : copy.cubismIndependent}
            </dd>
          </div>
          <div className="col-span-1 md:col-span-2">
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              {copy.sha256Label} ({plugin.fileName})
            </dt>
            <dd className="font-mono text-sm text-slate-600 bg-slate-50/80 px-3 py-2.5 rounded-xl border border-slate-200/80 overflow-x-auto">
              {plugin.sha256}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              {copy.sourceLabel}
            </dt>
            <dd>
              <a
                href={plugin.repository}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-blue-600 font-medium hover:text-blue-800 transition-colors"
              >
                {copy.openRepository} <ArrowUpRight size={16} />
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              {copy.supportLabel}
            </dt>
            <dd>
              <a
                href={plugin.support}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-blue-600 font-medium hover:text-blue-800 transition-colors"
              >
                {copy.supportChannel} <ArrowUpRight size={16} />
              </a>
            </dd>
          </div>
        </dl>

        {plugin.permissions.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-3">
              {copy.permissionsLabel}
            </h2>
            <ul className="space-y-2">
              {plugin.permissions.map((perm) => (
                <li
                  key={perm.id}
                  className="text-sm bg-white/60 rounded-xl border border-slate-200/70 px-4 py-2.5 flex flex-col md:flex-row md:items-center md:justify-between gap-1"
                >
                  <code className="font-mono text-xs text-slate-800">
                    {perm.id} ({perm.scope})
                  </code>
                  <span className="text-slate-600 text-xs">{perm.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {plugin.dependencies.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-3">
              {copy.dependenciesLabel}
            </h2>
            <ul className="space-y-2">
              {plugin.dependencies.map((dep) => (
                <li
                  key={dep.id}
                  className="text-sm bg-white/60 rounded-xl border border-slate-200/70 px-4 py-2.5 flex flex-col md:flex-row md:items-center md:justify-between gap-1"
                >
                  <code className="font-mono text-xs text-slate-800">
                    {dep.id} {dep.version} ({dep.type})
                  </code>
                  {dep.reason && <span className="text-slate-600 text-xs">{dep.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <a
            href={plugin.downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 text-white px-8 py-4 text-lg font-medium shadow-lg shadow-blue-500/20 hover:bg-blue-700 hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2"
          >
            <Download size={20} />
            {copy.downloadJar}
          </a>
          <a
            href={plugin.releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white/80 text-slate-700 px-6 py-4 text-base font-medium hover:border-blue-300 hover:text-blue-600 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2"
          >
            {copy.viewRelease} <ArrowUpRight size={18} />
          </a>
        </div>

        {readmeHtml ? (
          <section className="mt-14 pt-10 border-t border-slate-200/80" aria-label="Plugin documentation">
            <div
              className="prose prose-slate max-w-none text-slate-700 leading-relaxed
                [&>h1]:text-3xl [&>h1]:font-extrabold [&>h1]:text-slate-900 [&>h1]:mt-8 [&>h1]:mb-4
                [&>h2]:text-2xl [&>h2]:font-bold [&>h2]:text-slate-900 [&>h2]:mt-8 [&>h2]:mb-3 [&>h2]:pb-2 [&>h2]:border-b [&>h2]:border-slate-100
                [&>h3]:text-xl [&>h3]:font-semibold [&>h3]:text-slate-900 [&>h3]:mt-6 [&>h3]:mb-2
                [&>p]:my-4 [&>p]:leading-relaxed
                [&>ul]:my-4 [&>ul]:list-disc [&>ul]:pl-6 [&>ul]:space-y-1.5
                [&>ol]:my-4 [&>ol]:list-decimal [&>ol]:pl-6 [&>ol]:space-y-1.5
                [&>blockquote]:my-4 [&>blockquote]:pl-4 [&>blockquote]:border-l-4 [&>blockquote]:border-blue-500 [&>blockquote]:italic [&>blockquote]:text-slate-600 [&>blockquote]:bg-blue-50/40 [&>blockquote]:py-2 [&>blockquote]:rounded-r
                [&_table]:w-full [&_table]:my-6 [&_table]:border-collapse [&_table]:text-sm
                [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3.5 [&_th]:py-2.5 [&_th]:text-left [&_th]:font-semibold [&_th]:text-slate-800
                [&_td]:border [&_td]:border-slate-200 [&_td]:px-3.5 [&_td]:py-2.5 [&_td]:text-slate-700
                [&_tr:nth-child(even)]:bg-slate-50/50
                [&_code]:font-mono [&_code]:text-xs [&_code]:bg-slate-100 [&_code]:text-slate-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:border [&_code]:border-slate-200/60
                [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-4 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:my-4 [&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:text-slate-100"
              dangerouslySetInnerHTML={{ __html: readmeHtml }}
            />
          </section>
        ) : null}
      </main>
    </div>
  );
}
