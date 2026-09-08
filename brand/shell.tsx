"use client";
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import navigation from './navigation.json';
export type BrandLocale = 'en' | 'zh' | 'ja';
export type BrandSite = 'home' | 'docs' | 'sdk' | 'plugins' | 'learn' | 'sponsor' | 'thanks' | 'download';
export function BrandSocials() {
  return <div className="tb-socials">{navigation.socials.map(social => <a key={social.name} className="tb-icon" href={social.href} target="_blank" rel="noopener noreferrer" aria-label={`Turboism ${social.name}`} title={social.name}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={social.path}/></svg></a>)}</div>;
}
export function BrandHeader({ active, locale = 'en', languageControl }: { active: BrandSite; locale?: BrandLocale; languageControl?: ReactNode }) {
  const text = navigation.labels[locale];
  useEffect(() => { document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale; }, [locale]);
  const nav = <nav className="tb-nav" aria-label={text.nav}>{navigation.links.map(([key, href]) => <a key={key} href={href} aria-current={key === active ? 'page' : undefined}>{text[key as BrandSite]}</a>)}</nav>;
  return <header className="tb-header" data-turboism-brand={navigation.version}><div className="tb-header-row"><a className="tb-logo" href="https://turboism.dev/" aria-label="Turboism">Turboism.</a>{nav}{languageControl && <div className="tb-language">{languageControl}</div>}<BrandSocials/><details className="tb-menu"><summary aria-label={text.menu}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></summary><div className="tb-menu-panel">{nav}{languageControl && <div className="tb-language">{languageControl}</div>}</div></details></div></header>;
}
export function BrandFooter() {
  return <footer className="tb-footer"><div><a href="https://turboism.dev/">Turboism</a> © {new Date().getFullYear()}</div></footer>;
}
export function BrandLanguage({ locale, onChange }: { locale: BrandLocale; onChange: (locale: BrandLocale) => void }) {
  return <div className="tb-locale" role="group" aria-label="Language">{(['en', 'zh', 'ja'] as const).map(value => <button key={value} type="button" lang={value === 'zh' ? 'zh-CN' : value} aria-pressed={value === locale} onClick={() => onChange(value)}>{({ en: 'EN', zh: '中文', ja: '日本語' })[value]}</button>)}</div>;
}
