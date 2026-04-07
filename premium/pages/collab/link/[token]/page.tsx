"use client";

import { useParams, useRouter } from "next/navigation";
import { Nav } from "~/components/layout/nav";
import { PageTransition } from "~/components/ui/motion";
import { trpc } from "~/lib/platform/trpc";
import { useConnectedIdentity } from "~/components/hooks/use-connected-identity";
import { Loader2, ExternalLink, ShieldAlert } from "lucide-react";

export default function CollabLinkPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const identity = useConnectedIdentity();

  const linkQuery = trpc.collab.resolveLink.useQuery(
    { token: params.token },
    { enabled: !!params.token },
  );

  const link = linkQuery.data;

  if (linkQuery.isLoading) {
    return (
      <PageTransition>
        <main className="min-h-screen">
          <Nav />
          <div className="mx-auto max-w-2xl px-4 py-16 text-center">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted" />
            <p className="mt-3 text-sm text-muted">Resolving link...</p>
          </div>
        </main>
      </PageTransition>
    );
  }

  if (!link || linkQuery.error) {
    return (
      <PageTransition>
        <main className="min-h-screen">
          <Nav />
          <div className="mx-auto max-w-2xl px-4 py-16 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-red-400" />
            <p className="mt-3 text-sm text-red-400">
              {linkQuery.error?.message ?? "This link is invalid or has expired."}
            </p>
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

  return (
    <PageTransition>
      <main className="min-h-screen">
        <Nav />
        <div className="mx-auto max-w-2xl px-4 py-16">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-8 shadow-sm">
            <h2 className="text-lg font-semibold">Shared Section Link</h2>
            <p className="mt-2 text-sm text-muted">
              You&apos;ve been invited to review a section of a collaborative document.
            </p>

            {link.anchor && (
              <div className="mt-4 rounded-lg bg-[var(--bg-surface)] p-4 text-sm text-secondary">
                <p className="text-xs font-medium text-muted">Section anchor</p>
                <pre className="mt-1 whitespace-pre-wrap text-xs">
                  {JSON.stringify(link.anchor, null, 2)}
                </pre>
              </div>
            )}

            {link.aiBreakdown && (
              <div className="mt-4 rounded-lg border border-[var(--accent-20)] bg-[var(--accent-subtle)] p-4">
                <p className="text-xs font-medium text-[var(--accent)]">AI Breakdown</p>
                <p className="mt-1 text-sm text-secondary">{String(link.aiBreakdown)}</p>
              </div>
            )}

            <div className="mt-6 flex gap-2">
              {identity.isSignedIn ? (
                <button
                  onClick={() => router.push(`/collab/${link.sessionId}`)}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-90"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Join Session
                </button>
              ) : (
                <p className="text-sm text-muted">Sign in to join this session.</p>
              )}
              <button
                onClick={() => router.push("/dashboard")}
                className="rounded-lg bg-[var(--bg-hover)] px-4 py-2.5 text-sm text-secondary transition-colors hover:bg-[var(--border)]"
              >
                Dashboard
              </button>
            </div>
          </div>
        </div>
      </main>
    </PageTransition>
  );
}
