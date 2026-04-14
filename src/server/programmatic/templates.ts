import { and, eq } from "drizzle-orm";
import type { SaveTemplateInput } from "~/lib/schemas/document";
import { db } from "~/server/db";
import { isSchemaDriftError } from "~/server/db/compat";
import { documentTemplates } from "~/server/db/schema";
import { createReminderConfig, normalizeOwnerAddress } from "~/server/workspace/workspace";
import { ProgrammaticApiError } from "./errors";

function normalizeTemplateSigners(signers: SaveTemplateInput["signers"]) {
  return signers.map((signer) => ({
    label: signer.label,
    email: signer.email || undefined,
    phone: signer.phone || undefined,
    role: signer.role,
    deliveryMethods: signer.deliveryMethods,
    tokenGates: signer.tokenGates ?? null,
    fields: signer.fields.map((field) => ({
      id: field.id,
      type: field.type,
      label: field.label,
      value: field.value ?? null,
      required: field.required,
      options: field.options,
      settings: field.settings,
    })),
  }));
}

function normalizeTemplateDefaults(input: SaveTemplateInput) {
  return input.defaults
    ? {
        ...input.defaults,
        reminder: input.defaults.reminder
          ? (createReminderConfig(input.defaults.reminder.cadence, input.defaults.reminder.channels) ?? undefined)
          : undefined,
      }
    : null;
}

async function findOwnedTemplate(ownerAddress: string, templateId: string) {
  const normalizedOwner = normalizeOwnerAddress(ownerAddress);

  try {
    const template = await db.query.documentTemplates.findFirst({
      where: and(eq(documentTemplates.id, templateId), eq(documentTemplates.ownerAddress, normalizedOwner)),
    });
    if (!template) {
      throw new ProgrammaticApiError(404, "Template not found");
    }
    return template;
  } catch (error) {
    if (isSchemaDriftError(error)) {
      throw new ProgrammaticApiError(503, "Template storage is not available until the latest migration is applied");
    }
    throw error;
  }
}

export async function listOwnedTemplates(ownerAddress: string) {
  const normalizedOwner = normalizeOwnerAddress(ownerAddress);

  try {
    const templates = await db.query.documentTemplates.findMany({
      where: eq(documentTemplates.ownerAddress, normalizedOwner),
      orderBy: (table, order) => [order.desc(table.updatedAt)],
    });
    return { count: templates.length, templates };
  } catch (error) {
    if (isSchemaDriftError(error)) {
      return { count: 0, templates: [] };
    }
    throw error;
  }
}

export async function getOwnedTemplate(ownerAddress: string, templateId: string) {
  const template = await findOwnedTemplate(ownerAddress, templateId);
  return { template };
}

export async function createOwnedTemplate(ownerAddress: string, input: SaveTemplateInput) {
  const normalizedOwner = normalizeOwnerAddress(ownerAddress);

  try {
    const [template] = await db
      .insert(documentTemplates)
      .values({
        ownerAddress: normalizedOwner,
        name: input.name,
        description: input.description ?? null,
        title: input.title,
        content: input.content,
        signers: normalizeTemplateSigners(input.signers),
        defaults: normalizeTemplateDefaults(input),
      })
      .returning();

    return { template };
  } catch (error) {
    if (isSchemaDriftError(error)) {
      throw new ProgrammaticApiError(503, "Template storage is not available until the latest migration is applied");
    }
    throw error;
  }
}

export async function updateOwnedTemplate(ownerAddress: string, templateId: string, input: SaveTemplateInput) {
  await findOwnedTemplate(ownerAddress, templateId);

  try {
    const [template] = await db
      .update(documentTemplates)
      .set({
        name: input.name,
        description: input.description ?? null,
        title: input.title,
        content: input.content,
        signers: normalizeTemplateSigners(input.signers),
        defaults: normalizeTemplateDefaults(input),
        updatedAt: new Date(),
      })
      .where(eq(documentTemplates.id, templateId))
      .returning();

    return { template };
  } catch (error) {
    if (isSchemaDriftError(error)) {
      throw new ProgrammaticApiError(503, "Template storage is not available until the latest migration is applied");
    }
    throw error;
  }
}

export async function deleteOwnedTemplate(ownerAddress: string, templateId: string) {
  await findOwnedTemplate(ownerAddress, templateId);
  await db.delete(documentTemplates).where(eq(documentTemplates.id, templateId));
  return { ok: true };
}
