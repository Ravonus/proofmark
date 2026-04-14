import { and, asc, desc, eq } from "drizzle-orm";
import type { db as _dbRef } from "~/server/db";
import { documents, type ReminderConfig, signers } from "~/server/db/schema";

type Db = typeof _dbRef;
type LegacyDocumentRow = Omit<
  typeof documents.$inferSelect,
  "templateId" | "brandingProfileId" | "pdfStyleTemplateId" | "reminderConfig" | "groupId"
>;
type LegacySignerRow = Omit<
  typeof signers.$inferSelect,
  | "phone"
  | "deliveryMethods"
  | "role"
  | "declineReason"
  | "declinedAt"
  | "forensicEvidence"
  | "forensicHash"
  | "socialVerifications"
  | "tokenGates"
  | "groupRole"
  | "userId"
  | "documentStateHash"
  | "finalizationSignature"
  | "finalizationStateHash"
  | "finalizationSignedAt"
  | "finalizationMessage"
>;

type CompatDocument = typeof documents.$inferSelect & {
  templateId: string | null;
  brandingProfileId: string | null;
  pdfStyleTemplateId: string | null;
  reminderConfig: ReminderConfig | null;
  groupId: string | null;
};

type CompatSigner = typeof signers.$inferSelect & {
  phone: string | null;
  deliveryMethods: Array<"EMAIL" | "SMS"> | null;
  role: "SIGNER" | "APPROVER" | "CC" | "WITNESS" | "OBSERVER";
  declineReason: string | null;
  declinedAt: Date | null;
  forensicEvidence: unknown;
  forensicHash: string | null;
  tokenGates: (typeof signers.$inferSelect)["tokenGates"] | null;
  groupRole: string | null;
  userId: string | null;
  documentStateHash: string | null;
  finalizationSignature: string | null;
  finalizationStateHash: string | null;
  finalizationSignedAt: Date | null;
  finalizationMessage: string | null;
};

const stableDocumentSelect = {
  id: documents.id,
  title: documents.title,
  content: documents.content,
  contentHash: documents.contentHash,
  createdBy: documents.createdBy,
  createdByEmail: documents.createdByEmail,
  createdAt: documents.createdAt,
  expiresAt: documents.expiresAt,
  status: documents.status,
  accessToken: documents.accessToken,
  ipfsCid: documents.ipfsCid,
  postSignReveal: documents.postSignReveal,
  proofMode: documents.proofMode,
  signingOrder: documents.signingOrder,
  currentSignerIndex: documents.currentSignerIndex,
  encryptedAtRest: documents.encryptedAtRest,
  encryptionKeyWrapped: documents.encryptionKeyWrapped,
  gazeTracking: documents.gazeTracking,
};

const stableSignerSelect = {
  id: signers.id,
  documentId: signers.documentId,
  label: signers.label,
  address: signers.address,
  chain: signers.chain,
  email: signers.email,
  status: signers.status,
  signature: signers.signature,
  signedAt: signers.signedAt,
  scheme: signers.scheme,
  handSignatureData: signers.handSignatureData,
  handSignatureHash: signers.handSignatureHash,
  fields: signers.fields,
  fieldValues: signers.fieldValues,
  tokenGates: signers.tokenGates,
  claimToken: signers.claimToken,
  lastIp: signers.lastIp,
  ipUpdatedAt: signers.ipUpdatedAt,
  signMethod: signers.signMethod,
  otpCode: signers.otpCode,
  otpExpiresAt: signers.otpExpiresAt,
  otpVerifiedAt: signers.otpVerifiedAt,
  consentText: signers.consentText,
  consentAt: signers.consentAt,
  identityLevel: signers.identityLevel,
  signerOrder: signers.signerOrder,
  userAgent: signers.userAgent,
};

function withDocumentDefaults(row: typeof documents.$inferSelect | LegacyDocumentRow): CompatDocument {
  return {
    ...(row as LegacyDocumentRow),
    templateId: (row as { templateId?: string | null }).templateId ?? null,
    brandingProfileId: (row as { brandingProfileId?: string | null }).brandingProfileId ?? null,
    pdfStyleTemplateId: (row as { pdfStyleTemplateId?: string | null }).pdfStyleTemplateId ?? null,
    reminderConfig: (row as { reminderConfig?: ReminderConfig | null }).reminderConfig ?? null,
    groupId: (row as { groupId?: string | null }).groupId ?? null,
  };
}

