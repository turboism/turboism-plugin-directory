import type { MetadataRoute } from "next";
import { plugins } from "@/lib/directory";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://turboism.dev/plugins";
  return [{ url: baseUrl, lastModified: new Date() }, ...plugins.map((plugin) => ({ url: `${baseUrl}/${plugin.slug}`, lastModified: new Date() }))];
}
