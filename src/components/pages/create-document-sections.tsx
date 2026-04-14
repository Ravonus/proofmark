"use client";

import { motion } from "framer-motion";
import { Eye, FilePlus, FileUp, Globe, ListOrdered, Palette, Shield } from "lucide-react";
import type { CreateDocumentInput } from "~/lib/schemas/document";
import { SECURITY_MODE_DESCRIPTIONS, type SecurityMode } from "~/lib/signing/document-security";
import { FadeIn, GlassCard } from "../ui/motion";
import { Select } from "../ui/select";

type ReminderCadence = NonNullable<CreateDocumentInput["reminder"]>["cadence"];

export function CreateDocumentActions({ onUploadPdf, onBlank }: { onUploadPdf: () => void; onBlank: () => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <FadeIn delay={0.04}>
        <motion.button
          onClick={onUploadPdf}
          className="edge-highlight group h-full w-full rounded-lg border border-[var(--border-accent)] bg-[var(--bg-card)] p-5 text-left transition-colors"
          whileHover={{ y: -2, boxShadow: "0 8px 32px var(--accent-glow)" }}
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
      <FadeIn delay={0.08}>
        <motion.button
          onClick={onBlank}
          className="edge-highlight group h-full w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-5 text-left transition-colors"
          whileHover={{ y: -2, boxShadow: "0 8px 32px var(--accent-glow)" }}
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
  );
}

type DeliveryDefaultsProps = {
  creatorEmail: string;
  setCreatorEmail: (v: string) => void;
  expiresInDays: string;
  setExpiresInDays: (v: string) => void;
  reminderCadence: ReminderCadence;
  setReminderCadence: (v: ReminderCadence) => void;
  pdfStyleTemplateId: string;
  setPdfStyleTemplateId: (v: string) => void;
  pdfStyleTemplates: Array<{
    id: string;
    name: string;
    isDefault: boolean;
    description: string | null;
  }>;
  securityMode: SecurityMode;
  setSecurityMode: (v: SecurityMode) => void;
  proofMode: CreateDocumentInput["proofMode"];
  setProofMode: (v: CreateDocumentInput["proofMode"]) => void;
  signingOrder: CreateDocumentInput["signingOrder"];
  setSigningOrder: (v: CreateDocumentInput["signingOrder"]) => void;
  gazeTracking: CreateDocumentInput["gazeTracking"];
  setGazeTracking: (v: CreateDocumentInput["gazeTracking"]) => void;
  automationReviewMode: "FLAG" | "DENY" | "DISABLED";
  setAutomationReviewMode: (v: "FLAG" | "DENY" | "DISABLED") => void;
  prepAutomationMode: "ALLOW" | "FLAG";
  setPrepAutomationMode: (v: "ALLOW" | "FLAG") => void;
  createError: string | null;
};

function DeliveryBasicRow(p: DeliveryDefaultsProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <div>
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Creator Email</span>
        <input
          value={p.creatorEmail}
          onChange={(e) => p.setCreatorEmail(e.target.value)}
          placeholder="ops@company.com"
          className="w-full rounded-sm border border-[var(--border)] bg-[var(--bg-inset)] px-2.5 py-1.5 text-[12px] leading-[18px] outline-none transition-colors hover:border-[var(--border-accent)] focus:border-[var(--accent)]"
        />
      </div>
      <Select
        label="Expires In"
        value={p.expiresInDays}
        onChange={p.setExpiresInDays}
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
        value={p.reminderCadence}
        onChange={(v) => p.setReminderCadence(v as ReminderCadence)}
        options={[
          { value: "NONE", label: "No reminders" },
          { value: "DAILY", label: "Daily" },
          { value: "EVERY_2_DAYS", label: "Every 2 days" },
          { value: "EVERY_3_DAYS", label: "Every 3 days" },
          { value: "WEEKLY", label: "Weekly" },
        ]}
      />
    </div>
  );
}

function DeliverySecurityRow(p: DeliveryDefaultsProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Select
        label="PDF Style"
        value={p.pdfStyleTemplateId}
        onChange={p.setPdfStyleTemplateId}
        options={[
          {
            value: "",
            label: "Classic (default)",
            icon: <Palette className="h-3 w-3 text-purple-400" />,
          },
          ...p.pdfStyleTemplates.map((t) => ({
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
        value={p.securityMode}
        onChange={(v) => p.setSecurityMode(v as SecurityMode)}
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
  );
}

function DeliveryProofRow(p: DeliveryDefaultsProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <Select
        label="Proof Mode"
        value={p.proofMode}
        onChange={(v) => p.setProofMode(v as typeof p.proofMode)}
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
        value={p.signingOrder}
        onChange={(v) => p.setSigningOrder(v as typeof p.signingOrder)}
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
        value={p.gazeTracking}
        onChange={(v) => p.setGazeTracking(v as typeof p.gazeTracking)}
        options={[
          {
            value: "off",
            label: "Off",
            description: "No eye tracking required.",
          },
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
  );
}

function DeliveryAutomationRow(p: DeliveryDefaultsProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Select
        label="AI Automation Review"
        value={p.automationReviewMode}
        onChange={(v) => p.setAutomationReviewMode(v as typeof p.automationReviewMode)}
        options={[
          {
            value: "FLAG",
            label: "Flag suspicious",
            description: "Notify creator on suspicious automation.",
          },
          {
            value: "DENY",
            label: "Deny critical AI",
            description: "Block when final steps look automated.",
          },
          {
            value: "DISABLED",
            label: "Disabled",
            description: "No automation evaluation.",
          },
        ]}
      />
      <Select
        label="Admin Prep Automation"
        value={p.prepAutomationMode}
        onChange={(v) => p.setPrepAutomationMode(v as typeof p.prepAutomationMode)}
        options={[
          {
            value: "ALLOW",
            label: "Allow prep bots",
            description: "Permit mundane field prep.",
          },
          {
            value: "FLAG",
            label: "Flag prep bots",
            description: "Surface admin automation to creator.",
          },
        ]}
      />
    </div>
  );
}

export function DeliveryDefaults(p: DeliveryDefaultsProps) {
  return (
    <FadeIn delay={0.1}>
      <GlassCard className="space-y-4">
        <div>
          <h3 className="text-[13px] font-medium">Delivery Defaults</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            Set reminder cadence, expiration, and automation rules before editing.
          </p>
        </div>
        <DeliveryBasicRow {...p} />
        <DeliverySecurityRow {...p} />
        <DeliveryProofRow {...p} />
        <DeliveryAutomationRow {...p} />
        <div className="flex items-start justify-between gap-3 text-[10px] text-muted">
          <p>{SECURITY_MODE_DESCRIPTIONS[p.securityMode]}</p>
          {p.securityMode !== "HASH_ONLY" ? (
            <p className="max-w-xs text-right">Encrypted modes require the workspace encryption key.</p>
          ) : null}
        </div>
        {p.createError ? <p className="text-[11px] text-[var(--danger)]">{p.createError}</p> : null}
      </GlassCard>
    </FadeIn>
  );
}
