"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { trpc } from "~/lib/trpc";
import { useWallet } from "~/components/wallet-provider";
import { isImageDataUrl } from "~/lib/field-values";
import { tokenizeDocument, type DocToken } from "~/lib/document-tokens";
import { getFieldDisplayText, getFieldVisualStyle } from "~/components/sign-document-helpers";
import {
  FileDown,
  ShieldCheck,
  CheckCircle,
  Clock,
  XCircle,
  List,
  FileSignature,
  Hash,
  Globe,
  Copy,
  Check,
  Printer,
  ExternalLink,
  ChevronUp,
  Play,
} from "lucide-react";
import { ForensicReplayPanel } from "~/components/forensic/forensic-replay-panel";
import { ThemeToggle } from "~/components/theme-toggle";

type Props = { documentId: string };

export function ViewDocumentClient({ documentId }: Props) {
  const { address } = useWallet();
  const claimToken = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("claim") : null;

  const docQuery = trpc.document.get.useQuery(
    { id: documentId, claimToken: claimToken ?? undefined },
    { refetchOnWindowFocus: false },
  );

  const doc = docQuery.data;
  const [activeSection, setActiveSection] = useState("content");
  const [copiedHash, setCopiedHash] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const tokens = useMemo(() => {
    if (!doc) return [];
    const { tokens: t } = tokenizeDocument(doc.content, doc.signers.length);
    return t;
  }, [doc]);

  // Build field values from all signers
  const allFieldValues = useMemo(() => {
    if (!doc) return {} as Record<string, string>;
    const vals: Record<string, string> = {};
    for (const s of doc.signers) {
      if (s.fieldValues) {
        for (const [k, v] of Object.entries(s.fieldValues)) {
          if (v) vals[k] = v;
        }
      }
    }
    return vals;
  }, [doc]);

  // Build field summary for the index
  const fieldSummary = useMemo(() => {
    if (!doc) return [];
    const { fields } = tokenizeDocument(doc.content, doc.signers.length);
    const entries: Array<{ label: string; value: string; signer: string; type: string }> = [];
    for (const f of fields) {
      for (const s of doc.signers) {
        const val = s.fieldValues?.[f.id];
        if (val) {
          entries.push({ label: f.label, value: getFieldDisplayText(f, val), signer: s.label, type: f.type });
        }
      }
    }
    return entries;
  }, [doc]);

  const signedCount = doc?.signers.filter((s) => s.status === "SIGNED").length ?? 0;
  const allSigned = doc ? doc.signers.every((s) => s.status === "SIGNED") : false;
  const isCreatorViewer = !!(doc && doc.createdBy.toLowerCase() === address?.toLowerCase());

  // Scroll spy
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );

    for (const el of Object.values(sectionRefs.current)) {
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [doc]);

  const pdfUrl = claimToken
    ? `/api/pdf/${documentId}?claim=${claimToken}`
    : address
      ? `/api/pdf/${documentId}?address=${address}`
      : null;

  if (docQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!doc) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <p className="text-muted">Document not found or access denied.</p>
      </div>
    );
  }

  const tocItems = [
    { id: "content", label: "Document", icon: <FileSignature className="h-3.5 w-3.5" /> },
    ...(fieldSummary.length > 0
      ? [{ id: "fields", label: "Field Index", icon: <List className="h-3.5 w-3.5" /> }]
      : []),
    { id: "signatures", label: "Signatures", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
    ...(isCreatorViewer
      ? [{ id: "forensic-replay", label: "Forensic Replay", icon: <Play className="h-3.5 w-3.5" /> }]
      : []),
    { id: "verification", label: "Verification", icon: <Hash className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="min-h-screen bg-surface">
      {/* ── Top bar ── */}
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
            <span className="max-w-xs truncate text-sm font-medium text-secondary">{doc.title}</span>
            {allSigned ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2.5 py-0.5 text-[10px] font-bold text-green-400">
                <CheckCircle className="h-3 w-3" /> SIGNED
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-400">
                <Clock className="h-3 w-3" /> {signedCount}/{doc.signers.length}
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
              href={`/verify/${doc.contentHash}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-surface-hover px-3 py-1.5 text-xs text-secondary transition-colors hover:bg-surface-elevated"
            >
              <ShieldCheck className="h-3.5 w-3.5" /> Verify
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-7xl gap-0">
        {/* ── Sidebar TOC ── */}
        <aside className="sticky top-14 hidden h-[calc(100vh-56px)] w-56 shrink-0 overflow-y-auto border-r border-[var(--border-subtle)] p-4 lg:block">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted">Contents</p>
          <nav className="space-y-1">
            {tocItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  sectionRefs.current[item.id]?.scrollIntoView({ behavior: "smooth", block: "start" });
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

          {/* Signer status */}
          <div className="mt-6 space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted">Signers</p>
            {doc.signers.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs">
                {s.status === "SIGNED" ? (
                  <CheckCircle className="h-3 w-3 text-green-400" />
                ) : s.status === "DECLINED" ? (
                  <XCircle className="h-3 w-3 text-red-400" />
                ) : (
                  <Clock className="h-3 w-3 text-amber-400" />
                )}
                <span className="truncate text-secondary">{s.label}</span>
              </div>
            ))}
          </div>
        </aside>

        {/* ── Main content ── */}
        <main className="min-w-0 flex-1 px-6 py-10 sm:px-12 lg:px-16">
          {/* ═══ Document Content ═══ */}
          <section
            id="content"
            ref={(el) => {
              sectionRefs.current.content = el;
            }}
          >
            {/* Document body */}
            <div
              className="overflow-hidden rounded-2xl border border-border"
              style={{
                background: "var(--doc-paper)",
                boxShadow: "var(--doc-paper-shadow)",
              }}
            >
              <div
                className="h-px"
                style={{ background: "linear-gradient(90deg, transparent, var(--accent), transparent)" }}
              />
              <div
                className="space-y-1 px-8 py-10 sm:px-14 sm:py-14"
                style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
              >
                {tokens.map((token, i) => renderToken(token, i, doc.signers, allFieldValues))}
              </div>
            </div>
          </section>

          {/* ═══ Field Value Index ═══ */}
          {fieldSummary.length > 0 && (
            <section
              id="fields"
              ref={(el) => {
                sectionRefs.current.fields = el;
              }}
              className="mt-12"
            >
              <h2 className="mb-6 flex items-center gap-2 text-lg font-bold text-primary">
                <List className="h-5 w-5 text-accent" /> Field Value Index
              </h2>

              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-hover/30 border-b border-border">
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                        #
                      </th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                        Field
                      </th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                        Value
                      </th>
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-wider text-muted">
                        Signer
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {fieldSummary.map((entry, idx) => (
                      <tr
                        key={idx}
                        className={`hover:bg-surface-hover/30 border-b border-[var(--border-subtle)] transition-colors ${
                          idx % 2 === 0 ? "bg-surface-hover/10" : ""
                        }`}
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

              {/* Per-signer breakdown */}
              {(() => {
                const groups = new Map<string, typeof fieldSummary>();
                for (const e of fieldSummary) {
                  const g = groups.get(e.signer) ?? [];
                  g.push(e);
                  groups.set(e.signer, g);
                }
                if (groups.size <= 1) return null;
                return (
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
                );
              })()}
            </section>
          )}

          {/* ═══ Signatures ═══ */}
          <section
            id="signatures"
            ref={(el) => {
              sectionRefs.current.signatures = el;
            }}
            className="mt-12"
          >
            <h2 className="mb-6 flex items-center gap-2 text-lg font-bold text-primary">
              <ShieldCheck className="h-5 w-5 text-accent" /> Signatures
            </h2>

            <div className="space-y-4">
              {doc.signers.map((signer) => {
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
                                {signer.address.slice(0, 10)}...{signer.address.slice(-8)}
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

          {isCreatorViewer && (
            <section
              id="forensic-replay"
              ref={(el) => {
                sectionRefs.current["forensic-replay"] = el;
              }}
              className="mt-12"
            >
              <ForensicReplayPanel documentId={documentId} />
              <div className="mt-4 flex justify-end">
                <a
                  href={`/replay/${documentId}`}
                  className="bg-accent/15 hover:bg-accent/25 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium text-accent transition-colors"
                >
                  <Play className="h-3.5 w-3.5" />
                  Open Full Replay
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </section>
          )}

          {/* ═══ Verification ═══ */}
          <section
            id="verification"
            ref={(el) => {
              sectionRefs.current.verification = el;
            }}
            className="mt-12"
          >
            <h2 className="mb-6 flex items-center gap-2 text-lg font-bold text-primary">
              <Hash className="h-5 w-5 text-accent" /> Verification
            </h2>

            <div className="space-y-4 rounded-xl border border-border bg-surface-card p-6">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Content Hash (SHA-256)
                </span>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 break-all rounded-lg bg-surface-hover px-3 py-2 font-mono text-xs text-secondary">
                    {doc.contentHash}
                  </code>
                  <button
                    onClick={() => {
                      void navigator.clipboard.writeText(doc.contentHash);
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
                  href={`/verify/${doc.contentHash}`}
                  className="hover:text-accent/80 mt-2 flex items-center gap-2 text-sm text-accent transition-colors"
                >
                  <Globe className="h-4 w-4" />
                  {typeof window !== "undefined" ? window.location.origin : ""}/verify/{doc.contentHash}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>

              <p className="text-xs leading-relaxed text-muted">
                This document was signed using cryptographic wallet signatures. Each signature is independently
                verifiable using the content hash and wallet address. The hash above is a SHA-256 fingerprint of the
                original document content — any modification would produce a different hash.
              </p>
            </div>
          </section>

          {/* Back to top */}
          <div className="mt-16 flex justify-center pb-8">
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-hover px-4 py-2 text-xs text-muted transition-colors hover:bg-surface-elevated hover:text-secondary"
            >
              <ChevronUp className="h-3.5 w-3.5" /> Back to top
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Token renderer ──────────────────────────────────────────────────────────

function renderToken(
  token: DocToken,
  idx: number,
  signers: Array<{ label: string; status: string; signedAt: Date | null; handSignatureData?: string | null }>,
  allFieldValues: Record<string, string>,
) {
  switch (token.kind) {
    case "heading":
      return (
        <div key={idx} className="pb-2 pt-8">
          <h3 className="text-base font-bold text-primary">{token.text}</h3>
        </div>
      );
    case "subheading":
      return (
        <h4
          key={idx}
          className="pb-2 pt-8 text-sm font-bold uppercase tracking-widest text-secondary"
          style={{ letterSpacing: "0.15em" }}
        >
          {token.text}
        </h4>
      );
    case "text":
      return (
        <span key={idx} className="text-sm leading-relaxed text-secondary">
          {token.text}{" "}
        </span>
      );
    case "break":
      return <div key={idx} className="h-3" />;
    case "listItem":
      return (
        <p key={idx} className="pl-6 pt-1 text-sm leading-relaxed text-secondary">
          {token.text}
        </p>
      );
    case "field": {
      const val = allFieldValues[token.field.id];
      if (token.field.type === "signature" && isImageDataUrl(val)) {
        return (
          <span key={token.field.id} className="mx-1 inline-flex flex-col align-middle">
            <span className="mb-1 text-[9px] font-medium uppercase tracking-wider text-emerald-400/70">
              {token.field.label}
            </span>
            <span className="inline-block border-b-2 border-emerald-400/30 pb-1">
              <img
                src={val}
                alt={`${token.field.label} signature`}
                className="sig-theme-img h-10 w-auto object-contain"
              />
            </span>
          </span>
        );
      }
      const style = getFieldVisualStyle(token.field);
      return (
        <span key={token.field.id} className="mx-0.5 my-1 inline-block align-baseline">
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 ${
              val ? style.border + " " + style.bg : "bg-surface-hover/20 border-border"
            }`}
          >
            <span
              className={`shrink-0 text-[9px] font-medium uppercase tracking-wider ${val ? style.text : "text-muted"}`}
            >
              {token.field.label}
            </span>
            <span
              className={`text-sm ${val ? "font-medium text-primary" : "text-muted/50 italic"}`}
              style={{ fontFamily: "'Georgia', serif" }}
            >
              {getFieldDisplayText(token.field, val)}
            </span>
            {val && <CheckCircle className="h-3 w-3 shrink-0 text-green-400" />}
          </span>
        </span>
      );
    }
    case "signatureBlock": {
      const signer = signers[token.signerIdx];
      const hasSigned = signer?.status === "SIGNED";
      const sigImage = signer?.handSignatureData;
      return (
        <div key={idx} className="pb-2 pt-8">
          <p className="mb-3 text-xs uppercase tracking-wider text-muted">{token.label} Signature</p>
          {hasSigned && sigImage && isImageDataUrl(sigImage) ? (
            <div className="inline-block rounded-md border border-black/10 bg-[var(--sig-bg,#fefce8)] px-4 py-3 shadow-sm">
              <img
                src={sigImage}
                alt={`${signer.label} signature`}
                className="sig-theme-img h-14 w-auto object-contain"
              />
              <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-emerald-600/70">
                <CheckCircle className="h-3 w-3" />
                Signed by {signer.label}
                {signer.signedAt && ` (${new Date(signer.signedAt).toLocaleDateString()})`}
              </p>
            </div>
          ) : hasSigned ? (
            <div className="inline-flex items-center gap-2 text-sm text-green-400/80">
              <CheckCircle className="h-4 w-4" /> Signed by {signer.label}
              {signer.signedAt && (
                <span className="text-[10px] text-muted">({new Date(signer.signedAt).toLocaleDateString()})</span>
              )}
            </div>
          ) : (
            <div className="inline-block h-8 w-48 border-b-2 border-border" />
          )}
        </div>
      );
    }
    case "page-break":
      return <hr key={idx} className="my-6 border-border" />;
    default:
      return null;
  }
}

// ── Block explorer helper ───────────────────────────────────────────────────

function getBlockExplorerUrl(chain: string | null, address: string | null): string | null {
  if (!chain || !address) return null;
  const c = chain.toUpperCase();
  if (c === "ETH" || c === "ETHEREUM") return `https://etherscan.io/address/${address}`;
  if (c === "BTC" || c === "BITCOIN") return `https://mempool.space/address/${address}`;
  if (c === "SOL" || c === "SOLANA") return `https://solscan.io/account/${address}`;
  return null;
}
