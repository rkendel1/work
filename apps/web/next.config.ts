import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    serverActions: {
      allowedOrigins: ["127.0.0.1:3000", "localhost:3000"],
    },
  },
};

export default nextConfig;
