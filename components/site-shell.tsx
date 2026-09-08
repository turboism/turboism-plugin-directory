'use client';
import { BrandHeader, BrandLanguage } from '@/brand/shell';
import { useLanguage } from '@/components/language-provider';
export { BrandFooter as SiteFooter } from '@/brand/shell';
export function SiteHeader(){const {language,setLanguage,copy}=useLanguage();return <BrandHeader active="plugins" locale={language} languageControl={<BrandLanguage locale={language} onChange={setLanguage}/>} tools={<><a className="tb-action" href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md" target="_blank" rel="noopener noreferrer">{copy.nominate}</a><a className="tb-action" href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-request.md" target="_blank" rel="noopener noreferrer">{copy.request}</a></>}/>;}
