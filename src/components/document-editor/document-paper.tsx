"use client";

import { Fragment, type ReactNode, type Ref } from "react";
import type { DocToken, InlineField } from "~/lib/document/document-tokens";
import { ScrollReveal } from "../ui/scroll-reveal";

function sanitizeForensicPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function getDocumentTokenForensicId(token: DocToken, index: number) {
  const base = `doc-token-${index}`;
  switch (token.kind) {
    case "heading":
      return `${base}-heading-${sanitizeForensicPart(token.text) || "section"}`;
    case "subheading":
      return `${base}-subheading-${sanitizeForensicPart(token.text) || "section"}`;
    case "text":
      return `${base}-text-${sanitizeForensicPart(token.text) || "content"}`;
    case "field":
      return `${base}-field-${sanitizeForensicPart(token.field.id) || "field"}`;
    case "listItem":
      return `${base}-list-${sanitizeForensicPart(token.text) || "item"}`;
    case "break":
      return `${base}-break`;
    case "signatureBlock":
      return `${base}-signature-${sanitizeForensicPart(token.label) || token.signerIdx.toString()}`;
    case "page-break":
      return `${base}-page-${token.page}`;
  }
}

type DocumentPaperFieldRenderArgs = {
  field: InlineField;
  tokenIndex: number;
  forensicId: string;
};

type DocumentPaperSignatureRenderArgs = {
  label: string;
  signerIdx: number;
  tokenIndex: number;
  forensicId: string;
};

type DocumentPaperProps = {
  tokens: DocToken[];
  renderField: (args: DocumentPaperFieldRenderArgs) => ReactNode;
  renderSignatureBlock: (args: DocumentPaperSignatureRenderArgs) => ReactNode;
  reveal?: boolean;
  paperRef?: Ref<HTMLDivElement>;
  overlay?: ReactNode;
};

function maybeWrapReveal(key: string | number, enabled: boolean, delay: number, children: ReactNode) {
  if (!enabled) {
    return <Fragment key={key}>{children}</Fragment>;
  }
  return (
    <ScrollReveal key={key} delay={delay}>
      {children}
    </ScrollReveal>
  );
}

export function DocumentPaper({
  tokens,
  renderField,
  renderSignatureBlock,
  reveal = false,
  paperRef,
  overlay,
}: DocumentPaperProps) {
  return (
    <div ref={paperRef} className="relative">
      <div
        className="overflow-hidden rounded-2xl border border-border"
        data-forensic-id="document-paper"
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
          data-forensic-id="document-content"
          style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
        >
          {tokens.map((token, index) => {
            const forensicId = getDocumentTokenForensicId(token, index);
            switch (token.kind) {
              case "heading":
                return maybeWrapReveal(
                  index,
                  reveal,
                  0.03 * (token.sectionNum || 0),
                  <div className="pb-2 pt-8" data-forensic-id={forensicId}>
                    {(token.sectionNum || 0) > 1 && (
                      <div
                        className="mb-4 h-px"
                        style={{
                          background: "linear-gradient(90deg, transparent, var(--border), transparent)",
                        }}
                      />
                    )}
                    <h3 className="text-base font-bold text-primary">{token.text}</h3>
                  </div>,
                );
              case "subheading":
                return maybeWrapReveal(
                  index,
                  reveal,
                  0.03,
                  <h4
                    className="pb-2 pt-8 text-sm font-bold uppercase tracking-widest text-secondary"
                    data-forensic-id={forensicId}
                    style={{ letterSpacing: "0.15em" }}
                  >
                    {token.text}
                  </h4>,
                );
              case "text":
                return (
                  <span key={index} className="text-sm leading-relaxed text-secondary" data-forensic-id={forensicId}>
                    {token.text}{" "}
                  </span>
                );
              case "break":
                return <div key={index} className="h-3" data-forensic-id={forensicId} />;
              case "listItem":
                return <div key={index} className="pl-6 pt-1" data-forensic-id={forensicId} />;
              case "field":
                return (
                  <Fragment key={token.field.id}>
                    {renderField({ field: token.field, tokenIndex: index, forensicId })}
                  </Fragment>
                );
              case "signatureBlock":
                return maybeWrapReveal(
                  index,
                  reveal,
                  0.1,
                  <div className="pb-2 pt-8" data-forensic-id={forensicId}>
                    <p className="mb-3 text-xs uppercase tracking-wider text-muted">{token.label} Signature</p>
                    {renderSignatureBlock({
                      label: token.label,
                      signerIdx: token.signerIdx,
                      tokenIndex: index,
                      forensicId,
                    })}
                  </div>,
                );
              case "page-break":
                return <div key={index} className="h-6" data-forensic-id={forensicId} />;
              default:
                return null;
            }
          })}
        </div>
      </div>
      {overlay ? <div className="pointer-events-none absolute inset-0 z-20">{overlay}</div> : null}
    </div>
  );
}
