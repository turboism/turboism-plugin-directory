import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/plugins/",
      disallow: ["/plugins/dashboard", "/plugins/api/"],
    },
    sitemap: "https://turboism.dev/plugins/sitemap.xml",
  };
}
