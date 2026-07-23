import { ArrowUpRight } from "lucide-react";
import { DirectoryBrowser } from "@/components/directory-browser";

export default function HomePage() {
  return (
    <main>
      <DirectoryBrowser />
      <section className="directory-notes">
        <div><p className="eyebrow">How a listing qualifies</p><h2>Availability must be real.</h2><p>Future entries need public source, an explicit license, a versioned obtainable release, maintenance or support information, and enough material for a basic controlled trial.</p></div>
        <div className="note-links"><a href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md" target="_blank" rel="noreferrer">Nominate a plugin <ArrowUpRight size={15} /></a><a href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=directory-report.md" target="_blank" rel="noreferrer">Report a directory issue <ArrowUpRight size={15} /></a><a href="https://docs.turboism.dev/build-a-plugin/overview" target="_blank" rel="noreferrer">Read platform documentation <ArrowUpRight size={15} /></a></div>
      </section>
    </main>
  );
}
