import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowUpRight, CircleCheck } from "lucide-react";
import { plugins } from "@/lib/directory";

export function generateStaticParams() {
  return plugins.map((plugin) => ({ slug: plugin.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const plugin = plugins.find((entry) => entry.slug === slug);
  return plugin ? { title: plugin.name, description: plugin.summary, alternates: { canonical: `/plugins/${plugin.slug}` } } : {};
}

export default async function PluginDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const plugin = plugins.find((entry) => entry.slug === slug);
  if (!plugin) notFound();

  return (
    <main className="plugin-detail">
      <Link href="/" className="back-link"><ArrowLeft size={15} /> Plugin Directory</Link>
      <p className="eyebrow">{plugin.trust === "official" ? "Official plugin" : "Reviewed third-party plugin"}</p>
      <h1>{plugin.name}</h1>
      <p className="lede">{plugin.summary}</p>
      <section className="verification-card"><CircleCheck size={20} /><div><strong>{plugin.verification === "verified" ? "Verified release" : "Pending current-version verification"}</strong><p>Release {plugin.verifiedRelease} was trialed against Turboism {plugin.verifiedAgainst} on {plugin.verifiedOn}.</p></div></section>
      {plugin.warning && <p className="warning">{plugin.warning}</p>}
      <dl className="plugin-facts"><div><dt>Maintainer</dt><dd>{plugin.author}</dd></div><div><dt>License</dt><dd>{plugin.license}</dd></div><div><dt>Release checksum</dt><dd><code>{plugin.checksum}</code></dd></div><div><dt>Source</dt><dd><a href={plugin.repository} target="_blank" rel="noreferrer">Open repository <ArrowUpRight size={14} /></a></dd></div><div><dt>Support</dt><dd><a href={plugin.support} target="_blank" rel="noreferrer">Support channel <ArrowUpRight size={14} /></a></dd></div></dl>
      <a className="get-button" href={plugin.releaseUrl} target="_blank" rel="noreferrer">Get verified release <ArrowUpRight size={16} /></a>
    </main>
  );
}
