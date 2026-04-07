import { isPremiumAvailable } from "~/lib/platform/premium";

/**
 * Feature access catalog.
 *
 * OSS  = true  → ships with the free open-source build (full DocuSign replacement)
 * OSS  = false → requires the premium build (crypto layer + managed infra)
 *
 * Some OSS features are "bring-your-own" — the operator plugs in their own
 * API keys (Twilio, Stripe, Okta, etc). Premium ships those pre-configured.
 * That's noted in the summary, but it doesn't change whether the feature is
 * available — BYO features are fully functional once configured.
 */

export type FeatureCategory =
  | "core" // signing fundamentals every deployment gets
  | "automation" // cron-driven workflows (reminders, expiry, bulk)
  | "integration" // webhooks, embedded signing, SMS, payments
  | "enterprise" // teams, RBAC, reporting
  | "crypto" // blockchain anchoring, wallet signing, inscriptions
  | "social" // pseudo-anon contracts, post-sign access, sharing
  | "ai"; // AI-powered features (premium)

export type FeatureId =
  | "templates"
  | "advanced_fields"
  | "reminders"
  | "expiration"
  | "branding"
  | "bulk_send"
  | "decline_reasons"
  | "void_cancel"
  | "webhooks"
  | "embedded_signing"
  | "address_autocomplete"
  | "sms_delivery"
  | "payments"
  | "attachments"
  | "approval_roles"
  | "reporting"
  | "teams"
  | "sso"
  | "id_verification"
  | "blockchain_anchoring"
  | "zero_knowledge_vault"
  | "auto_wallet"
  | "html_inscriptions"
  | "wallet_signing"
  | "post_sign_access"
  | "group_access_controls"
  | "ai_scraper_fix"
  | "ai_editor_assistant"
  | "ai_signer_qa"
  | "ai_automation_review"
  | "ai_byok"
  | "ai_connector"
  | "ai_enterprise_sharing"
  | "collab_live_sessions"
  | "collab_co_editing"
  | "collab_review_mode"
  | "collab_shared_ai"
  | "collab_pdf_review"
  | "collab_shareable_links";

export type FeatureDescriptor = {
  id: FeatureId;
  label: string;
  category: FeatureCategory;
  summary: string;
  /** True = included in OSS. False = premium only. */
  oss: boolean;
  /** True = operator supplies their own API keys in OSS (e.g. Twilio, Stripe). */
  byo: boolean;
};

export const FEATURE_IDS = [
  "templates",
  "advanced_fields",
  "reminders",
  "expiration",
  "branding",
  "bulk_send",
  "decline_reasons",
  "void_cancel",
  "webhooks",
  "embedded_signing",
  "address_autocomplete",
  "sms_delivery",
  "payments",
  "attachments",
  "approval_roles",
  "reporting",
  "teams",
  "sso",
  "id_verification",
  "blockchain_anchoring",
  "zero_knowledge_vault",
  "auto_wallet",
  "html_inscriptions",
  "wallet_signing",
  "post_sign_access",
  "group_access_controls",
  "ai_scraper_fix",
  "ai_editor_assistant",
  "ai_signer_qa",
  "ai_automation_review",
  "ai_byok",
  "ai_connector",
  "ai_enterprise_sharing",
  "collab_live_sessions",
  "collab_co_editing",
  "collab_review_mode",
  "collab_shared_ai",
  "collab_pdf_review",
  "collab_shareable_links",
] as const satisfies readonly FeatureId[];

export const PREMIUM_FEATURE_IDS = [
  "reporting",
  "teams",
  "blockchain_anchoring",
  "auto_wallet",
  "html_inscriptions",
  "post_sign_access",
  "group_access_controls",
  "ai_scraper_fix",
  "ai_editor_assistant",
  "ai_signer_qa",
  "ai_automation_review",
  "ai_byok",
  "ai_connector",
  "ai_enterprise_sharing",
  "collab_live_sessions",
  "collab_co_editing",
  "collab_review_mode",
  "collab_shared_ai",
  "collab_pdf_review",
  "collab_shareable_links",
] as const satisfies readonly FeatureId[];

