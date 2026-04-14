import { describe, expect, it } from "vitest";
import type { InlineField } from "~/lib/document/document-tokens";
import { getEquivalentFieldIds, getFieldMirrorKey } from "../signing-field-sync";

function makeField(overrides: Partial<InlineField>): InlineField {
  return {
    id: overrides.id ?? "field-id",
    type: overrides.type ?? "full-name",
    label: overrides.label ?? "Field Label",
    placeholder: overrides.placeholder ?? "Field Label",
    signerIdx: overrides.signerIdx ?? 0,
    required: overrides.required ?? true,
    options: overrides.options,
    settings: overrides.settings,
  };
}

describe("signing field mirroring", () => {
  it("matches duplicate social verification fields by required username", () => {
    const fields = [
      makeField({
        id: "recipient-x-1",
        type: "x-verify",
        label: "Recipient X Verification",
        settings: { requiredUsername: "elmosaves" },
      }),
      makeField({
        id: "recipient-x-2",
        type: "x-verify",
        label: "Verify Recipient Identity",
        settings: { requiredUsername: "@elmosaves" },
      }),
      makeField({
        id: "recipient-x-3",
        type: "x-verify",
        label: "Another Recipient Verification",
        settings: { requiredUsername: "someoneelse" },
      }),
    ];

    expect(getEquivalentFieldIds(fields[0]!, fields)).toEqual(["recipient-x-1", "recipient-x-2"]);
    expect(getFieldMirrorKey(fields[0]!)).toBe(getFieldMirrorKey(fields[1]!));
    expect(getFieldMirrorKey(fields[0]!)).not.toBe(getFieldMirrorKey(fields[2]!));
  });

  it("matches duplicate text fields by signer, type, and label", () => {
    const fields = [
      makeField({ id: "alias-1", type: "full-name", label: "Discloser Alias", signerIdx: 1 }),
      makeField({ id: "alias-2", type: "full-name", label: "Discloser Alias", signerIdx: 1 }),
      makeField({ id: "alias-3", type: "full-name", label: "Discloser Alias", signerIdx: 0 }),
    ];

    expect(getEquivalentFieldIds(fields[0]!, fields)).toEqual(["alias-1", "alias-2"]);
    expect(getFieldMirrorKey(fields[0]!)).not.toBe(getFieldMirrorKey(fields[2]!));
  });
});
