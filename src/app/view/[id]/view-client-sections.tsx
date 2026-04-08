"use client";

import {
  Check,
  CheckCircle,
  Clock,
  Copy,
  ExternalLink,
  FileDown,
  Globe,
  Hash,
  List,
  Play,
  ShieldCheck,
} from "lucide-react";
import { ForensicReplayPanel } from "~/components/forensic/forensic-replay-panel";
import { getBlockExplorerUrl } from "./view-client-helpers";

// ── Field Index Section ─────────────────────────────────────────────────────

export function FieldIndexSection({
  fieldSummary,
  sectionRef,
}: {
  fieldSummary: Array<{
    label: string;
    value: string;
    signer: string;
    type: string;
  }>;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  if (fieldSummary.length === 0) return null;
  const groups = new Map<string, typeof fieldSummary>();
  for (const e of fieldSummary) {
    const g = groups.get(e.signer) ?? [];
    g.push(e);
    groups.set(e.signer, g);
  }
  return (
    <section id="fields" ref={sectionRef} className="mt-12">
      <h2 className="mb-6 flex items-center gap-2 text-lg font-bold text-primary">
        <List className="h-5 w-5 text-accent" /> Field Value Index
      </h2>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-hover/30 border-b border-border">
              {["#", "Field", "Value", "Signer"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fieldSummary.map((entry, idx) => (
              <tr
                key={idx}
                className={`hover:bg-surface-hover/30 border-b border-[var(--border-subtle)] transition-colors ${idx % 2 === 0 ? "bg-surface-hover/10" : ""}`}
              >
                <td className="text-muted/50 px-4 py-2.5 font-mono text-xs">{idx + 1}</td>
                <td className="px-4 py-2.5 text-secondary">{entry.label}</td>
                <td className="px-4 py-2.5 font-medium text-primary">{entry.value}</td>
                <td className="px-4 py-2.5 text-muted">{entry.signer}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {groups.size > 1 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {[...groups.entries()].map(([signer, entries]) => (
            <div key={signer} className="rounded-xl border border-border bg-surface-card p-4">
              <h4 className="mb-3 text-xs font-bold text-secondary">{signer}&apos;s Fields</h4>
              <div className="space-y-2">
                {entries.map((e, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-2">
                    <span className="text-xs text-muted">{e.label}</span>
                    <span className="shrink-0 border-b border-dotted border-border text-xs font-medium text-secondary">
                      {e.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Signatures Section ──────────────────────────────────────────────────────

export function SignaturesSection({
  signers,
  sectionRef,
}: {
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
  }>;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  return (
    <section id="signatures" ref={sectionRef} className="mt-12">
      <h2 className="mb-6 flex items-center gap-2 text-lg font-bold text-primary">
        <ShieldCheck className="h-5 w-5 text-accent" /> Signatures
      </h2>
      <div className="space-y-4">
        {signers.map((signer) => {
          const signed = signer.status === "SIGNED";
          const explorerUrl = getBlockExplorerUrl(signer.chain, signer.address);
          return (
            <div key={signer.id} className="overflow-hidden rounded-xl border border-border bg-surface-card">
              <div className={`h-1 ${signed ? "bg-green-500/50" : "bg-amber-500/30"}`} />
              <div className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-full ${signed ? "bg-green-500/10" : "bg-amber-500/10"}`}
                    >
                      {signed ? (
                        <CheckCircle className="h-5 w-5 text-green-400" />
                      ) : (
                        <Clock className="h-5 w-5 text-amber-400" />
                      )}
                    </div>
                    <div>
                      <p className="font-semibold text-primary">{signer.label}</p>
                      {signer.address && (
                        <p className="flex items-center gap-1 font-mono text-xs text-muted">
                          {signer.chain ?? ""}
                          <span className="mx-1 text-border">|</span>
                          {signer.address.slice(0, 10)}...
                          {signer.address.slice(-8)}
                          {explorerUrl && (
                            <a
                              href={explorerUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-accent/60 hover:text-accent"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[10px] font-bold ${signed ? "bg-green-500/10 text-green-400" : "bg-amber-500/10 text-amber-400"}`}
                  >
                    {signer.status}
                  </span>
                </div>
                {signed && (
                  <div className="mt-4 space-y-3 border-t border-[var(--border-subtle)] pt-4">
                    <div className="grid grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-muted">Scheme</span>
                        <p className="font-mono text-secondary">{signer.scheme ?? "\u2014"}</p>
                      </div>
                      <div>
                        <span className="text-muted">Signed</span>
                        <p className="text-secondary">
                          {signer.signedAt
                            ? new Date(signer.signedAt).toLocaleString("en-US", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })
                            : "\u2014"}
                        </p>
                      </div>
                    </div>
                    {signer.signature && (
                      <div>
                        <span className="text-[10px] text-muted">Cryptographic Signature</span>
                        <p className="text-muted/60 mt-1 break-all font-mono text-[10px] leading-relaxed">
                          {signer.signature}
                        </p>
                      </div>
                    )}
                    {signer.handSignatureHash && (
                      <div>
                        <span className="text-[10px] text-muted">Ink Signature Hash</span>
                        <p className="text-muted/60 mt-1 font-mono text-[10px]">{signer.handSignatureHash}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Downloads Section ───────────────────────────────────────────────────────

export function DownloadsSection({
  reveal,
  documentId,
  sectionRef,
}: {
  reveal:
    | {
        downloads?: Array<{
          filename: string;
          label: string;
          description?: string;
        }>;
      }
    | null
    | undefined;
  documentId: string;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  if (!reveal?.downloads?.length) return null;
  return (
    <section id="downloads" ref={sectionRef} className="mt-12">
      <h2 className="mb-6 flex items-center gap-2 text-lg font-bold text-primary">
        <FileDown className="h-5 w-5 text-accent" /> Post-Sign Downloads
      </h2>
      <div className="space-y-3">
        {reveal.downloads.map((dl) => (
          <a
            key={dl.filename}
            href={`/api/download/${encodeURIComponent(dl.filename)}?documentId=${documentId}`}
            className="border-border/40 bg-card/60 hover:bg-card/80 flex items-center gap-4 rounded-xl border p-4 transition-colors"
            download
          >
            <div className="bg-accent/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-accent">
              <FileDown className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-primary">{dl.label}</p>
              {dl.description && <p className="truncate text-xs text-muted">{dl.description}</p>}
            </div>
            <span className="shrink-0 text-xs text-muted">{dl.filename.split(".").pop()?.toUpperCase()}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

// ── Verification Section ────────────────────────────────────────────────────

export function VerificationSection({
  contentHash,
  sectionRef,
}: {
  contentHash: string;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  return (
    <section id="verification" ref={sectionRef} className="mt-12">
      <h2 className="mb-6 flex items-center gap-2 text-lg font-bold text-primary">
        <Hash className="h-5 w-5 text-accent" /> Verification
      </h2>
      <VerificationCard contentHash={contentHash} />
    </section>
  );
}

function VerificationCard({ contentHash }: { contentHash: string }) {
  const [copiedHash, setCopiedHash] = React.useState(false);
  return (
    <div className="space-y-4 rounded-xl border border-border bg-surface-card p-6">
      <div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Content Hash (SHA-256)</span>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 break-all rounded-lg bg-surface-hover px-3 py-2 font-mono text-xs text-secondary">
            {contentHash}
          </code>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(contentHash);
              setCopiedHash(true);
              setTimeout(() => setCopiedHash(false), 2000);
            }}
            className="shrink-0 rounded-lg bg-surface-hover p-2 text-muted transition-colors hover:bg-surface-elevated hover:text-secondary"
          >
            {copiedHash ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Verify Online</span>
        <a
          href={`/verify/${contentHash}`}
          className="hover:text-accent/80 mt-2 flex items-center gap-2 text-sm text-accent transition-colors"
        >
          <Globe className="h-4 w-4" />
          {typeof window !== "undefined" ? window.location.origin : ""}/verify/
          {contentHash}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        This document was signed using cryptographic wallet signatures. Each signature is independently verifiable using
        the content hash and wallet address.
      </p>
    </div>
  );
}

import React from "react";

// ── Forensic Replay Section ─────────────────────────────────────────────────

export function ForensicReplaySection({
  documentId,
  sectionRef,
}: {
  documentId: string;
  sectionRef: (el: HTMLElement | null) => void;
}) {
  return (
    <section id="forensic-replay" ref={sectionRef} className="mt-12">
      <ForensicReplayPanel documentId={documentId} />
      <div className="mt-4 flex justify-end">
        <a
          href={`/replay/${documentId}`}
          className="bg-accent/15 hover:bg-accent/25 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium text-accent transition-colors"
        >
          <Play className="h-3.5 w-3.5" /> Open Full Replay <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </section>
  );
}