const FEATURE_CATALOG: FeatureDescriptor[] = [
  // ── Core signing (OSS) ───────────────────────────────────────────
  {
    id: "templates",
    label: "Reusable templates",
    category: "core",
    oss: true,
    byo: false,
    summary: "Save and reuse signing blueprints with default signers and document settings.",
  },
  {
    id: "advanced_fields",
    label: "Advanced fields",
    category: "core",
    oss: true,
    byo: false,
    summary: "Checkboxes, dropdowns, initials, attachments, wallet fields, and signer-aware placement.",
  },
  {
    id: "branding",
    label: "Custom branding",
    category: "core",
    oss: true,
    byo: false,
    summary: "Per-account logo, colors, and email/signing experience customization.",
  },
  {
    id: "decline_reasons",
    label: "Decline reasons",
    category: "core",
    oss: true,
    byo: false,
    summary: "Recipients can formally decline and explain why.",
  },
  {
    id: "void_cancel",
    label: "Void and cancel",
    category: "core",
    oss: true,
    byo: false,
    summary: "Creators can cancel pending packets without deleting the audit trail.",
  },
  {
    id: "approval_roles",
    label: "Approval and observer roles",
    category: "core",
    oss: true,
    byo: false,
    summary: "Support approvers, observers, and witness-style recipients alongside signers.",
  },
  {
    id: "attachments",
    label: "Signer attachments",
    category: "core",
    oss: true,
    byo: false,
    summary: "Collect supporting files during a signing session.",
  },
  {
    id: "zero_knowledge_vault",
    label: "Zero-knowledge vault",
    category: "core",
    oss: true,
    byo: false,
    summary: "Client-side encrypted vault — keys never leave the user's device.",
  },

  // ── Automation (OSS) ─────────────────────────────────────────────
  {
    id: "reminders",
    label: "Automated reminders",
    category: "automation",
    oss: true,
    byo: false,
    summary: "Scheduled nudges for pending recipients with cron-friendly automation hooks.",
  },
  {
    id: "expiration",
    label: "Expiration and auto-void",
    category: "automation",
    oss: true,
    byo: false,
    summary: "Auto-expire and void in-flight documents after a deadline.",
  },
  {
    id: "bulk_send",
    label: "Bulk send",
    category: "automation",
    oss: true,
    byo: false,
    summary: "Create many signing packets in one request from a template or payload set.",
  },

  // ── Integration (OSS, some BYO) ──────────────────────────────────
  {
    id: "webhooks",
    label: "Webhooks",
    category: "integration",
    oss: true,
    byo: false,
    summary: "HMAC-signed event callbacks for document lifecycle changes.",
  },
  {
    id: "embedded_signing",
    label: "Embedded signing",
    category: "integration",
    oss: true,
    byo: false,
    summary: "Iframe-safe signing links for product and partner integrations.",
  },
  {
    id: "address_autocomplete",
    label: "Address autocomplete",
    category: "integration",
    oss: true,
    byo: true,
    summary: "Typeahead address suggestions with BYO geocoding providers like Mapbox, Geoapify, or your own endpoint.",
  },
  {
    id: "sms_delivery",
    label: "SMS delivery",
    category: "integration",
    oss: true,
    byo: true,
    summary: "Send invites and reminders via SMS. Plug in your own Twilio/provider keys; premium ships pre-configured.",
  },
  {
    id: "payments",
    label: "Payment collection",
    category: "integration",
    oss: true,
    byo: true,
    summary:
      "Collect payment inside the signing flow. Plug in your own Stripe/provider keys; premium ships pre-configured.",
  },
  {
    id: "sso",
    label: "SSO / OAuth providers",
    category: "integration",
    oss: true,
    byo: true,
    summary:
      "Plug in identity providers (Google, Auth0, Okta, etc). Supply your own API keys; premium ships pre-configured.",
  },

  // ── Enterprise (PREMIUM) ──────────────────────────────────────────
  {
    id: "reporting",
    label: "Reporting dashboard",
    category: "enterprise",
    oss: false,
    byo: false,
    summary: "Completion, drop-off, and throughput reporting for templates and packets.",
  },
  {
    id: "teams",
    label: "Teams and RBAC",
    category: "enterprise",
    oss: false,
    byo: false,
    summary: "Shared accounts, org structures, permissions, and operational controls.",
  },
  {
    id: "group_access_controls",
    label: "Group access controls",
    category: "enterprise",
    oss: false,
    byo: false,
    summary:
      "Post-signing access grants — give signers access to files, testnets, or internal resources after contract execution.",
  },

  // ── ID verification (FREE algo, PREMIUM managed KYC) ────────────
  {
    id: "id_verification",
    label: "ID verification",
    category: "core",
    oss: true,
    byo: false,
    summary:
      "Identity verification L0-L3 with built-in algorithmic KYC system. Premium adds managed third-party provider integration.",
  },

  // ── Crypto signing (FREE — this is a Web3 signing platform) ───────
  {
    id: "wallet_signing",
    label: "Wallet-based signing",
    category: "crypto",
    oss: true,
    byo: false,
    summary: "Sign documents with wallet private keys — verifiable on-chain identity for contracts and legal evidence.",
  },

  // ── Crypto managed (PREMIUM) ─────────────────────────────────────
  {
    id: "auto_wallet",
    label: "Auto-wallet generation",
    category: "crypto",
    oss: false,
    byo: false,
    summary: "Web2 email users get managed wallets (Base/SOL/BTC) with encrypted private keys stored in vault.",
  },

  // ── On-chain writing (PREMIUM — costs gas, managed infra) ────────
  {
    id: "blockchain_anchoring",
    label: "Blockchain anchoring",
    category: "crypto",
    oss: false,
    byo: false,
    summary:
      "Write document hashes to Base, Solana, and Bitcoin to cryptographically prove date and time of signatures.",
  },
  {
    id: "html_inscriptions",
    label: "HTML inscriptions",
    category: "crypto",
    oss: false,
    byo: false,
    summary:
      "Inscribe the full signed document as an interactive HTML page on BTC, bound to the recipient's wallet address.",
  },

  // ── Social (PREMIUM ONLY) ────────────────────────────────────────
  {
    id: "post_sign_access",
    label: "Post-sign resource access",
    category: "social",
    oss: false,
    byo: false,
    summary:
      "After signing, grant signers access to files, test networks, repos, or internal systems — contractors start working immediately.",
  },

  // ── AI Layer (PREMIUM) ──────────────────────────────────────────
  {
    id: "ai_scraper_fix",
    label: "AI smart scraper fix",
    category: "ai",
    oss: false,
    byo: false,
    summary: "AI reviews PDF analysis and fixes missed fields, wrong types, and missing tags in one pass.",
  },
  {
    id: "ai_editor_assistant",
    label: "AI editor assistant",
    category: "ai",
    oss: false,
    byo: false,
    summary:
      "Guided AI assistant for document editing — point it at specific sections, ask for edits, ideas, and cleanup.",
  },
  {
    id: "ai_signer_qa",
    label: "AI signer Q&A",
    category: "ai",
    oss: false,
    byo: false,
    summary:
      "AI-powered document Q&A for signers — break down complex contracts, explain clauses, ask follow-up questions.",
  },
  {
    id: "ai_automation_review",
    label: "AI automation review",
    category: "ai",
    oss: false,
    byo: false,
    summary:
      "Review forensic signing evidence with one or more models to classify human vs. automated behavior and compare verdicts.",
  },
  {
    id: "ai_byok",
    label: "Bring your own AI key",
    category: "ai",
    oss: false,
    byo: true,
    summary: "Plug in your own AI API keys (OpenAI, Anthropic, Google, etc.) for AI features.",
  },
  {
    id: "ai_connector",
    label: "OpenClaw connector",
    category: "ai",
    oss: false,
    byo: false,
    summary: "Connect Claude Code, Codex, or OpenClaw directly to the platform via the open-source Rust connector app.",
  },
  {
    id: "ai_enterprise_sharing",
    label: "AI enterprise sharing",
    category: "enterprise",
    oss: false,
    byo: false,
    summary: "Share AI access with team members — set rate limits and usage caps per user.",
  },

  // ── Collaboration Layer (PREMIUM) ──────────────────────────────
  {
    id: "collab_live_sessions",
    label: "Live collaboration sessions",
    category: "enterprise",
    oss: false,
    byo: false,
    summary: "Create/join real-time collaborative workspaces for building or reviewing contracts together.",
  },
  {
    id: "collab_co_editing",
    label: "Real-time co-editing",
    category: "enterprise",
    oss: false,
    byo: false,
    summary: "CRDT-based collaborative editing with live cursors, selections, and conflict-free simultaneous typing.",
  },
  {
    id: "collab_review_mode",
    label: "Collaborative review mode",
    category: "enterprise",
    oss: false,
    byo: false,
    summary:
      "Walk through contracts together with annotations, highlights, comments, and bookmarks with user attribution.",
  },
  {
    id: "collab_shared_ai",
    label: "Shared AI conversations",
    category: "ai",
    oss: false,
    byo: false,
    summary: "Talk to the same AI model with shared context — everyone sees questions and answers in real-time.",
  },
  {
    id: "collab_pdf_review",
    label: "Collaborative PDF review",
    category: "enterprise",
    oss: false,
    byo: false,
    summary:
      "Import existing PDFs, filled contracts, or opposing counsel docs for collaborative analysis and AI research.",
  },
  {
    id: "collab_shareable_links",
    label: "Shareable section links",
    category: "enterprise",
    oss: false,
    byo: false,
    summary: "Deep links to specific contract sections with optional AI breakdowns for quick sharing and navigation.",
  },
];

export function getFeatureCatalog(): FeatureDescriptor[] {
  return FEATURE_CATALOG;
}

export function getFeatureDescriptor(featureId: FeatureId): FeatureDescriptor {
  const feature = FEATURE_CATALOG.find((entry) => entry.id === featureId);
  if (!feature) throw new Error(`Unknown feature "${featureId}"`);
  return feature;
}

/** True when the feature is usable in the current deployment. */
export function isFeatureEnabled(featureId: FeatureId): boolean {
  const feature = getFeatureDescriptor(featureId);
  if (feature.oss) return true;
  return isPremiumAvailable();
}

/** True when the feature requires operator-supplied credentials in OSS. */
export function isByoFeature(featureId: FeatureId): boolean {
  const feature = getFeatureDescriptor(featureId);
  return feature.byo && !isPremiumAvailable();
}
