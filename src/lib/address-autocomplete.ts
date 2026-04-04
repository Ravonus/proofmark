import type { InlineField } from "~/lib/document-tokens";

export type AddressSuggestion = {
  id: string;
  label: string;
  primaryLine: string;
  secondaryLine?: string;
  formatted: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  county?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  countryCode?: string;
};

const ADDRESS_FIELD_TYPES = new Set([
  "address",
  "street-address",
  "address-line-2",
  "billing-address",
  "mailing-address",
  "full-address",
  "city",
  "county",
  "state",
  "zip",
  "billing-zip",
  "country",
]);

export function isAddressLikeField(field: Pick<InlineField, "type">): boolean {
  return ADDRESS_FIELD_TYPES.has(field.type);
}

function getSuggestionValueForField(
  field: Pick<InlineField, "type" | "id">,
  suggestion: AddressSuggestion,
): string | undefined {
  const formatted = suggestion.formatted || suggestion.label || suggestion.primaryLine;
  switch (field.type) {
    case "address":
    case "street-address":
    case "billing-address":
    case "mailing-address":
      return suggestion.addressLine1 || suggestion.primaryLine || formatted;
    case "address-line-2":
      return suggestion.addressLine2;
    case "full-address":
      return formatted;
    case "city":
      return suggestion.city;
    case "county":
      return suggestion.county;
    case "state":
      return suggestion.state;
    case "zip":
    case "billing-zip":
      return suggestion.postalCode;
    case "country":
      return suggestion.country || suggestion.countryCode;
    default:
      return field.id ? formatted : undefined;
  }
}

export function buildAddressSuggestionFieldUpdates(params: {
  anchorField: InlineField;
  fields: InlineField[];
  suggestion: AddressSuggestion;
}): Record<string, string> {
  const { anchorField, fields, suggestion } = params;
  const updates: Record<string, string> = {};

  for (const field of fields) {
    const sameSignerGroup =
      field.signerIdx === anchorField.signerIdx || (field.signerIdx === -1 && anchorField.signerIdx === -1);
    if (!sameSignerGroup || !isAddressLikeField(field)) continue;

    const nextValue = getSuggestionValueForField(field, suggestion);
    if (typeof nextValue === "string" && nextValue.trim().length > 0) {
      updates[field.id] = nextValue.trim();
    }
  }

  if (!updates[anchorField.id]) {
    const fallback = suggestion.formatted || suggestion.label || suggestion.primaryLine;
    if (fallback.trim().length > 0) {
      updates[anchorField.id] = fallback.trim();
    }
  }

  return updates;
}
