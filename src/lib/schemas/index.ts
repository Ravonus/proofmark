/**
 * Schema barrel export — single import point for all Zod schemas.
 *
 * Usage:
 *   import { createDocumentSchema, signerDefSchema } from "~/lib/schemas";
 */

export {
  signerDefSchema,
  signerInputSchema,
  fieldValueSchema,
  walletChainSchema,
  validateFieldValue,
  validateAllFields,
} from "./signer";
export type { SignerDef, WalletChain } from "./signer";

export {
  createDocumentSchema,
  documentStatusSchema,
  documentFilterSchema,
  proofModeSchema,
  proofModeLabels,
} from "./document";
export type { CreateDocumentInput, DocumentStatus, DocumentFilter } from "./document";

export {
  brandingSchema,
  smsProviderSchema,
  addressProviderSchema,
  webhookSchema,
  aiProviderSchema,
  webhookEventSchema,
  WEBHOOK_EVENTS,
} from "./settings";
export type {
  BrandingConfig,
  SmsProviderConfig,
  AddressProviderConfig,
  WebhookConfig,
  AiProviderConfig,
} from "./settings";
