import type { InlineField } from "~/lib/document-tokens";
import {
  decodeStructuredFieldValue,
  type AttachmentFieldValue,
  type IdentityVerificationFieldValue,
  type PaymentFieldValue,
  type SocialVerificationFieldValue,
} from "~/lib/field-values";
import { getField, type FieldConfig } from "~/components/fields/field-registry";

export type RuntimeInputType = FieldConfig["inputType"] | "url" | "time" | "datetime-local" | "radio";

export type ValidationKind =
  | "credit-card"
  | "credit-card-expiry"
  | "credit-card-cvc"
  | "routing-number"
  | "iban"
  | "swift-bic"
  | "tax-id"
  | "ssn-last4"
  | "ssn-full"
  | "passport-number"
  | "drivers-license"
  | "url";

export type VisibilityOperator = "equals" | "not_equals" | "contains" | "not_empty" | "one_of";
export type LogicEffect = "show" | "hide";

export type RuntimeFieldValidation = {
  pattern?: string;
  message?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  kind?: ValidationKind;
};

export type RuntimeFieldLogic = {
  showWhenFieldId?: string;
  operator?: VisibilityOperator;
  value?: string;
  values?: string[];
  effect?: LogicEffect;
  requireOnMatch?: boolean;
  lockOnMatch?: boolean;
  clearWhenHidden?: boolean;
};

export type RuntimeFieldDisplay = {
  badge?: string;
  logo?: string;
  helpText?: string;
};

export type RuntimeFieldSettings = {
  inputType?: RuntimeInputType;
  autocomplete?: string;
  options?: string[];
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  rows?: number;
  accept?: string;
  maxSizeMb?: number;
  amount?: number;
  currency?: string;
  description?: string;
  requiredUsername?: string;
  validation?: RuntimeFieldValidation;
  logic?: RuntimeFieldLogic;
  display?: RuntimeFieldDisplay;
};

type ValueMap = Record<string, string | undefined>;

type ValidationOptions = {
  signatureReady?: boolean;
  allValues?: ValueMap;
};

export type FieldLogicState = {
  matchesCondition: boolean;
  visible: boolean;
  required: boolean;
  locked: boolean;
  clearWhenHidden: boolean;
};

type CardBrand = {
  id: "visa" | "mastercard" | "amex" | "discover" | "diners" | "jcb" | "unionpay";
  label: string;
  logo: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : undefined;
}

export function getRuntimeFieldSettings(field: InlineField): RuntimeFieldSettings {
  const raw = isRecord(field.settings) ? field.settings : {};
  const validation = isRecord(raw.validation) ? raw.validation : {};
  const logic = isRecord(raw.logic) ? raw.logic : {};
  const display = isRecord(raw.display) ? raw.display : {};

  return {
    inputType: getString(raw.inputType) as RuntimeInputType | undefined,
    autocomplete: getString(raw.autocomplete),
    options: getStringArray(raw.options) ?? field.options,
    placeholder: getString(raw.placeholder),
    prefix: getString(raw.prefix),
    suffix: getString(raw.suffix),
    rows: getNumber(raw.rows),
    accept: getString(raw.accept),
    maxSizeMb: getNumber(raw.maxSizeMb),
    amount: getNumber(raw.amount),
    currency: getString(raw.currency),
    description: getString(raw.description),
    requiredUsername: getString(raw.requiredUsername),
    validation: {
      pattern: getString(validation.pattern),
      message: getString(validation.message),
      minLength: getNumber(validation.minLength),
      maxLength: getNumber(validation.maxLength),
      min: getNumber(validation.min),
      max: getNumber(validation.max),
      step: getNumber(validation.step),
      kind: getString(validation.kind) as ValidationKind | undefined,
    },
    logic: {
      showWhenFieldId: getString(logic.showWhenFieldId),
      operator: getString(logic.operator) as VisibilityOperator | undefined,
      value: getString(logic.value),
      values: getStringArray(logic.values),
      effect: getString(logic.effect) as LogicEffect | undefined,
      requireOnMatch: typeof logic.requireOnMatch === "boolean" ? logic.requireOnMatch : undefined,
      lockOnMatch: typeof logic.lockOnMatch === "boolean" ? logic.lockOnMatch : undefined,
      clearWhenHidden: typeof logic.clearWhenHidden === "boolean" ? logic.clearWhenHidden : undefined,
    },
    display: {
      badge: getString(display.badge),
      logo: getString(display.logo),
      helpText: getString(display.helpText),
    },
  };
}

