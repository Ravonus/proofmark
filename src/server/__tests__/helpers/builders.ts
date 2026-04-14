/**
 * Shared test builder functions for creating document and signer test data.
 */

export interface TestDocument {
  id: string;
  title: string;
  content: string;
  contentHash: string;
  createdBy: string;
  createdByEmail: string | null;
  createdAt: Date;
  expiresAt: Date | null;
  status: "PENDING" | "COMPLETED" | "EXPIRED" | "VOIDED";
  accessToken: string;
  ipfsCid: string | null;
  postSignReveal: unknown;
  proofMode: "PRIVATE" | "HYBRID" | "CRYPTO_NATIVE";
  signingOrder: string;
  currentSignerIndex: number;
  encryptedAtRest: boolean;
  encryptionKeyWrapped: string | null;
  gazeTracking: string;
  templateId: string | null;
  brandingProfileId: string | null;
  pdfStyleTemplateId: string | null;
  reminderConfig: unknown;
  groupId: string | null;
}

export interface TestSigner {
  id: string;
  documentId: string;
  label: string;
  address: string | null;
  chain: "ETH" | "SOL" | "BTC" | null;
  email: string | null;
  phone: string | null;
  status: "PENDING" | "SIGNED" | "DECLINED";
  signature: string | null;
  signedAt: Date | null;
  scheme: string | null;
  handSignatureData: string | null;
  handSignatureHash: string | null;
  documentStateHash: string | null;
  fields: unknown;
  fieldValues: Record<string, string> | null;
  tokenGates: unknown;
  claimToken: string;
  lastIp: string | null;
  ipUpdatedAt: Date | null;
  signMethod: "WALLET" | "EMAIL_OTP";
  otpCode: string | null;
  otpExpiresAt: Date | null;
  otpVerifiedAt: Date | null;
  consentText: string | null;
  consentAt: Date | null;
  deliveryMethods: Array<"EMAIL" | "SMS"> | null;
  role: "SIGNER" | "APPROVER" | "CC" | "WITNESS" | "OBSERVER";
  declineReason: string | null;
  declinedAt: Date | null;
  identityLevel: "L0_WALLET" | "L1_EMAIL" | "L2_VERIFIED" | "L3_KYC";
  signerOrder: number;
  userAgent: string | null;
  socialVerifications: unknown;
  forensicEvidence: unknown;
  forensicHash: string | null;
  groupRole: string | null;
}

let docCounter = 0;
let signerCounter = 0;

export function buildDocument(overrides: Partial<TestDocument> = {}): TestDocument {
  docCounter++;
  return {
    id: `doc-${docCounter}`,
    title: "Test Document",
    content: "Test content",
    contentHash: `hash-${docCounter}`,
    createdBy: "0x1234567890abcdef",
    createdByEmail: null,
    createdAt: new Date("2026-04-02T00:00:00Z"),
    expiresAt: null,
    status: "PENDING",
    accessToken: `token-${docCounter}`,
    ipfsCid: null,
    postSignReveal: null,
    proofMode: "HYBRID",
    signingOrder: "parallel",
    currentSignerIndex: 0,
    encryptedAtRest: false,
    encryptionKeyWrapped: null,
    gazeTracking: "off",
    templateId: null,
    brandingProfileId: null,
    pdfStyleTemplateId: null,
    reminderConfig: null,
    groupId: null,
    ...overrides,
  };
}

export function buildSigner(overrides: Partial<TestSigner> = {}): TestSigner {
  signerCounter++;
  return {
    id: `signer-${signerCounter}`,
    documentId: "doc-1",
    label: `Signer ${signerCounter}`,
    address: null,
    chain: null,
    email: null,
    phone: null,
    status: "PENDING",
    signature: null,
    signedAt: null,
    scheme: null,
    handSignatureData: null,
    handSignatureHash: null,
    documentStateHash: null,
    fields: null,
    fieldValues: null,
    tokenGates: null,
    claimToken: `claim-${signerCounter}`,
    lastIp: null,
    ipUpdatedAt: null,
    signMethod: "WALLET",
    otpCode: null,
    otpExpiresAt: null,
    otpVerifiedAt: null,
    consentText: null,
    consentAt: null,
    deliveryMethods: null,
    role: "SIGNER",
    declineReason: null,
    declinedAt: null,
    identityLevel: "L0_WALLET",
    signerOrder: 0,
    userAgent: null,
    socialVerifications: null,
    forensicEvidence: null,
    forensicHash: null,
    groupRole: null,
    ...overrides,
  };
}

export function resetBuilderCounters() {
  docCounter = 0;
  signerCounter = 0;
}
