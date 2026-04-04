"use client";

import { useState, useEffect } from "react";
import type { AddressSuggestion } from "~/lib/address-autocomplete";
import { isAddressLikeField } from "~/lib/address-autocomplete";
import {
  decodeStructuredFieldValue,
  type AttachmentFieldValue,
  type IdentityVerificationFieldValue,
  type PaymentFieldValue,
  type SocialVerificationFieldValue,
} from "~/lib/field-values";
import {
  getRuntimeFieldSettings,
  resolveFieldAutocomplete,
  resolveFieldBadge,
  resolveFieldHelpText,
  resolveFieldInputType,
  resolveFieldLogo,
  resolveFieldOptions,
  resolveFieldPlaceholder,
  resolveFieldPrefix,
  resolveFieldSuffix,
} from "~/lib/field-runtime";
import { AddressAutocompleteInput } from "./fields/address-autocomplete-input";
import { AlertCircle, CheckCircle, Copy } from "lucide-react";
import type { InlineField } from "./sign-document-helpers";
import {
  formatCurrency,
  getFieldDisplayText,
  getFieldMinWidth,
  getFieldVisualStyle,
  validateField,
} from "./sign-document-helpers";

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
  const runtimeSettings = getRuntimeFieldSettings(field);
  const inputType =
    field.type === "signature" || field.type === "initials" ? "signature" : resolveFieldInputType(field);
  const s = getFieldVisualStyle(field);
  const placeholder = resolveFieldPlaceholder(field);
  const autocomplete = resolveFieldAutocomplete(field);
  const options = resolveFieldOptions(field);
  const prefix = resolveFieldPrefix(field);
  const suffix = resolveFieldSuffix(field);
  const badge = resolveFieldBadge(field, value);
  const logo = resolveFieldLogo(field, value);
  const helpText = resolveFieldHelpText(field);
  const filled = isFilled || !validateField(field, value, { signatureReady, allValues });
  const displayValue = getFieldDisplayText(field, value);
  const attachmentValue = decodeStructuredFieldValue<AttachmentFieldValue>(value);
  const paymentValue = decodeStructuredFieldValue<PaymentFieldValue>(value);
  const verificationValue = decodeStructuredFieldValue<IdentityVerificationFieldValue>(value);
  const socialVerifValue = decodeStructuredFieldValue<SocialVerificationFieldValue>(value);
  const fieldMinWidth = getFieldMinWidth(field);
  const attachmentUrl = attachmentValue
    ? claimToken
      ? `/api/signer-attachments/${documentId}/${field.id}?claimToken=${encodeURIComponent(claimToken)}`
      : walletAddress
        ? `/api/signer-attachments/${documentId}/${field.id}?address=${encodeURIComponent(walletAddress)}`
        : null
    : null;
  // Show reuse icon when this field is empty but a sibling with the same type:label has a value
  const canReuse =
    canEdit &&
    !value &&
    !!siblingValue &&
    !filled &&
    !["checkbox", "file", "payment", "idv", "social-verify"].includes(inputType);

  const stateStyles = error
    ? "ring-2 ring-red-400/60 border-red-400/40"
    : active
      ? "ring-2 ring-accent/60 shadow-[0_0_24px_rgba(var(--accent-rgb,99,102,241),0.3)] border-accent/50"
      : filled
        ? "border-green-400/30 bg-green-400/5"
        : isRequired && canEdit
          ? "ring-1 ring-red-400/30 border-red-400/20"
          : "";

  useEffect(() => {
    const nextError = validateField(field, value, { signatureReady, allValues });
    if (active) {
      if (!nextError && error) {
        setError(null);
      }
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

  const handleAttachmentInput = async (file: File | null) => {
    if (!file) return;
    const maxSizeMb = Number(runtimeSettings.maxSizeMb ?? 15);
    if (Number.isFinite(maxSizeMb) && maxSizeMb > 0 && file.size > maxSizeMb * 1024 * 1024) {
      setError(`File must be ${maxSizeMb}MB or smaller`);
      return;
    }

    await runAsyncFieldAction("attachment", async () => {
      await onUploadAttachment(field, file);
    });
  };

  const fillAllEnabled =
    hasSiblings && !!value && !["checkbox", "file", "payment", "idv", "social-verify", "signature"].includes(inputType);

  // Other signer already filled this field
  if (isOtherSigners && otherValue) {
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
          {logo && (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted">{logo}</span>
          )}
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

  // Other signer's unfilled field
  if (isOtherSigners) {
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
          {logo && (
            <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-muted">{logo}</span>
          )}
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
              {inputType === "textarea" ? (
                <textarea
                  value={value ?? ""}
                  placeholder={placeholder}
                  onChange={(event) => handleValueChange(event.target.value)}
                  onFocus={onFocus}
                  onBlur={handleBlur}
                  rows={runtimeSettings.rows ?? 2}
                  autoComplete={autocomplete}
                  className="placeholder:text-muted/50 min-h-[3.25rem] w-full min-w-0 resize-y bg-transparent text-sm text-primary outline-none"
                  style={{ fontFamily: "'Georgia', serif" }}
                />
              ) : inputType === "select" ? (
                <select
                  value={value ?? ""}
                  onChange={(event) => handleValueChange(event.target.value)}
                  onFocus={onFocus}
                  onBlur={handleBlur}
                  className="min-w-0 flex-1 bg-transparent text-sm text-primary outline-none"
                  style={{ fontFamily: "'Georgia', serif" }}
                >
                  <option value="" className="bg-[var(--bg-card)] text-secondary">
                    {placeholder}
                  </option>
                  {options.map((option) => (
                    <option key={option} value={option} className="bg-[var(--bg-card)] text-primary">
                      {option}
                    </option>
                  ))}
                </select>
              ) : inputType === "radio" ? (
                <span className="flex min-w-0 flex-1 flex-wrap gap-2">
                  {options.map((option) => (
                    <label
                      key={option}
                      className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors ${
                        value === option
                          ? "border-accent/50 bg-accent/10 text-white"
                          : "border-border text-secondary hover:border-border hover:text-primary"
                      }`}
                    >
                      <input
                        type="radio"
                        name={field.id}
                        checked={value === option}
                        onChange={() => handleValueChange(option)}
                        onFocus={onFocus}
                        onBlur={handleBlur}
                        className="accent-current"
                      />
                      {option}
                    </label>
                  ))}
                </span>
              ) : inputType === "checkbox" ? (
                <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-primary">
                  <input
                    type="checkbox"
                    checked={value === "true"}
                    onChange={(event) => handleValueChange(event.target.checked ? "true" : "")}
                    onFocus={onFocus}
                    onBlur={handleBlur}
                    className="rounded border-border bg-transparent"
                  />
                  <span className="truncate">{placeholder}</span>
                </label>
              ) : inputType === "file" ? (
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                  <input
                    type="file"
                    accept={runtimeSettings.accept}
                    className="hidden"
                    onClick={onFocus}
                    onBlur={handleBlur}
                    onChange={(event) => void handleAttachmentInput(event.target.files?.[0] ?? null)}
                  />
                  <span className="truncate text-sm text-primary" style={{ fontFamily: "'Georgia', serif" }}>
                    {attachmentValue?.kind === "attachment"
                      ? attachmentValue.originalName
                      : busyAction === "attachment"
                        ? "Uploading..."
                        : placeholder}
                  </span>
                </label>
              ) : inputType === "payment" ? (
                <button
                  type="button"
                  onClick={() =>
                    void runAsyncFieldAction("payment", async () => {
                      await onStartPayment(field);
                    })
                  }
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm text-primary"
                  style={{ fontFamily: "'Georgia', serif" }}
                >
                  <span className="truncate">
                    {paymentValue?.kind === "payment"
                      ? `${formatCurrency(paymentValue.amount, paymentValue.currency)} paid`
                      : busyAction === "payment"
                        ? "Opening checkout..."
                        : runtimeSettings.description || getFieldDisplayText(field, value)}
                  </span>
                  <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-muted">
                    {paymentValue?.kind === "payment" ? "paid" : "pay"}
                  </span>
                </button>
              ) : inputType === "idv" ? (
                <button
                  type="button"
                  onClick={() =>
                    void runAsyncFieldAction("idv", async () => {
                      await onRunIdentityCheck(field);
                    })
                  }
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm text-primary"
                  style={{ fontFamily: "'Georgia', serif" }}
                >
                  <span className="truncate">
                    {verificationValue?.kind === "id-verification"
                      ? `Verified (${verificationValue.score}/${verificationValue.threshold})`
                      : busyAction === "idv"
                        ? "Running verification..."
                        : placeholder}
                  </span>
                  <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-muted">
                    {verificationValue?.status === "verified" ? "verified" : "verify"}
                  </span>
                </button>
              ) : inputType === "social-verify" ? (
                <button
                  type="button"
                  onClick={() => {
                    onFocus();
                    onStartSocialVerify(field);
                  }}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm text-primary"
                  style={{ fontFamily: "'Georgia', serif" }}
                >
                  <span className="truncate">
                    {socialVerifValue?.kind === "social-verification"
                      ? `@${socialVerifValue.username}`
                      : busyAction === "social"
                        ? "Verifying..."
                        : runtimeSettings.requiredUsername
                          ? `Verify as @${String(runtimeSettings.requiredUsername).replace(/^@/, "")}`
                          : placeholder}
                  </span>
                  <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-muted">
                    {socialVerifValue?.status === "verified" ? "verified" : "verify"}
                  </span>
                </button>
              ) : inputType === "signature" ? (
                <div className="flex min-w-0 flex-1 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      onFocus();
                      onRequestSignature();
                    }}
                    onBlur={handleBlur}
                    className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm text-primary"
                    style={{ fontFamily: "'Georgia', serif" }}
                  >
                    {field.type === "initials" ? (
                      <>
                        <span className="truncate">
                          {value ? <img src={value} alt="Initials" className="inline-block max-h-5" /> : placeholder}
                        </span>
                        <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-muted">
                          {value ? "done" : "draw"}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="truncate">{signatureReady ? "Signature ready" : placeholder}</span>
                        <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[9px] uppercase tracking-[0.2em] text-muted">
                          {signatureReady ? "signed" : "draw"}
                        </span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onFocus();
                      onRequestPhoneDraw();
                    }}
                    className="shrink-0 rounded-full bg-surface-elevated p-1 text-muted transition-colors hover:text-primary"
                    title="Draw on phone"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                      <line x1="12" y1="18" x2="12" y2="18" />
                    </svg>
                  </button>
                </div>
              ) : isAddressLikeField(field) ? (
                <AddressAutocompleteInput
                  value={value ?? ""}
                  placeholder={placeholder}
                  autoComplete={autocomplete}
                  onChange={(nextValue) => handleValueChange(nextValue)}
                  onFocus={onFocus}
                  onBlur={handleBlur}
                  onSuggestionSelect={(suggestion) => onApplyAddressSuggestion(field, suggestion)}
                  loadSuggestions={(query) => onLoadAddressSuggestions(query, field)}
                  wrapperClassName="relative flex-1 min-w-[220px]"
                  inputClassName="bg-transparent outline-none text-sm w-full min-w-0 text-primary placeholder:text-muted/50"
                />
              ) : (
                <input
                  type={
                    inputType === "wallet" || inputType === "initials" || inputType === "address-group"
                      ? "text"
                      : inputType
                  }
                  value={value ?? ""}
                  name={field.id}
                  placeholder={placeholder}
                  onChange={(event) => handleValueChange(event.target.value)}
                  onFocus={onFocus}
                  onBlur={handleBlur}
                  autoComplete={autocomplete}
                  min={runtimeSettings.validation?.min}
                  max={runtimeSettings.validation?.max}
                  step={runtimeSettings.validation?.step}
                  className="placeholder:text-muted/50 w-full min-w-0 bg-transparent text-sm text-primary outline-none"
                  style={{ fontFamily: "'Georgia', serif" }}
                />
              )}

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
