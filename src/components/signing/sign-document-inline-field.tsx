"use client";

import { AlertCircle, CheckCircle, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import type { AddressSuggestion } from "~/lib/address-autocomplete";
import {
  resolveFieldBadge,
  resolveFieldHelpText,
  resolveFieldInputType,
  resolveFieldLogo,
  resolveFieldPlaceholder,
  resolveFieldPrefix,
  resolveFieldSuffix,
} from "~/lib/document/field-runtime";
import { type AttachmentFieldValue, decodeStructuredFieldValue } from "~/lib/document/field-values";
import type { InlineField } from "./sign-document-helpers";
import { getFieldDisplayText, getFieldMinWidth, getFieldVisualStyle, validateField } from "./sign-document-helpers";
import { type FieldInputCallbacks, renderFieldInput } from "./sign-document-inline-field-inputs";

// ─── Other signer's filled field ────────────────────────────────────────────

function OtherSignerFilledField({
  field,
  forensicId,
  inputType,
  otherValue,
}: {
  field: InlineField;
  forensicId?: string;
  inputType: string;
  otherValue: string;
}) {
  const fieldMinWidth = getFieldMinWidth(field);
  const logo = resolveFieldLogo(field, otherValue);
  const badge = resolveFieldBadge(field, otherValue);
  const prefix = resolveFieldPrefix(field);
  const suffix = resolveFieldSuffix(field);

  return (
    <span
      className="mx-0.5 my-1 inline-block align-baseline"
      id={field.id}
      data-field-id={field.id}
      data-field-type={inputType}
      data-forensic-id={forensicId}
    >
      <span
        className="bg-surface-hover/30 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5"
        style={{ minWidth: fieldMinWidth }}
      >
        <span className="shrink-0 text-[9px] font-medium uppercase tracking-wider text-muted">{field.label}</span>
        {logo && <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted">{logo}</span>}
        {badge && (
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted">{badge}</span>
        )}
        {prefix && <span className="text-xs text-muted">{prefix}</span>}
        <span className="text-sm italic text-muted">{getFieldDisplayText(field, otherValue)}</span>
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
        <CheckCircle className="h-3 w-3 shrink-0 text-green-400/50" />
      </span>
    </span>
  );
}

// ─── Other signer's unfilled field ──────────────────────────────────────────

function OtherSignerEmptyField({
  field,
  forensicId,
  inputType,
}: {
  field: InlineField;
  forensicId?: string;
  inputType: string;
}) {
  const fieldMinWidth = getFieldMinWidth(field);
  const logo = resolveFieldLogo(field, undefined);
  const badge = resolveFieldBadge(field, undefined);
  const prefix = resolveFieldPrefix(field);
  const suffix = resolveFieldSuffix(field);
  const placeholder = resolveFieldPlaceholder(field);

  return (
    <span
      className="mx-0.5 my-1 inline-block align-baseline"
      id={field.id}
      data-field-id={field.id}
      data-field-type={inputType}
      data-forensic-id={forensicId}
    >
      <span
        className="bg-surface-hover/20 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 opacity-40"
        style={{ minWidth: fieldMinWidth }}
      >
        <span className="shrink-0 text-[9px] font-medium uppercase tracking-wider text-muted">{field.label}</span>
        {logo && <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted">{logo}</span>}
        {badge && (
          <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted">{badge}</span>
        )}
        {prefix && <span className="text-xs text-muted">{prefix}</span>}
        <span className="text-muted/40 text-sm italic">{placeholder}</span>
        {suffix && <span className="text-xs text-muted">{suffix}</span>}
      </span>
    </span>
  );
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

const NON_REUSABLE_TYPES = new Set(["checkbox", "file", "payment", "idv"]);
const NON_FILL_ALL_TYPES = new Set(["checkbox", "file", "payment", "idv", "signature"]);

function resolveInputType(field: InlineField): string {
  return field.type === "signature" || field.type === "initials" ? "signature" : resolveFieldInputType(field);
}

function getStateStyles(opts: {
  error: string | null;
  active: boolean;
  filled: boolean;
  isRequired?: boolean;
  canEdit: boolean;
}): string {
  if (opts.error) return "ring-2 ring-red-400/60 border-red-400/40";
  if (opts.active)
    return "ring-2 ring-accent/60 shadow-[0_0_24px_rgba(var(--accent-rgb,99,102,241),0.3)] border-accent/50";
  if (opts.filled) return "border-green-400/30 bg-green-400/5";
  if (opts.isRequired && opts.canEdit) return "ring-1 ring-red-400/30 border-red-400/20";
  return "";
}

function buildAttachmentUrl(
  attachmentValue: AttachmentFieldValue | null,
  documentId: string,
  fieldId: string,
  claimToken: string | null,
  walletAddress: string | null | undefined,
): string | null {
  if (!attachmentValue) return null;
  if (claimToken)
    return `/api/signer-attachments/${documentId}/${fieldId}?claimToken=${encodeURIComponent(claimToken)}`;
  if (walletAddress)
    return `/api/signer-attachments/${documentId}/${fieldId}?address=${encodeURIComponent(walletAddress)}`;
  return null;
}

// ─── Editable field body (extracted for line count) ─────────────────────────

function EditableFieldBody({
  field,
  forensicId,
  inputType,
  value,
  canEdit,
  signatureReady,
  busyAction,
  error,
  filled,
  displayValue,
  stateStyles,
  canReuse,
  fillAllEnabled,
  attachmentUrl,
  attachmentValue,
  callbacks,
  handleValueChange,
  handleBlur,
  runAsyncFieldAction,
  onChange,
  onFillMatching,
  isRequired,
  active,
  siblingValue,
  helpText,
}: {
  field: InlineField;
  forensicId?: string;
  inputType: string;
  value?: string;
  canEdit: boolean;
  signatureReady?: boolean;
  busyAction: "attachment" | "payment" | "idv" | "social" | null;
  error: string | null;
  filled: boolean;
  displayValue: string;
  stateStyles: string;
  canReuse: boolean;
  fillAllEnabled: boolean;
  attachmentUrl: string | null;
  attachmentValue: AttachmentFieldValue | null;
  callbacks: FieldInputCallbacks;
  handleValueChange: (v: string) => void;
  handleBlur: () => void;
  runAsyncFieldAction: (a: "attachment" | "payment" | "idv", r: () => Promise<void>) => Promise<void>;
  onChange: (id: string, value: string) => void;
  onFillMatching: (id: string, value: string) => void;
  isRequired?: boolean;
  active: boolean;
  siblingValue?: string;
  helpText: string | null;
}) {
  const s = getFieldVisualStyle(field);
  const logo = resolveFieldLogo(field, value);
  const badge = resolveFieldBadge(field, value);
  const prefix = resolveFieldPrefix(field);
  const suffix = resolveFieldSuffix(field);
  const fieldMinWidth = getFieldMinWidth(field);

  return (
    <span
      className="mx-0.5 my-1 inline-block align-baseline"
      id={field.id}
      data-field-id={field.id}
      data-field-type={inputType}
      data-forensic-id={forensicId}
    >
      <span className="inline-flex flex-col">
        <span
          className={`inline-flex gap-1.5 rounded-lg border px-3 py-1.5 transition-all ${s.border} ${s.bg} ${stateStyles} ${
            inputType === "textarea" || inputType === "radio" ? "flex-wrap items-start" : "items-center"
          }`}
          style={{ minWidth: fieldMinWidth }}
        >
          <span className={`shrink-0 text-[9px] font-medium uppercase tracking-wider ${s.text}`}>{field.label}</span>
          {logo && (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-secondary">{logo}</span>
          )}
          {badge && (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-secondary">{badge}</span>
          )}
          {prefix && <span className="text-xs text-muted">{prefix}</span>}
          {canReuse && (
            <button
              type="button"
              onClick={() => onChange(field.id, siblingValue!)}
              className="bg-accent/10 hover:bg-accent/20 shrink-0 rounded p-0.5 text-accent transition-colors"
              title="Reuse from matching field"
            >
              <Copy className="h-3 w-3" />
            </button>
          )}
          {canEdit ? (
            <>
              {renderFieldInput(inputType, {
                field,
                value,
                signatureReady,
                busyAction,
                callbacks,
                handleValueChange,
                handleBlur,
                runAsyncFieldAction,
              })}
              {suffix && <span className="text-xs text-muted">{suffix}</span>}
              {filled && !error && <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-400" />}
              {fillAllEnabled && (
                <button
                  type="button"
                  onClick={() => onFillMatching(field.id, value ?? "")}
                  className="shrink-0 rounded bg-surface-elevated px-1.5 py-0.5 text-[9px] text-muted transition-colors hover:bg-surface-elevated hover:text-primary"
                  title="Fill all matching fields"
                >
                  Fill all
                </button>
              )}
            </>
          ) : (
            <>
              <span className={`text-sm ${value ? "text-primary" : "text-muted/50 italic"}`}>{displayValue}</span>
              {suffix && <span className="text-xs text-muted">{suffix}</span>}
            </>
          )}
        </span>
        {attachmentUrl && attachmentValue?.kind === "attachment" && (
          <a
            href={attachmentUrl}
            target="_blank"
            rel="noreferrer"
            className="hover:text-accent/80 ml-1 mt-0.5 text-[9px] text-accent"
          >
            Download {attachmentValue.originalName}
          </a>
        )}
        {helpText && <span className="ml-1 mt-0.5 text-[9px] text-muted">{helpText}</span>}
        {isRequired && !filled && !error && active && (
          <span className="ml-1 mt-0.5 text-[9px] text-amber-400/70">Required field</span>
        )}
        {error && (
          <span className="ml-1 mt-0.5 flex items-center gap-0.5 text-[9px] text-red-400">
            <AlertCircle className="h-2.5 w-2.5" /> {error}
          </span>
        )}
        {isRequired && canEdit && !filled && !error && !active && (
          <span className="ml-1 mt-0.5 text-[9px] text-red-400/60">Required</span>
        )}
      </span>
    </span>
  );
}

// ─── Inline field input (rendered inside the document) ───────────────────────

export function InlineFieldInput({
  documentId,
  claimToken,
  field,
  forensicId,
  active,
  canEdit,
  isOtherSigners,
  otherValue,
  hasSiblings,
  siblingValue,
  value,
  signatureReady,
  allValues,
  walletAddress,
  isFilled,
  isRequired,
  onApplyAddressSuggestion,
  onLoadAddressSuggestions,
  onChange,
  onFillMatching,
  onUploadAttachment,
  onRunIdentityCheck,
  onStartPayment,
  onStartSocialVerify,
  onRequestSignature,
  onRequestPhoneDraw,
  onFocus,
  onBlur,
}: {
  documentId: string;
  claimToken: string | null;
  field: InlineField;
  forensicId?: string;
  active: boolean;
  canEdit: boolean;
  isOtherSigners?: boolean;
  otherValue?: string;
  hasSiblings?: boolean;
  siblingValue?: string;
  value?: string;
  signatureReady?: boolean;
  allValues: Record<string, string>;
  walletAddress?: string | null;
  isFilled?: boolean;
  isRequired?: boolean;
  onApplyAddressSuggestion: (field: InlineField, suggestion: AddressSuggestion) => void;
  onLoadAddressSuggestions: (query: string, field: InlineField) => Promise<AddressSuggestion[]>;
  onChange: (id: string, value: string) => void;
  onFillMatching: (id: string, value: string) => void;
  onUploadAttachment: (field: InlineField, file: File) => Promise<string>;
  onRunIdentityCheck: (field: InlineField) => Promise<string>;
  onStartPayment: (field: InlineField) => Promise<void>;
  onStartSocialVerify: (field: InlineField) => void;
  onRequestSignature: () => void;
  onRequestPhoneDraw: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"attachment" | "payment" | "idv" | "social" | null>(null);

  const inputType = resolveInputType(field);
  const filled = isFilled || !validateField(field, value, { signatureReady, allValues });
  const attachmentValue = decodeStructuredFieldValue<AttachmentFieldValue>(value);
  const attachmentUrl = buildAttachmentUrl(
    attachmentValue?.kind === "attachment" ? attachmentValue : null,
    documentId,
    field.id,
    claimToken,
    walletAddress,
  );

  useEffect(() => {
    const nextError = validateField(field, value, {
      signatureReady,
      allValues,
    });
    if (active) {
      if (!nextError && error) setError(null);
      return;
    }
    setError(nextError);
  }, [active, allValues, error, field, signatureReady, value]);

  const handleValueChange = (nextValue: string) => {
    onChange(field.id, nextValue);
    if (error) setError(null);
  };

  const handleBlur = () => {
    setError(validateField(field, value, { signatureReady, allValues }));
    onBlur();
  };

  const runAsyncFieldAction = async (action: "attachment" | "payment" | "idv", runner: () => Promise<void>) => {
    onFocus();
    setBusyAction(action);
    setError(null);
    try {
      await runner();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setBusyAction(null);
      handleBlur();
    }
  };

  if (isOtherSigners && otherValue) {
    return (
      <OtherSignerFilledField field={field} forensicId={forensicId} inputType={inputType} otherValue={otherValue} />
    );
  }
  if (isOtherSigners) {
    return <OtherSignerEmptyField field={field} forensicId={forensicId} inputType={inputType} />;
  }

  const callbacks: FieldInputCallbacks = {
    onChange,
    onFocus,
    onBlur: handleBlur,
    onRequestSignature,
    onRequestPhoneDraw,
    onUploadAttachment,
    onRunIdentityCheck,
    onStartPayment,
    onStartSocialVerify,
    onApplyAddressSuggestion,
    onLoadAddressSuggestions,
  };

  return (
    <EditableFieldBody
      field={field}
      forensicId={forensicId}
      inputType={inputType}
      value={value}
      canEdit={canEdit}
      signatureReady={signatureReady}
      busyAction={busyAction}
      error={error}
      filled={filled}
      displayValue={getFieldDisplayText(field, value)}
      stateStyles={getStateStyles({
        error,
        active,
        filled,
        isRequired,
        canEdit,
      })}
      canReuse={canEdit && !value && !!siblingValue && !filled && !NON_REUSABLE_TYPES.has(inputType)}
      fillAllEnabled={hasSiblings === true && !!value && !NON_FILL_ALL_TYPES.has(inputType)}
      attachmentUrl={attachmentUrl}
      attachmentValue={attachmentValue?.kind === "attachment" ? attachmentValue : null}
      callbacks={callbacks}
      handleValueChange={handleValueChange}
      handleBlur={handleBlur}
      runAsyncFieldAction={runAsyncFieldAction}
      onChange={onChange}
      onFillMatching={onFillMatching}
      isRequired={isRequired}
      active={active}
      siblingValue={siblingValue}
      helpText={resolveFieldHelpText(field) ?? null}
    />
  );
}
