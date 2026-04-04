"use client";

import { useState, useCallback, useRef, lazy, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "~/lib/trpc";
import { useWallet } from "./wallet-provider";
import { useConnectedIdentity } from "~/components/hooks/use-connected-identity";
import { CONTRACT_TEMPLATES, type ContractTemplate } from "~/lib/document/templates";
import { SECURITY_MODE_DESCRIPTIONS, type SecurityMode } from "~/lib/signing/document-security";
import type { SignerTokenGate } from "~/lib/token-gates";
import { FadeIn, ScaleIn, GlassCard, W3SButton, W3SLink } from "./ui/motion";
import { Select } from "./ui/select";
import {
  FileUp,
  FilePlus,
  ChevronDown,
  Check,
  Copy,
  Lock,
  FileText,
  Palette,
  Shield,
  Eye,
  ListOrdered,
  Globe,
} from "lucide-react";

const PdfUpload = lazy(() => import("./pdf-upload").then((m) => ({ default: m.PdfUpload })));
const DocumentEditor = lazy(() => import("./document-editor").then((m) => ({ default: m.DocumentEditor })));

type SignerField = {
  id?: string;
  type: string;
  label: string;
  value: string | null;
  required: boolean;
  options?: string[];
  settings?: Record<string, unknown>;
};
type SignerRow = {
  label: string;
  email: string;
  phone?: string;
  role?: "SIGNER" | "APPROVER" | "CC" | "WITNESS" | "OBSERVER";
  signMethod?: "WALLET" | "EMAIL_OTP";
  tokenGates?: SignerTokenGate | null;
  fields?: SignerField[];
};

const emptySigner = (): SignerRow => ({ label: "", email: "", phone: "", role: "SIGNER", tokenGates: null });

type CreatedResult = {
  id: string;
  signerLinks: Array<{ label: string; signUrl: string; embedUrl?: string }>;
};

export function CreateDocument() {
  const identity = useConnectedIdentity();
  const { connected, authenticated, address } = useWallet();
  const savedTemplatesQuery = trpc.account.listTemplates.useQuery(undefined, { enabled: identity.isSignedIn });
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [creatorEmail, setCreatorEmail] = useState("");
  const [signers, setSigners] = useState<SignerRow[]>([emptySigner(), emptySigner()]);
  const [created, setCreated] = useState<CreatedResult | null>(null);
  const [, setSelectedTemplate] = useState<ContractTemplate | null>(null);
  const [selectedSavedTemplateId, setSelectedSavedTemplateId] = useState<string | null>(null);
  const [expiresInDays, setExpiresInDays] = useState("30");
  const [reminderCadence, setReminderCadence] = useState<"NONE" | "DAILY" | "EVERY_2_DAYS" | "EVERY_3_DAYS" | "WEEKLY">(
    "EVERY_2_DAYS",
  );
  const [automationReviewMode, setAutomationReviewMode] = useState<"FLAG" | "DENY" | "DISABLED">("FLAG");
  const [prepAutomationMode, setPrepAutomationMode] = useState<"ALLOW" | "FLAG">("ALLOW");
  const [term] = useState("2 years");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [showPdfUpload, setShowPdfUpload] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [pdfStyleTemplateId, setPdfStyleTemplateId] = useState("");
  const [securityMode, setSecurityMode] = useState<SecurityMode>("HASH_ONLY");
  const [proofMode, setProofMode] = useState<"HYBRID" | "PRIVATE" | "CRYPTO_NATIVE">("HYBRID");
  const [signingOrder, setSigningOrder] = useState<"parallel" | "sequential">("parallel");
  const [gazeTracking, setGazeTracking] = useState<"off" | "full" | "signing_only">("off");

  const pdfStyleTemplatesQuery = trpc.account.listPdfStyleTemplates.useQuery(undefined, {
    enabled: identity.isSignedIn,
  });

  const lastGeneratedRef = useRef<string | null>(null);
  const initializedPdfStyleRef = useRef(false);

  const createMutation = trpc.document.create.useMutation({
    onSuccess: (data) =>
      setCreated({
        id: data.id,
        signerLinks: data.signerLinks,
      }),
  });
  const saveTemplateMutation = trpc.account.saveTemplate.useMutation({
    onSuccess: () => savedTemplatesQuery.refetch(),
  });

  const generateFromTemplate = useCallback(
    (template: ContractTemplate, currentSigners: SignerRow[]) => {
      const partyNames = currentSigners.map((s) => s.label.trim()).filter(Boolean);
      const effectiveDate = new Date().toISOString().split("T")[0] || "";
      const generated = template.content({
        partyNames: partyNames.length > 0 ? partyNames : ["Party A", "Party B"],
        effectiveDate,
        term,
      });
      setTitle(template.name);
      setContent(generated);
      lastGeneratedRef.current = template.id;
    },
    [term],
  );

  const handleSelectTemplate = (template: ContractTemplate) => {
    setSelectedTemplate(template);
    setSelectedSavedTemplateId(null);
    setShowTemplates(false);
    generateFromTemplate(template, signers);
    setShowEditor(true);
  };

  const handleSelectSavedTemplate = (template: NonNullable<typeof savedTemplatesQuery.data>[number]) => {
    setSelectedTemplate(null);
    setSelectedSavedTemplateId(template.id);
    setTitle(template.title);
    setContent(template.content);
    setSigners(
      template.signers.length > 0
        ? template.signers.map((signer) => ({
            label: signer.label,
            email: signer.email ?? "",
            phone: signer.phone ?? "",
            role: signer.role ?? "SIGNER",
            tokenGates: signer.tokenGates ?? null,
            fields: signer.fields?.map((f) => ({ ...f, type: f.type })),
          }))
        : [emptySigner(), emptySigner()],
    );
    setExpiresInDays(template.defaults?.expiresInDays ? String(template.defaults.expiresInDays) : "30");
    setReminderCadence(template.defaults?.reminder?.cadence ?? "EVERY_2_DAYS");
    setShowTemplates(false);
    setShowEditor(true);
  };

  const handleSelectBlank = () => {
    setSelectedTemplate(null);
    setSelectedSavedTemplateId(null);
    setShowTemplates(false);
    setTitle("");
    setContent("");
    lastGeneratedRef.current = null;
    setShowEditor(true);
  };

  const handlePdfComplete = (result: {
    title: string;
    content: string;
    signers: Array<{ label: string; email: string; phone?: string; fields?: SignerField[] }>;
  }) => {
    setTitle(result.title);
    setContent(result.content);
    setSigners(result.signers.length > 0 ? result.signers : [emptySigner(), emptySigner()]);
    setSelectedTemplate(null);
    setSelectedSavedTemplateId(null);
    setShowPdfUpload(false);
    setShowTemplates(false);
    setShowEditor(true);
    lastGeneratedRef.current = null;
  };

  const handleCopy = (url: string, idx: number) => {
    void navigator.clipboard.writeText(url);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  // Initialize PDF style from default template (runs once via ref guard)
  if (!initializedPdfStyleRef.current && identity.isSignedIn && !pdfStyleTemplatesQuery.isLoading) {
    initializedPdfStyleRef.current = true;
    const defaultTemplate = (pdfStyleTemplatesQuery.data ?? []).find((template) => template.isDefault);
    if (defaultTemplate) setPdfStyleTemplateId(defaultTemplate.id);
  }

  const resetToHome = () => {
    setCreated(null);
    setTitle("");
    setContent("");
    setSigners([emptySigner(), emptySigner()]);
    setShowTemplates(false);
    setShowPdfUpload(false);
    setShowEditor(false);
    setSelectedTemplate(null);
    setSelectedSavedTemplateId(null);
    lastGeneratedRef.current = null;
  };

  // ---- Created success state ------------------------------------------------

  if (created) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <ScaleIn>
          <GlassCard className="p-6 text-center">
            <motion.div
              className="mb-3 flex justify-center text-[var(--success)]"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.1 }}
            >
              <Check className="h-8 w-8" />
            </motion.div>
            <h2 className="mb-1 text-lg font-semibold">Document Created</h2>
            <p className="text-[12px] text-secondary">
              Share each signer&apos;s unique link below. They&apos;ll connect their wallet when they sign.
            </p>
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
                      onClick={() => handleCopy(link.signUrl, idx)}
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
          <W3SButton variant="secondary" size="md" onClick={resetToHome}>
            Create Another
          </W3SButton>
          <W3SLink href="/dashboard" variant="primary" size="md" className="text-center">
            View Dashboard
          </W3SLink>
        </FadeIn>
      </div>
    );
  }

  // ---- Not connected --------------------------------------------------------

  if (!connected) {
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

  // ---- Document Editor ------------------------------------------------------

  if (showEditor) {
    return (
      <div className="fixed inset-0 top-12 z-30 bg-[var(--bg-surface)]">
        <Suspense
          fallback={
            <GlassCard className="p-6 text-center">
              <motion.div
                className="border-[var(--accent)]/30 inline-block h-4 w-4 rounded-full border border-t-accent"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
              />
              <p className="mt-2 text-[11px] text-muted">Loading editor...</p>
            </GlassCard>
          }
        >
          <DocumentEditor
            initialTitle={title}
            initialContent={content}
            initialSigners={signers.map((s) => ({
              label: s.label,
              email: s.email,
              phone: s.phone,
              role: s.role,
              signMethod: s.signMethod,
              tokenGates: s.tokenGates ?? null,
            }))}
            onSubmit={(result) => {
              if (!connected || !authenticated || !address) return;
              createMutation.mutate({
                title: result.title,
                content: result.content,
                createdByEmail: creatorEmail || undefined,
                proofMode,
                signingOrder,
                gazeTracking: gazeTracking !== "off" ? gazeTracking : undefined,
                signers: result.signers.map((s) => ({
                  label: s.label,
                  email: s.email || undefined,
                  phone: s.phone || undefined,
                  role: s.role ?? "SIGNER",
                  signMethod: s.signMethod ?? (proofMode === "PRIVATE" ? "EMAIL_OTP" : "WALLET"),
                  tokenGates: s.tokenGates ?? undefined,
                  fields: s.fields?.length ? s.fields : undefined,
                  deliveryMethods: s.phone?.trim() ? ["EMAIL", "SMS"] : ["EMAIL"],
                })),
                templateId: selectedSavedTemplateId || undefined,
                pdfStyleTemplateId:
                  pdfStyleTemplateId && !pdfStyleTemplateId.startsWith("__") ? pdfStyleTemplateId : undefined,
                securityMode,
                expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
                reminder:
                  reminderCadence === "NONE"
                    ? undefined
                    : {
                        cadence: reminderCadence,
                        channels: result.signers.some((signer) => signer.phone?.trim()) ? ["EMAIL", "SMS"] : ["EMAIL"],
                      },
                automationPolicy:
                  automationReviewMode === "DISABLED"
                    ? {
                        enabled: false,
                        onPreparationAutomation: prepAutomationMode,
                        onCriticalAutomation: "FLAG",
                        notifyCreator: false,
                        requireHumanSteps: ["signature", "consent", "final_submit", "wallet_auth"],
                      }
                    : {
                        enabled: true,
                        onPreparationAutomation: prepAutomationMode,
                        onCriticalAutomation: automationReviewMode,
                        notifyCreator: true,
                        requireHumanSteps: ["signature", "consent", "final_submit", "wallet_auth"],
                      },
              });
            }}
            onSaveTemplate={(result) => {
              const name = window.prompt("Template name", result.title);
              if (!name) return;
              saveTemplateMutation.mutate({
                name,
                title: result.title,
                description: selectedSavedTemplateId ? "Updated from editor" : "Saved from editor",
                content: result.content,
                signers: result.signers.map((signer) => ({
                  label: signer.label,
                  email: signer.email || undefined,
                  phone: signer.phone || undefined,
                  role: signer.role ?? "SIGNER",
                  tokenGates: signer.tokenGates ?? undefined,
                  deliveryMethods: signer.phone?.trim() ? ["EMAIL", "SMS"] : ["EMAIL"],
                  fields: signer.fields?.length ? signer.fields : [],
                })),
                defaults: {
                  expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
                  reminder:
                    reminderCadence === "NONE"
                      ? undefined
                      : {
                          cadence: reminderCadence,
                          channels: result.signers.some((signer) => signer.phone?.trim())
                            ? ["EMAIL", "SMS"]
                            : ["EMAIL"],
                        },
                },
              });
            }}
            onBack={resetToHome}
          />
        </Suspense>
      </div>
    );
  }

  // ---- PDF Upload flow ------------------------------------------------------

  if (showPdfUpload) {
    return (
      <div className="mx-auto max-w-2xl">
        <Suspense
          fallback={
            <GlassCard className="p-6 text-center">
              <motion.div
                className="border-[var(--accent)]/30 inline-block h-4 w-4 rounded-full border border-t-accent"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
              />
              <p className="mt-2 text-[11px] text-muted">Loading PDF tools...</p>
            </GlassCard>
          }
        >
          <PdfUpload onComplete={handlePdfComplete} onCancel={resetToHome} />
        </Suspense>
      </div>
    );
  }

  // ---- Home: two prominent options + collapsible templates ------------------

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* Upload PDF */}
        <FadeIn delay={0.04}>
          <motion.button
            onClick={() => setShowPdfUpload(true)}
            className="edge-highlight group h-full w-full rounded-lg border border-[var(--border-accent)] bg-[var(--bg-card)] p-5 text-left transition-colors"
            whileHover={{
              y: -2,
              boxShadow: "0 8px 32px var(--accent-glow)",
            }}
            whileTap={{ scale: 0.985 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--border-accent)] bg-[var(--accent-subtle)]">
                <FileUp className="h-4 w-4 text-accent" />
              </div>
              <div>
                <h3 className="text-[13px] font-medium transition-colors group-hover:text-accent">Upload PDF</h3>
                <p className="mt-0.5 text-[11px] text-muted">Auto-detect signers and fields</p>
              </div>
            </div>
          </motion.button>
        </FadeIn>

        {/* Start Blank Document */}
        <FadeIn delay={0.08}>
          <motion.button
            onClick={handleSelectBlank}
            className="edge-highlight group h-full w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 text-left transition-colors"
            whileHover={{
              y: -2,
              boxShadow: "0 8px 32px var(--accent-glow)",
            }}
            whileTap={{ scale: 0.985 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-[var(--border)] bg-[var(--bg-inset)]">
                <FilePlus className="h-4 w-4 text-accent" />
              </div>
              <div>
                <h3 className="text-[13px] font-medium transition-colors group-hover:text-accent">Blank Document</h3>
                <p className="mt-0.5 text-[11px] text-muted">Write your own agreement</p>
              </div>
            </div>
          </motion.button>
        </FadeIn>
      </div>

      <FadeIn delay={0.1}>
        <GlassCard className="space-y-4">
          <div>
            <h3 className="text-[13px] font-medium">Delivery Defaults</h3>
            <p className="mt-0.5 text-[11px] text-muted">
              Set reminder cadence, expiration, and automation rules before editing.
            </p>
          </div>
          {/* Row 1: Creator email + basic delivery settings */}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1">
              <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Creator Email</span>
              <input
                value={creatorEmail}
                onChange={(event) => setCreatorEmail(event.target.value)}
                placeholder="ops@company.com"
                className="w-full rounded-sm border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-1.5 text-[12px] outline-none transition-colors focus:border-[var(--accent)]"
              />
            </label>
            <Select
              label="Expires In"
              value={expiresInDays}
              onChange={setExpiresInDays}
              options={[
                { value: "7", label: "7 days" },
                { value: "14", label: "14 days" },
                { value: "30", label: "30 days" },
                { value: "60", label: "60 days" },
                { value: "90", label: "90 days" },
              ]}
            />
            <Select
              label="Reminder Cadence"
              value={reminderCadence}
              onChange={(v) => setReminderCadence(v as typeof reminderCadence)}
              options={[
                { value: "NONE", label: "No reminders" },
                { value: "DAILY", label: "Daily" },
                { value: "EVERY_2_DAYS", label: "Every 2 days" },
                { value: "EVERY_3_DAYS", label: "Every 3 days" },
                { value: "WEEKLY", label: "Weekly" },
              ]}
            />
          </div>
          {/* Row 2: Style & security */}
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="PDF Style"
              value={pdfStyleTemplateId}
              onChange={setPdfStyleTemplateId}
              options={[
                { value: "", label: "Classic (default)", icon: <Palette className="h-3 w-3 text-purple-400" /> },
                ...(pdfStyleTemplatesQuery.data ?? []).map((t) => ({
                  value: t.id,
                  label: t.isDefault ? `${t.name} (Default)` : t.name,
                  description: t.description ?? undefined,
                  icon: <Palette className="h-3 w-3 text-blue-400" />,
                })),
                {
                  value: "__modern",
                  label: "Modern",
                  description: "Blue accent, full header/footer",
                  icon: <Palette className="h-3 w-3 text-blue-400" />,
                },
                {
                  value: "__legal",
                  label: "Legal",
                  description: "Navy tone, larger body text",
                  icon: <Palette className="h-3 w-3 text-slate-400" />,
                },
                {
                  value: "__minimal",
                  label: "Minimal",
                  description: "Clean, no extras",
                  icon: <Palette className="h-3 w-3 text-gray-400" />,
                },
              ]}
            />
            <Select
              label="Security Mode"
              value={securityMode}
              onChange={(value) => setSecurityMode(value as SecurityMode)}
              options={[
                {
                  value: "HASH_ONLY",
                  label: "SHA-256 only",
                  description: "Public proof uses the document hash only.",
                  icon: <Shield className="h-3 w-3 text-emerald-400" />,
                },
                {
                  value: "ENCRYPTED_PRIVATE",
                  label: "Encrypted storage",
                  description: "Encrypt at rest, keep SHA-256 as public proof.",
                  icon: <Shield className="h-3 w-3 text-amber-400" />,
                },
                {
                  value: "ENCRYPTED_IPFS",
                  label: "Encrypted + IPFS",
                  description: "Encrypt + IPFS CID for encrypted payload.",
                  icon: <Shield className="h-3 w-3 text-blue-400" />,
                },
              ]}
            />
          </div>
          {/* Row 3: Document mode & signing order */}
          <div className="grid gap-2 sm:grid-cols-3">
            <Select
              label="Proof Mode"
              value={proofMode}
              onChange={(value) => setProofMode(value as typeof proofMode)}
              options={[
                {
                  value: "HYBRID",
                  label: "Hybrid (default)",
                  description: "Email or wallet signing, on-chain hash.",
                  icon: <Globe className="h-3 w-3 text-blue-400" />,
                },
                {
                  value: "PRIVATE",
                  label: "Private (Web2)",
                  description: "Email signing only, off-chain audit.",
                  icon: <Globe className="h-3 w-3 text-slate-400" />,
                },
                {
                  value: "CRYPTO_NATIVE",
                  label: "Crypto Native",
                  description: "Wallet only, on-chain storage.",
                  icon: <Globe className="h-3 w-3 text-emerald-400" />,
                },
              ]}
            />
            <Select
              label="Signing Order"
              value={signingOrder}
              onChange={(value) => setSigningOrder(value as typeof signingOrder)}
              options={[
                {
                  value: "parallel",
                  label: "Parallel",
                  description: "All signers can sign at the same time.",
                  icon: <ListOrdered className="h-3 w-3 text-blue-400" />,
                },
                {
                  value: "sequential",
                  label: "Sequential",
                  description: "Signers must sign in order.",
                  icon: <ListOrdered className="h-3 w-3 text-amber-400" />,
                },
              ]}
            />
            <Select
              label="Forensic Eye Tracking"
              value={gazeTracking}
              onChange={(value) => setGazeTracking(value as typeof gazeTracking)}
              options={[
                { value: "off", label: "Off", description: "No eye tracking required." },
                {
                  value: "full",
                  label: "Full document",
                  description: "Track gaze while reading and signing.",
                  icon: <Eye className="h-3 w-3 text-emerald-400" />,
                },
                {
                  value: "signing_only",
                  label: "Signing only",
                  description: "Track gaze during signature step only.",
                  icon: <Eye className="h-3 w-3 text-amber-400" />,
                },
              ]}
            />
          </div>
          {/* Row 4: Automation policies */}
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="AI Automation Review"
              value={automationReviewMode}
              onChange={(value) => setAutomationReviewMode(value as typeof automationReviewMode)}
              options={[
                { value: "FLAG", label: "Flag suspicious", description: "Notify creator on suspicious automation." },
                { value: "DENY", label: "Deny critical AI", description: "Block when final steps look automated." },
                { value: "DISABLED", label: "Disabled", description: "No automation evaluation." },
              ]}
            />
            <Select
              label="Admin Prep Automation"
              value={prepAutomationMode}
              onChange={(value) => setPrepAutomationMode(value as typeof prepAutomationMode)}
              options={[
                { value: "ALLOW", label: "Allow prep bots", description: "Permit mundane field prep." },
                { value: "FLAG", label: "Flag prep bots", description: "Surface admin automation to creator." },
              ]}
            />
          </div>
          <div className="flex items-start justify-between gap-3 text-[10px] text-muted">
            <p>{SECURITY_MODE_DESCRIPTIONS[securityMode]}</p>
            {securityMode !== "HASH_ONLY" ? (
              <p className="max-w-xs text-right">Encrypted modes require the workspace encryption key.</p>
            ) : null}
          </div>
          {createMutation.error ? (
            <p className="text-[11px] text-[var(--danger)]">{createMutation.error.message}</p>
          ) : null}
        </GlassCard>
      </FadeIn>

      {/* Collapsible template section */}
      <FadeIn delay={0.12}>
        <button
          onClick={() => setShowTemplates(!showTemplates)}
          className="flex w-full items-center justify-center gap-2 py-1.5 text-[11px] text-muted transition-colors hover:text-secondary"
        >
          <FileText className="h-3 w-3" />
          <span>Or choose a template</span>
          <motion.span animate={{ rotate: showTemplates ? 180 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronDown className="h-3 w-3" />
          </motion.span>
        </button>

        <AnimatePresence>
          {showTemplates && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              <div className="space-y-3 pt-2">
                {savedTemplatesQuery.data?.length ? (
                  <div className="space-y-2">
                    <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Saved Templates</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {savedTemplatesQuery.data.map((template) => (
                        <motion.button
                          key={template.id}
                          onClick={() => handleSelectSavedTemplate(template)}
                          className="edge-highlight group w-full rounded-lg border border-[var(--border-accent)] bg-[var(--bg-card)] p-4 text-left"
                          whileHover={{
                            y: -1,
                            boxShadow: "0 4px 20px var(--accent-glow)",
                          }}
                          whileTap={{ scale: 0.985 }}
                          transition={{ type: "spring", stiffness: 400, damping: 25 }}
                        >
                          <h3 className="text-[12px] font-medium transition-colors group-hover:text-accent">
                            {template.name}
                          </h3>
                          <p className="mt-0.5 text-[10px] text-muted">{template.title}</p>
                          {template.description ? (
                            <p className="mt-1 text-[10px] text-muted">{template.description}</p>
                          ) : null}
                        </motion.button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="space-y-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Built-in Templates</p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {CONTRACT_TEMPLATES.map((template) => (
                      <motion.button
                        key={template.id}
                        onClick={() => handleSelectTemplate(template)}
                        className="edge-highlight group w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-4 text-left"
                        whileHover={{
                          y: -1,
                          boxShadow: "0 4px 20px var(--accent-glow)",
                        }}
                        whileTap={{ scale: 0.985 }}
                        transition={{ type: "spring", stiffness: 400, damping: 25 }}
                      >
                        <h3 className="text-[12px] font-medium transition-colors group-hover:text-accent">
                          {template.name}
                        </h3>
                        <p className="mt-1 text-[10px] text-muted">{template.description}</p>
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </FadeIn>
    </div>
  );
}
