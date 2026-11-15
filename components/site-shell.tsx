"use client";
import { BrandHeader, BrandLanguage } from '@/brand/shell';
import { useLanguage } from '@/components/language-provider';
import { PublisherAuthBar } from '@/components/publisher-auth-bar';
export { BrandFooter as SiteFooter } from '@/brand/shell';
export function SiteHeader(){const {language,setLanguage}=useLanguage();return <BrandHeader active="plugins" locale={language} languageControl={<BrandLanguage locale={language} onChange={setLanguage}/>}/>;}
export function SiteActions(){return <PublisherAuthBar />;}
