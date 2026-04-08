"use client";

import { AnimatePresence, motion } from "framer-motion";
import { GripVertical, PenTool, Trash2, X } from "lucide-react";
import { memo, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AddressSuggestion } from "~/lib/address-autocomplete";
import type { DocToken, InlineField } from "~/lib/document/document-tokens";
import { getFieldLogicState, resolveFieldBadge, resolveFieldLogo } from "~/lib/document/field-runtime";
import { getSignerColor } from "../fields";
import { getFieldIcon } from "../fields/field-picker";
import { EditorFieldPopover } from "./document-editor-field-popover";
import { PreviewField } from "./document-editor-preview-field";
import type { PreviewValueMap, SignerDef } from "./document-editor-types";

// -- EditorField --

export type EditorFieldProps = {
  field: InlineField;
  active: boolean;
  previewMode: boolean;
  previewValue?: string;
  previewValues: PreviewValueMap;
  allFields: InlineField[];
  signerCount: number;
  signers: SignerDef[];
  onFocus: () => void;
  onPreviewChange?: (value: string) => void;
  onPreviewAddressSuggestion?: (suggestion: AddressSuggestion) => void;
  loadAddressSuggestions?: (query: string, field: InlineField) => Promise<AddressSuggestion[]>;
  onUpdate: (patch: Partial<InlineField>) => void;
  onRemove: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
};

export type SignatureBlockToken = Extract<DocToken, { kind: "signatureBlock" }>;

export const EditorField = memo(
  function EditorField({
    field,
    active,
    previewMode,
    previewValue,
    previewValues,
    allFields,
    signerCount,
    signers,
    onFocus,
    onPreviewChange,
    onPreviewAddressSuggestion,
    loadAddressSuggestions,
    onUpdate,
    onRemove,
    onDragStart,
    onDragEnd,
    onMoveUp: _onMoveUp,
    onMoveDown: _onMoveDown,
  }: EditorFieldProps) {
    const sc = getSignerColor(field.signerIdx ?? 0);
    const FieldIcon = getFieldIcon(field.type);
    const [showPopover, setShowPopover] = useState(false);
    const [popoverPos, setPopoverPos] = useState<{
      top: number;
      left: number;
    } | null>(null);
    const fieldRef = useRef<HTMLSpanElement>(null);
    const updatePopoverPos = useCallback(() => {
      if (!fieldRef.current) return;
      const rect = fieldRef.current.getBoundingClientRect();
      const popW = 288; // w-72 = 18rem = 288px
      const popH = 400; // approximate max height
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < popH && rect.top > spaceBelow ? Math.max(8, rect.top - popH - 4) : rect.bottom + 8;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - popW - 8));
      setPopoverPos({ top, left });
    }, []);

    const logo = resolveFieldLogo(field, previewValue);
    const badge = resolveFieldBadge(field, previewValue);
    const logicState = getFieldLogicState(field, previewValues);

    if (previewMode) {
      if (!logicState.visible) return null;
      return (
        <PreviewField
          field={field}
          value={previewValue}
          onChange={(v) => onPreviewChange?.(v)}
          onFocus={onFocus}
          onApplySuggestion={onPreviewAddressSuggestion}
          loadAddressSuggestions={loadAddressSuggestions}
        />
      );
    }

    return (
      <span className="group/field relative mx-0.5 my-0.5 inline-flex items-center" id={field.id} ref={fieldRef}>
        <span
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", field.id);
            const blank = document.createElement("div");
            blank.style.cssText = "width:1px;height:1px;opacity:0";
            document.body.appendChild(blank);
            e.dataTransfer.setDragImage(blank, 0, 0);
            setTimeout(() => blank.remove(), 0);
            onDragStart?.();
          }}
          onDragEnd={() => onDragEnd?.()}
          className={`inline-flex cursor-grab items-center gap-1.5 rounded-md border px-2.5 py-1 transition-all active:cursor-grabbing ${sc.border} ${sc.bg} ${
            active ? "shadow-sm ring-2 ring-[var(--accent-30)]" : "hover:shadow-sm"
          }`}
          onClick={() => {
            onFocus();
            if (!showPopover) updatePopoverPos();
            setShowPopover(!showPopover);
          }}
        >
          <GripVertical className="text-muted/40 h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/field:opacity-100" />
          <FieldIcon className={`h-3.5 w-3.5 shrink-0 ${sc.text}`} />
          <span className={`text-[10px] font-semibold uppercase tracking-wide ${sc.text}`}>{field.label}</span>
          {logo && (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-secondary">{logo}</span>
          )}
          {badge && (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-secondary">{badge}</span>
          )}
          {field.required && <span className="text-xs leading-none text-red-400">*</span>}
        </span>

        {/* Field settings popover */}
        {showPopover && active && popoverPos && (
          <EditorFieldPopover
            field={field}
            popoverPos={popoverPos}
            signerCount={signerCount}
            signers={signers}
            allFields={allFields}
            previewValues={previewValues}
            onUpdate={onUpdate}
            onRemove={onRemove}
            onClose={() => setShowPopover(false)}
          />
        )}
      </span>
    );
  },
  (prev, next) =>
    prev.field === next.field &&
    prev.active === next.active &&
    prev.previewMode === next.previewMode &&
    prev.previewValue === next.previewValue &&
    prev.previewValues === next.previewValues &&
    prev.allFields === next.allFields &&
    prev.signerCount === next.signerCount &&
    prev.signers === next.signers,
);