function withSignerDefaults(row: typeof signers.$inferSelect | LegacySignerRow): CompatSigner {
  return {
    ...(row as LegacySignerRow),
    phone: (row as { phone?: string | null }).phone ?? null,
    deliveryMethods: (row as { deliveryMethods?: Array<"EMAIL" | "SMS"> | null }).deliveryMethods ?? null,
    role: (row as { role?: CompatSigner["role"] }).role ?? "SIGNER",
    declineReason: (row as { declineReason?: string | null }).declineReason ?? null,
    declinedAt: (row as { declinedAt?: Date | null }).declinedAt ?? null,
    forensicEvidence: (row as { forensicEvidence?: unknown }).forensicEvidence ?? null,
    forensicHash: (row as { forensicHash?: string | null }).forensicHash ?? null,
    tokenGates:
      (
        row as {
          tokenGates?: (typeof signers.$inferSelect)["tokenGates"] | null;
        }
      ).tokenGates ?? null,
    socialVerifications:
      ((row as { socialVerifications?: unknown })
        .socialVerifications as (typeof signers.$inferSelect)["socialVerifications"]) ?? null,
    groupRole: (row as { groupRole?: string | null }).groupRole ?? null,
    userId: (row as { userId?: string | null }).userId ?? null,
    documentStateHash: (row as { documentStateHash?: string | null }).documentStateHash ?? null,
    finalizationSignature: (row as { finalizationSignature?: string | null }).finalizationSignature ?? null,
    finalizationStateHash: (row as { finalizationStateHash?: string | null }).finalizationStateHash ?? null,
    finalizationSignedAt: (row as { finalizationSignedAt?: Date | null }).finalizationSignedAt ?? null,
    finalizationMessage: (row as { finalizationMessage?: string | null }).finalizationMessage ?? null,
  };
}

/**
 * Detects PostgreSQL errors caused by schema drift — typically column (42703) or
 * table (42P01) not existing because the DB hasn't been migrated to the latest schema.
 * When detected, queries fall back to a stable subset of columns.
 */
export function isSchemaDriftError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as { code?: string; message?: string };
  return (
    maybeError.code === "42703" ||
    maybeError.code === "42P01" ||
    maybeError.message?.includes("does not exist") === true
  );
}

/** Try the primary query; if it fails with a schema drift error, run the fallback instead. */
async function withSchemaDriftFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  try {
    return await primary();
  } catch (error) {
    if (!isSchemaDriftError(error)) throw error;
    return fallback();
  }
}

export function findDocumentById(db: Db, id: string): Promise<CompatDocument | undefined> {
  return withSchemaDriftFallback(
    async () => {
      const doc = await db.query.documents.findFirst({
        where: eq(documents.id, id),
      });
      return doc ? withDocumentDefaults(doc) : undefined;
    },
    async () => {
      const [doc] = await db.select(stableDocumentSelect).from(documents).where(eq(documents.id, id)).limit(1);
      return doc ? withDocumentDefaults(doc) : undefined;
    },
  );
}

export function findDocumentByContentHash(db: Db, contentHash: string): Promise<CompatDocument | undefined> {
  return withSchemaDriftFallback(
    async () => {
      const doc = await db.query.documents.findFirst({
        where: eq(documents.contentHash, contentHash),
      });
      return doc ? withDocumentDefaults(doc) : undefined;
    },
    async () => {
      const [doc] = await db
        .select(stableDocumentSelect)
        .from(documents)
        .where(eq(documents.contentHash, contentHash))
        .limit(1);
      return doc ? withDocumentDefaults(doc) : undefined;
    },
  );
}

export function findDocumentByIpfsCid(db: Db, ipfsCid: string): Promise<CompatDocument | undefined> {
  return withSchemaDriftFallback(
    async () => {
      const doc = await db.query.documents.findFirst({
        where: eq(documents.ipfsCid, ipfsCid),
      });
      return doc ? withDocumentDefaults(doc) : undefined;
    },
    async () => {
      const [doc] = await db
        .select(stableDocumentSelect)
        .from(documents)
        .where(eq(documents.ipfsCid, ipfsCid))
        .limit(1);
      return doc ? withDocumentDefaults(doc) : undefined;
    },
  );
}

export function findDocumentsByCreator(db: Db, createdBy: string): Promise<CompatDocument[]> {
  return withSchemaDriftFallback(
    async () => {
      const docs = await db.query.documents.findMany({
        where: eq(documents.createdBy, createdBy),
        orderBy: (t, { desc: orderDesc }) => [orderDesc(t.createdAt)],
      });
      return docs.map(withDocumentDefaults);
    },
    async () => {
      const docs = await db
        .select(stableDocumentSelect)
        .from(documents)
        .where(eq(documents.createdBy, createdBy))
        .orderBy(desc(documents.createdAt));
      return docs.map(withDocumentDefaults);
    },
  );
}

