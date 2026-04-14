export type DocWithSigners = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  createdBy: string;
  viewerIsCreator: boolean;
  contentHash: string;
  groupId: string | null;
  expiresAt: Date | null;
  postSignReveal: {
    enabled: boolean;
    summary?: string;
    sections?: Array<{
      title: string;
      content: string;
      icon?: string;
    }>;
    downloads?: Array<{
      label: string;
      filename: string;
      description?: string;
      icon?: string;
      uploadedByAddress?: string;
      uploadedByLabel?: string;
      uploadedAt?: string;
    }>;
    testbedAccess?: {
      enabled: boolean;
      description?: string;
      proxyEndpoint?: string;
    };
  } | null;
  signers: Array<{
    id: string;
    label: string;
    address: string | null;
    chain: string | null;
    status: string;
    signedAt: Date | null;
    isYou: boolean;
    signUrl: string | null;
    groupRole: string | null;
  }>;
};

/** A group of docs collapsed into a single dashboard row. */
export type GroupedDoc = {
  kind: "group";
  groupId: string;
  title: string;
  createdAt: Date;
  createdBy: string;
  viewerIsCreator: boolean;
  expiresAt: Date | null;
  status: string;
  postSignReveal: DocWithSigners["postSignReveal"];
  /** The first doc in the group -- used for links/actions */
  primaryDoc: DocWithSigners;
  /** All docs in the group */
  docs: DocWithSigners[];
  /** All recipient signers across all docs in the group */
  recipients: Array<DocWithSigners["signers"][number] & { documentId: string }>;
  /** The discloser signer (from the first doc) */
  discloser: DocWithSigners["signers"][number] | null;
};

export type DashboardItem = (DocWithSigners & { kind?: "single" }) | GroupedDoc;

export function isGroup(item: DashboardItem): item is GroupedDoc {
  return (item as GroupedDoc).kind === "group";
}

/** Collapse documents that share a groupId into a single GroupedDoc. */
export function groupDocuments(docs: DocWithSigners[]): DashboardItem[] {
  const groups = new Map<string, DocWithSigners[]>();
  const singles: DocWithSigners[] = [];

  for (const doc of docs) {
    if (doc.groupId) {
      const list = groups.get(doc.groupId) ?? [];
      list.push(doc);
      groups.set(doc.groupId, list);
    } else {
      singles.push(doc);
    }
  }

  const items: DashboardItem[] = [];

  for (const [groupId, groupDocs] of groups) {
    groupDocs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const primary = groupDocs[0]!;
    const recipients = collectRecipients(groupDocs);
    const status = deriveGroupStatus(groupDocs);

    items.push({
      kind: "group",
      groupId,
      title: primary.title,
      createdAt: primary.createdAt,
      createdBy: primary.createdBy,
      viewerIsCreator: primary.viewerIsCreator,
      expiresAt: primary.expiresAt,
      status,
      postSignReveal: primary.postSignReveal,
      primaryDoc: primary,
      docs: groupDocs,
      recipients,
      discloser: primary.signers.find((s) => s.groupRole === "discloser") ?? null,
    });
  }

  for (const doc of singles) {
    items.push(doc);
  }

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return items;
}

function collectRecipients(groupDocs: DocWithSigners[]): GroupedDoc["recipients"] {
  const recipients: GroupedDoc["recipients"] = [];
  for (const d of groupDocs) {
    for (const s of d.signers) {
      if (s.groupRole !== "discloser") {
        recipients.push({ ...s, documentId: d.id });
      }
    }
  }
  return recipients;
}

function deriveGroupStatus(groupDocs: DocWithSigners[]): string {
  const allCompleted = groupDocs.every((d) => d.status === "COMPLETED");
  if (allCompleted) return "COMPLETED";
  return "PENDING";
}
