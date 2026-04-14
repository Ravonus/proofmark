import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: [
    "./src/server/db/schema.ts",
    "./src/server/db/schema-billing.ts",
    "./premium/collaboration/schema.ts",
    "./premium/escrow/schema.ts",
  ],
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  out: "./drizzle",
});
