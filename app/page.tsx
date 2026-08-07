import { ArrowUpRight } from "lucide-react";
import { DirectoryBrowser } from "@/components/directory-browser";

export default function HomePage() {
  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 pt-24 pb-16">
        <DirectoryBrowser />
        <section className="container mx-auto px-6 max-w-5xl mt-16 pt-16 border-t border-slate-100/50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div>
              <p className="text-blue-600 font-mono text-sm font-semibold uppercase tracking-widest mb-3">How a listing qualifies</p>
              <h2 className="text-3xl font-bold text-slate-900 mb-4 tracking-tight leading-tight">Availability must be real.</h2>
              <p className="text-slate-500 leading-relaxed font-light text-lg">
                Future entries need public source, an explicit license, a versioned obtainable release, maintenance or support information, and enough material for a basic controlled trial.
              </p>
            </div>
            <div className="flex flex-col justify-start space-y-4">
              <a href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md" target="_blank" rel="noreferrer" className="flex items-center gap-2 px-5 py-4 rounded-xl border border-slate-100/50 bg-white/50 backdrop-blur-sm text-slate-600 hover:text-blue-600 hover:border-blue-100 hover:shadow-md hover:shadow-blue-500/5 transition-all group">
                <span className="font-medium">Nominate a plugin</span>
                <ArrowUpRight size={18} className="ml-auto text-slate-400 group-hover:text-blue-600 transition-colors" />
              </a>
              <a href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=directory-report.md" target="_blank" rel="noreferrer" className="flex items-center gap-2 px-5 py-4 rounded-xl border border-slate-100/50 bg-white/50 backdrop-blur-sm text-slate-600 hover:text-blue-600 hover:border-blue-100 hover:shadow-md hover:shadow-blue-500/5 transition-all group">
                <span className="font-medium">Report a directory issue</span>
                <ArrowUpRight size={18} className="ml-auto text-slate-400 group-hover:text-blue-600 transition-colors" />
              </a>
              <a href="https://docs.turboism.dev/build-a-plugin/overview" target="_blank" rel="noreferrer" className="flex items-center gap-2 px-5 py-4 rounded-xl border border-slate-100/50 bg-white/50 backdrop-blur-sm text-slate-600 hover:text-blue-600 hover:border-blue-100 hover:shadow-md hover:shadow-blue-500/5 transition-all group">
                <span className="font-medium">Read platform documentation</span>
                <ArrowUpRight size={18} className="ml-auto text-slate-400 group-hover:text-blue-600 transition-colors" />
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
