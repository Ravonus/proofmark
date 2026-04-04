import type { WalletChain } from "~/lib/chains";

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
};
