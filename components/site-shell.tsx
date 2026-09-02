"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThanksStarLink } from "@/components/thanks-star-link";

const networks = [
  { key: "home", href: "https://turboism.dev" },
  { key: "docs", href: "https://turboism.dev/docs" },
  { key: "sdk", href: "https://turboism.dev/docs/api/sdk/index.html" },
  { key: "plugins", href: "https://turboism.dev/plugins" },
  { key: "learn", href: "https://turboism.dev/learn" },
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
          <ThanksStarLink />
        </div>
        
        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-5 xl:flex xl:gap-6">
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

        <div className="hidden shrink-0 items-center justify-end gap-4 xl:flex">
          <LanguageSwitcher />
          <a 
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-blue-600 text-white px-5 py-2.5 text-sm font-medium shadow-md shadow-blue-500/20 hover:bg-blue-700 hover:-translate-y-0.5 transition-all"
            href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md" 
            target="_blank" 
            rel="noreferrer"
          >
            {copy.nominate}
          </a>
          <a
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-blue-600/40 bg-white px-5 py-2.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50"
            href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-request.md"
            target="_blank"
            rel="noreferrer"
          >
            {copy.request}
          </a>
        </div>

        <button
          aria-expanded={open}
          aria-label={copy.toggleNavigation}
          className="xl:hidden ml-auto flex items-center justify-center h-11 w-11 text-slate-500 hover:bg-slate-50/50 rounded-lg"
          onClick={() => setOpen((current) => !current)}
          type="button"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      
      {open && (
        <div className="xl:hidden border-t border-slate-100/50 bg-white/90 backdrop-blur-xl px-6 py-6 space-y-4 shadow-xl">
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
                className="inline-flex min-h-11 items-center text-lg font-medium text-blue-600 w-full text-left"
              >
                {copy.nominate}
              </a>
              <a
                href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-request.md"
                className="inline-flex min-h-11 items-center text-lg font-medium text-slate-700 w-full text-left hover:text-blue-600"
              >
                {copy.request}
              </a>
          </nav>
        </div>
      )}
    </header>
  );
}

export function SiteFooter() {
  const links = [
    { title: "contact@turboism.dev", href: "mailto:contact@turboism.dev" },
    { title: "Discord", href: "https://discord.gg/bect4anknH" },
  ];

  return (
    <footer className="relative z-10 border-t border-white/20 bg-white/20 backdrop-blur-sm pt-12 mb-8">
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3 text-sm text-slate-500/80">
            <Link href="https://turboism.dev" className="font-sans font-medium text-slate-600 hover:text-slate-900 transition-colors">
              Turboism
            </Link>
            <span className="text-slate-300">|</span>
            <span className="font-light">© {new Date().getFullYear()}</span>
          </div>
          <div className="flex flex-wrap justify-center items-center gap-6 text-sm font-medium text-slate-500/80">
            {links.map((link) => (
              <a key={link.title} href={link.href} className="transition-colors hover:text-slate-900">
                {link.title}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
