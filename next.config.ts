import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["localhost", ".trycloudflare.com"],
  turbopack: { root: __dirname },
};

export default nextConfig;
