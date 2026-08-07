"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState, useEffect } from "react";
import { useLanguage } from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";

const networks = [
  { key: "home", href: "https://www.turboism.dev" },
  { key: "docs", href: "https://docs.turboism.dev" },
  { key: "sdk", href: "https://docs.turboism.dev/api/sdk/index.html" },
  { key: "plugins", href: "https://plugin.turboism.dev" },
  { key: "learn", href: "https://learn.turboism.dev" },
  { key: "chat", href: "https://chat.turboism.dev" },
  { key: "download", href: "https://github.com/turboism/turboism/releases" },
  { key: "github", href: "https://github.com/turboism" },
] as const;

export function SiteHeader() {
  const { copy } = useLanguage();
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 inset-x-0 z-50 transition-all duration-300 bg-white/40 backdrop-blur-md border-b border-slate-100/50">
      <div className="flex h-20 w-full items-center pl-4 pr-6">
        <div className="flex shrink-0 items-center">
          <Link href="/" className="flex shrink-0 items-center font-sans text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-600 to-amber-400 bg-clip-text text-transparent">
            Turboism
          </Link>
        </div>
        
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-5 md:flex lg:gap-6">
          {networks.map((network) => (
            <a
              key={network.key}
              href={network.href}
              className={`text-sm font-medium transition-colors ${
                network.key === "plugins" 
                  ? "text-blue-600" 
                  : "text-slate-600 hover:text-blue-600"
              }`}
            >
              {copy[network.key]}
            </a>
          ))}
        </nav>

        <div className="hidden shrink-0 items-center justify-end gap-4 md:flex">
          <LanguageSwitcher />
          <a 
            className="inline-flex items-center justify-center rounded-full bg-blue-600 text-white px-5 py-2.5 text-sm font-medium shadow-md shadow-blue-500/20 hover:bg-blue-700 hover:-translate-y-0.5 transition-all"
            href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md" 
            target="_blank" 
            rel="noreferrer"
          >
            {copy.nominate}
          </a>
        </div>

        <button
          aria-expanded={open}
          aria-label="Toggle navigation"
          className="md:hidden ml-auto flex items-center justify-center h-10 w-10 text-slate-500 hover:bg-slate-50/50 rounded-lg"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      
      {open && (
        <div className="md:hidden border-t border-slate-100/50 bg-white/90 backdrop-blur-xl px-6 py-6 space-y-4 shadow-xl">
          <nav className="flex flex-col space-y-4">
             {networks.map((network) => (
                <a
                  key={network.key}
                  href={network.href}
                  className={`text-lg font-medium ${
                    network.key === "plugins" ? "text-blue-600" : "text-slate-700 hover:text-blue-600"
                  }`}
                >
                  {copy[network.key]}
                </a>
              ))}
              <div className="h-px bg-slate-200/50 my-2"></div>
              <LanguageSwitcher />
              <a 
                href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md"
                className="text-lg font-medium text-blue-600 w-full text-left"
              >
                {copy.nominate}
              </a>
          </nav>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  const { copy } = useLanguage();
  const [year, setYear] = useState(2025);
  
  useEffect(() => {
    setYear(new Date().getFullYear());
  }, []);

  return (
    <footer className="relative z-10 border-t border-slate-100/50 bg-white/20 backdrop-blur-sm py-12 mt-auto">
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3 text-sm text-slate-500/80">
            <Link href="/" className="flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity">
               <div className="grid size-6 place-items-center rounded bg-slate-400 text-white">
                 <span className="text-xs font-bold font-serif">T</span>
               </div>
               <span className="font-sans font-medium text-slate-600">Turboism Plugins</span>
            </Link>
            <span className="text-slate-300">|</span>
            <span className="font-light">© {year}</span>
          </div>
          <div className="flex flex-wrap justify-center items-center gap-6 text-sm font-medium text-slate-500/80">
            <a href="https://www.turboism.dev" className="transition-colors hover:text-slate-900">{copy.product}</a>
            <a href="https://docs.turboism.dev" className="transition-colors hover:text-slate-900">{copy.docs}</a>
            <a href="https://github.com/turboism/turboism-plugin-directory" className="transition-colors hover:text-slate-900">{copy.github}</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
