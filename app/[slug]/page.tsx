import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, ArrowUpRight, CircleCheck, AlertTriangle } from "lucide-react";
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

  const isOfficial = plugin.trust === "official";

  return (
    <div className="flex flex-col min-h-screen pt-24 pb-16">
      <main className="container mx-auto px-6 max-w-4xl flex-1">
        <Link href="/" className="inline-flex items-center gap-2 text-slate-400 hover:text-blue-600 transition-colors mb-12 font-medium text-sm group">
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" /> 
          Back to Directory
        </Link>
        
        <p className="text-blue-600 font-mono text-xs font-semibold uppercase tracking-widest mb-4">
          {isOfficial ? "Official plugin" : "Reviewed third-party plugin"}
        </p>
        
        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight text-slate-900 mb-6 leading-tight">
          {plugin.name}
        </h1>
        
        <p className="text-xl md:text-2xl text-slate-500 font-light leading-relaxed mb-10">
          {plugin.summary}
        </p>
        
        <section className={`flex gap-4 p-6 rounded-2xl border bg-white/60 backdrop-blur-sm shadow-sm ${plugin.verification === "verified" ? "border-emerald-200/70" : "border-slate-200/70"} mb-6`}>
          <CircleCheck size={24} className={plugin.verification === "verified" ? "text-emerald-500" : "text-slate-400"} />
          <div>
            <strong className="block text-slate-900 font-bold mb-1">
              {plugin.verification === "verified" ? "Verified release" : "Pending current-version verification"}
            </strong>
            <p className="text-slate-600 text-sm font-light">
              Release <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">{plugin.verifiedRelease}</span> was trialed against Turboism <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200">{plugin.verifiedAgainst}</span> on {plugin.verifiedOn}.
            </p>
          </div>
        </section>
        
        {plugin.warning && (
          <div className="flex gap-4 p-6 rounded-2xl border bg-amber-50/60 backdrop-blur-sm border-amber-200/70 mb-10">
            <AlertTriangle size={24} className="text-amber-500" />
            <p className="text-amber-800 text-sm">{plugin.warning}</p>
          </div>
        )}
        
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6 py-10 border-t border-b border-slate-100/80 mb-10">
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">Maintainer</dt>
            <dd className="text-slate-900 font-medium">{plugin.author}</dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">License</dt>
            <dd className="text-slate-900 font-medium">{plugin.license}</dd>
          </div>
          <div className="col-span-1 md:col-span-2">
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">Release checksum</dt>
            <dd className="font-mono text-sm text-slate-600 bg-slate-50/80 px-3 py-2.5 rounded-xl border border-slate-200/80 overflow-x-auto">
              {plugin.checksum}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">Source</dt>
            <dd>
              <a href={plugin.repository} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-blue-600 font-medium hover:text-blue-800 transition-colors">
                Open repository <ArrowUpRight size={16} />
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-mono font-bold text-slate-400 uppercase tracking-widest mb-1.5">Support</dt>
            <dd>
              <a href={plugin.support} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-blue-600 font-medium hover:text-blue-800 transition-colors">
                Support channel <ArrowUpRight size={16} />
              </a>
            </dd>
          </div>
        </dl>
        
        <div>
          <a 
            href={plugin.releaseUrl} 
            target="_blank" 
            rel="noreferrer" 
            className="inline-flex items-center justify-center gap-2 rounded-full bg-blue-600 text-white px-8 py-4 text-lg font-medium shadow-lg shadow-blue-500/20 hover:bg-blue-700 hover:-translate-y-1 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-2"
          >
            Get verified release <ArrowUpRight size={20} />
          </a>
        </div>
      </main>
    </div>
  );
}
