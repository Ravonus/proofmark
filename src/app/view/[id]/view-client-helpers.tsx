/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any */
"use client";

import { CheckCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useConnectedIdentity } from "~/components/hooks/use-connected-identity";
import { getFieldDisplayText, getFieldVisualStyle } from "~/components/signing/sign-document-helpers";
import type { DocToken } from "~/lib/document/document-tokens";
import { tokenizeDocument } from "~/lib/document/document-tokens";
import { isImageDataUrl } from "~/lib/document/field-values";
import { trpc } from "~/lib/platform/trpc";

// ── Token renderer ──────────────────────────────────────────────────────────

export function renderToken(
  token: DocToken,
  idx: number,
  signers: Array<{
    label: string;
    status: string;
    signedAt: Date | null;
    handSignatureData?: string | null;
  }>,
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
    case "field":
      return renderFieldToken(token, allFieldValues);
    case "signatureBlock":
      return renderSignatureBlock(token, idx, signers);
    case "page-break":
      return <hr key={idx} className="my-6 border-border" />;
    default:
      return null;
  }
}

function renderFieldToken(token: Extract<DocToken, { kind: "field" }>, allFieldValues: Record<string, string>) {
  const val = allFieldValues[token.field.id];
  if (token.field.type === "signature" && isImageDataUrl(val)) {
    return (
      <span key={token.field.id} className="mx-1 inline-flex flex-col align-middle">
        <span className="mb-1 text-[9px] font-medium uppercase tracking-wider text-emerald-400/70">
          {token.field.label}
        </span>
        <span className="inline-block border-b-2 border-emerald-400/30 pb-1">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL signature */}
          <img src={val} alt={`${token.field.label} signature`} className="sig-theme-img h-10 w-auto object-contain" />
        </span>
      </span>
    );
  }
  const style = getFieldVisualStyle(token.field);
  return (
    <span key={token.field.id} className="mx-0.5 my-1 inline-block align-baseline">
      <span
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 ${val ? style.border + " " + style.bg : "bg-surface-hover/20 border-border"}`}
      >
        <span className={`shrink-0 text-[9px] font-medium uppercase tracking-wider ${val ? style.text : "text-muted"}`}>
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

function renderSignatureBlock(
  token: Extract<DocToken, { kind: "signatureBlock" }>,
  idx: number,
  signers: Array<{
    label: string;
    status: string;
    signedAt: Date | null;
    handSignatureData?: string | null;
  }>,
) {
  const signer = signers[token.signerIdx];
  const hasSigned = signer?.status === "SIGNED";
  const sigImage = signer?.handSignatureData;
  return (
    <div key={idx} className="pb-2 pt-8">
      <p className="mb-3 text-xs uppercase tracking-wider text-muted">{token.label} Signature</p>
      {hasSigned && sigImage && isImageDataUrl(sigImage) ? (
        <div className="inline-block rounded-md border border-black/10 bg-[var(--sig-bg,#fefce8)] px-4 py-3 shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL signature */}
          <img src={sigImage} alt={`${signer.label} signature`} className="sig-theme-img h-14 w-auto object-contain" />
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

// ── Block explorer helper ───────────────────────────────────────────────────

export function getBlockExplorerUrl(chain: string | null, address: string | null): string | null {
  if (!chain || !address) return null;
  const c = chain.toUpperCase();
  if (c === "ETH" || c === "ETHEREUM") return `https://etherscan.io/address/${address}`;
  if (c === "BTC" || c === "BITCOIN") return `https://mempool.space/address/${address}`;
  if (c === "SOL" || c === "SOLANA") return `https://solscan.io/account/${address}`;
  return null;
}

// ── Derived data hook ───────────────────────────────────────────────────────

export function useViewDocumentData(doc: any) {
  const tokens = useMemo(() => {
    if (!doc) return [];
    const { tokens: t } = tokenizeDocument(doc.content, doc.signers.length);
    return t;
  }, [doc]);

  const allFieldValues = useMemo(() => {
    if (!doc) return {} as Record<string, string>;
    const vals: Record<string, string> = {};
    for (const s of doc.signers) {
      if (s.fieldValues) {
        for (const [k, v] of Object.entries(s.fieldValues as Record<string, string>)) {
          if (v) vals[k] = v;
        }
      }
    }
    return vals;
  }, [doc]);

  const fieldSummary = useMemo(() => {
    if (!doc) return [];
    const { fields } = tokenizeDocument(doc.content, doc.signers.length);
    const entries: Array<{
      label: string;
      value: string;
      signer: string;
      type: string;
    }> = [];
    for (const f of fields) {
      for (const s of doc.signers) {
        const val = s.fieldValues?.[f.id];
        if (val) {
          entries.push({
            label: f.label,
            value: getFieldDisplayText(f, val),
            signer: s.label,
            type: f.type,
          });
        }
      }
    }
    return entries;
  }, [doc]);

  return { tokens, allFieldValues, fieldSummary };
}

// ── Collaboration hook ──────────────────────────────────────────────────────

export function useViewCollab(documentId: string, docTitle: string | undefined) {
  const identity = useConnectedIdentity();
  const collabCapabilities = trpc.collab.capabilities.useQuery();
  const collabAvailable = collabCapabilities.data?.available ?? false;
  const [collabSessionId, setCollabSessionId] = useState<string | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const autoCollabInitiated = useRef(false);
  const viewerDisplayName = identity.session?.user?.name ?? identity.wallet?.address?.slice(0, 8) ?? "Anonymous";

  const autoCollab = trpc.collab.getOrCreateForDocument.useMutation();
  const collabSessionQuery = trpc.collab.get.useQuery({ sessionId: collabSessionId! }, { enabled: !!collabSessionId });
  const collabSession = collabSessionQuery.data;

  useEffect(() => {
    if (!collabAvailable || !documentId || !viewerDisplayName || autoCollabInitiated.current) return;
    autoCollabInitiated.current = true;
    autoCollab
      .mutateAsync({
        documentId,
        documentTitle: docTitle,
        displayName: viewerDisplayName,
      })
      .then((res) => setCollabSessionId(res.sessionId))
      .catch(() => {
        autoCollabInitiated.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabAvailable, documentId, viewerDisplayName]);

  return {
    identity,
    collabSessionId,
    setCollabSessionId,
    collabSession,
    showAnnotations,
    setShowAnnotations,
    showAiPanel,
    setShowAiPanel,
    viewerDisplayName,
  };
}
