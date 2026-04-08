/**
 * Schema barrel export — single import point for all Zod schemas.
 *
 * Usage:
 *   import { createDocumentSchema, signerDefSchema } from "~/lib/schemas";
 */

export type {
  CreateDocumentInput,
  DeliveryMethod,
  DocumentFieldInput,
  DocumentFilter,
  DocumentReminderInput,
  DocumentSignerInput,
  DocumentStatus,
  DocumentTemplateDefaults,
  DocumentTemplateSignerInput,
  GazeTrackingInput,
  PostSignRevealInput,
  ProofMode,
  SaveTemplateInput,
  SecurityModeInput,
  SigningOrderInput,
} from "./document";
export {
  createDocumentSchema,
  deliveryMethodSchema,
  documentFieldSchema,
  documentFilterSchema,
  documentReminderSchema,
  documentSignerSchema,
  documentStatusSchema,
  documentTemplateDefaultsSchema,
  documentTemplateSignerSchema,
  gazeTrackingSchema,
  postSignRevealSchema,
  proofModeLabels,
  proofModeSchema,
  saveTemplateSchema,
  securityModeSchema,
  signingOrderSchema,
} from "./document";
export type {
  AddressProviderConfig,
  AiProviderConfig,
  BrandingConfig,
  SmsProviderConfig,
  WebhookConfig,
} from "./settings";
export {
  addressProviderSchema,
  aiProviderSchema,
  brandingSchema,
  smsProviderSchema,
  WEBHOOK_EVENTS,
  webhookEventSchema,
  webhookSchema,
} from "./settings";
export type { SignerDef, SignerRole, SignMethod, WalletChain } from "./signer";
export { fieldValueSchema, signerDefSchema, signerInputSchema, walletChainSchema } from "./signer";
