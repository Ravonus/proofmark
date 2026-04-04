"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "~/lib/trpc";
import { useWallet } from "./wallet-provider";
import { PostSignRevealUploader } from "./post-sign-reveal-uploader";
import { addressPreview } from "~/lib/chains";
import { FadeIn, GlassCard, AnimatedButton, AnimatedLink, StaggerContainer, StaggerItem } from "./ui/motion";

function formatUploadMeta(download: { uploadedByLabel?: string; uploadedAt?: string }) {
  const label = download.uploadedByLabel?.trim();
  const uploadedAt = download.uploadedAt ? new Date(download.uploadedAt) : null;
  const uploadedAtText = uploadedAt && !Number.isNaN(uploadedAt.getTime()) ? uploadedAt.toLocaleString() : null;

  if (label && uploadedAtText) return `Uploaded by ${label} on ${uploadedAtText}`;
  if (label) return `Uploaded by ${label}`;
  if (uploadedAtText) return `Uploaded ${uploadedAtText}`;
  return null;
}

export function PostSignReveal({ documentId }: { documentId: string }) {
  const { connected, address, chain, signMessage } = useWallet();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<string | null>(null);

  const revealQuery = trpc.document.getReveal.useQuery({ documentId }, { enabled: connected && !!address });

  const challengeQuery = trpc.document.getAccessChallenge.useQuery(
    { documentId, callerAddress: address ?? "" },
    { enabled: false }, // manual fetch
  );

  const refreshMutation = trpc.document.refreshAccess.useMutation({
    onSuccess: (data) => {
      setRefreshResult(data.ip);
      revealQuery.refetch();
    },
  });

  const handleRefreshAccess = async () => {
    if (!address || !chain) return;
    setRefreshing(true);
    setRefreshResult(null);
    try {
      // Get a fresh challenge
      const challenge = await challengeQuery.refetch();
      if (!challenge.data) throw new Error("Failed to get challenge");

      // Sign it with the wallet
      const signature = await signMessage(challenge.data.message);

      // Submit to server — server auto-grabs the IP
      await refreshMutation.mutateAsync({
        documentId,
        callerAddress: address,
        chain,
        signature,
        challengeMessage: challenge.data.message,
      });
    } catch (e) {
      console.error("Access refresh failed:", e);
    } finally {
      setRefreshing(false);
    }
  };

  if (!connected) {
    return (
      <FadeIn>
        <GlassCard className="mx-auto max-w-3xl p-8 text-center">
          <motion.div
            className="mb-4 text-4xl opacity-40"
            animate={{ y: [0, -6, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            &#128274;
          </motion.div>
          <p className="text-muted">Connect your wallet to access post-signing content</p>
        </GlassCard>
      </FadeIn>
    );
  }

  if (revealQuery.isLoading) {
    return (
      <FadeIn>
        <GlassCard className="mx-auto max-w-3xl p-8 text-center">
          <motion.div
            className="border-accent/30 inline-block h-6 w-6 rounded-full border-2 border-t-accent"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
          />
          <p className="mt-3 text-muted">Loading...</p>
        </GlassCard>
      </FadeIn>
    );
  }

  if (revealQuery.error) {
    return (
      <FadeIn>
        <GlassCard className="mx-auto max-w-3xl space-y-3 p-8 text-center">
          <motion.div className="text-4xl" initial={{ scale: 0 }} animate={{ scale: 1 }}>
            &#128274;
          </motion.div>
          <h2 className="text-xl font-semibold">Signature Required</h2>
          <p className="text-sm text-muted">{revealQuery.error.message}</p>
          <AnimatedLink href={`/sign/${documentId}`} variant="primary" className="inline-block px-4 py-2">
            Go to Signing Page
          </AnimatedLink>
        </GlassCard>
      </FadeIn>
    );
  }

  const data = revealQuery.data;
  if (!data?.reveal) {
    return (
      <FadeIn>
        <GlassCard className="mx-auto max-w-3xl p-8 text-center">
          <p className="text-muted">No post-signing content available.</p>
        </GlassCard>
      </FadeIn>
    );
  }

  const { reveal, signer } = data;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Header */}
      <FadeIn>
        <GlassCard className="from-accent/10 bg-gradient-to-br to-transparent p-6 sm:p-8">
          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <motion.div
                className="bg-success/20 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg text-success"
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
              >
                &#10003;
              </motion.div>
              <div>
                <h1 className="text-xl font-bold sm:text-2xl">{data.documentTitle}</h1>
                <p className="text-xs text-muted">
                  Signed &amp; Verified
                  {signer?.address && (
                    <>
                      {" "}
                      &bull; <span className="font-mono">{addressPreview(signer.address)}</span>
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Download contract PDF */}
            <a
              href={`/api/pdf/${data.documentId}?address=${encodeURIComponent(address!)}`}
              className="bg-surface/50 flex shrink-0 items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm transition hover:bg-surface-hover"
            >
              <span>&#128196;</span>
              Download Signed PDF
            </a>
          </div>

          {reveal.summary && <p className="mt-4 text-sm leading-relaxed text-secondary">{reveal.summary}</p>}
        </GlassCard>
      </FadeIn>

      {/* Info Sections */}
      {reveal.sections && reveal.sections.length > 0 && (
        <StaggerContainer className="space-y-4">
          {reveal.sections.map((section, idx) => (
            <StaggerItem key={idx}>
              <GlassCard className="space-y-3 p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  {section.icon && <span className="text-2xl">{section.icon}</span>}
                  <h3 className="text-lg font-semibold">{section.title}</h3>
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-secondary">{section.content}</div>
              </GlassCard>
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}

      {/* Downloads */}
      {reveal.downloads && reveal.downloads.length > 0 && (
        <FadeIn delay={0.2}>
          <GlassCard className="p-5 sm:p-6">
            <h3 className="mb-4 text-lg font-semibold">Documents &amp; Downloads</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {reveal.downloads.map((dl, idx) => (
                <motion.a
                  key={idx}
                  href={`/api/download/${dl.filename}?documentId=${encodeURIComponent(data.documentId)}`}
                  download
                  className="bg-surface/50 group flex items-center gap-4 rounded-xl border border-border p-4"
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <div className="bg-accent/10 flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-2xl">
                    {dl.icon || "\ud83d\udcc4"}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium transition-colors group-hover:text-accent">{dl.label}</p>
                    {dl.description && <p className="mt-0.5 text-xs text-muted">{dl.description}</p>}
                    {formatUploadMeta(dl) && <p className="mt-1 text-[10px] text-muted">{formatUploadMeta(dl)}</p>}
                    <p className="mt-1 text-[10px] text-accent">Click to download</p>
                  </div>
                </motion.a>
              ))}
            </div>
          </GlassCard>
        </FadeIn>
      )}

      <FadeIn delay={0.22}>
        <PostSignRevealUploader
          documentId={data.documentId}
          onUploaded={async () => {
            await revealQuery.refetch();
          }}
        />
      </FadeIn>

      {/* Testbed Access */}
      {reveal.testbedAccess?.enabled && (
        <FadeIn delay={0.25}>
          <GlassCard className="space-y-4 p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="text-2xl">&#127760;</span>
              <h3 className="text-lg font-semibold">Testbed Access</h3>
            </div>
            {reveal.testbedAccess.description && (
              <p className="text-sm text-secondary">{reveal.testbedAccess.description}</p>
            )}

            <div className="bg-surface/50 space-y-4 rounded-xl p-4">
              {signer?.lastIp ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-success/20 flex h-8 w-8 items-center justify-center rounded-full text-sm text-success">
                      &#10003;
                    </div>
                    <div>
                      <p className="text-sm font-medium">Access Granted</p>
                      <p className="font-mono text-xs text-muted">{signer.lastIp}</p>
                      {signer.ipUpdatedAt && (
                        <p className="text-[10px] text-muted">{new Date(signer.ipUpdatedAt).toLocaleString()}</p>
                      )}
                    </div>
                  </div>
                  <AnimatedButton
                    variant="secondary"
                    className="px-3 py-2 text-xs"
                    onClick={handleRefreshAccess}
                    disabled={refreshing}
                  >
                    {refreshing ? "Verifying..." : "Refresh IP"}
                  </AnimatedButton>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="bg-warning/20 flex h-8 w-8 items-center justify-center rounded-full text-sm text-warning">
                      !
                    </div>
                    <div>
                      <p className="text-sm font-medium">IP Not Registered</p>
                      <p className="text-xs text-muted">Sign a quick wallet verification to register your IP</p>
                    </div>
                  </div>
                  <AnimatedButton
                    variant="primary"
                    className="px-4 py-2 text-xs"
                    onClick={handleRefreshAccess}
                    disabled={refreshing}
                  >
                    {refreshing ? "Verifying..." : "Register Access"}
                  </AnimatedButton>
                </div>
              )}

              <AnimatePresence>
                {refreshResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="bg-success/10 rounded-lg p-3 text-sm text-success"
                  >
                    Access updated — IP {refreshResult} registered
                  </motion.div>
                )}
                {refreshMutation.error && (
                  <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-red-400">
                    {refreshMutation.error.message}
                  </motion.p>
                )}
              </AnimatePresence>

              <div className="bg-accent/5 border-accent/10 rounded-lg border p-3">
                <p className="text-xs leading-relaxed text-muted">
                  Click &quot;{signer?.lastIp ? "Refresh IP" : "Register Access"}&quot; to verify your wallet and
                  whitelist your current IP. This is a lightweight signature — it does not modify the contract.
                </p>
              </div>
            </div>
          </GlassCard>
        </FadeIn>
      )}
    </div>
  );
}
