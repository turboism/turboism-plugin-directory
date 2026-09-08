"use client";
import { BrandHeader, BrandLanguage } from '@/brand/shell';
import { useLanguage } from '@/components/language-provider';
export { BrandFooter as SiteFooter } from '@/brand/shell';
export function SiteHeader(){const {language,setLanguage}=useLanguage();return <BrandHeader active="plugins" locale={language} languageControl={<BrandLanguage locale={language} onChange={setLanguage}/>}/>;}
export function SiteActions(){const {copy}=useLanguage();return <div className="tb-page-tools"><a className="tb-action" href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md" target="_blank" rel="noopener noreferrer">{copy.nominate}</a><a className="tb-action" href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-request.md" target="_blank" rel="noopener noreferrer">{copy.request}</a></div>;}
