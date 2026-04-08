"use client";

import { motion } from "framer-motion";
import { Check, CheckCircle, FileDown, FileSignature, ShieldCheck } from "lucide-react";
import Link from "next/link";
import {
  isFieldVisible,
  resolveFieldBadge,
  resolveFieldLogo,
  resolveFieldPrefix,
  resolveFieldSuffix,
} from "~/lib/document/field-runtime";
import { isImageDataUrl } from "~/lib/document/field-values";
import type { DocToken, SignerInfo } from "./sign-document-helpers";
import { getFieldDisplayText, getFieldMinWidth, getFieldVisualStyle } from "./sign-document-helpers";
import { DocumentHeader, SignerList } from "./sign-document-parts";

// ─── Finalization View ──────────────────────────────────────────────────────

export function FinalizeView({
  doc,
  signedCount,
  totalRecipients,
  signingError,
  clearSigningError,
  signing,
  connected,
  groupId,
  handleFinalize,
  handleBulkFinalize,
}: {
  doc: { title: string; status: string; signers: SignerInfo[] };
  signedCount: number;
  totalRecipients: number;
  signingError: string | null;
  clearSigningError: () => void;
  signing: boolean;
  connected: boolean;
  groupId: string | null;
  handleFinalize: () => void;
  handleBulkFinalize: () => void;
}) {
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <DocumentHeader doc={doc} signedCount={signedCount} totalRecipients={totalRecipients} />

      {signingError && (
        <div className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          <span>{signingError}</span>
          <button onClick={clearSigningError} className="ml-3 text-red-400/60 hover:text-red-400">
            Dismiss
          </button>
        </div>
      )}

      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="space-y-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 backdrop-blur-sm"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/15">
            <CheckCircle className="h-6 w-6 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-primary">All parties have signed</h2>
            <p className="text-sm text-secondary">Your final wallet signature is needed to close this contract.</p>
          </div>
        </div>

        <p className="text-sm leading-relaxed text-secondary">
          All other signers have completed their signatures. Your finalization signature cryptographically covers the
          entire completed document — proving you reviewed and approved the final version with everyone&apos;s
          information included.
        </p>

        <div className="flex gap-3 pt-2">
          <button
            onClick={groupId ? handleBulkFinalize : handleFinalize}
            disabled={!connected || signing}
            className="shadow-accent/25 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-white shadow-lg transition-all hover:brightness-110 disabled:opacity-50"
          >
            {signing ? "Signing..." : groupId ? "Finalize All Contracts" : "Finalize Contract"}
          </button>
        </div>

        {!connected && <p className="text-xs text-amber-400">Connect your wallet to finalize.</p>}
      </motion.div>
    </div>
  );
}

// ─── Read-only document body for done/signed state ──────────────────────────

