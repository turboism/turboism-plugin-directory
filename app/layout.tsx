import type { Metadata } from 'next';
import { brandFontVariables } from '@/brand/fonts';
import './globals.css';
import '@/brand/brand.css';
import '@/brand/typography.css';
import { LanguageProvider } from '@/components/language-provider';
import { SiteFooter, SiteHeader, SiteActions } from '@/components/site-shell';
export const metadata:Metadata={metadataBase:new URL('https://turboism.dev'),title:{default:'Turboism Plugin Directory',template:'%s · Turboism Plugins'},description:'The curated public directory for Turboism plugins.',alternates:{canonical:'/plugins'}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en" className={`${brandFontVariables}`}><body className="relative flex min-h-screen flex-col overflow-x-hidden"><LanguageProvider><SiteHeader/><main className="tb-directory-main flex-1 relative z-10 pt-20"><SiteActions/>{children}</main><SiteFooter/></LanguageProvider></body></html>;}