export function resolveFieldInputType(field: InlineField): RuntimeInputType {
  const config = getField(field.type);
  const settings = getRuntimeFieldSettings(field);
  return settings.inputType ?? config?.inputType ?? "text";
}

export function resolveFieldOptions(field: InlineField): string[] {
  const config = getField(field.type);
  const settings = getRuntimeFieldSettings(field);
  return settings.options ?? field.options ?? config?.validation?.options ?? [];
}

export function resolveFieldPlaceholder(field: InlineField): string {
  const config = getField(field.type);
  const settings = getRuntimeFieldSettings(field);
  return settings.placeholder ?? field.placeholder ?? config?.placeholder ?? "Enter value";
}

export function resolveFieldPrefix(field: InlineField): string | undefined {
  const config = getField(field.type);
  const settings = getRuntimeFieldSettings(field);
  return settings.prefix ?? config?.prefix;
}

export function resolveFieldSuffix(field: InlineField): string | undefined {
  return getRuntimeFieldSettings(field).suffix;
}

const AUTOCOMPLETE_BY_FIELD_TYPE: Record<string, string> = {
  "full-name": "name",
  "first-name": "given-name",
  "middle-name": "additional-name",
  "last-name": "family-name",
  "preferred-name": "nickname",
  "company-name": "organization",
  "job-title": "organization-title",
  email: "email",
  "secondary-email": "email",
  phone: "tel",
  "fax-number": "tel-national",
  website: "url",
  "linkedin-url": "url",
  "street-address": "street-address",
  "address-line-2": "address-line2",
  "billing-address": "street-address",
  "mailing-address": "street-address",
  "full-address": "street-address",
  city: "address-level2",
  county: "address-level2",
  state: "address-level1",
  zip: "postal-code",
  "billing-zip": "postal-code",
  country: "country-name",
  dob: "bday",
  "credit-card-number": "cc-number",
  "cardholder-name": "cc-name",
  "credit-card-expiry": "cc-exp",
  "credit-card-cvc": "cc-csc",
};

export function resolveFieldAutocomplete(field: InlineField): string | undefined {
  const config = getField(field.type);
  const settings = getRuntimeFieldSettings(field);
  return settings.autocomplete ?? config?.autoComplete ?? AUTOCOMPLETE_BY_FIELD_TYPE[field.type];
}

export function resolveFieldBadge(field: InlineField, value?: string): string | undefined {
  const settings = getRuntimeFieldSettings(field);
  if (settings.display?.badge) return settings.display.badge;
  if (getValidationKind(field) === "credit-card" && value) {
    return detectCardBrand(value)?.label;
  }
  return undefined;
}

export function resolveFieldLogo(field: InlineField, value?: string): string | undefined {
  const settings = getRuntimeFieldSettings(field);
  if (settings.display?.logo) return settings.display.logo;
  if (getValidationKind(field) === "credit-card" && value) {
    return detectCardBrand(value)?.logo;
  }
  return undefined;
}

export function resolveFieldHelpText(field: InlineField): string | undefined {
  return getRuntimeFieldSettings(field).display?.helpText;
}

export function isFieldVisible(field: InlineField, values: ValueMap): boolean {
  const logic = getRuntimeFieldSettings(field).logic;
  const effect = logic?.effect ?? "show";
  if (!logic?.showWhenFieldId) return effect === "hide" ? true : true;
  const currentValue = values[logic.showWhenFieldId] ?? "";
  const operator = logic.operator ?? "equals";
  let matches = false;

  switch (operator) {
    case "not_equals":
      matches = currentValue !== (logic.value ?? "");
      break;
    case "contains":
      matches = currentValue.includes(logic.value ?? "");
      break;
    case "not_empty":
      matches = currentValue.trim().length > 0;
      break;
    case "one_of":
      matches = (logic.values ?? []).includes(currentValue);
      break;
    case "equals":
    default:
      matches = currentValue === (logic.value ?? "");
      break;
  }

  return effect === "hide" ? !matches : matches;
}

