/**
 * Settings validation schemas — shared across admin, user, and workspace settings.
 *
 * DRY: these schemas are the single source of truth for all settings forms.
 * Used for both client-side validation and form state typing.
 */

import { z } from "zod";

// ── Branding ─────────────────────────────────────────────────────────────────

export const brandingSchema = z.object({
  name: z.string().max(100).default(""),
  tagline: z.string().max(200).default(""),
  logoUrl: z.string().url().or(z.literal("")).default(""),
  faviconUrl: z.string().url().or(z.literal("")).default(""),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color").default("#7C5CFC"),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Invalid hex color").default("#5B3EFC"),
  fontFamily: z.string().default("Inter"),
});

export type BrandingConfig = z.infer<typeof brandingSchema>;

// ── SMS provider ─────────────────────────────────────────────────────────────

export const smsProviderSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("twilio"),
    accountSid: z.string().min(1, "Account SID required"),
    authToken: z.string().min(1, "Auth token required"),
    fromNumber: z.string().min(1, "From number required"),
  }),
  z.object({
    provider: z.literal("vonage"),
    apiKey: z.string().min(1, "API key required"),
    apiSecret: z.string().min(1, "API secret required"),
    fromNumber: z.string().min(1, "From number required"),
  }),
  z.object({
    provider: z.literal("telnyx"),
    apiKey: z.string().min(1, "API key required"),
    fromNumber: z.string().min(1, "From number required"),
  }),
]);

export type SmsProviderConfig = z.infer<typeof smsProviderSchema>;

// ── Address autocomplete ─────────────────────────────────────────────────────

export const addressProviderSchema = z.object({
  provider: z.enum(["mapbox", "geoapify", "custom"]),
  apiKey: z.string().min(1, "API key required"),
  countryCodes: z.string().default(""),
});

export type AddressProviderConfig = z.infer<typeof addressProviderSchema>;

// ── Webhook ──────────────────────────────────────────────────────────────────

export const webhookSchema = z.object({
  url: z.string().url("Invalid URL"),
  secret: z.string().min(8, "Secret must be at least 8 characters"),
  events: z.array(z.string()).min(1, "Select at least one event"),
  active: z.boolean().default(true),
});

export type WebhookConfig = z.infer<typeof webhookSchema>;

// ── AI provider ──────────────────────────────────────────────────────────────

export const aiProviderSchema = z.object({
  provider: z.enum(["openai", "anthropic", "custom"]),
  apiKey: z.string().min(1, "API key required"),
  model: z.string().default(""),
  endpoint: z.string().url().or(z.literal("")).default(""),
});

export type AiProviderConfig = z.infer<typeof aiProviderSchema>;

// ── All webhook event types ──────────────────────────────────────────────────

export const WEBHOOK_EVENTS = [
  "DOCUMENT_CREATED",
  "DOCUMENT_COMPLETED",
  "DOCUMENT_VOIDED",
  "DOCUMENT_EXPIRED",
  "SIGNER_SIGNED",
  "SIGNER_DECLINED",
  "SIGNER_VIEWED",
  "PROOF_PACKET_GENERATED",
  "AUDIT_HASH_ANCHORED",
] as const;

export const webhookEventSchema = z.enum(WEBHOOK_EVENTS);