// -- Signature Block --

export type EditorSignatureBlockProps = {
  token: SignatureBlockToken;
  tokenId: string;
  active: boolean;
  previewMode: boolean;
  signers: SignerDef[];
  onFocus: () => void;
  onUpdate: (patch: Partial<SignatureBlockToken>) => void;
  onRemove: () => void;
};

export const EditorSignatureBlock = memo(
  function EditorSignatureBlock({
    token,
    tokenId,
    active,
    previewMode,
    signers,
    onFocus,
    onUpdate,
    onRemove,
  }: EditorSignatureBlockProps) {
    const safeIdx = Math.min(Math.max(token.signerIdx, 0), Math.max(signers.length - 1, 0));
    const sc = getSignerColor(safeIdx);
    const name = signers[safeIdx]?.label || `Party ${String.fromCharCode(65 + safeIdx)}`;
    const [showPopover, setShowPopover] = useState(false);
    const [sigPopoverPos, setSigPopoverPos] = useState<{
      top: number;
      left: number;
    } | null>(null);
    const sigBlockRef = useRef<HTMLDivElement>(null);
    const updateSigPopoverPos = useCallback(() => {
      if (!sigBlockRef.current) return;
      const rect = sigBlockRef.current.getBoundingClientRect();
      const popW = 256; // w-64
      const popH = 200;
      const spaceBelow = window.innerHeight - rect.bottom;
      const top = spaceBelow < popH && rect.top > spaceBelow ? Math.max(8, rect.top - popH - 4) : rect.bottom + 8;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - popW - 8));
      setSigPopoverPos({ top, left });
    }, []);

    if (previewMode) {
      return (
        <div id={tokenId} className="pb-4 pt-8">
          <div className={`rounded-lg border-2 border-dashed px-6 py-4 ${sc.border} ${sc.bg}`}>
            <p className={`mb-2 text-xs font-medium uppercase tracking-wider ${sc.text}`}>{token.label}</p>
            <div className="flex h-16 items-end border-b-2 border-current opacity-20" />
            <p className="mt-2 text-xs text-muted">{name}</p>
          </div>
        </div>
      );
    }

    return (
      <div id={tokenId} className="group relative pb-4 pt-8" ref={sigBlockRef}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            onFocus();
            if (!showPopover) updateSigPopoverPos();
            setShowPopover((s) => !s);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onFocus();
              if (!showPopover) updateSigPopoverPos();
              setShowPopover((s) => !s);
            }
          }}
          className={`w-full cursor-pointer rounded-lg border-2 border-dashed px-6 py-4 text-left transition-all ${sc.border} ${sc.bg} ${active ? "ring-2 ring-[var(--accent-20)]" : "hover:shadow-sm"}`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <PenTool className={`h-4 w-4 ${sc.text}`} />
              <span className={`text-sm font-medium ${sc.text}`}>
                {token.label} - {name}
              </span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="p-1 text-red-400/60 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 h-12 border-b-2 border-current opacity-10" />
          <p className="mt-1.5 text-[11px] text-muted">Click to configure</p>
        </div>
        {showPopover &&
          active &&
          sigPopoverPos &&
          createPortal(
            <AnimatePresence>
              <>
                <div className="fixed inset-0 z-[9998]" onClick={() => setShowPopover(false)} />
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  className="fixed z-[9999] w-64 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-xl"
                  style={{ top: sigPopoverPos.top, left: sigPopoverPos.left }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">Signature Spot</span>
                    <button onClick={() => setShowPopover(false)} className="text-muted hover:text-secondary">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-muted">Assigned to</label>
                    <div className="flex flex-wrap gap-1.5">
                      {signers.map((signer, idx) => {
                        const c = getSignerColor(idx);
                        return (
                          <button
                            key={idx}
                            onClick={() => onUpdate({ signerIdx: idx })}
                            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${safeIdx === idx ? `${c.border} ${c.bg} ${c.text} font-medium` : "border-[var(--border)] text-muted hover:text-secondary"}`}
                          >
                            <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                            {signer.label || `Party ${String.fromCharCode(65 + idx)}`}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              </>
            </AnimatePresence>,
            document.body,
          )}
      </div>
    );
  },
  (prev, next) =>
    prev.token === next.token &&
    prev.active === next.active &&
    prev.previewMode === next.previewMode &&
    prev.signers === next.signers,
);
