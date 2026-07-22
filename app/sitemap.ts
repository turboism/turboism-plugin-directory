import type { MetadataRoute } from "next";
import { plugins } from "@/lib/directory";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://plugin.turboism.dev";
  return [{ url: baseUrl, lastModified: new Date() }, ...plugins.map((plugin) => ({ url: `${baseUrl}/plugins/${plugin.slug}`, lastModified: new Date() }))];
}
