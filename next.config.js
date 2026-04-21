/** @type {import('next').NextConfig} */
const nextConfig = {
	output: "standalone",
	serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
	outputFileTracingIncludes: {
		// Ship drizzle migrations with the standalone bundle so runtime schema-sync
		// can call drizzle-kit migrate against prod DB on boot / via /api/ops/run.
		"/api/ops/run": ["./drizzle/**/*"],
		"/api/automation/run": ["./drizzle/**/*"],
	},
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
