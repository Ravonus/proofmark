/**
 * Shared Drizzle pgEnums used by both schema.ts and schema-workspace.ts.
 * Lives in its own file to break the circular dependency.
 */
import { pgEnum } from "drizzle-orm/pg-core";

export const walletChainEnum = pgEnum("wallet_chain", [
	"ETH",
	"SOL",
	"BTC",
	"BASE",
]);

export const integrationKindEnum = pgEnum("integration_kind", [
	"SMS",
	"PAYMENT",
	"IDV",
	"SSO",
	"ADDRESS",
	"FORENSIC",
]);

export const billingIntervalEnum = pgEnum("billing_interval", [
	"monthly",
	"yearly",
	"lifetime",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
	"active",
	"past_due",
	"canceled",
	"trialing",
	"paused",
	"incomplete",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
	"draft",
	"open",
	"paid",
	"void",
	"uncollectible",
]);
