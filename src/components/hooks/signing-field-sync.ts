"use client";

import type { InlineField } from "~/lib/document/document-tokens";

const NON_MIRRORABLE_TYPES = new Set(["file", "payment"]);

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

export function getRequiredUsername(field: Pick<InlineField, "settings">): string | null {
  const raw = field.settings?.requiredUsername;
  if (typeof raw !== "string") return null;
  const normalized = raw.replace(/^@/, "").trim().toLowerCase();
  return normalized || null;
}

export function getFieldMirrorKey(field: InlineField): string | null {
  if (NON_MIRRORABLE_TYPES.has(field.type)) return null;

  const requiredUsername = getRequiredUsername(field);
  if (requiredUsername) {
    return `social:${field.signerIdx}:${field.type}:${requiredUsername}`;
  }

  return `field:${field.signerIdx}:${field.type}:${normalizeLabel(field.label)}`;
}

export function getEquivalentFieldIds(sourceField: InlineField, inlineFields: InlineField[]): string[] {
  const mirrorKey = getFieldMirrorKey(sourceField);
  if (!mirrorKey) return [sourceField.id];

  const matches = inlineFields
    .filter((candidate) => getFieldMirrorKey(candidate) === mirrorKey)
    .map((candidate) => candidate.id);

  return matches.length > 0 ? matches : [sourceField.id];
}
