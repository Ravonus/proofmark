// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPREHENSIVE FIELD REGISTRY
// Every field type a contract could need — standard, web3, verification, legal
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { FINANCIAL_FIELDS, WEB3_FIELDS } from "./field-defs-financial";
import { ADDRESS_FIELDS, CONTACT_FIELDS, IDENTITY_FIELDS } from "./field-defs-identity";
import { DOCUMENT_FIELDS, LEGAL_FIELDS, SIGNATURE_FIELDS, VERIFICATION_FIELDS } from "./field-defs-legal";

export type FieldCategory =
  | "identity"
  | "contact"
  | "address"
  | "financial"
  | "web3"
  | "legal"
  | "verification"
  | "signature"
  | "document";

export type FieldTypeId = keyof typeof FIELD_REGISTRY;

export type FieldConfig = {
  id: string;
  category: FieldCategory;
  label: string;
  icon: string;
  placeholder: string;
  description: string;
  inputType:
    | "text"
    | "email"
    | "tel"
    | "date"
    | "number"
    | "textarea"
    | "select"
    | "checkbox"
    | "signature"
    | "initials"
    | "address-group"
    | "wallet"
    | "file"
    | "payment"
    | "idv"
    | "social-verify"
    | "url"
    | "time"
    | "datetime-local"
    | "radio";
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    options?: string[];
  };
  color: {
    border: string;
    bg: string;
    text: string;
    glow: string;
  };
  autoFill?: "wallet-address" | "current-date" | "current-email" | "chain-name";
  autoComplete?: string;
  mask?: string;
  prefix?: string;
  sensitive?: boolean;
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UNIFIED REGISTRY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export const FIELD_REGISTRY = {
  ...IDENTITY_FIELDS,
  ...CONTACT_FIELDS,
  ...ADDRESS_FIELDS,
  ...FINANCIAL_FIELDS,
  ...WEB3_FIELDS,
  ...LEGAL_FIELDS,
  ...VERIFICATION_FIELDS,
  ...SIGNATURE_FIELDS,
  ...DOCUMENT_FIELDS,
} as const;

// Grouped for the toolbar/picker UI
export const FIELD_CATEGORIES: Array<{
  id: FieldCategory;
  label: string;
  icon: string;
  fields: FieldTypeId[];
}> = [
  {
    id: "identity",
    label: "Identity",
    icon: "\u{1F464}",
    fields: [
      "full-name",
      "first-name",
      "middle-name",
      "last-name",
      "preferred-name",
      "company-name",
      "job-title",
      "tax-id",
      "ssn",
      "ssn-full",
      "dob",
      "passport-number",
      "drivers-license",
      "national-id",
      "nationality",
    ],
  },
  {
    id: "contact",
    label: "Contact",
    icon: "\u2709",
    fields: ["email", "secondary-email", "phone", "fax-number", "website", "linkedin-url"],
  },
  {
    id: "address",
    label: "Address",
    icon: "\u{1F3E0}",
    fields: [
      "street-address",
      "address-line-2",
      "billing-address",
      "mailing-address",
      "full-address",
      "city",
      "county",
      "state",
      "zip",
      "country",
    ],
  },
  {
    id: "financial",
    label: "Financial",
    icon: "\u{1F4B2}",
    fields: [
      "currency-amount",
      "percentage",
      "bank-account",
      "account-holder-name",
      "routing-number",
      "credit-card-number",
      "cardholder-name",
      "credit-card-expiry",
      "credit-card-cvc",
      "billing-zip",
      "iban",
      "swift-bic",
      "invoice-number",
      "purchase-order",
      "payment-request",
    ],
  },
  {
    id: "web3",
    label: "Web3",
    icon: "\u{1F510}",
    fields: [
      "wallet-address",
      "eth-address",
      "btc-address",
      "sol-address",
      "ens-name",
      "token-amount",
      "tx-hash",
      "smart-contract",
      "chain-name",
      "nft-id",
      "dao-name",
    ],
  },
  {
    id: "legal",
    label: "Legal",
    icon: "\u2696",
    fields: [
      "date",
      "effective-date",
      "expiration-date",
      "renewal-date",
      "term-length",
      "notice-period",
      "jurisdiction",
      "governing-law",
      "witness-name",
      "notary-field",
      "clause-number",
      "contract-id",
    ],
  },
  {
    id: "verification",
    label: "Verify",
    icon: "\u2611",
    fields: [
      "acknowledge-checkbox",
      "risk-warning",
      "age-verification",
      "twitter-handle",
      "discord-handle",
      "telegram-handle",
      "github-handle",
      "id-verification",
      "x-verify",
      "github-verify",
      "discord-verify",
      "google-verify",
    ],
  },
  {
    id: "signature",
    label: "Sign",
    icon: "\u270D",
    fields: ["signature", "initials"],
  },
  {
    id: "document",
    label: "Other",
    icon: "\u{1F4DD}",
    fields: [
      "free-text",
      "url",
      "dropdown",
      "radio-group",
      "number",
      "time",
      "datetime",
      "file-attachment",
      "custom-field",
    ],
  },
];

export function getField(id: string): FieldConfig | undefined {
  return (FIELD_REGISTRY as Record<string, FieldConfig>)[id];
}

// Signer-based coloring: each signer gets a distinct color regardless of field type
export const SIGNER_COLORS = [
  {
    bg: "bg-blue-400/10",
    border: "border-blue-400/50",
    text: "text-blue-400",
    ring: "ring-blue-400/30",
    glow: "shadow-[0_0_16px_rgba(96,165,250,0.2)]",
    dot: "bg-blue-400",
  },
  {
    bg: "bg-orange-400/10",
    border: "border-orange-400/50",
    text: "text-orange-400",
    ring: "ring-orange-400/30",
    glow: "shadow-[0_0_16px_rgba(251,146,60,0.2)]",
    dot: "bg-orange-400",
  },
  {
    bg: "bg-purple-400/10",
    border: "border-purple-400/50",
    text: "text-purple-400",
    ring: "ring-purple-400/30",
    glow: "shadow-[0_0_16px_rgba(192,132,252,0.2)]",
    dot: "bg-purple-400",
  },
  {
    bg: "bg-emerald-400/10",
    border: "border-emerald-400/50",
    text: "text-emerald-400",
    ring: "ring-emerald-400/30",
    glow: "shadow-[0_0_16px_rgba(52,211,153,0.2)]",
    dot: "bg-emerald-400",
  },
  {
    bg: "bg-pink-400/10",
    border: "border-pink-400/50",
    text: "text-pink-400",
    ring: "ring-pink-400/30",
    glow: "shadow-[0_0_16px_rgba(244,114,182,0.2)]",
    dot: "bg-pink-400",
  },
  {
    bg: "bg-cyan-400/10",
    border: "border-cyan-400/50",
    text: "text-cyan-400",
    ring: "ring-cyan-400/30",
    glow: "shadow-[0_0_16px_rgba(34,211,238,0.2)]",
    dot: "bg-cyan-400",
  },
] as const;

export type SignerColor = (typeof SIGNER_COLORS)[number];

export function getSignerColor(signerIndex: number): SignerColor {
  return SIGNER_COLORS[signerIndex % SIGNER_COLORS.length]!;
}
