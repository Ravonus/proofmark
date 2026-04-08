/**
 * Shared Drizzle pgEnums used by both schema.ts and schema-workspace.ts.
 * Lives in its own file to break the circular dependency.
 */
import { pgEnum } from "drizzle-orm/pg-core";

export const walletChainEnum = pgEnum("wallet_chain", ["ETH", "SOL", "BTC", "BASE"]);

export const integrationKindEnum = pgEnum("integration_kind", ["SMS", "PAYMENT", "IDV", "SSO", "ADDRESS", "FORENSIC"]);
