"use client";

import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CircleCheck, AlertTriangle, Download, Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { PluginEntry } from "@/lib/directory";
import {
  collectAvailableCategories,
  collectAvailableTags,
  filterPlugins,
  resolveLocalizedPlugin,
} from "@/lib/directory-view.mjs";
import { useLanguage } from "@/components/language-provider";

const REPORT_URL = "https://github.com/turboism/turboism-plugin-directory/issues/new?template=directory-report.md";

export function DirectoryBrowser({ plugins = [] }: { plugins?: PluginEntry[] }) {
  const { copy, catalogLocale } = useLanguage();
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const availableTags = useMemo(() => collectAvailableTags(plugins), [plugins]);
  const availableCategories = useMemo(() => collectAvailableCategories(plugins), [plugins]);
  const filteredPlugins = useMemo(
    () => filterPlugins(plugins, query, selectedTag, selectedCategory, catalogLocale),
    [plugins, query, selectedTag, selectedCategory, catalogLocale],
  );

  return (
    <section className="container mx-auto px-4 md:px-8 max-w-[1540px] pt-24" aria-label={copy.directoryLabel}>
      <div className="flex flex-col md:flex-row items-center gap-3 md:gap-4 mb-4">
        <label className="flex items-center gap-3 w-full flex-1 px-4 py-3 rounded-full border border-slate-200 bg-white/60 backdrop-blur-sm shadow-sm focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/10 transition-all">
          <Search size={18} className="text-slate-400 shrink-0" />
          <span className="sr-only">{copy.search}</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.search}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-slate-900 placeholder:text-slate-400 font-medium"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={copy.clearSearch}
              className="inline-flex items-center justify-center min-h-11 min-w-11 p-1 text-slate-400 hover:text-slate-600 transition-colors rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50"
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

      {availableCategories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3" aria-label={copy.categoriesLabel}>
          <button
            className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${!selectedCategory ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm font-semibold" : "bg-white/50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white"}`}
            type="button"
            aria-pressed={!selectedCategory}
            onClick={() => setSelectedCategory(null)}
          >
            {copy.allCategories}
          </button>
          {availableCategories.map((category) => (
            <button
              className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${selectedCategory === category ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm font-semibold" : "bg-white/50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white"}`}
              type="button"
              aria-pressed={selectedCategory === category}
              key={category}
              onClick={() => setSelectedCategory(category)}
            >
              {copy.categoryNames[category] ?? category}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-8" aria-label={copy.tagsLabel}>
        <button
          className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${!selectedTag ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm font-semibold" : "bg-white/50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white"}`}
          type="button"
          aria-pressed={!selectedTag}
          onClick={() => setSelectedTag(null)}
        >
          {copy.all}
        </button>
        {availableTags.map((tag) => (
          <button
            className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${selectedTag === tag ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm font-semibold" : "bg-white/50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white"}`}
            type="button"
            aria-pressed={selectedTag === tag}
            key={tag}
            onClick={() => setSelectedTag(tag)}
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
              <PluginCard plugin={plugin} key={plugin.slug} />
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
  const filtering = Boolean(query || selectedTag || selectedCategory);
  return (
    <div className="rounded-3xl border border-slate-100/50 bg-white/50 backdrop-blur-sm shadow-sm px-6 py-14 text-center">
      <h2 className="text-xl font-bold text-slate-900 mb-2">{filtering ? copy.noMatchTitle : copy.emptyTitle}</h2>
      <p className="max-w-md mx-auto text-slate-500 font-light leading-relaxed mb-8">
        {filtering ? copy.noMatchGuidance : copy.emptyExplanation}
      </p>
      {!filtering && (
        <a
          className="inline-flex items-center justify-center rounded-full bg-blue-600 text-white px-6 py-3 text-sm font-medium shadow-md shadow-blue-500/20 hover:bg-blue-700 hover:-translate-y-0.5 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2"
          href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md"
          target="_blank"
          rel="noreferrer"
        >
          {copy.nominateQualifying}
        </a>
      )}
    </div>
  );
}

function formatCubismRange(plugin: PluginEntry, independentLabel: string): string {
  if (!plugin.requiresCubism || plugin.cubismVersions.length === 0) {
    return independentLabel;
  }
  if (plugin.cubismVersions.length <= 3) {
    return `Cubism ${plugin.cubismVersions.join(", ")}`;
  }
  const sorted = [...plugin.cubismVersions].sort();
  return `Cubism ${sorted[0]} – ${sorted[sorted.length - 1]} (${sorted.length})`;
}

export function PluginCard({ plugin }: { plugin: PluginEntry }) {
  const { copy, catalogLocale } = useLanguage();
  const isOfficial = plugin.trust === "official";
  const trust = isOfficial ? copy.official : copy.reviewed;
  const localized = resolveLocalizedPlugin(plugin, catalogLocale);
  const categoryLabel = copy.categoryNames[plugin.category] ?? plugin.category;
  const cubismSummary = formatCubismRange(plugin, copy.cubismIndependent);

  return (
    <article
      data-plugin-slug={plugin.slug}
      className="group flex flex-col p-6 rounded-2xl border border-slate-200 bg-white/70 backdrop-blur-sm shadow-sm transition-all hover:shadow-xl hover:shadow-blue-500/10 hover:border-blue-200"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider border ${isOfficial ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-slate-50 text-slate-600 border-slate-200"}`}
          >
            {trust}
          </span>
          <span className="inline-block px-2.5 py-1 rounded-md text-[10px] font-mono font-semibold uppercase tracking-wider bg-slate-100/80 text-slate-700 border border-slate-200/70">
            {categoryLabel}
          </span>
        </div>
        <span className="font-mono text-xs font-semibold text-slate-600 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200/80">
          v{plugin.latestVersion}
        </span>
      </div>

      <h2 className="text-xl font-bold text-slate-900 mb-2">
        <Link href={`/${plugin.slug}`} className="hover:text-blue-600 transition-colors">
          {localized.name}
        </Link>
      </h2>
      <p className="text-slate-500 text-sm font-light mb-4 flex-1 line-clamp-3">{localized.summary}</p>

      <div className="space-y-1.5 text-xs text-slate-500 mb-4 pt-3 border-t border-slate-100">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono uppercase text-[10px] tracking-wider text-slate-400">
            {copy.cubismVersionsLabel}
          </span>
          <span className="font-mono text-slate-700 truncate" title={plugin.cubismVersions.join(", ")}>
            {cubismSummary}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono uppercase text-[10px] tracking-wider text-slate-400">{copy.sha256Label}</span>
          <code
            className="font-mono text-slate-600 truncate max-w-[14rem]"
            title={plugin.sha256}
            data-sha256={plugin.sha256}
          >
            {plugin.sha256.slice(0, 12)}…{plugin.sha256.slice(-8)}
          </code>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-5">
        {plugin.tags.map((tag) => (
          <span
            className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100/80 text-slate-600 border border-slate-200/60"
            key={tag}
          >
            {tag}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mt-auto pt-3 border-t border-slate-100">
        <Link
          href={`/${plugin.slug}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
        >
          {copy.viewDetails}
          <ArrowUpRight size={14} />
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

export function PluginDetailView({ plugin }: { plugin: PluginEntry }) {
  const { copy, catalogLocale } = useLanguage();
  const isOfficial = plugin.trust === "official";
  const localized = resolveLocalizedPlugin(plugin, catalogLocale);
  const categoryLabel = copy.categoryNames[plugin.category] ?? plugin.category;

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
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-600">
            {categoryLabel} ({plugin.category})
          </span>
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
            <span
              className="px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100/80 text-slate-600 border border-slate-200/60"
              key={tag}
            >
              {tag}
            </span>
          ))}
        </div>

        <section
          className={`flex gap-4 p-6 rounded-2xl border bg-white/60 backdrop-blur-sm shadow-sm ${plugin.verification === "verified" ? "border-emerald-200/70" : "border-slate-200/70"} mb-6`}
        >
          <CircleCheck size={24} className={plugin.verification === "verified" ? "text-emerald-500 shrink-0" : "text-slate-400 shrink-0"} />
          <div>
            <strong className="block text-slate-900 font-bold mb-1">{copy.verifiedReleaseTitle}</strong>
            <p className="text-slate-600 text-sm font-light mb-1">
              {isOfficial ? copy.officialNotice : copy.reviewedNotice}
            </p>
            <p className="text-slate-600 text-xs font-mono">
              {plugin.id} · v{plugin.latestVersion} · API {plugin.turboismApi} · {plugin.verifiedOn}
            </p>
          </div>
        </section>

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
            <dd className="text-slate-900 font-medium">{plugin.author}</dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              {copy.licenseLabel}
            </dt>
            <dd className="text-slate-900 font-medium">{plugin.license}</dd>
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
            <dd className="text-slate-900 font-medium">
              {categoryLabel} <span className="font-mono text-xs text-slate-500">({plugin.category})</span>
            </dd>
          </div>
          <div className="col-span-1 md:col-span-2">
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              {copy.cubismVersionsLabel}
            </dt>
            <dd className="font-mono text-sm text-slate-700 bg-slate-50/80 px-3 py-2.5 rounded-xl border border-slate-200/80">
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
      </main>
    </div>
  );
}
