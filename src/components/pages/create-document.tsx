"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, FileText, Lock } from "lucide-react";
import { lazy, Suspense } from "react";
import { CONTRACT_TEMPLATES } from "~/lib/document/templates";
import { FadeIn, GlassCard } from "../ui/motion";
import { CreateDocumentActions, DeliveryDefaults } from "./create-document-sections";
import { type CreatedResult, useCreateDocument } from "./use-create-document";

const PdfUpload = lazy(() => import("../pdf-upload").then((m) => ({ default: m.PdfUpload })));
const DocumentEditor = lazy(() => import("../document-editor").then((m) => ({ default: m.DocumentEditor })));

export function CreateDocument() {
  const ctx = useCreateDocument();

  if (ctx.created) {
    return (
      <CreatedSuccess
        created={ctx.created}
        copiedIdx={ctx.copiedIdx}
        onCopy={ctx.handleCopy}
        onReset={ctx.resetToHome}
      />
    );
  }
  if (!ctx.connected) {
    return (
      <FadeIn>
        <GlassCard className="mx-auto max-w-2xl p-6 text-center">
          <motion.div
            className="mb-3 flex justify-center text-faint"
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          >
            <Lock className="h-8 w-8" />
          </motion.div>
          <p className="text-[12px] text-secondary">Connect your wallet to create a document</p>
        </GlassCard>
      </FadeIn>
    );
  }
  if (ctx.showEditor) {
    return <EditorView ctx={ctx} />;
  }
  if (ctx.showPdfUpload) {
    return (
      <div className="mx-auto max-w-2xl">
        <Suspense fallback={<LoadingCard text="Loading PDF tools..." />}>
          <PdfUpload onComplete={ctx.handlePdfComplete} onCancel={ctx.resetToHome} />
        </Suspense>
      </div>
    );
  }
  return <HomeView ctx={ctx} />;
}

// ── Sub-views ──

function LoadingCard({ text }: { text: string }) {
  return (
    <GlassCard className="p-6 text-center">
      <motion.div
        className="inline-block h-4 w-4 rounded-full border border-[var(--accent-30)] border-t-[var(--accent)]"
        animate={{ rotate: 360 }}
        transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
      />
      <p className="mt-2 text-[11px] text-muted">{text}</p>
    </GlassCard>
  );
}

function EditorView({ ctx }: { ctx: ReturnType<typeof useCreateDocument> }) {
  return (
    <div className="fixed inset-0 top-12 z-30 bg-[var(--bg-surface)]">
      <Suspense fallback={<LoadingCard text="Loading editor..." />}>
        <DocumentEditor
          initialTitle={ctx.title}
          initialContent={ctx.content}
          initialSigners={ctx.signers.map((s) => ({
            label: s.label,
            email: s.email,
            phone: s.phone,
            role: s.role,
            signMethod: s.signMethod,
            tokenGates: s.tokenGates ?? null,
          }))}
          onSubmit={ctx.handleSubmit}
          onSaveTemplate={ctx.handleSaveTemplate}
          onBack={ctx.resetToHome}
        />
      </Suspense>
    </div>
  );
}

function HomeView({ ctx }: { ctx: ReturnType<typeof useCreateDocument> }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <CreateDocumentActions onUploadPdf={() => ctx.setShowPdfUpload(true)} onBlank={ctx.handleSelectBlank} />
      <DeliveryDefaults
        creatorEmail={ctx.creatorEmail}
        setCreatorEmail={ctx.setCreatorEmail}
        expiresInDays={ctx.expiresInDays}
        setExpiresInDays={ctx.setExpiresInDays}
        reminderCadence={ctx.reminderCadence}
        setReminderCadence={ctx.setReminderCadence}
        pdfStyleTemplateId={ctx.pdfStyleTemplateId}
        setPdfStyleTemplateId={ctx.setPdfStyleTemplateId}
        pdfStyleTemplates={ctx.pdfStyleTemplatesQuery.data ?? []}
        securityMode={ctx.securityMode}
        setSecurityMode={ctx.setSecurityMode}
        proofMode={ctx.proofMode}
        setProofMode={ctx.setProofMode}
        signingOrder={ctx.signingOrder}
        setSigningOrder={ctx.setSigningOrder}
        gazeTracking={ctx.gazeTracking}
        setGazeTracking={ctx.setGazeTracking}
        automationReviewMode={ctx.automationReviewMode}
        setAutomationReviewMode={ctx.setAutomationReviewMode}
        prepAutomationMode={ctx.prepAutomationMode}
        setPrepAutomationMode={ctx.setPrepAutomationMode}
        createError={ctx.createMutation.error?.message ?? null}
      />
      <TemplateSection ctx={ctx} />
    </div>
  );
}

