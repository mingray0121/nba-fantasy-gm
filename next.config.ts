import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Yahoo player headshots
  images: { remotePatterns: [{ protocol: "https", hostname: "s.yimg.com" }] },
};

export default nextConfig;
