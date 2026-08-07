import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["localhost", "*.trycloudflare.com", "deaf-opposed-rangers-pharmacology.trycloudflare.com"],
  turbopack: { root: __dirname },
};

export default nextConfig;
