"use client";

import Link from "next/link";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { availableTags, plugins, type PluginEntry } from "@/lib/directory";
import { useLanguage } from "@/components/language-provider";

export function DirectoryBrowser() {
  const { copy } = useLanguage();
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const filteredPlugins = useMemo(() => filterPlugins(plugins, query, selectedTag), [query, selectedTag]);

  return (
    <section className="container mx-auto px-6 max-w-5xl" aria-label="Plugin directory">
      <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
        <label className="flex items-center gap-3 w-full max-w-md px-4 py-3 rounded-full border border-slate-200 bg-white/60 backdrop-blur-sm shadow-sm focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-500/10 transition-all">
          <Search size={18} className="text-slate-400" />
          <span className="sr-only">{copy.search}</span>
          <input 
            value={query} 
            onChange={(event) => setQuery(event.target.value)} 
            placeholder={copy.search} 
            className="flex-1 bg-transparent border-0 outline-none text-slate-900 placeholder:text-slate-400 font-medium"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="text-slate-400 hover:text-slate-600 transition-colors">
              <X size={16} />
            </button>
          )}
        </label>
        <span className="hidden md:flex items-center gap-2 text-slate-400 font-mono text-xs uppercase font-semibold tracking-wider">
          <SlidersHorizontal size={14} /> Filter
        </span>
      </div>
      
      <div className="flex flex-wrap gap-2 mb-10" aria-label="Plugin tags">
        <button 
          className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${!selectedTag ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm' : 'bg-white/50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'}`} 
          type="button" 
          onClick={() => setSelectedTag(null)}
        >
          {copy.all}
        </button>
        {availableTags.map((tag) => (
          <button 
            className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${selectedTag === tag ? 'bg-blue-50 text-blue-700 border-blue-200 shadow-sm' : 'bg-white/50 border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-white'}`}
            type="button" 
            key={tag} 
            onClick={() => setSelectedTag(tag)}
          >
            {tag}
          </button>
        ))}
      </div>

      {filteredPlugins.length === 0 ? (
        <EmptyDirectory query={query} selectedTag={selectedTag} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredPlugins.map((plugin) => <PluginCard plugin={plugin} key={plugin.slug} />)}
        </div>
      )}
    </section>
  );
}

function EmptyDirectory({ query, selectedTag }: { query: string; selectedTag: string | null }) {
  const filtering = Boolean(query || selectedTag);
  return (
    <div className="flex flex-col items-center justify-center min-h-[40vh] text-center px-6 py-12 rounded-3xl border border-slate-100/50 bg-slate-50/50 backdrop-blur-sm shadow-inner">
      <p className="text-8xl font-bold font-mono text-slate-200 tracking-tighter mb-6">00</p>
      <h2 className="text-2xl font-bold text-slate-900 mb-4">{filtering ? "No matching plugins." : "No plugins listed yet."}</h2>
      <p className="max-w-md text-slate-500 font-light text-lg mb-8">
        {filtering ? "Try another search or remove the filter." : "The directory is live before its first qualifying release. We will not fill it with planned or unavailable placeholders."}
      </p>
      {!filtering && (
        <a 
          className="inline-flex items-center justify-center rounded-full bg-blue-600 text-white px-6 py-3 text-sm font-medium shadow-md shadow-blue-500/20 hover:bg-blue-700 hover:-translate-y-0.5 transition-all" 
          href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md" 
          target="_blank" 
          rel="noreferrer"
        >
          Nominate a qualifying plugin
        </a>
      )}
    </div>
  );
}

function PluginCard({ plugin }: { plugin: PluginEntry }) {
  const isOfficial = plugin.trust === "official";
  const trust = isOfficial ? "Official" : "Reviewed third-party";
  
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
