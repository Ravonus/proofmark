import type { InlineField } from "~/lib/document-tokens";
import type { LogicEffect, RuntimeInputType, ValidationKind, VisibilityOperator } from "~/lib/field-runtime";
import type { SignerTokenGate } from "~/lib/token-gates";
import { FIELD_REGISTRY, FIELD_CATEGORIES } from "./fields";
import type { DropdownItem } from "./ui/search-dropdown";

export const SIGNER_BORDER_COLORS = ["#60a5fa", "#fb923c", "#c084fc", "#34d399", "#f472b6", "#22d3ee"];

export const fieldDropdownItems: DropdownItem[] = FIELD_CATEGORIES.flatMap(
  (cat) =>
    cat.fields
      .map((fid) => {
        const f = FIELD_REGISTRY[fid];
        return f ? { id: fid, label: f.label, description: f.description, icon: f.icon, category: cat.label } : null;
      })
      .filter(Boolean) as DropdownItem[],
);

// -- Types --

export type SignerDef = {
  label: string;
  email: string;
  phone?: string;
  role?: "SIGNER" | "APPROVER" | "CC" | "WITNESS" | "OBSERVER";
  signMethod?: "WALLET" | "EMAIL_OTP";
  tokenGates?: SignerTokenGate | null;
};

export type EditorSignerField = Pick<InlineField, "id" | "type" | "label" | "required" | "options" | "settings"> & {
  value: string | null;
};

export type EditorResult = {
  title: string;
  content: string;
  signers: Array<{
    label: string;
    email: string;
    phone?: string;
    role?: "SIGNER" | "APPROVER" | "CC" | "WITNESS" | "OBSERVER";
    signMethod?: "WALLET" | "EMAIL_OTP";
    tokenGates?: SignerTokenGate | null;
    fields: EditorSignerField[];
  }>;
};

export type Props = {
  initialTitle: string;
  initialContent: string;
  initialSigners: SignerDef[];
  onSubmit: (result: EditorResult) => void;
  onSaveTemplate?: (result: EditorResult) => void | Promise<void>;
  onBack: () => void;
};

export type PreviewValueMap = Record<string, string>;

export const INPUT_TYPE_OPTIONS: Array<{ value: RuntimeInputType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Paragraph" },
  { value: "email", label: "Email" },
  { value: "tel", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
  { value: "datetime-local", label: "Date & Time" },
  { value: "url", label: "URL" },
  { value: "select", label: "Dropdown" },
  { value: "radio", label: "Radio Group" },
  { value: "checkbox", label: "Checkbox" },
  { value: "file", label: "File Upload" },
  { value: "signature", label: "Signature" },
  { value: "initials", label: "Initials" },
];

export const VALIDATION_KIND_OPTIONS: Array<{ value: ValidationKind | ""; label: string }> = [
  { value: "", label: "Default" },
  { value: "credit-card", label: "Credit Card" },
  { value: "credit-card-expiry", label: "Card Expiration" },
  { value: "credit-card-cvc", label: "Card CVC" },
  { value: "routing-number", label: "Routing Number" },
  { value: "iban", label: "IBAN" },
  { value: "swift-bic", label: "SWIFT / BIC" },
  { value: "tax-id", label: "Tax ID" },
  { value: "ssn-last4", label: "SSN Last 4" },
  { value: "ssn-full", label: "Full SSN" },
  { value: "passport-number", label: "Passport Number" },
  { value: "drivers-license", label: "Driver License" },
  { value: "url", label: "URL" },
];

export const VISIBILITY_OPERATOR_OPTIONS: Array<{ value: VisibilityOperator; label: string }> = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does not equal" },
  { value: "contains", label: "Contains" },
  { value: "not_empty", label: "Is filled" },
  { value: "one_of", label: "Matches one of" },
];

export const LOGIC_EFFECT_OPTIONS: Array<{ value: LogicEffect; label: string }> = [
  { value: "show", label: "Show on match" },
  { value: "hide", label: "Hide on match" },
];

export function formatPreviewCurrency(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toFixed(2)}`;
  }
}
