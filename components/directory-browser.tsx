"use client";

import Link from "next/link";
import { ArrowUpRight, Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { availableTags, plugins, type PluginEntry } from "@/lib/directory";
import { useLanguage } from "@/components/language-provider";

const REPORT_URL = "https://github.com/turboism/turboism-plugin-directory/issues/new?template=directory-report.md";

export function DirectoryBrowser() {
  const { copy } = useLanguage();
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const filteredPlugins = useMemo(() => filterPlugins(plugins, query, selectedTag), [query, selectedTag]);

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
            <button type="button" onClick={() => setQuery("")} aria-label={copy.clearSearch} className="inline-flex items-center justify-center min-h-11 min-w-11 p-1 text-slate-400 hover:text-slate-600 transition-colors rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50">
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

      <div className="flex flex-wrap gap-2 mb-8" aria-label={copy.tagsLabel}>
        <button
          className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${!selectedTag ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm font-semibold' : 'bg-white/50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'}`}
          type="button"
          aria-pressed={!selectedTag}
          onClick={() => setSelectedTag(null)}
        >
          {copy.all}
        </button>
        {availableTags.map((tag) => (
          <button
            className={`px-4 py-1.5 min-h-11 min-w-11 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 ${selectedTag === tag ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm font-semibold' : 'bg-white/50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'}`}
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
          <EmptyDirectory query={query} selectedTag={selectedTag} />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredPlugins.map((plugin) => <PluginCard plugin={plugin} key={plugin.slug} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyDirectory({ query, selectedTag }: { query: string; selectedTag: string | null }) {
  const { copy } = useLanguage();
  const filtering = Boolean(query || selectedTag);
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

function PluginCard({ plugin }: { plugin: PluginEntry }) {
  const { copy } = useLanguage();
  const isOfficial = plugin.trust === "official";
  const trust = isOfficial ? copy.official : copy.reviewed;

  return (
    <Link href={`/plugins/${plugin.slug}`} className="group flex flex-col p-6 rounded-2xl border border-slate-200 bg-white/70 backdrop-blur-sm shadow-sm transition-all hover:shadow-xl hover:shadow-blue-500/10 hover:border-blue-200 hover:-translate-y-1">
      <div className="flex items-start justify-between mb-4">
        <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider border ${isOfficial ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
          {trust}
        </span>
      </div>
      <h2 className="text-xl font-bold text-slate-900 mb-2 group-hover:text-blue-600 transition-colors">{plugin.name}</h2>
      <p className="text-slate-500 text-sm font-light mb-6 flex-1 line-clamp-3">{plugin.summary}</p>
      <div className="flex flex-wrap gap-1.5 mt-auto">
        {plugin.tags.map((tag) => (
          <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100/80 text-slate-600 border border-slate-200/60" key={tag}>{tag}</span>
        ))}
      </div>
    </Link>
  );
}

function filterPlugins(entries: PluginEntry[], query: string, selectedTag: string | null) {
  const normalized = query.trim().toLowerCase();
  return entries.filter((plugin) => {
    const textMatches = !normalized || `${plugin.name} ${plugin.summary} ${plugin.author} ${plugin.tags.join(" ")}`.toLowerCase().includes(normalized);
    return textMatches && (!selectedTag || plugin.tags.includes(selectedTag));
  });
}
