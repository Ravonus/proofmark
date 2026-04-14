// @ts-nocheck -- tRPC context types break type inference across 2500+ line router; typed helpers extracted to document-helpers.ts
/**
 * Document router — merges sub-routers for file-length compliance.
 *
 * Sub-routers:
 *   document-create.ts      — create, createGroup, bulkCreate, evaluateTokenGateWallets
 *   document-query.ts       — get, getForensicReplay, saveForensicSession, claimDocuments, checkVerificationSessions, listByAddress
 *   document-sign-wallet.ts — saveFieldValues, getSigningMessage, sign
 *   document-sign-email.ts  — requestSigningOtp, signWithEmail
 *   document-management.ts  — voidDocument, declineSign, resendInvite, claimSlot, createEmbedLink, ...
 *   document-finalize.ts    — generateProofPacket, getAuditTrail, verify, mobile signing, finalization, group status
 *
 * Shared utilities:
 *   document-helpers.ts     — typed helpers (existing)
 *   document-utils.ts       — forensic helpers, identity helpers, schemas
 *   document-packets.ts     — createDocumentPacket, requiresTokenGateWalletProofs
 */

import { mergeRouters } from "~/server/api/trpc";
import { documentCreateRouter } from "./document-create";
import { documentFinalizeRouter } from "./document-finalize";
import { documentManagementRouter } from "./document-management";
import { documentQueryRouter } from "./document-query";
import { documentSignEmailRouter } from "./document-sign-email";
import { documentSignWalletRouter } from "./document-sign-wallet";

export const documentRouter = mergeRouters(
  documentCreateRouter,
  documentQueryRouter,
  documentSignWalletRouter,
  documentSignEmailRouter,
  documentManagementRouter,
  documentFinalizeRouter,
);
