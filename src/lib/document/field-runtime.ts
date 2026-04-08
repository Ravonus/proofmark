import { type FieldConfig, getField } from "~/components/fields/field-registry";
import type { InlineField } from "~/lib/document/document-tokens";
import {
  SPECIAL_INPUT_VALIDATORS,
  validateByFieldType,
  validateByKind,
  validateLengthConstraints,
  validateNumberInput,
  validatePatternConstraint,
  validateSignatureOrInitials,
} from "./field-validation";

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
  const normalizedValue = value?.trim() ?? "";

  if (!logicState.visible) return null;

  const sigResult = validateSignatureOrInitials(field, normalizedValue, logicState.required, options.signatureReady);
  if (sigResult !== undefined) return sigResult;

  const specialValidator = SPECIAL_INPUT_VALIDATORS[inputType];
  if (specialValidator) return specialValidator(field, normalizedValue, logicState.required);

  if (!normalizedValue) {
    return logicState.required ? getValidationMessage(field, "Required") : null;
  }

  const lengthError = validateLengthConstraints(field, normalizedValue, settings.validation);
  if (lengthError) return lengthError;

  if (inputType === "number") {
    const numberError = validateNumberInput(field, normalizedValue, settings.validation);
    if (numberError) return numberError;
  }

  const patternError = validatePatternConstraint(field, normalizedValue, settings.validation?.pattern);
  if (patternError) return patternError;

  const kindResult = validateByKind(field, normalizedValue, getValidationKind);
  if (kindResult !== undefined) return kindResult;

  return validateByFieldType(field, normalizedValue);
}
