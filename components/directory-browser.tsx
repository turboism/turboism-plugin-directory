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
    <section className="directory-browser" aria-label="Plugin directory">
      <div className="filter-row">
        <label className="search-field">
          <Search size={17} />
          <span className="sr-only">{copy.search}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button>}
        </label>
        <span className="filter-label"><SlidersHorizontal size={15} /> Filter</span>
      </div>
      <div className="tag-row" aria-label="Plugin tags">
        <button className={!selectedTag ? "selected" : undefined} type="button" onClick={() => setSelectedTag(null)}>{copy.all}</button>
        {availableTags.map((tag) => <button className={selectedTag === tag ? "selected" : undefined} type="button" key={tag} onClick={() => setSelectedTag(tag)}>{tag}</button>)}
      </div>
      {filteredPlugins.length === 0 ? <EmptyDirectory query={query} selectedTag={selectedTag} /> : <div className="plugin-grid">{filteredPlugins.map((plugin) => <PluginCard plugin={plugin} key={plugin.slug} />)}</div>}
    </section>
  );
}

function EmptyDirectory({ query, selectedTag }: { query: string; selectedTag: string | null }) {
  const filtering = Boolean(query || selectedTag);
  return (
    <div className="empty-directory">
      <p className="empty-index">00</p>
      <h2>{filtering ? "No matching plugins." : "No plugins listed yet."}</h2>
      <p>{filtering ? "Try another search or remove the filter." : "The directory is live before its first qualifying release. We will not fill it with planned or unavailable placeholders."}</p>
      {!filtering && <a className="nominate-button" href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md" target="_blank" rel="noreferrer">Nominate a qualifying plugin</a>}
    </div>
  );
}

function PluginCard({ plugin }: { plugin: PluginEntry }) {
  const trust = plugin.trust === "official" ? "Official" : "Reviewed third-party";
  return (
    <Link href={`/plugins/${plugin.slug}`} className="plugin-card">
      <span className="trust-badge">{trust}</span>
      <h2>{plugin.name}</h2>
      <p>{plugin.summary}</p>
      <div>{plugin.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div>
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
