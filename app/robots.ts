import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/plugins/" }, sitemap: "https://turboism.dev/plugins/sitemap.xml" };
}
