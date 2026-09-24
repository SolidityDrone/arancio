import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    root: import.meta.dirname,
  },
  typescript: {
    // Anchor IDL account names are loosely typed in strip-vault-tx / wallet-tx.
    ignoreBuildErrors: true,
  },
  serverExternalPackages: [
    "@meteora-ag/dynamic-bonding-curve-sdk",
    "@kamino-finance/klend-sdk",
    "@solana/kit",
  ],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      buffer: "buffer/",
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;
