import type { InlineField } from "~/lib/document/document-tokens";
import {
  type AttachmentFieldValue,
  decodeStructuredFieldValue,
  type IdentityVerificationFieldValue,
  type PaymentFieldValue,
  type SocialVerificationFieldValue,
} from "~/lib/document/field-values";
import type { RuntimeFieldValidation } from "./field-runtime";

function getValidationMessage(field: InlineField, fallback: string): string {
  const settings = typeof field.settings === "object" && field.settings !== null ? field.settings : {};
  const validation =
    typeof settings.validation === "object" && settings.validation !== null
      ? (settings.validation as Record<string, unknown>)
      : {};
  return typeof validation.message === "string" && validation.message.trim() ? validation.message : fallback;
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

// ── Special input type validators ────────────────────────────

function validateCheckboxInput(field: InlineField, normalizedValue: string, required: boolean): string | null {
  return required && normalizedValue !== "true" ? getValidationMessage(field, "Required") : null;
}

function validateFileInput(field: InlineField, normalizedValue: string, required: boolean): string | null {
  if (!normalizedValue) return required ? getValidationMessage(field, "Upload a file") : null;
  const attachment = decodeStructuredFieldValue<AttachmentFieldValue>(normalizedValue);
  return attachment?.kind === "attachment" ? null : getValidationMessage(field, "Upload a valid file");
}

function validatePaymentInput(field: InlineField, normalizedValue: string, required: boolean): string | null {
  if (!normalizedValue) return required ? getValidationMessage(field, "Payment required") : null;
  const payment = decodeStructuredFieldValue<PaymentFieldValue>(normalizedValue);
  return payment?.kind === "payment" && payment.status === "paid"
    ? null
    : getValidationMessage(field, "Complete payment");
}

function validateIdvInput(field: InlineField, normalizedValue: string, required: boolean): string | null {
  if (!normalizedValue) return required ? getValidationMessage(field, "Identity verification required") : null;
  const verification = decodeStructuredFieldValue<IdentityVerificationFieldValue>(normalizedValue);
  return verification?.kind === "id-verification" && verification.status === "verified"
    ? null
    : getValidationMessage(field, "Verify identity");
}

function validateSocialInput(field: InlineField, normalizedValue: string, required: boolean): string | null {
  if (!normalizedValue) return required ? getValidationMessage(field, "Social verification required") : null;
  const social = decodeStructuredFieldValue<SocialVerificationFieldValue>(normalizedValue);
  return social?.kind === "social-verification" && social.status === "verified"
    ? null
    : getValidationMessage(field, "Verify account");
}

export const SPECIAL_INPUT_VALIDATORS: Record<
  string,
  (field: InlineField, normalizedValue: string, required: boolean) => string | null
> = {
  checkbox: validateCheckboxInput,
  file: validateFileInput,
  payment: validatePaymentInput,
  idv: validateIdvInput,
  "social-verify": validateSocialInput,
};

// ── Kind-based validators ────────────────────────────────────

function validateCreditCardExpiry(field: InlineField, normalizedValue: string): string | null {
  const digits = normalizedValue.replace(/\D/g, "");
  if (digits.length !== 4) return getValidationMessage(field, "Use MM/YY");
  const month = Number(digits.slice(0, 2));
  const year = Number(`20${digits.slice(2)}`);
  if (month < 1 || month > 12) return getValidationMessage(field, "Invalid expiration month");
  const expiry = new Date(year, month, 0, 23, 59, 59, 999);
  return expiry.getTime() < Date.now() ? getValidationMessage(field, "Card is expired") : null;
}

function validateUrl(field: InlineField, normalizedValue: string): string | null {
  try {
    const maybeUrl = normalizedValue.startsWith("http") ? normalizedValue : `https://${normalizedValue}`;
    new URL(maybeUrl);
  } catch {
    return getValidationMessage(field, "Invalid URL");
  }
  return null;
}

type KindValidator = {
  normalize?: (v: string) => string;
  pattern: RegExp;
  message: string;
};

const KIND_PATTERN_VALIDATORS: Record<string, KindValidator> = {
  "credit-card-cvc": {
    normalize: (v) => v.replace(/\D/g, ""),
    pattern: /^\d{3,4}$/,
    message: "Invalid security code",
  },
  "routing-number": {
    normalize: (v) => v.replace(/\D/g, ""),
    pattern: /^\d{9}$/,
    message: "Routing number must be 9 digits",
  },
  iban: {
    normalize: (v) => v.replace(/\s+/g, ""),
    pattern: /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/i,
    message: "Invalid IBAN",
  },
  "swift-bic": {
    pattern: /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/i,
    message: "Invalid SWIFT/BIC",
  },
  "tax-id": { pattern: /^\d{2}-?\d{7}$/, message: "Invalid tax ID" },
  "ssn-last4": {
    normalize: (v) => v.replace(/\D/g, ""),
    pattern: /^\d{4}$/,
    message: "Use last 4 digits",
  },
  "ssn-full": { pattern: /^\d{3}-?\d{2}-?\d{4}$/, message: "Invalid SSN" },
  "passport-number": {
    normalize: (v) => v.replace(/\s+/g, ""),
    pattern: /^[A-Z0-9]{6,12}$/i,
    message: "Invalid passport number",
  },
  "drivers-license": {
    pattern: /^[A-Z0-9-]{5,20}$/i,
    message: "Invalid license number",
  },
};

export function validateByKind(
  field: InlineField,
  normalizedValue: string,
  getKind: (f: InlineField) => string | undefined,
): string | null | undefined {
  const kind = getKind(field);
  if (!kind) return undefined;

  if (kind === "credit-card") {
    return passesLuhn(normalizedValue) ? null : getValidationMessage(field, "Invalid card number");
  }
  if (kind === "credit-card-expiry") {
    return validateCreditCardExpiry(field, normalizedValue);
  }
  if (kind === "url") {
    return validateUrl(field, normalizedValue);
  }

  const patternValidator = KIND_PATTERN_VALIDATORS[kind];
  if (patternValidator) {
    const testValue = patternValidator.normalize ? patternValidator.normalize(normalizedValue) : normalizedValue;
    return patternValidator.pattern.test(testValue) ? null : getValidationMessage(field, patternValidator.message);
  }

  return undefined;
}

// ── Field type validators ────────────────────────────────────

type FieldTypeValidator = (value: string) => string | null;

const FIELD_TYPE_VALIDATOR_MAP: Record<string, FieldTypeValidator> = {};

function nameValidator(value: string): string | null {
  return value.split(/\s+/).filter(Boolean).length < 2 ? "Enter first and last name" : null;
}

function emailValidator(value: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "Invalid email";
}

function addressValidator(value: string): string | null {
  return value.length < 5 ? "Address too short" : null;
}

for (const key of ["name", "full-name", "legal-name"]) {
  FIELD_TYPE_VALIDATOR_MAP[key] = nameValidator;
}
for (const key of ["email", "secondary-email"]) {
  FIELD_TYPE_VALIDATOR_MAP[key] = emailValidator;
}
for (const key of ["date", "effective-date", "expiration-date", "renewal-date", "dob"]) {
  FIELD_TYPE_VALIDATOR_MAP[key] = (value: string) => (Number.isNaN(Date.parse(value)) ? "Invalid date" : null);
}
for (const key of ["address", "street-address", "billing-address", "mailing-address", "full-address"]) {
  FIELD_TYPE_VALIDATOR_MAP[key] = addressValidator;
}

export function validateByFieldType(field: InlineField, normalizedValue: string): string | null {
  const validator = FIELD_TYPE_VALIDATOR_MAP[field.type];
  if (!validator) return null;
  const error = validator(normalizedValue);
  return error ? getValidationMessage(field, error) : null;
}

// ── Common constraint validators ─────────────────────────────

export function validateLengthConstraints(
  field: InlineField,
  normalizedValue: string,
  validation: RuntimeFieldValidation | undefined,
): string | null {
  if (validation?.minLength && normalizedValue.length < validation.minLength) {
    return getValidationMessage(field, `Must be at least ${validation.minLength} characters`);
  }
  if (validation?.maxLength && normalizedValue.length > validation.maxLength) {
    return getValidationMessage(field, `Must be ${validation.maxLength} characters or fewer`);
  }
  return null;
}

export function validateNumberInput(
  field: InlineField,
  normalizedValue: string,
  validation: RuntimeFieldValidation | undefined,
): string | null {
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
  return null;
}

export function validateSignatureOrInitials(
  field: InlineField,
  normalizedValue: string,
  required: boolean,
  signatureReady: boolean | undefined,
): string | null | undefined {
  if (field.type === "signature") {
    return required && !signatureReady ? "Add your signature" : null;
  }
  if (field.type === "initials") {
    return required && !normalizedValue ? "Draw your initials" : null;
  }
  return undefined;
}

export function validatePatternConstraint(
  field: InlineField,
  normalizedValue: string,
  pattern: string | undefined,
): string | null {
  if (!pattern) return null;
  return new RegExp(pattern).test(normalizedValue)
    ? null
    : getValidationMessage(field, `Invalid ${field.label.toLowerCase()}`);
}
