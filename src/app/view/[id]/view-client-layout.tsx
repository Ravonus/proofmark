"use client";

import {
  CheckCircle,
  Clock,
  FileDown,
  FileSignature,
  Hash,
  List,
  Play,
  Printer,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import dynamic from "next/dynamic";
import { ThemeToggle } from "~/components/ui/theme-toggle";

const CollabToolbar = dynamic(() => import("~/generated/premium/components/collab-toolbar"), {
  ssr: false,
  loading: () => null,
});
const CollabAnnotationSidebar = dynamic(() => import("~/generated/premium/components/collab-annotations"), {
  ssr: false,
  loading: () => null,
});
const CollabAiPanel = dynamic(() => import("~/generated/premium/components/collab-ai-panel"), {
  ssr: false,
  loading: () => null,
});
const CollabSharePopover = dynamic(() => import("~/generated/premium/components/collab-share-popover"), {
  ssr: false,
  loading: () => null,
});

// ── Top Bar ──

type TopBarProps = {
  title: string;
  allSigned: boolean;
  signedCount: number;
  totalSigners: number;
  pdfUrl: string | null;
  contentHash: string;
  collabSessionId: string | null;
  collabJoinToken: string;
};

export function ViewTopBar({
  title,
  allSigned,
  signedCount,
  totalSigners,
  pdfUrl,
  contentHash,
  collabSessionId,
  collabJoinToken,
}: TopBarProps) {
  return (
    <div
      className="sticky top-0 z-50 px-4 py-3"
      style={{
        backdropFilter: "blur(20px)",
        background: "var(--doc-nav-bg)",
        borderBottom: "1px solid var(--doc-nav-border)",
      }}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-bold tracking-wider text-accent">PROOFMARK</span>
          <span className="text-muted/40">|</span>
          <span className="max-w-xs truncate text-sm font-medium text-secondary">{title}</span>
          {allSigned ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-0.5 text-[10px] font-bold text-green-400">
              <CheckCircle className="h-3 w-3" /> SIGNED
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-400">
              <Clock className="h-3 w-3" /> {signedCount}/{totalSigners}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-hover px-3 py-1.5 text-xs text-secondary transition-colors hover:bg-surface-elevated"
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
          {pdfUrl && (
            <a
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-accent/15 hover:bg-accent/25 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-accent transition-colors"
            >
              <FileDown className="h-3.5 w-3.5" /> PDF
            </a>
          )}
          <a
            href={`/verify/${contentHash}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-surface-hover px-3 py-1.5 text-xs text-secondary transition-colors hover:bg-surface-elevated"
          >
            <ShieldCheck className="h-3.5 w-3.5" /> Verify
          </a>
          {collabSessionId && <CollabSharePopover sessionId={collabSessionId} joinToken={collabJoinToken} />}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar TOC ──

type TocItem = { id: string; label: string; icon: React.ReactNode };

export function buildTocItems(opts: {
  hasFields: boolean;
  isCreatorViewer: boolean;
  hasDownloads: boolean;
}): TocItem[] {
  const items: TocItem[] = [
    {
      id: "content",
      label: "Document",
      icon: <FileSignature className="h-3.5 w-3.5" />,
    },
  ];
  if (opts.hasFields) {
    items.push({
      id: "fields",
      label: "Field Index",
      icon: <List className="h-3.5 w-3.5" />,
    });
  }
  items.push({
    id: "signatures",
    label: "Signatures",
    icon: <ShieldCheck className="h-3.5 w-3.5" />,
  });
  if (opts.isCreatorViewer && opts.hasDownloads) {
    items.push({
      id: "downloads",
      label: "Downloads",
      icon: <FileDown className="h-3.5 w-3.5" />,
    });
  }
  if (opts.isCreatorViewer) {
    items.push({
      id: "forensic-replay",
      label: "Forensic Replay",
      icon: <Play className="h-3.5 w-3.5" />,
    });
  }
  items.push({
    id: "verification",
    label: "Verification",
    icon: <Hash className="h-3.5 w-3.5" />,
  });
  return items;
}

type SidebarProps = {
  tocItems: TocItem[];
  activeSection: string;
  sectionRefs: React.MutableRefObject<Record<string, HTMLElement | null>>;
  signers: Array<{ id: string; label: string; status: string }>;
};

export function ViewSidebar({ tocItems, activeSection, sectionRefs, signers }: SidebarProps) {
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-56px)] w-56 shrink-0 overflow-y-auto border-r border-[var(--border-subtle)] p-4 lg:block">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted">Contents</p>
      <nav className="space-y-1">
        {tocItems.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            onClick={(e) => {
              e.preventDefault();
              sectionRefs.current[item.id]?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors ${
              activeSection === item.id
                ? "bg-accent/10 font-medium text-accent"
                : "text-muted hover:bg-surface-hover hover:text-secondary"
            }`}
          >
            {item.icon}
            {item.label}
          </a>
        ))}
      </nav>
      <div className="mt-6 space-y-1.5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Signers</p>
        {signers.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs">
            <SignerStatusIcon status={s.status} />
            <span className="truncate text-secondary">{s.label}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}

function SignerStatusIcon({ status }: { status: string }) {
  if (status === "SIGNED") return <CheckCircle className="h-3 w-3 text-green-400" />;
  if (status === "DECLINED") return <XCircle className="h-3 w-3 text-red-400" />;
  return <Clock className="h-3 w-3 text-amber-400" />;
}

// ── Collab Overlays ──

type CollabOverlayProps = {
  collabSessionId: string;
  collabSession: {
    session?: { title?: string; joinToken?: string } | null;
    myRole?: string;
    participants?: Record<string, unknown>[];
  };
  docTitle: string;
  showAnnotations: boolean;
  setShowAnnotations: (v: boolean) => void;
  showAiPanel: boolean;
  setShowAiPanel: (v: boolean) => void;
  viewerDisplayName: string;
  currentUserId: string;
  onClose: () => void;
};

export function CollabOverlays({
  collabSessionId,
  collabSession,
  docTitle,
  showAnnotations,
  setShowAnnotations,
  showAiPanel,
  setShowAiPanel,
  viewerDisplayName,
  currentUserId,
  onClose,
}: CollabOverlayProps) {
  return (
    <>
      <CollabToolbar
        sessionId={collabSessionId}
        sessionTitle={collabSession.session?.title ?? docTitle}
        joinToken={collabSession.session?.joinToken ?? ""}
        isHost={collabSession.myRole === "host"}
        connected={true}
        participants={(collabSession.participants ?? []).map((p: Record<string, unknown>) => ({
          userId: p.userId as string,
          displayName: p.displayName as string,
          color: p.color as string,
          role: p.role as string,
          isActive: Boolean(p.isActive),
        }))}
        remoteUsers={[]}
        onClose={onClose}
        hasDocument={true}
      />
      <CollabAnnotationSidebar
        sessionId={collabSessionId}
        isOpen={showAnnotations}
        onClose={() => setShowAnnotations(false)}
        onNavigate={() => {
          /* noop */
        }}
        currentUserId={currentUserId}
        isHost={collabSession.myRole === "host"}
      />
      <CollabAiPanel
        isOpen={showAiPanel}
        onClose={() => setShowAiPanel(false)}
        sessionId={collabSessionId}
        displayName={viewerDisplayName}
      />
    </>
  );
}