export function findSignersByDocumentId(db: Db, documentId: string): Promise<CompatSigner[]> {
  return withSchemaDriftFallback(
    async () => {
      const rows = await db.query.signers.findMany({
        where: eq(signers.documentId, documentId),
        orderBy: (t, { asc: orderAsc }) => [orderAsc(t.signerOrder), orderAsc(t.id)],
      });
      return rows.map(withSignerDefaults);
    },
    async () => {
      const rows = await db
        .select(stableSignerSelect)
        .from(signers)
        .where(eq(signers.documentId, documentId))
        .orderBy(asc(signers.signerOrder), asc(signers.id));
      return rows.map(withSignerDefaults);
    },
  );
}

export function findDocumentsByGroupId(db: Db, groupId: string): Promise<CompatDocument[]> {
  return withSchemaDriftFallback(
    async () => {
      const docs = await db.query.documents.findMany({
        where: eq(documents.groupId, groupId),
      });
      return docs.map(withDocumentDefaults);
    },
    async () => {
      // groupId column doesn't exist yet — no groups possible
      return [];
    },
  );
}

export function findSignersByAddress(db: Db, address: string): Promise<CompatSigner[]> {
  return withSchemaDriftFallback(
    async () => {
      const rows = await db.query.signers.findMany({
        where: eq(signers.address, address),
      });
      return rows.map(withSignerDefaults);
    },
    async () => {
      const rows = await db.select(stableSignerSelect).from(signers).where(eq(signers.address, address));
      return rows.map(withSignerDefaults);
    },
  );
}

export function findSignerByIdAndDocumentId(
  db: Db,
  signerId: string,
  documentId: string,
): Promise<CompatSigner | undefined> {
  return withSchemaDriftFallback(
    async () => {
      const signer = await db.query.signers.findFirst({
        where: and(eq(signers.id, signerId), eq(signers.documentId, documentId)),
      });
      return signer ? withSignerDefaults(signer) : undefined;
    },
    async () => {
      const [signer] = await db
        .select(stableSignerSelect)
        .from(signers)
        .where(and(eq(signers.id, signerId), eq(signers.documentId, documentId)))
        .limit(1);
      return signer ? withSignerDefaults(signer) : undefined;
    },
  );
}

export async function insertDocumentCompat(db: Db, values: typeof documents.$inferInsert): Promise<CompatDocument[]> {
  try {
    return (await db.insert(documents).values(values).returning()).map(withDocumentDefaults);
  } catch (error) {
    if (!isSchemaDriftError(error)) throw error;
    const {
      templateId: _templateId, // eslint-disable-line @typescript-eslint/no-unused-vars
      brandingProfileId: _brandingProfileId, // eslint-disable-line @typescript-eslint/no-unused-vars
      pdfStyleTemplateId: _pdfStyleTemplateId, // eslint-disable-line @typescript-eslint/no-unused-vars
      reminderConfig: _reminderConfig, // eslint-disable-line @typescript-eslint/no-unused-vars
      groupId: _groupId, // eslint-disable-line @typescript-eslint/no-unused-vars
      ...legacyValues
    } = values as typeof values & {
      templateId?: string | null;
      brandingProfileId?: string | null;
      pdfStyleTemplateId?: string | null;
      reminderConfig?: ReminderConfig | null;
      groupId?: string | null;
    };
    return (await db.insert(documents).values(legacyValues).returning()).map(withDocumentDefaults);
  }
}

export async function insertSignersCompat(db: Db, values: Array<typeof signers.$inferInsert>): Promise<CompatSigner[]> {
  try {
    return (await db.insert(signers).values(values).returning()).map(withSignerDefaults);
  } catch (error) {
    if (!isSchemaDriftError(error)) throw error;
    const legacyValues = values.map((value) => {
      /* eslint-disable @typescript-eslint/no-unused-vars -- stripping new columns for legacy fallback */
      const {
        phone,
        deliveryMethods,
        role,
        declineReason,
        declinedAt,
        tokenGates,
        groupRole,
        userId,
        documentStateHash,
        finalizationSignature,
        finalizationStateHash,
        finalizationSignedAt,
        finalizationMessage,
        ...rest
      } = value as typeof value & {
        phone?: string | null;
        deliveryMethods?: Array<"EMAIL" | "SMS"> | null;
        role?: CompatSigner["role"];
        declineReason?: string | null;
        declinedAt?: Date | null;
        tokenGates?: (typeof signers.$inferInsert)["tokenGates"] | null;
        groupRole?: string | null;
        userId?: string | null;
        documentStateHash?: string | null;
        finalizationSignature?: string | null;
        finalizationStateHash?: string | null;
        finalizationSignedAt?: Date | null;
        finalizationMessage?: string | null;
      };
      /* eslint-enable @typescript-eslint/no-unused-vars */
      return rest;
    });
    return (await db.insert(signers).values(legacyValues).returning()).map(withSignerDefaults);
  }
}