function ReadOnlyFieldToken({
  token,
  allFieldValues,
}: {
  token: DocToken & { kind: "field" };
  allFieldValues: Record<string, string>;
}) {
  if (!isFieldVisible(token.field, allFieldValues)) return null;
  const val = allFieldValues[token.field.id];
  if (token.field.type === "signature" && isImageDataUrl(val)) {
    return (
      <span className="mx-1 inline-flex flex-col align-middle">
        <span className="mb-1 text-[9px] font-medium uppercase tracking-wider text-emerald-400/70">
          {token.field.label}
        </span>
        <span className="inline-block rounded-md border border-black/10 bg-[var(--sig-bg)] px-3 py-2 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL signature, not a remote image */}
          <img src={val} alt={`${token.field.label} signature`} className="sig-theme-img h-10 w-auto object-contain" />
        </span>
      </span>
    );
  }
  const s = getFieldVisualStyle(token.field);
  const badge = resolveFieldBadge(token.field, val);
  const logo = resolveFieldLogo(token.field, val);
  const prefix = resolveFieldPrefix(token.field);
  const suffix = resolveFieldSuffix(token.field);
  return (
    <span className="mx-0.5 my-1 inline-block align-baseline">
      <span
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 ${val ? s.border + " " + s.bg : "bg-surface-hover/20 border-border"}`}
        style={{ minWidth: getFieldMinWidth(token.field) }}
      >
        <span className={`shrink-0 text-[9px] font-medium uppercase tracking-wider ${val ? s.text : "text-muted"}`}>
          {token.field.label}
        </span>
        {logo && <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted">{logo}</span>}
        {badge && (
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted">{badge}</span>
        )}
        {prefix && <span className="text-xs text-muted">{prefix}</span>}
        <span
          className={`text-sm ${val ? "font-medium text-primary" : "text-muted/50 italic"}`}
          style={{ fontFamily: "'Georgia', serif" }}
        >
          {getFieldDisplayText(token.field, val)}
        </span>
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
        {val && <CheckCircle className="h-3 w-3 shrink-0 text-green-400" />}
      </span>
    </span>
  );
}

function ReadOnlySignatureBlock({
  token,
  signers,
}: {
  token: DocToken & { kind: "signatureBlock" };
  signers: SignerInfo[];
}) {
  const signerForBlock = signers[token.signerIdx];
  const hasSigned = signerForBlock?.status === "SIGNED";
  const signatureImage = (signerForBlock as { handSignatureData?: string })?.handSignatureData;

  if (hasSigned && signatureImage && isImageDataUrl(signatureImage)) {
    return (
      <div className="pb-2 pt-8">
        <p className="mb-3 text-xs uppercase tracking-wider text-muted">{token.label} Signature</p>
        <div className="inline-block rounded-md border border-black/10 bg-[var(--sig-bg)] px-3 py-2 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL signature, not a remote image */}
          <img
            src={signatureImage}
            alt={`${signerForBlock.label} signature`}
            className="sig-theme-img h-12 w-auto object-contain"
          />
        </div>
      </div>
    );
  }
  if (hasSigned) {
    return (
      <div className="pb-2 pt-8">
        <p className="mb-3 text-xs uppercase tracking-wider text-muted">{token.label} Signature</p>
        <div className="inline-flex items-center gap-2 text-sm text-green-400/80">
          <Check className="h-4 w-4" /> Signed by {signerForBlock?.label}
          {signerForBlock?.signedAt && (
            <span className="text-[10px] text-muted">({new Date(signerForBlock.signedAt).toLocaleDateString()})</span>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="pb-2 pt-8">
      <p className="mb-3 text-xs uppercase tracking-wider text-muted">{token.label} Signature</p>
      <div className="inline-block h-8 w-48 border-b-2 border-border" />
    </div>
  );
}

export function ReadOnlyDocumentTokens({
  tokens,
  allFieldValues,
  signers,
  contentHash,
  isCompleted,
}: {
  tokens: DocToken[];
  allFieldValues: Record<string, string>;
  signers: SignerInfo[];
  contentHash?: string;
  isCompleted: boolean;
}) {
  return (
    <div
      className="space-y-1 px-8 py-10 sm:px-14 sm:py-14"
      style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
    >
      {tokens.map((token, i) => {
        switch (token.kind) {
          case "heading":
            return (
              <div key={i} className="pb-2 pt-8">
                <h3 className="text-base font-bold text-primary">{token.text}</h3>
              </div>
            );
          case "subheading":
            return (
              <h4
                key={i}
                className="pb-2 pt-8 text-sm font-bold uppercase tracking-widest text-secondary"
                style={{ letterSpacing: "0.15em" }}
              >
                {token.text}
              </h4>
            );
          case "text":
            return (
              <span key={i} className="text-sm leading-relaxed text-secondary">
                {token.text}{" "}
              </span>
            );
          case "break":
            return <div key={i} className="h-3" />;
          case "listItem":
            return <div key={i} className="pl-6 pt-1" />;
          case "field":
            return (
              <ReadOnlyFieldToken
                key={token.field.id}
                token={token as DocToken & { kind: "field" }}
                allFieldValues={allFieldValues}
              />
            );
          case "signatureBlock":
            return (
              <ReadOnlySignatureBlock
                key={i}
                token={token as DocToken & { kind: "signatureBlock" }}
                signers={signers}
              />
            );
          default:
            return null;
        }
      })}

      {isCompleted && contentHash && (
        <div className="mt-8 border-t border-border pt-10">
          <p className="text-muted/60 font-mono text-[10px]">Document SHA-256: {contentHash}</p>
        </div>
      )}
    </div>
  );
}

// ─── Done / Already Signed View ─────────────────────────────────────────────

export function DoneView({
  doc,
  documentId,
  claimToken,
  address,
  signedCount,
  totalRecipients,
  done,
  tokens,
  allFieldValues,
}: {
  doc: {
    title: string;
    status: string;
    signers: SignerInfo[];
    contentHash: string;
    postSignReveal?: unknown;
    id?: string;
  };
  documentId: string;
  claimToken: string | null;
  address: string | null;
  signedCount: number;
  totalRecipients: number;
  done: boolean;
  tokens: DocToken[];
  allFieldValues: Record<string, string>;
}) {
  const pdfUrl = claimToken
    ? `/api/pdf/${documentId}?claim=${claimToken}`
    : address
      ? `/api/pdf/${documentId}?address=${address}`
      : null;

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8">
      <DocumentHeader doc={doc} signedCount={signedCount} totalRecipients={totalRecipients} />

      {/* Status banner */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="space-y-4 rounded-2xl border border-green-500/20 bg-green-500/5 p-6 backdrop-blur-sm"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", delay: 0.2 }}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/15"
            >
              <CheckCircle className="h-6 w-6 text-green-400" />
            </motion.div>
            <div>
              <p className="font-semibold text-green-400">
                {doc.status === "COMPLETED"
                  ? "All Parties Have Signed"
                  : done
                    ? "Signature Recorded!"
                    : "You've Already Signed"}
              </p>
              <p className="text-xs text-muted">Signatures are cryptographically bound to this document.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {pdfUrl && (
              <a
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-accent/15 hover:bg-accent/25 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-accent transition-colors"
              >
                <FileDown className="h-3.5 w-3.5" /> Download PDF
              </a>
            )}
            <Link
              href={`/view/${documentId}${claimToken ? `?claim=${claimToken}` : ""}`}
              className="bg-accent/10 hover:bg-accent/20 inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium text-accent transition-colors"
            >
              <FileSignature className="h-3.5 w-3.5" /> View Online
            </Link>
            <Link
              href={`/verify/${doc.contentHash}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-surface-hover px-4 py-2 text-xs font-medium text-secondary transition-colors hover:bg-surface-elevated"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Verify
            </Link>
            {doc.status === "COMPLETED" && (
              <a
                href={`/api/proof-packet/${documentId}?address=${address ?? ""}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-surface-hover px-4 py-2 text-xs font-medium text-secondary transition-colors hover:bg-surface-elevated"
              >
                <FileDown className="h-3.5 w-3.5" /> Evidence Bundle
              </a>
            )}
          </div>
        </div>
        {!!doc.postSignReveal && (
          <Link
            href={`/reveal/${documentId}`}
            className="inline-block rounded-lg bg-accent px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
          >
            View Project Details &rarr;
          </Link>
        )}
      </motion.div>

      {/* Full document with filled-in fields */}
      <div className="relative">
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
          <ReadOnlyDocumentTokens
            tokens={tokens}
            allFieldValues={allFieldValues}
            signers={doc.signers}
            contentHash={doc.contentHash}
            isCompleted={doc.status === "COMPLETED"}
          />
        </div>
      </div>

      <SignerList signers={doc.signers} currentAddress={address} />
    </div>
  );
}

// Token gate, modals, and confirm dialog are in sign-document-modals.tsx
