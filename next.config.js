/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.externals.push("pino-pretty", "encoding");
    // Ignore non-JS files in premium modules (Solidity contracts, Rust programs)
    config.module.rules.push({
      test: /\.(sol|rs|toml)$/,
      use: "null-loader",
    });
    return config;
  },
};

module.exports = nextConfig;
