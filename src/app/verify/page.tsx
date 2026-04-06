"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ShieldCheck,
  FileText,
  Upload,
  Clock,
  User,
  Hash,
  Link as LinkIcon,
  CheckCircle,
  XCircle,
  Shield,
  FilePlus,
  PenLine,
  Mail,
  Eye,
  Send,
  Award,
  Terminal,
  Play,
} from "lucide-react";
import { trpc } from "~/lib/trpc";
import { Nav } from "~/components/nav";
import { CHAIN_META, type WalletChain } from "~/lib/chains";
import { SECURITY_MODE_LABELS } from "~/lib/signing/document-security";

async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Detect what kind of input the user provided */
function detectInputType(input: string): "hash" | "cid" | "id" | "content" {
  const trimmed = input.trim();
  // SHA-256 hex hash: exactly 64 hex characters
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) return "hash";
  // IPFS CID v0 (Qm...) or CIDv1 base32 (typically begins with `b`)
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44,}$/.test(trimmed) || /^b[a-z2-7]{20,}$/i.test(trimmed)) return "cid";
  // UUID pattern
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return "id";
  // Short alphanumeric that looks like a CUID/nanoid-style ID (not long enough to be content)
  if (/^[a-z0-9]{20,30}$/i.test(trimmed)) return "id";
  return "content";
}

