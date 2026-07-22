import { ArrowUpRight, BadgeCheck, GitPullRequest, ShieldAlert } from "lucide-react";
import { DirectoryBrowser } from "@/components/directory-browser";

export default function HomePage() {
  return (
    <main>
      <section className="directory-hero">
        <p className="eyebrow">Turboism / Plugin Directory</p>
        <h1>Plugins with a visible basis for trust.</h1>
        <p className="lede">A small, curated directory for discovering Turboism plugins. Each listing is intended to tell you who maintains it, what release was reviewed, and where to obtain it.</p>
        <div className="principle-grid">
          <div><BadgeCheck size={18} /><strong>Curated, not self-service</strong><p>Turboism decides what is listed, updated, warned on, or removed.</p></div>
          <div><ShieldAlert size={18} /><strong>Limited review</strong><p>Reviewed third-party is not a security certification or ongoing support promise.</p></div>
          <div><GitPullRequest size={18} /><strong>Git-reviewed records</strong><p>Directory data is public, structured, and changed through repository review.</p></div>
        </div>
      </section>
      <DirectoryBrowser />
      <section className="directory-notes">
        <div><p className="eyebrow">How a listing qualifies</p><h2>Availability must be real.</h2><p>Future entries need public source, an explicit license, a versioned obtainable release, maintenance or support information, and enough material for a basic controlled trial.</p></div>
        <div className="note-links"><a href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-nomination.md" target="_blank" rel="noreferrer">Nominate a plugin <ArrowUpRight size={15} /></a><a href="https://github.com/turboism/turboism-plugin-directory/issues/new?template=directory-report.md" target="_blank" rel="noreferrer">Report a directory issue <ArrowUpRight size={15} /></a><a href="https://docs.turboism.dev/build-a-plugin/overview" target="_blank" rel="noreferrer">Read platform documentation <ArrowUpRight size={15} /></a></div>
      </section>
    </main>
  );
}
