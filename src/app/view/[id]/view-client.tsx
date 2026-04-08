/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/consistent-type-imports -- premium router stubs expose `any` types */
"use client";

import { ChevronUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "~/components/layout/wallet-provider";
import { trpc } from "~/lib/platform/trpc";
import { renderToken, useViewCollab, useViewDocumentData } from "./view-client-helpers";
import { buildTocItems, CollabOverlays, ViewSidebar, ViewTopBar } from "./view-client-layout";
import {
  DownloadsSection,
  FieldIndexSection,
  ForensicReplaySection,
  SignaturesSection,
  VerificationSection,
} from "./view-client-sections";

// ── Document body sub-component ──

function DocumentPaper({
  tokens,
  signers,
  allFieldValues,
}: {
  tokens: ReturnType<typeof useViewDocumentData>["tokens"];
  signers: Array<{
    id: string;
    label: string;
    status: string;
    signedAt: Date | null;
    handSignatureData?: string | null;
  }>;
  allFieldValues: Record<string, string>;
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-border"
      style={{
        background: "var(--doc-paper)",
        boxShadow: "var(--doc-paper-shadow)",
      }}
    >
      <div
        className="h-px"
        style={{
          background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
        }}
      />
      <div
        className="space-y-1 px-8 py-10 sm:px-14 sm:py-14"
        style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
      >
        {tokens.map((token, i) => renderToken(token, i, signers, allFieldValues))}
      </div>
    </div>
  );
}

function ViewMainContent({
  tokens,
  signers,
  allFieldValues,
  fieldSummary,
  isCreatorViewer,
  hasDownloads,
  reveal,
  documentId,
  contentHash,
  sectionRefs,
}: {
  tokens: ReturnType<typeof useViewDocumentData>["tokens"];
  signers: Array<{
    id: string;
    label: string;
    status: string;
    address: string | null;
    chain: string | null;
    scheme: string | null;
    signedAt: Date | null;
    signature: string | null;
    handSignatureHash: string | null;
    handSignatureData?: string | null;
  }>;
  allFieldValues: Record<string, string>;
  fieldSummary: ReturnType<typeof useViewDocumentData>["fieldSummary"];
  isCreatorViewer: boolean;
  hasDownloads: boolean;
  reveal: import("~/server/db/schema").PostSignReveal | null | undefined;
  documentId: string;
  contentHash: string;
  sectionRefs: React.MutableRefObject<Record<string, HTMLElement | null>>;
}) {
  return (
    <main className="min-w-0 flex-1 px-6 py-10 sm:px-12 lg:px-16">
      <section
        id="content"
        ref={(el) => {
          sectionRefs.current.content = el;
        }}
      >
        <DocumentPaper tokens={tokens} signers={signers} allFieldValues={allFieldValues} />
      </section>

      <FieldIndexSection
        fieldSummary={fieldSummary}
        sectionRef={(el) => {
          sectionRefs.current.fields = el;
        }}
      />
      <SignaturesSection
        signers={signers}
        sectionRef={(el) => {
          sectionRefs.current.signatures = el;
        }}
      />
      {isCreatorViewer && hasDownloads && (
        <DownloadsSection
          reveal={reveal}
          documentId={documentId}
          sectionRef={(el) => {
            sectionRefs.current.downloads = el;
          }}
        />
      )}
      {isCreatorViewer && (
        <ForensicReplaySection
          documentId={documentId}
          sectionRef={(el) => {
            sectionRefs.current["forensic-replay"] = el;
          }}
        />
      )}
      <VerificationSection
        contentHash={contentHash}
        sectionRef={(el) => {
          sectionRefs.current.verification = el;
        }}
      />

      <div className="mt-16 flex justify-center pb-8">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface-hover px-4 py-2 text-xs text-muted transition-colors hover:bg-surface-elevated hover:text-secondary"
        >
          <ChevronUp className="h-3.5 w-3.5" /> Back to top
        </button>
      </div>
    </main>
  );
}

type Props = { documentId: string };

export function ViewDocumentClient({ documentId }: Props) {
  const { address } = useWallet();
  const claimToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("claim") : null;

  const docQuery = trpc.document.get.useQuery(
    { id: documentId, claimToken: claimToken ?? undefined },
    { refetchOnWindowFocus: false },
  );

  const doc = docQuery.data;
  const [activeSection, setActiveSection] = useState("content");
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const { tokens, allFieldValues, fieldSummary } = useViewDocumentData(doc);

  const signedCount = doc?.signers.filter((s) => s.status === "SIGNED").length ?? 0;
  const allSigned = doc ? doc.signers.every((s) => s.status === "SIGNED") : false;
  const isCreatorViewer = !!(doc && doc.createdBy.toLowerCase() === address?.toLowerCase());

  const collab = useViewCollab(documentId, doc?.title);

  // Scroll spy
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    for (const el of Object.values(sectionRefs.current)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [doc]);

  const pdfUrl = claimToken
    ? `/api/pdf/${documentId}?claim=${claimToken}`
    : address
      ? `/api/pdf/${documentId}?address=${address}`
      : null;

  if (docQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <p className="text-muted">Document not found or access denied.</p>
      </div>
    );
  }

  const reveal = doc?.postSignReveal as import("~/server/db/schema").PostSignReveal | null | undefined;
  const hasDownloads = (reveal?.downloads?.length ?? 0) > 0;

  const tocItems = buildTocItems({
    hasFields: fieldSummary.length > 0,
    isCreatorViewer,
    hasDownloads,
  });

  return (
    <div className="min-h-screen bg-surface">
      <ViewTopBar
        title={doc.title}
        allSigned={allSigned}
        signedCount={signedCount}
        totalSigners={doc.signers.length}
        pdfUrl={pdfUrl}
        contentHash={doc.contentHash}
        collabSessionId={collab.collabSessionId}
        collabJoinToken={collab.collabSession?.session?.joinToken ?? ""}
      />

      <div className="mx-auto flex max-w-7xl gap-0">
        <ViewSidebar
          tocItems={tocItems}
          activeSection={activeSection}
          sectionRefs={sectionRefs}
          signers={doc.signers}
        />

        <ViewMainContent
          tokens={tokens}
          signers={doc.signers}
          allFieldValues={allFieldValues}
          fieldSummary={fieldSummary}
          isCreatorViewer={isCreatorViewer}
          hasDownloads={hasDownloads}
          reveal={reveal}
          documentId={documentId}
          contentHash={doc.contentHash}
          sectionRefs={sectionRefs}
        />
      </div>

      {collab.collabSessionId && collab.collabSession && (
        <CollabOverlays
          collabSessionId={collab.collabSessionId}
          collabSession={collab.collabSession}
          docTitle={doc.title}
          showAnnotations={collab.showAnnotations}
          setShowAnnotations={collab.setShowAnnotations}
          showAiPanel={collab.showAiPanel}
          setShowAiPanel={collab.setShowAiPanel}
          viewerDisplayName={collab.viewerDisplayName}
          currentUserId={collab.identity.currentWallet?.address ?? collab.identity.session?.user?.id ?? ""}
          onClose={() => collab.setCollabSessionId(null)}
        />
      )}
    </div>
  );
}