export default function VerifyPage() {
  const [input, setInput] = useState("");
  const [effectiveQuery, setEffectiveQuery] = useState("");
  const [searched, setSearched] = useState(false);
  const [detectedType, setDetectedType] = useState<string | null>(null);
  const [computedHash, setComputedHash] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const verifyQuery = trpc.document.verify.useQuery(
    { query: effectiveQuery },
    { enabled: searched && effectiveQuery.length > 0 },
  );

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    const type = detectInputType(trimmed);
    setDetectedType(type);

    if (type === "content") {
      const hash = await sha256Hex(trimmed);
      setComputedHash(hash);
      setEffectiveQuery(hash);
    } else {
      setComputedHash(null);
      setEffectiveQuery(trimmed);
    }
    setSearched(true);
  };

  const handleFileDrop = async (file: File) => {
    if (file.type === "application/pdf" || !file.type.startsWith("text/")) {
      const buf = await file.arrayBuffer();
      const hash = await sha256Hex(buf);
      setInput(`[Uploaded: ${file.name} -- ${(buf.byteLength / 1024).toFixed(1)} KB]`);
      setComputedHash(hash);
      setDetectedType("content");
      setEffectiveQuery(hash);
      setSearched(true);
      return;
    }
    const text = await file.text();
    const hash = await sha256Hex(text);
    setInput(`[Uploaded: ${file.name}]`);
    setComputedHash(hash);
    setDetectedType("content");
    setEffectiveQuery(hash);
    setSearched(true);
  };

  const doc = verifyQuery.data;
  const securityModeLabel = doc ? (SECURITY_MODE_LABELS[doc.securityMode ?? "HASH_ONLY"] ?? doc.securityMode) : null;
  const encryptedIpfsCid = doc?.encryptedAtRest && doc.securityMode === "ENCRYPTED_IPFS" ? (doc.ipfsCid ?? null) : null;
  const hasEncryptedIpfs = Boolean(encryptedIpfsCid);

  return (
    <main className="min-h-screen">
      <Nav />
      <div className="mx-auto max-w-3xl space-y-8 px-4 py-10">
        {/* Header */}
        <div className="space-y-2 text-center">
          <div className="mb-1 flex items-center justify-center gap-2">
            <Shield className="h-7 w-7 text-accent" />
            <h1 className="text-3xl font-bold">Verify Document</h1>
          </div>
          <p className="text-sm text-muted">
            Verify any document by hash, IPFS CID, ID, or paste/upload the document itself
          </p>
        </div>

        {/* Single unified search */}
        <form onSubmit={handleSearch} className="space-y-2">
          <div className="glass-card flex gap-2 rounded-2xl p-1.5">
            <div className="relative flex-1">
              <Search className="text-muted/60 pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" />
              <input
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setSearched(false);
                  setComputedHash(null);
                  setDetectedType(null);
                }}
                placeholder="Paste document hash, CID, ID, or full content to verify..."
                className="bg-surface/50 placeholder:text-muted/50 w-full rounded-xl py-3.5 pl-11 pr-5 font-mono text-sm outline-none ring-1 ring-border transition-all placeholder:font-sans focus:ring-accent"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) void handleFileDrop(f);
                }}
              />
            </div>
            <button
              type="submit"
              disabled={!input.trim()}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-accent px-6 py-3.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              <Search className="h-4 w-4" />
              Verify
            </button>
          </div>
          <div className="flex items-center justify-between px-2">
            <p className="text-muted/60 text-[11px]">We&apos;ll automatically detect what you&apos;re searching for</p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 text-[11px] text-accent transition-colors hover:text-accent-hover"
            >
              <Upload className="h-3 w-3" />
              Upload File
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.json,.pdf,.doc,.docx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileDrop(f);
              }}
            />
          </div>
        </form>

        {/* Detected type + computed hash feedback */}
        {searched && detectedType && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1 text-center">
            <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
              {detectedType === "hash" && (
                <>
                  <Hash className="h-3 w-3" /> Detected as SHA-256 hash
                </>
              )}
              {detectedType === "cid" && (
                <>
                  <LinkIcon className="h-3 w-3" /> Detected as IPFS CID
                </>
              )}
              {detectedType === "id" && (
                <>
                  <FileText className="h-3 w-3" /> Detected as document ID
                </>
              )}
              {detectedType === "content" && (
                <>
                  <FileText className="h-3 w-3" /> Hashing content for lookup
                </>
              )}
            </p>
            {computedHash && <p className="text-muted/60 font-mono text-[11px]">SHA-256: {computedHash}</p>}
          </motion.div>
        )}

        {/* Loading */}
        {verifyQuery.isLoading && searched && (
          <div className="glass-card rounded-2xl p-8 text-center">
            <div className="border-accent/30 inline-block h-6 w-6 animate-spin rounded-full border-2 border-t-accent" />
            <p className="mt-3 text-sm text-muted">Searching...</p>
          </div>
        )}

        {/* Not found */}
        {searched && !verifyQuery.isLoading && !doc && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-red-500/20 bg-red-500/5 p-8 text-center"
          >
            <XCircle className="mx-auto mb-2 h-8 w-8 text-red-400" />
            <p className="mb-1 text-lg font-medium text-red-400">Not Found</p>
            <p className="text-sm text-muted">No document matches this hash, CID, or ID.</p>
          </motion.div>
        )}

        {/* Result */}
        <AnimatePresence>
          {doc && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
              {/* Status banner */}
              <div
                className={`rounded-2xl border p-6 text-center ${
                  doc.status === "COMPLETED"
                    ? "border-emerald-500/20 bg-emerald-500/5"
                    : "border-amber-500/20 bg-amber-500/5"
                }`}
              >
                <div className="mb-2 flex justify-center">
                  {doc.status === "COMPLETED" ? (
                    <ShieldCheck className="h-10 w-10 text-emerald-400" />
                  ) : (
                    <Clock className="h-10 w-10 text-amber-400" />
                  )}
                </div>
                <p
                  className={`text-lg font-semibold ${doc.status === "COMPLETED" ? "text-emerald-400" : "text-amber-400"}`}
                >
                  {doc.status === "COMPLETED" ? "Fully Verified & Signed" : "Pending Signatures"}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {doc.signers.filter((s) => s.status === "SIGNED").length} of {doc.signers.length} signatures collected
                </p>
              </div>

              {/* Document info */}
              <div className="glass-card space-y-4 rounded-2xl p-6">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <FileText className="h-5 w-5 text-accent" />
                  {doc.title}
                </h2>
                <div className="grid gap-3">
                  <InfoRow icon={<FileText className="h-3.5 w-3.5" />} label="Document ID" value={doc.id} mono />
                  <InfoRow icon={<Hash className="h-3.5 w-3.5" />} label="SHA-256 Hash" value={doc.contentHash} mono />
                  <InfoRow
                    icon={<Shield className="h-3.5 w-3.5" />}
                    label="Security Mode"
                    value={securityModeLabel ?? "SHA-256 only"}
                  />
                  {hasEncryptedIpfs && (
                    <InfoRow
                      icon={<LinkIcon className="h-3.5 w-3.5" />}
                      label="Encrypted Payload CID"
                      value={encryptedIpfsCid!}
                      mono
                      link={`https://ipfs.io/ipfs/${encryptedIpfsCid!}`}
                    />
                  )}
                  <InfoRow icon={<User className="h-3.5 w-3.5" />} label="Created By" value={doc.createdBy} mono />
                  <InfoRow
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label="Created"
                    value={new Date(doc.createdAt).toLocaleString()}
                  />
                  <InfoRow
                    icon={
                      doc.status === "COMPLETED" ? (
                        <CheckCircle className="h-3.5 w-3.5" />
                      ) : (
                        <Clock className="h-3.5 w-3.5" />
                      )
                    }
                    label="Status"
                    value={doc.status}
                    badge={doc.status === "COMPLETED" ? "green" : "amber"}
                  />
                </div>
              </div>

              {/* Signatures */}
              <div className="glass-card space-y-4 rounded-2xl p-6">
                <h3 className="flex items-center gap-2 text-sm font-medium text-secondary">
                  <PenLine className="h-4 w-4" />
                  Cryptographic Signatures
                </h3>
                <div className="space-y-3">
                  {doc.signers.map((s, i) => {
                    const meta = s.chain ? CHAIN_META[s.chain as WalletChain] : null;
                    return (
                      <div
                        key={i}
                        className={`rounded-xl border p-4 ${s.status === "SIGNED" ? "border-emerald-500/20 bg-emerald-500/5" : "bg-surface/50 border-border"}`}
                      >
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {meta && <span style={{ color: meta.color }}>{meta.icon}</span>}
                            <span className="text-sm font-medium">{s.label}</span>
                          </div>
                          <span
                            className={`flex items-center gap-1 text-xs font-medium ${s.status === "SIGNED" ? "text-emerald-400" : "text-amber-400"}`}
                          >
                            {s.status === "SIGNED" ? (
                              <>
                                <CheckCircle className="h-3.5 w-3.5" /> Verified
                              </>
                            ) : (
                              <>
                                <Clock className="h-3.5 w-3.5" /> Pending
                              </>
                            )}
                          </span>
                        </div>
                        {s.address && <p className="mb-1 font-mono text-xs text-muted">Address: {s.address}</p>}
                        {s.signature && (
                          <p className="break-all font-mono text-xs text-muted">
                            Sig: {s.signature.slice(0, 40)}...{s.signature.slice(-8)}
                          </p>
                        )}
                        {s.scheme && <p className="mt-1 text-[10px] text-muted">Scheme: {s.scheme}</p>}
                        {s.signedAt && (
                          <p className="text-[10px] text-muted">Signed: {new Date(s.signedAt).toLocaleString()}</p>
                        )}
                        {s.handSignatureHash && (
                          <p className="font-mono text-[10px] text-muted">
                            Ink hash: {s.handSignatureHash.slice(0, 16)}...
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Certificate of Completion */}
              {doc.status === "COMPLETED" && (
                <div className="space-y-5 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.03] p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-medium text-emerald-400">
                      <Award className="h-4 w-4" /> Certificate of Completion
                    </h3>
                    <span className="flex items-center gap-1 font-mono text-[10px] text-emerald-400/60">
                      <ShieldCheck className="h-3 w-3" /> TAMPER-EVIDENT
                    </span>
                  </div>

                  <div className="space-y-3 text-xs">
                    <div className="grid gap-2">
                      <div className="flex justify-between border-b border-white/[0.04] py-1.5">
                        <span className="text-muted">Document Title</span>
                        <span className="font-medium text-white/80">{doc.title}</span>
                      </div>
                      <div className="flex justify-between border-b border-white/[0.04] py-1.5">
                        <span className="text-muted">Document ID</span>
                        <span className="font-mono text-[11px] text-white/60">{doc.id}</span>
                      </div>
                      <div className="flex justify-between border-b border-white/[0.04] py-1.5">
                        <span className="text-muted">Content Hash (SHA-256)</span>
                        <span className="font-mono text-[11px] text-white/60">
                          {doc.contentHash.slice(0, 16)}...{doc.contentHash.slice(-8)}
                        </span>
                      </div>
                      {hasEncryptedIpfs && (
                        <div className="flex justify-between border-b border-white/[0.04] py-1.5">
                          <span className="text-muted">Encrypted Payload CID</span>
                          <span className="font-mono text-[11px] text-white/60">
                            {encryptedIpfsCid!.slice(0, 16)}...
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between border-b border-white/[0.04] py-1.5">
                        <span className="text-muted">Created</span>
                        <span className="text-white/80">{new Date(doc.createdAt).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between border-b border-white/[0.04] py-1.5">
                        <span className="text-muted">Completed</span>
                        <span className="text-white/80">
                          {(() => {
                            const lastSigned = doc.signers
                              .filter((s) => s.signedAt)
                              .sort((a, b) => new Date(b.signedAt!).getTime() - new Date(a.signedAt!).getTime())[0];
                            return lastSigned?.signedAt ? new Date(lastSigned.signedAt).toLocaleString() : "--";
                          })()}
                        </span>
                      </div>
                      <div className="flex justify-between border-b border-white/[0.04] py-1.5">
                        <span className="text-muted">Security Mode</span>
                        <span className="text-white/80">{securityModeLabel ?? "SHA-256 only"}</span>
                      </div>
                      <div className="flex justify-between border-b border-white/[0.04] py-1.5">
                        <span className="text-muted">Proof Mode</span>
                        <span className="text-white/80">{doc.proofMode ?? "HYBRID"}</span>
                      </div>
                    </div>

                    {/* Signer summary table */}
                    <div className="pt-2">
                      <p className="mb-2 font-medium text-muted">Signing Parties</p>
                      <div className="overflow-hidden rounded-lg border border-white/[0.06]">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="bg-white/[0.03]">
                              <th className="px-3 py-2 text-left font-medium text-muted">Party</th>
                              <th className="px-3 py-2 text-left font-medium text-muted">Method</th>
                              <th className="px-3 py-2 text-left font-medium text-muted">Identity</th>
                              <th className="px-3 py-2 text-left font-medium text-muted">Signed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {doc.signers.map((s, i) => (
                              <tr key={i} className="border-t border-white/[0.04]">
                                <td className="px-3 py-2 text-white/80">{s.label}</td>
                                <td className="px-3 py-2 text-white/60">{s.signMethod ?? s.scheme ?? "WALLET"}</td>
                                <td className="px-3 py-2">
                                  <span
                                    className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${
                                      s.identityLevel === "L2_VERIFIED"
                                        ? "bg-emerald-500/20 text-emerald-400"
                                        : s.identityLevel === "L1_EMAIL"
                                          ? "bg-blue-500/20 text-blue-400"
                                          : "bg-white/10 text-white/50"
                                    }`}
                                  >
                                    {s.identityLevel ?? "L0_WALLET"}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-white/60">
                                  {s.signedAt ? new Date(s.signedAt).toLocaleString() : "--"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Audit Trail */}
              {doc.auditTrail && doc.auditTrail.length > 0 && (
                <div className="glass-card space-y-4 rounded-2xl p-6">
                  <div className="flex items-center justify-between">
                    <h3 className="flex items-center gap-2 text-sm font-medium text-secondary">
                      <Eye className="h-4 w-4" /> Audit Trail
                    </h3>
                    {doc.auditChainValid !== undefined && (
                      <span
                        className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          doc.auditChainValid ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {doc.auditChainValid ? (
                          <>
                            <CheckCircle className="h-3 w-3" /> Chain Valid
                          </>
                        ) : (
                          <>
                            <XCircle className="h-3 w-3" /> Chain Broken
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="space-y-0">
                    {doc.auditTrail.map(
                      (
                        evt: {
                          eventType: string;
                          actor: string;
                          actorType: string | null;
                          ipAddress: string | null;
                          createdAt: string;
                          metadata: unknown;
                        },
                        i: number,
                      ) => {
                        const isLast = i === doc.auditTrail.length - 1;
                        const EventIcon = getAuditEventIcon(evt.eventType);
                        const iconColor = getAuditEventColor(evt.eventType);
                        return (
                          <div key={i} className="flex gap-3">
                            {/* Timeline */}
                            <div className="flex flex-col items-center">
                              <div className={`mt-1 shrink-0 ${iconColor}`}>
                                <EventIcon className="h-3.5 w-3.5" />
                              </div>
                              {!isLast && <div className="my-1 w-px flex-1 bg-white/[0.06]" />}
                            </div>
                            {/* Event */}
                            <div className="min-w-0 pb-4">
                              <p className="text-xs font-medium text-white/80">{evt.eventType.replace(/_/g, " ")}</p>
                              <p className="mt-0.5 text-[10px] text-muted">
                                {new Date(evt.createdAt).toLocaleString()}
                                {evt.actor && evt.actor !== "system" && (
                                  <span className="ml-2 font-mono">
                                    {evt.actor.length > 20
                                      ? `${evt.actor.slice(0, 8)}...${evt.actor.slice(-6)}`
                                      : evt.actor}
                                  </span>
                                )}
                                {evt.ipAddress && <span className="ml-2 opacity-50">IP: {evt.ipAddress}</span>}
                              </p>
                            </div>
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>
              )}

              {/* CLI Verification */}
              <div className="glass-card space-y-4 rounded-2xl p-6">
                <h3 className="flex items-center gap-2 text-sm font-medium text-secondary">
                  <Terminal className="h-4 w-4" />
                  Verify via CLI
                </h3>
                <div className="overflow-x-auto rounded-xl bg-black/30 p-4">
                  <pre className="whitespace-pre font-mono text-xs leading-relaxed text-emerald-400">
                    {`# Verify document SHA-256
echo -n '<document content>' | sha256sum
# Expected: ${doc.contentHash}
${
  hasEncryptedIpfs
    ? `
# Encrypted payload CID
ipfs cat ${encryptedIpfsCid!} > encrypted-payload.bin
# The CID addresses the encrypted payload. Verify the document itself
# with the SHA-256 hash above after decrypting it through your own flow.
`
    : ""
}

# Verify wallet signatures on-chain
# Each signature can be verified using the signer's
# public key and the signing scheme listed above.`}
                  </pre>
                </div>
              </div>

              {/* Forensic Replay */}
              <div className="glass-card flex items-center justify-between rounded-2xl p-6">
                <div className="flex items-center gap-3">
                  <div className="bg-accent/10 flex h-10 w-10 items-center justify-center rounded-full">
                    <Play className="h-5 w-5 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-secondary">Forensic Replay</h3>
                    <p className="text-xs text-muted">
                      View the full signing session replay with device fingerprint and behavioral evidence
                    </p>
                  </div>
                </div>
                <Link
                  href={`/replay/${doc.id}`}
                  className="flex shrink-0 items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  <Play className="h-4 w-4" />
                  View Forensic Replay
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}

/** Map audit event types to Lucide icons */
function getAuditEventIcon(eventType: string) {
  if (eventType.includes("SIGNED") || eventType.includes("SIGNATURE")) return PenLine;
  if (eventType.includes("COMPLETED")) return CheckCircle;
  if (eventType.includes("CREATED")) return FilePlus;
  if (eventType.includes("INVITED") || eventType.includes("SENT")) return Send;
  if (eventType.includes("VIEWED") || eventType.includes("OPENED")) return Eye;
  if (eventType.includes("EMAIL")) return Mail;
  return Clock;
}

function getAuditEventColor(eventType: string): string {
  if (eventType.includes("SIGNED") || eventType.includes("COMPLETED")) return "text-emerald-400";
  if (eventType.includes("CREATED") || eventType.includes("INVITED")) return "text-accent";
  return "text-white/30";
}

function InfoRow({
  icon,
  label,
  value,
  mono,
  badge,
  link,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
  badge?: "green" | "amber";
  link?: string;
}) {
  const valueEl = link ? (
    <a
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      className={`text-accent hover:underline ${mono ? "font-mono" : ""} break-all text-sm`}
    >
      {value}
    </a>
  ) : badge ? (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge === "green" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}
    >
      {value}
    </span>
  ) : (
    <span className={`${mono ? "font-mono" : ""} break-all text-sm text-white/80`}>{value}</span>
  );

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start">
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted sm:w-32">
        <span className="text-muted/60">{icon}</span>
        {label}
      </span>
      {valueEl}
    </div>
  );
}