function TemplateSection({ ctx }: { ctx: ReturnType<typeof useCreateDocument> }) {
  return (
    <FadeIn delay={0.12}>
      <button
        onClick={() => ctx.setShowTemplates(!ctx.showTemplates)}
        className="flex w-full items-center justify-center gap-2 py-1.5 text-[11px] text-muted transition-colors hover:text-secondary"
      >
        <FileText className="h-3 w-3" />
        <span>Or choose a template</span>
        <motion.span animate={{ rotate: ctx.showTemplates ? 180 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronDown className="h-3 w-3" />
        </motion.span>
      </button>
      <AnimatePresence>
        {ctx.showTemplates && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-3 pt-2">
              {ctx.savedTemplatesQuery.data?.length ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Saved Templates</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {ctx.savedTemplatesQuery.data.map((t) => (
                      <TemplateCard
                        key={t.id}
                        name={t.name}
                        subtitle={t.title}
                        description={t.description ?? undefined}
                        accent
                        onClick={() => ctx.handleSelectSavedTemplate(t)}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Built-in Templates</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {CONTRACT_TEMPLATES.map((t) => (
                    <TemplateCard
                      key={t.id}
                      name={t.name}
                      description={t.description}
                      onClick={() => ctx.handleSelectTemplate(t)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </FadeIn>
  );
}

function TemplateCard({
  name,
  subtitle,
  description,
  accent,
  onClick,
}: {
  name: string;
  subtitle?: string;
  description?: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      onClick={onClick}
      className={`edge-highlight group w-full rounded-lg border ${accent ? "border-[var(--border-accent)]" : "border-[var(--border)]"} bg-[var(--bg-card)] p-4 text-left`}
      whileHover={{ y: -1, boxShadow: "0 4px 20px var(--accent-glow)" }}
      whileTap={{ scale: 0.985 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
    >
      <h3 className="text-[12px] font-medium transition-colors group-hover:text-accent">{name}</h3>
      {subtitle ? <p className="mt-0.5 text-[10px] text-muted">{subtitle}</p> : null}
      {description ? <p className="mt-1 text-[10px] text-muted">{description}</p> : null}
    </motion.button>
  );
}

// CreatedSuccess is imported from use-create-document types but defined here for JSX
import { Check, Copy } from "lucide-react";
import { ScaleIn, W3SButton, W3SLink } from "../ui/motion";

function CreatedSuccess({
  created,
  copiedIdx,
  onCopy,
  onReset,
}: {
  created: CreatedResult;
  copiedIdx: number | null;
  onCopy: (url: string, idx: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ScaleIn>
        <GlassCard className="p-6 text-center">
          <motion.div
            className="mb-3 flex justify-center text-[var(--success)]"
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{
              type: "spring",
              stiffness: 200,
              damping: 15,
              delay: 0.1,
            }}
          >
            <Check className="h-8 w-8" />
          </motion.div>
          <h2 className="mb-1 text-lg font-semibold">Document Created</h2>
          <p className="text-[12px] text-secondary">Share each signer&apos;s unique link below.</p>
        </GlassCard>
      </ScaleIn>
      <FadeIn delay={0.15}>
        <GlassCard className="space-y-3 p-5">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">Signing Links</h3>
          <div className="space-y-2">
            {created.signerLinks.map((link, idx) => (
              <div key={idx} className="rounded-md border border-[var(--border)] bg-[var(--bg-inset)] p-3">
                <p className="mb-2 text-[12px] font-medium">{link.label}</p>
                <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                  <input
                    readOnly
                    value={link.signUrl}
                    className="flex-1 rounded-sm border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5 font-mono text-[10px] text-secondary outline-none"
                  />
                  <W3SButton
                    variant={copiedIdx === idx ? "accent-outline" : "primary"}
                    size="xs"
                    onClick={() => onCopy(link.signUrl, idx)}
                  >
                    {copiedIdx === idx ? (
                      <>
                        <Check className="h-2.5 w-2.5" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-2.5 w-2.5" /> Copy
                      </>
                    )}
                  </W3SButton>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </FadeIn>
      <FadeIn delay={0.25} className="flex flex-col justify-center gap-2 sm:flex-row">
        <W3SButton variant="secondary" size="md" onClick={onReset}>
          Create Another
        </W3SButton>
        <W3SLink href="/dashboard" variant="primary" size="md" className="text-center">
          View Dashboard
        </W3SLink>
      </FadeIn>
    </div>
  );
}
