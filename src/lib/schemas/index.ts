/**
 * Schema barrel export — single import point for all Zod schemas.
 *
 * Usage:
 *   import { createDocumentSchema, signerDefSchema } from "~/lib/schemas";
 */

export { signerDefSchema, signerInputSchema, fieldValueSchema, walletChainSchema } from "./signer";
export type { SignerDef, SignMethod, SignerRole, WalletChain } from "./signer";

export {
  createDocumentSchema,
  saveTemplateSchema,
  deliveryMethodSchema,
  documentFieldSchema,
  documentSignerSchema,
  documentTemplateSignerSchema,
  documentTemplateDefaultsSchema,
  documentReminderSchema,
  documentStatusSchema,
  documentFilterSchema,
  securityModeSchema,
  signingOrderSchema,
  gazeTrackingSchema,
  proofModeSchema,
  proofModeLabels,
  postSignRevealSchema,
} from "./document";
export type {
  CreateDocumentInput,
  SaveTemplateInput,
  DeliveryMethod,
  DocumentFieldInput,
  DocumentSignerInput,
  DocumentTemplateSignerInput,
  DocumentTemplateDefaults,
  DocumentReminderInput,
  ProofMode,
  SecurityModeInput,
  SigningOrderInput,
  GazeTrackingInput,
  PostSignRevealInput,
  DocumentStatus,
  DocumentFilter,
} from "./document";

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
