"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "@/components/language-provider";

const networks = [
  { key: "product", href: "https://www.turboism.dev" },
  { key: "docs", href: "https://docs.turboism.dev" },
  { key: "plugins", href: "https://plugin.turboism.dev" },
  { key: "learn", href: "https://learn.turboism.dev" },
  { key: "chat", href: "https://chat.turboism.dev" },
  { key: "github", href: "https://github.com/turboism" },
] as const;

export function SiteHeader() {
  const { copy, toggleLanguage } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link href="/" className="brand" aria-label="Turboism Plugin Directory home">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span>Turboism <em>Plugins</em></span>
        </Link>
        <nav className="network-nav" aria-label="Turboism network">
          {networks.map((network) => (
            <a className={network.key === "plugins" ? "is-active" : undefined} href={network.href} key={network.key} target={network.key === "github" ? "_blank" : undefined} rel={network.key === "github" ? "noreferrer" : undefined}>
              {copy[network.key]}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <button className="language-button" onClick={toggleLanguage} type="button">{copy.language}</button>
          <a className="nominate-button" href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md" target="_blank" rel="noreferrer">{copy.nominate}</a>
          <button className="icon-button" onClick={() => setOpen(!open)} type="button" aria-expanded={open} aria-label="Toggle navigation">{open ? <X size={18} /> : <Menu size={18} />}</button>
        </div>
      </div>
      {open && <nav className="mobile-network-nav" aria-label="Turboism network">{networks.map((network) => <a href={network.href} key={network.key} target={network.key === "github" ? "_blank" : undefined} rel={network.key === "github" ? "noreferrer" : undefined}>{copy[network.key]}</a>)}</nav>}
    </header>
  );
}

export function SiteFooter() {
  const { copy } = useLanguage();
  return (
    <footer className="site-footer">
      <div><span className="footer-brand">Turboism Plugin Directory</span><p>Curated listings, never self-service publication.</p></div>
      <div className="footer-links"><a href="https://www.turboism.dev">{copy.product}</a><a href="https://docs.turboism.dev">{copy.docs}</a><a href="https://github.com/turboism/turboism-plugin-directory">{copy.github}</a></div>
    </footer>
  );
}
