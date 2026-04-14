import type { WalletChain } from "~/lib/crypto/chains";

export type FieldType =
  | "name"
  | "address"
  | "date"
  | "signature"
  | "initials"
  | "wallet"
  | "title"
  | "email"
  | "company"
  | "phone"
  | "witness"
  | "notary"
  | "amount"
  | "reference"
  | "checkbox"
  | "other";

export type DetectedField = {
  type: FieldType;
  label: string;
  value: string | null;
  blank: boolean;
  partyRole: string | null;
  line: number;
  position: number;
};

export type SignatureBlock = {
  partyRole: string;
  partyLabel: string;
  signerIndex: number;
  fields: DetectedField[];
  line: number;
};

export type DetectedSigner = {
  label: string;
  role: string | null;
  address: string | null;
  mailingAddress: string | null;
  chain: WalletChain | null;
  confidence: "high" | "medium" | "low";
  source: string;
  fields: DetectedField[];
  signatureBlock: SignatureBlock | null;
};

export type DetectedAddress = {
  address: string;
  chain: WalletChain;
  context: string;
};

// ── AcroForm types ──────────────────────────────────────────────────────────

export type AcroFormFieldType =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "signature";

export type AcroFormField = {
  name: string;
  fieldType: AcroFormFieldType;
  value: string | null;
  filled: boolean;
  readOnly: boolean;
  options: string[];
  page: number | null;
};

// ── Document structure types ────────────────────────────────────────────────

export type SectionKind =
  | "preamble"
  | "recitals"
  | "definitions"
  | "parties"
  | "term"
  | "payment"
  | "obligations"
  | "confidentiality"
  | "intellectual-property"
  | "representations"
  | "indemnification"
  | "termination"
  | "governing-law"
  | "miscellaneous"
  | "clause"
  | "signatures";

export type DocumentSection = {
  kind: SectionKind;
  title: string;
  lineStart: number;
  lineEnd: number;
  subsections: DocumentSection[];
};

// ── Walkthrough types ───────────────────────────────────────────────────────

export type WalkthroughStep = {
  step: number;
  title: string;
  description: string;
  action: "review" | "fill" | "configure" | "sign";
  target: string | null;
  required: boolean;
};

// ── Analysis result ─────────────────────────────────────────────────────────

export type PdfAnalysisResult = {
  title: string;
  content: string;
  pageCount: number;
  documentType: string | null;
  detectedSigners: DetectedSigner[];
  detectedAddresses: DetectedAddress[];
  signatureBlocks: SignatureBlock[];
  detectedFields: DetectedField[];
  suggestedSignerCount: number;
  // Enhanced parsing fields
  acroformFields: AcroFormField[];
  sections: DocumentSection[];
  isFilled: boolean;
  blankFieldCount: number;
  filledFieldCount: number;
  walkthrough: WalkthroughStep[];
};

// ── PDF edit types ──────────────────────────────────────────────────────────

export type PdfEditResult = {
  pdfBase64: string;
  fieldsModified: number;
  summary: string;
};
