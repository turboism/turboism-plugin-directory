import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PluginDetailView } from "@/components/directory-browser";
import { getDirectoryPluginBySlug, getDirectoryPlugins, getPluginReadmes } from "@/lib/directory";

export function generateStaticParams() {
  return getDirectoryPlugins().map((plugin) => ({ slug: plugin.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const plugin = getDirectoryPluginBySlug(slug);
  return plugin
    ? {
        title: plugin.name,
        description: plugin.summary,
        alternates: { canonical: `/plugins/${plugin.slug}` },
      }
    : {};
}

export default async function PluginDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const plugin = getDirectoryPluginBySlug(slug);
  if (!plugin) notFound();

  const readmes = getPluginReadmes(plugin.id, plugin.latestVersion);

  return <PluginDetailView plugin={plugin} readmes={readmes} />;
}
