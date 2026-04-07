"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Nav } from "~/components/layout/nav";
import { FadeIn, PageTransition } from "~/components/ui/motion";
import { trpc } from "~/lib/platform/trpc";
import { useConnectedIdentity } from "~/components/hooks/use-connected-identity";
import {
  useCollabSession,
  CollabToolbar,
  CollabCursors,
  CollabAnnotationSidebar,
  CollabAiPanel,
  CollabShareLinks,
} from "../../../components/collab";
import {
  MessageSquare,
  Bot,
  Link2,
  Loader2,
  ShieldAlert,
} from "lucide-react";

export default function CollabSessionPage() {
  const params = useParams<{ sessionId: string }>();
  const router = useRouter();
  const identity = useConnectedIdentity();
  const sessionId = params.sessionId;

  const [showAnnotations, setShowAnnotations] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [showLinks, setShowLinks] = useState(false);

  const sessionQuery = trpc.collab.get.useQuery(
    { sessionId },
    { enabled: identity.isSignedIn && !!sessionId },
  );

  const session = sessionQuery.data;
  const displayName =
    identity.session?.user?.name ??
    identity.wallet?.address?.slice(0, 8) ??
    "Anonymous";

  const collab = useCollabSession({
    sessionId,
    user: {
      userId: identity.currentWallet?.address ?? identity.session?.user?.id ?? "anon",
      displayName,
      color: "#3B82F6",
      role: session?.myRole ?? "editor",
    },
    onCustomMessage: () => {},
  });

  if (!identity.isSignedIn) {
    return (
      <PageTransition>
        <main className="min-h-screen">
          <Nav />
          <div className="mx-auto max-w-2xl px-4 py-16 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-muted" />
            <p className="mt-3 text-sm text-muted">Sign in to join this collaboration session.</p>
          </div>
        </main>
      </PageTransition>
    );
  }

  if (sessionQuery.isLoading) {
    return (
      <PageTransition>
        <main className="min-h-screen">
          <Nav />
          <div className="mx-auto max-w-2xl px-4 py-16 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted" />
            <p className="mt-3 text-sm text-muted">Loading session...</p>
          </div>
        </main>
      </PageTransition>
    );
  }

  if (!session) {
    return (
      <PageTransition>
        <main className="min-h-screen">
          <Nav />
          <div className="mx-auto max-w-2xl px-4 py-16 text-center">
            <p className="text-sm text-red-400">Session not found or access denied.</p>
            <button
              onClick={() => router.push("/dashboard")}
              className="mt-4 text-xs text-muted underline"
            >
              Back to dashboard
            </button>
          </div>
        </main>
      </PageTransition>
    );
  }

  const userId = identity.currentWallet?.address ?? identity.session?.user?.id ?? "";
  const isHost = session.myRole === "host";
  const participants = (session.participants ?? []).map((p: Record<string, unknown>) => ({
    userId: p.userId as string,
    displayName: p.displayName as string,
    color: p.color as string,
    role: p.role as string,
    isActive: Boolean(p.isActive),
  }));

  return (
    <PageTransition>
      <main className="flex min-h-screen flex-col">
        <Nav />

        {/* Collab Toolbar */}
        <CollabToolbar
          sessionId={sessionId}
          sessionTitle={session.session?.title ?? "Untitled Session"}
          joinToken={session.session?.joinToken ?? ""}
          isHost={isHost}
          connected={collab.connected}
          participants={participants}
          remoteUsers={collab.remoteUsers}
          onClose={() => router.push("/dashboard")}
          hasDocument={!!session.session?.documentId}
        />

        {/* Main content area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Document / content area */}
          <div className="relative flex-1 overflow-y-auto bg-[var(--bg-surface)]">
            <div className="mx-auto max-w-5xl px-4 py-6 sm:px-8">
              <FadeIn>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-8 shadow-sm">
                  <p className="text-center text-sm text-muted">
                    Session &ldquo;{session.session?.title}&rdquo; is live.
                    {session.session?.documentId
                      ? " Document content synced via CRDT."
                      : " No document attached — use PDF review mode or start editing."}
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                    <SidebarToggle
                      icon={MessageSquare}
                      label="Annotations"
                      active={showAnnotations}
                      onClick={() => setShowAnnotations(!showAnnotations)}
                    />
                    <SidebarToggle
                      icon={Bot}
                      label="AI Chat"
                      active={showAi}
                      onClick={() => setShowAi(!showAi)}
                    />
                    <SidebarToggle
                      icon={Link2}
                      label="Share Links"
                      active={showLinks}
                      onClick={() => setShowLinks(!showLinks)}
                    />
                  </div>
                </div>
              </FadeIn>
            </div>

            {/* Remote cursors overlay */}
            <CollabCursors
              remoteUsers={collab.remoteUsers}
              getPositionFromToken={() => null}
            />
          </div>

          {/* Annotation sidebar */}
          <CollabAnnotationSidebar
            sessionId={sessionId}
            isOpen={showAnnotations}
            onClose={() => setShowAnnotations(false)}
            onNavigate={() => {}}
            currentUserId={userId}
            isHost={isHost}
          />

          {/* AI panel */}
          <CollabAiPanel
            isOpen={showAi}
            onClose={() => setShowAi(false)}
            sessionId={sessionId}
            displayName={displayName}
          />

          {/* Share links */}
          <CollabShareLinks
            sessionId={sessionId}
            isOpen={showLinks}
            onClose={() => setShowLinks(false)}
            pendingAnchor={null}
            onClearPendingAnchor={() => {}}
          />
        </div>
      </main>
    </PageTransition>
  );
}

function SidebarToggle({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
        active
          ? "bg-[var(--accent)] text-white"
          : "bg-[var(--bg-hover)] text-secondary hover:bg-[var(--border)]"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