export function getFieldLogicState(field: InlineField, values: ValueMap): FieldLogicState {
  const logic = getRuntimeFieldSettings(field).logic;
  const baseRequired = field.required ?? true;
  if (!logic?.showWhenFieldId) {
    return {
      matchesCondition: false,
      visible: true,
      required: baseRequired,
      locked: false,
      clearWhenHidden: false,
    };
  }

  const currentValue = values[logic.showWhenFieldId] ?? "";
  const operator = logic.operator ?? "equals";
  let matchesCondition = false;

  switch (operator) {
    case "not_equals":
      matchesCondition = currentValue !== (logic.value ?? "");
      break;
    case "contains":
      matchesCondition = currentValue.includes(logic.value ?? "");
      break;
    case "not_empty":
      matchesCondition = currentValue.trim().length > 0;
      break;
    case "one_of":
      matchesCondition = (logic.values ?? []).includes(currentValue);
      break;
    case "equals":
    default:
      matchesCondition = currentValue === (logic.value ?? "");
      break;
  }

  const visible = (logic.effect ?? "show") === "hide" ? !matchesCondition : matchesCondition;
  return {
    matchesCondition,
    visible,
    required: baseRequired || !!(logic.requireOnMatch && matchesCondition),
    locked: !!(logic.lockOnMatch && matchesCondition),
    clearWhenHidden: !!logic.clearWhenHidden,
  };
}

export function isFieldRequired(field: InlineField, values: ValueMap): boolean {
  return getFieldLogicState(field, values).required;
}

export function isFieldLocked(field: InlineField, values: ValueMap): boolean {
  return getFieldLogicState(field, values).locked;
}

export function detectCardBrand(value: string): CardBrand | null {
  const digits = value.replace(/\D/g, "");
  if (/^4\d{0,18}$/.test(digits)) return { id: "visa", label: "Visa", logo: "VISA" };
  if (/^(5[1-5]\d{0,14}|2(2[2-9]|[3-6]\d|7[01])\d{0,12}|2720\d{0,12})$/.test(digits)) {
    return { id: "mastercard", label: "Mastercard", logo: "MC" };
  }
  if (/^3[47]\d{0,13}$/.test(digits)) return { id: "amex", label: "Amex", logo: "AMEX" };
  if (/^(6011|65|64[4-9])\d{0,15}$/.test(digits)) return { id: "discover", label: "Discover", logo: "DISC" };
  if (/^3(0[0-5]|[68]\d)\d{0,11}$/.test(digits)) return { id: "diners", label: "Diners", logo: "DINERS" };
  if (/^(2131|1800|35\d{0,2})\d{0,11}$/.test(digits)) return { id: "jcb", label: "JCB", logo: "JCB" };
  if (/^62\d{0,17}$/.test(digits)) return { id: "unionpay", label: "UnionPay", logo: "UNIONPAY" };
  return null;
}

function passesLuhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  let sum = 0;
  let shouldDouble = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index] ?? "0");
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return digits.length >= 12 && sum % 10 === 0;
}

function getValidationKind(field: InlineField): ValidationKind | undefined {
  const settings = getRuntimeFieldSettings(field);
  if (settings.validation?.kind) return settings.validation.kind;

  switch (field.type) {
    case "credit-card-number":
      return "credit-card";
    case "credit-card-expiry":
      return "credit-card-expiry";
    case "credit-card-cvc":
      return "credit-card-cvc";
    case "routing-number":
      return "routing-number";
    case "iban":
      return "iban";
    case "swift-bic":
      return "swift-bic";
    case "tax-id":
      return "tax-id";
    case "ssn":
      return "ssn-last4";
    case "ssn-full":
      return "ssn-full";
    case "passport-number":
      return "passport-number";
    case "drivers-license":
      return "drivers-license";
    case "website":
    case "linkedin-url":
    case "url":
      return "url";
    default:
      return undefined;
  }
}

