import { describe, expect, it } from "vitest";
import { buildAddressSuggestionFieldUpdates } from "~/lib/address-autocomplete";
import type { InlineField } from "~/lib/document/document-tokens";
import {
  getFieldLogicState,
  detectCardBrand,
  formatEditableFieldValue,
  isFieldVisible,
  resolveFieldAutocomplete,
  resolveFieldOptions,
  validateFieldValue,
} from "~/lib/document/field-runtime";

function makeField(overrides: Partial<InlineField>): InlineField {
  return {
    id: overrides.id ?? "field-1",
    type: overrides.type ?? "custom-field",
    label: overrides.label ?? "Field",
    placeholder: overrides.placeholder ?? "Enter value",
    signerIdx: overrides.signerIdx ?? 0,
    required: overrides.required ?? true,
    options: overrides.options,
    settings: overrides.settings,
  };
}

describe("field runtime helpers", () => {
  it("formats and detects credit card fields", () => {
    const field = makeField({
      type: "credit-card-number",
      label: "Card Number",
      placeholder: "4111 1111 1111 1111",
    });

    expect(formatEditableFieldValue(field, "4111111111111111")).toBe("4111 1111 1111 1111");
    expect(detectCardBrand("4111 1111 1111 1111")?.label).toBe("Visa");
    expect(validateFieldValue(field, "4111 1111 1111 1111")).toBeNull();
    expect(validateFieldValue(field, "4242 4242 4242 4241")).toBe("Invalid card number");
  });

  it("supports custom validation and browser autocomplete metadata", () => {
    const field = makeField({
      type: "custom-field",
      label: "Client Portal",
      placeholder: "portal.example.com",
      settings: {
        inputType: "url",
        autocomplete: "url",
        validation: {
          kind: "url",
          pattern: "^([a-z0-9-]+\\.)+[a-z]{2,}$",
          message: "Enter a valid portal URL",
        },
      },
    });

    expect(resolveFieldAutocomplete(field)).toBe("url");
    expect(validateFieldValue(field, "portal.example.com")).toBeNull();
    expect(validateFieldValue(field, "bad portal")).toBe("Enter a valid portal URL");
  });

  it("resolves custom options and conditional visibility", () => {
    const field = makeField({
      type: "custom-field",
      label: "Approval Path",
      settings: {
        inputType: "radio",
        options: ["Legal", "Finance", "Exec"],
        logic: {
          showWhenFieldId: "plan-tier",
          operator: "one_of",
          values: ["pro", "enterprise"],
        },
      },
    });

    expect(resolveFieldOptions(field)).toEqual(["Legal", "Finance", "Exec"]);
    expect(isFieldVisible(field, { "plan-tier": "starter" })).toBe(false);
    expect(isFieldVisible(field, { "plan-tier": "enterprise" })).toBe(true);
  });

  it("does not require hidden fields until their logic condition matches", () => {
    const field = makeField({
      id: "approval-code",
      type: "custom-field",
      label: "Approval Code",
      placeholder: "ABC-123",
      settings: {
        validation: {
          minLength: 6,
          message: "Approval code is required",
        },
        logic: {
          showWhenFieldId: "needs-approval",
          operator: "equals",
          value: "true",
        },
      },
    });

    expect(validateFieldValue(field, "", { allValues: { "needs-approval": "false" } })).toBeNull();
    expect(validateFieldValue(field, "", { allValues: { "needs-approval": "true" } })).toBe(
      "Approval code is required",
    );
  });

  it("applies specialized formatting for tax ids", () => {
    const field = makeField({
      type: "tax-id",
      label: "Tax ID",
      placeholder: "12-3456789",
    });

    expect(formatEditableFieldValue(field, "123456789")).toBe("12-3456789");
    expect(validateFieldValue(field, "12-3456789")).toBeNull();
  });

  it("supports richer logic effects like lock and clear-on-hide", () => {
    const field = makeField({
      id: "discount-code",
      type: "custom-field",
      label: "Discount Code",
      settings: {
        logic: {
          showWhenFieldId: "has-discount",
          operator: "equals",
          value: "true",
          effect: "show",
          lockOnMatch: true,
          clearWhenHidden: true,
        },
      },
    });

    expect(getFieldLogicState(field, { "has-discount": "false" })).toMatchObject({
      visible: false,
      locked: false,
      clearWhenHidden: true,
    });
    expect(getFieldLogicState(field, { "has-discount": "true" })).toMatchObject({
      visible: true,
      locked: true,
    });
  });

  it("maps an address suggestion across sibling address fields", () => {
    const fields = [
      makeField({ id: "street", type: "street-address", label: "Street" }),
      makeField({ id: "city", type: "city", label: "City" }),
      makeField({ id: "state", type: "state", label: "State" }),
      makeField({ id: "zip", type: "zip", label: "ZIP" }),
      makeField({ id: "country", type: "country", label: "Country" }),
    ];

    const updates = buildAddressSuggestionFieldUpdates({
      anchorField: fields[0]!,
      fields,
      suggestion: {
        id: "1",
        label: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, United States",
        formatted: "1600 Amphitheatre Pkwy, Mountain View, CA 94043, United States",
        primaryLine: "1600 Amphitheatre Pkwy",
        addressLine1: "1600 Amphitheatre Pkwy",
        city: "Mountain View",
        state: "CA",
        postalCode: "94043",
        country: "United States",
      },
    });

    expect(updates).toMatchObject({
      street: "1600 Amphitheatre Pkwy",
      city: "Mountain View",
      state: "CA",
      zip: "94043",
      country: "United States",
    });
  });
});
