"use client";

import { motion } from "framer-motion";
import { ShieldCheck, ShieldX, Clock, CheckCircle } from "lucide-react";
import { trpc } from "~/lib/platform/trpc";
import { CHAIN_META, addressPreview, type WalletChain } from "~/lib/crypto/chains";
import { FadeIn, ScaleIn, GlassCard, StaggerContainer, StaggerItem } from "../ui/motion";

export function VerifyDocument({ hash }: { hash: string }) {
  const verifyQuery = trpc.document.verify.useQuery({ query: hash });

  if (verifyQuery.isLoading) {
    return (
      <FadeIn>
        <GlassCard className="mx-auto max-w-2xl p-8 text-center">
          <motion.div
            className="border-accent/30 inline-block h-6 w-6 rounded-full border-2 border-t-accent"
            animate={{ rotate: 360 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
          />
          <p className="mt-3 text-muted">Verifying...</p>
        </GlassCard>
      </FadeIn>
    );
  }

  const doc = verifyQuery.data;

  if (!doc) {
    return (
      <ScaleIn>
        <GlassCard className="mx-auto max-w-2xl space-y-3 p-8 text-center">
          <motion.div
            className="flex justify-center text-red-400"
            initial={{ scale: 0, rotate: 90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
          >
            <ShieldX className="h-10 w-10" />
          </motion.div>
          <h2 className="text-xl font-semibold">No Document Found</h2>
          <p className="text-sm text-muted">
            No document matches SHA-256: <span className="break-all font-mono">{hash}</span>
          </p>
        </GlassCard>
      </ScaleIn>
    );
  }

  const allSigned = doc.signers.every((s) => s.status === "SIGNED");

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <ScaleIn>
        <GlassCard className="p-6 text-center">
          <motion.div
            className={`mb-3 flex justify-center ${allSigned ? "text-success" : "text-warning"}`}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
          >
            {allSigned ? <ShieldCheck className="h-10 w-10" /> : <Clock className="h-10 w-10" />}
          </motion.div>
          <h2 className="text-xl font-semibold">{doc.title}</h2>
          <p className="mt-1 break-all font-mono text-xs text-muted">SHA-256: {doc.contentHash}</p>
          <p className="mt-2 text-sm text-secondary">Created {new Date(doc.createdAt).toLocaleDateString()}</p>
        </GlassCard>
      </ScaleIn>

      <FadeIn delay={0.15}>
        <GlassCard>
          <h3 className="mb-4 text-sm font-medium text-secondary">Signatures</h3>
          <StaggerContainer className="space-y-3">
            {doc.signers.map((signer, idx) => {
              const meta = signer.chain ? CHAIN_META[signer.chain as WalletChain] : null;
              return (
                <StaggerItem key={idx}>
                  <div className="bg-surface/50 space-y-2 rounded-xl px-4 py-3">
                    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                      <div className="flex items-center gap-3">
                        {meta ? (
                          <span style={{ color: meta.color }}>{meta.icon}</span>
                        ) : (
                          <span className="text-muted">?</span>
                        )}
                        <div>
                          <p className="text-sm font-medium">{signer.label}</p>
                          {signer.address ? (
                            <p className="font-mono text-xs text-muted">{addressPreview(signer.address)}</p>
                          ) : (
                            <p className="text-xs italic text-muted">Not yet signed</p>
                          )}
                        </div>
                      </div>
                      {signer.status === "SIGNED" ? (
                        <span className="flex items-center gap-1 text-sm text-success">
                          <motion.span
                            className="flex items-center"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring", stiffness: 300 }}
                          >
                            <CheckCircle className="h-4 w-4" />
                          </motion.span>{" "}
                          Verified
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-warning">
                          <Clock className="h-3.5 w-3.5" />
                          Pending
                        </span>
                      )}
                    </div>
                    {signer.scheme && (
                      <div className="bg-surface-card/60 rounded-lg p-2">
                        <p className="text-[10px] text-muted">{signer.scheme}</p>
                        {signer.signedAt && (
                          <p className="mt-0.5 text-[10px] text-muted">{new Date(signer.signedAt).toLocaleString()}</p>
                        )}
                      </div>
                    )}
                  </div>
                </StaggerItem>
              );
            })}
          </StaggerContainer>
        </GlassCard>
      </FadeIn>
    </div>
  );
}
