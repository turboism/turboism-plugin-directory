import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  basePath: "/plugins",
  reactStrictMode: true,
  allowedDevOrigins: ["localhost", "*.trycloudflare.com", "deaf-opposed-rangers-pharmacology.trycloudflare.com"],
  async redirects() {
    const legacyRequest = {
      type: "host" as const,
      value: "plugin.turboism.dev",
    };
    const gatewayRequest = {
      type: "query" as const,
      key: "__turboism_gateway",
      value: "1",
    };

    return [
      {
        source: "/",
        destination: "https://turboism.dev/plugins",
        permanent: true,
        basePath: false,
        has: [legacyRequest],
        missing: [gatewayRequest],
      },
      {
        // Redirect legacy UI paths, but never the machine API.
        // Vercel rewrites /api/* to /plugins/api/* (see vercel.json), so both
        // the pre- and post-rewrite API paths must be excluded here.
        source: "/plugins/:path((?!api(?:/|$)).*)",
        destination: "https://turboism.dev/plugins/:path*",
        permanent: true,
        basePath: false,
        has: [legacyRequest],
        missing: [gatewayRequest],
      },
      {
        source: "/:path((?!(?:plugins|api)(?:/|$)).*)",
        destination: "https://turboism.dev/plugins/:path*",
        permanent: true,
        basePath: false,
        has: [legacyRequest],
        missing: [gatewayRequest],
      },
    ];
  },
  turbopack: { root: __dirname },
};

export default nextConfig;