function getValidationMessage(field: InlineField, fallback: string): string {
  return getRuntimeFieldSettings(field).validation?.message ?? fallback;
}

export function formatEditableFieldValue(field: InlineField, nextValue: string): string {
  const kind = getValidationKind(field);
  switch (kind) {
    case "credit-card": {
      const digits = nextValue.replace(/\D/g, "").slice(0, 19);
      return digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
    }
    case "credit-card-expiry": {
      const digits = nextValue.replace(/\D/g, "").slice(0, 4);
      if (digits.length <= 2) return digits;
      return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    case "credit-card-cvc":
      return nextValue.replace(/\D/g, "").slice(0, 4);
    case "routing-number":
      return nextValue.replace(/\D/g, "").slice(0, 9);
    case "tax-id": {
      const digits = nextValue.replace(/\D/g, "").slice(0, 9);
      if (digits.length <= 2) return digits;
      return `${digits.slice(0, 2)}-${digits.slice(2)}`;
    }
    case "ssn-last4":
      return nextValue.replace(/\D/g, "").slice(0, 4);
    case "ssn-full": {
      const digits = nextValue.replace(/\D/g, "").slice(0, 9);
      if (digits.length <= 3) return digits;
      if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
      return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    }
    default:
      return nextValue;
  }
}

export function validateFieldValue(
  field: InlineField,
  value: string | undefined,
  options: ValidationOptions = {},
): string | null {
  const settings = getRuntimeFieldSettings(field);
  const inputType = resolveFieldInputType(field);
  const logicState = getFieldLogicState(field, options.allValues ?? {});
  const required = logicState.required;
  const visible = logicState.visible;
  const normalizedValue = value?.trim() ?? "";

  if (!visible) return null;

  if (field.type === "signature") {
    return required && !options.signatureReady ? "Add your signature" : null;
  }

  if (field.type === "initials") {
    return required && !normalizedValue ? "Draw your initials" : null;
  }

  if (inputType === "checkbox") {
    if (required && value !== "true") return getValidationMessage(field, "Required");
    return null;
  }

  if (inputType === "file") {
    if (!normalizedValue) return required ? getValidationMessage(field, "Upload a file") : null;
    const attachment = decodeStructuredFieldValue<AttachmentFieldValue>(normalizedValue);
    return attachment?.kind === "attachment" ? null : getValidationMessage(field, "Upload a valid file");
  }

  if (inputType === "payment") {
    if (!normalizedValue) return required ? getValidationMessage(field, "Payment required") : null;
    const payment = decodeStructuredFieldValue<PaymentFieldValue>(normalizedValue);
    return payment?.kind === "payment" && payment.status === "paid"
      ? null
      : getValidationMessage(field, "Complete payment");
  }

  if (inputType === "idv") {
    if (!normalizedValue) return required ? getValidationMessage(field, "Identity verification required") : null;
    const verification = decodeStructuredFieldValue<IdentityVerificationFieldValue>(normalizedValue);
    return verification?.kind === "id-verification" && verification.status === "verified"
      ? null
      : getValidationMessage(field, "Verify identity");
  }

  if (inputType === "social-verify") {
    if (!normalizedValue) return required ? getValidationMessage(field, "Social verification required") : null;
    const social = decodeStructuredFieldValue<SocialVerificationFieldValue>(normalizedValue);
    return social?.kind === "social-verification" && social.status === "verified"
      ? null
      : getValidationMessage(field, "Verify account");
  }

  if (!normalizedValue) {
    return required ? getValidationMessage(field, "Required") : null;
  }

  const validation = settings.validation;
  if (validation?.minLength && normalizedValue.length < validation.minLength) {
    return getValidationMessage(field, `Must be at least ${validation.minLength} characters`);
  }
  if (validation?.maxLength && normalizedValue.length > validation.maxLength) {
    return getValidationMessage(field, `Must be ${validation.maxLength} characters or fewer`);
  }
  if (inputType === "number" && normalizedValue) {
    const numberValue = Number(normalizedValue);
    if (!Number.isFinite(numberValue)) {
      return getValidationMessage(field, "Invalid number");
    }
    if (typeof validation?.min === "number" && numberValue < validation.min) {
      return getValidationMessage(field, `Must be at least ${validation.min}`);
    }
    if (typeof validation?.max === "number" && numberValue > validation.max) {
      return getValidationMessage(field, `Must be at most ${validation.max}`);
    }
  }

  if (validation?.pattern) {
    const pattern = new RegExp(validation.pattern);
    if (!pattern.test(normalizedValue)) {
      return getValidationMessage(field, `Invalid ${field.label.toLowerCase()}`);
    }
  }

  const kind = getValidationKind(field);
  switch (kind) {
    case "credit-card":
      if (!passesLuhn(normalizedValue)) return getValidationMessage(field, "Invalid card number");
      return null;
    case "credit-card-expiry": {
      const digits = normalizedValue.replace(/\D/g, "");
      if (digits.length !== 4) return getValidationMessage(field, "Use MM/YY");
      const month = Number(digits.slice(0, 2));
      const year = Number(`20${digits.slice(2)}`);
      if (month < 1 || month > 12) return getValidationMessage(field, "Invalid expiration month");
      const expiry = new Date(year, month, 0, 23, 59, 59, 999);
      if (expiry.getTime() < Date.now()) return getValidationMessage(field, "Card is expired");
      return null;
    }
    case "credit-card-cvc":
      if (!/^\d{3,4}$/.test(normalizedValue.replace(/\D/g, "")))
        return getValidationMessage(field, "Invalid security code");
      return null;
    case "routing-number":
      if (!/^\d{9}$/.test(normalizedValue.replace(/\D/g, "")))
        return getValidationMessage(field, "Routing number must be 9 digits");
      return null;
    case "iban":
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i.test(normalizedValue.replace(/\s+/g, "")))
        return getValidationMessage(field, "Invalid IBAN");
      return null;
    case "swift-bic":
      if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/i.test(normalizedValue))
        return getValidationMessage(field, "Invalid SWIFT/BIC");
      return null;
    case "tax-id":
      if (!/^\d{2}-?\d{7}$/.test(normalizedValue)) return getValidationMessage(field, "Invalid tax ID");
      return null;
    case "ssn-last4":
      if (!/^\d{4}$/.test(normalizedValue.replace(/\D/g, ""))) return getValidationMessage(field, "Use last 4 digits");
      return null;
    case "ssn-full":
      if (!/^\d{3}-?\d{2}-?\d{4}$/.test(normalizedValue)) return getValidationMessage(field, "Invalid SSN");
      return null;
    case "passport-number":
      if (!/^[A-Z0-9]{6,12}$/i.test(normalizedValue.replace(/\s+/g, "")))
        return getValidationMessage(field, "Invalid passport number");
      return null;
    case "drivers-license":
      if (!/^[A-Z0-9-]{5,20}$/i.test(normalizedValue)) return getValidationMessage(field, "Invalid license number");
      return null;
    case "url":
      try {
        const maybeUrl = normalizedValue.startsWith("http") ? normalizedValue : `https://${normalizedValue}`;
        new URL(maybeUrl);
      } catch {
        return getValidationMessage(field, "Invalid URL");
      }
      return null;
    default:
      break;
  }

  switch (field.type) {
    case "name":
    case "full-name":
    case "legal-name":
      if (normalizedValue.split(/\s+/).filter(Boolean).length < 2)
        return getValidationMessage(field, "Enter first and last name");
      return null;
    case "email":
    case "secondary-email":
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedValue)) return getValidationMessage(field, "Invalid email");
      return null;
    case "date":
    case "effective-date":
    case "expiration-date":
    case "renewal-date":
    case "dob":
      if (Number.isNaN(Date.parse(normalizedValue))) return getValidationMessage(field, "Invalid date");
      return null;
    case "address":
    case "street-address":
    case "billing-address":
    case "mailing-address":
    case "full-address":
      if (normalizedValue.length < 5) return getValidationMessage(field, "Address too short");
      return null;
    default:
      return null;
  }
}
