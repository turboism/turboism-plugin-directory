import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/components/language-provider";
import { SiteFooter, SiteHeader } from "@/components/site-shell";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://plugin.turboism.dev"),
  title: { default: "Turboism Plugin Directory", template: "%s · Turboism Plugins" },
  description: "The curated public directory for Turboism plugins.",
  alternates: { canonical: "/" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}><body><LanguageProvider><div className="background-grid" aria-hidden="true" /><SiteHeader />{children}<SiteFooter /></LanguageProvider></body></html>;
}
