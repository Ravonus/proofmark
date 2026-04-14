"use client";

import { type ReactNode } from "react";
import type { AddressSuggestion } from "~/lib/address-autocomplete";
import { isAddressLikeField } from "~/lib/address-autocomplete";
import {
  getRuntimeFieldSettings,
  resolveFieldAutocomplete,
  resolveFieldInputType,
  resolveFieldOptions,
} from "~/lib/document/field-runtime";
import {
  type AttachmentFieldValue,
  decodeStructuredFieldValue,
  type IdentityVerificationFieldValue,
  type PaymentFieldValue,
  type SocialVerificationFieldValue,
} from "~/lib/document/field-values";
import { AddressAutocompleteInput } from "../fields/address-autocomplete-input";
import type { InlineField } from "./sign-document-helpers";
import { formatCurrency, getFieldDisplayText } from "./sign-document-helpers";

// ─── Shared types for field input renderers ─────────────────────────────────

export type FieldInputCallbacks = {
  onChange: (id: string, value: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onRequestSignature: () => void;
  onRequestPhoneDraw: () => void;
  onUploadAttachment: (field: InlineField, file: File) => Promise<string>;
  onRunIdentityCheck: (field: InlineField) => Promise<string>;
  onStartPayment: (field: InlineField) => Promise<void>;
  onStartSocialVerify: (field: InlineField) => void;
  onApplyAddressSuggestion: (field: InlineField, suggestion: AddressSuggestion) => void;
  onLoadAddressSuggestions: (query: string, field: InlineField) => Promise<AddressSuggestion[]>;
};

type InputProps = {
  field: InlineField;
  value: string | undefined;
  signatureReady: boolean | undefined;
  busyAction: "attachment" | "payment" | "idv" | "social" | null;
  callbacks: FieldInputCallbacks;
  handleValueChange: (nextValue: string) => void;
  handleBlur: () => void;
  runAsyncFieldAction: (action: "attachment" | "payment" | "idv", runner: () => Promise<void>) => Promise<void>;
};

// ─── Textarea ───────────────────────────────────────────────────────────────

function TextareaInput({ field, value, handleValueChange, handleBlur, callbacks }: InputProps) {
  const runtimeSettings = getRuntimeFieldSettings(field);
  const placeholder = field.placeholder ?? field.label;
  const autocomplete = resolveFieldAutocomplete(field);
  return (
    <textarea
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(event) => handleValueChange(event.target.value)}
      onFocus={callbacks.onFocus}
      onBlur={handleBlur}
      rows={runtimeSettings.rows ?? 2}
      autoComplete={autocomplete}
      className="placeholder:text-muted/50 min-h-[3.25rem] w-full min-w-0 resize-y bg-transparent text-sm text-primary outline-none"
      style={{ fontFamily: "'Georgia', serif" }}
    />
  );
}

// ─── Select ─────────────────────────────────────────────────────────────────

function SelectInput({ field, value, handleValueChange, handleBlur, callbacks }: InputProps) {
  const options = resolveFieldOptions(field);
  const placeholder = field.placeholder ?? field.label;
  return (
    <select
      value={value ?? ""}
      onChange={(event) => handleValueChange(event.target.value)}
      onFocus={callbacks.onFocus}
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
  );
}

// ─── Radio ──────────────────────────────────────────────────────────────────

function RadioInput({ field, value, handleValueChange, handleBlur, callbacks }: InputProps) {
  const options = resolveFieldOptions(field);
  return (
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
            onFocus={callbacks.onFocus}
            onBlur={handleBlur}
            className="accent-current"
          />
          {option}
        </label>
      ))}
    </span>
  );
}

// ─── Checkbox ───────────────────────────────────────────────────────────────

function CheckboxInput({ field, value, handleValueChange, handleBlur, callbacks }: InputProps) {
  const placeholder = field.placeholder ?? field.label;
  return (
    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-primary">
      <input
        type="checkbox"
        checked={value === "true"}
        onChange={(event) => handleValueChange(event.target.checked ? "true" : "")}
        onFocus={callbacks.onFocus}
        onBlur={handleBlur}
        className="rounded border-border bg-transparent"
      />
      <span className="truncate">{placeholder}</span>
    </label>
  );
}

// ─── File ───────────────────────────────────────────────────────────────────

function FileInput({ field, value, busyAction, callbacks, handleBlur, runAsyncFieldAction }: InputProps) {
  const runtimeSettings = getRuntimeFieldSettings(field);
  const placeholder = field.placeholder ?? field.label;
  const attachmentValue = decodeStructuredFieldValue<AttachmentFieldValue>(value);

  const handleAttachmentInput = async (file: File | null) => {
    if (!file) return;
    const maxSizeMb = Number(runtimeSettings.maxSizeMb ?? 15);
    if (Number.isFinite(maxSizeMb) && maxSizeMb > 0 && file.size > maxSizeMb * 1024 * 1024) {
      return;
    }
    await runAsyncFieldAction("attachment", async () => {
      await callbacks.onUploadAttachment(field, file);
    });
  };

  return (
    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
      <input
        type="file"
        accept={runtimeSettings.accept}
        className="hidden"
        onClick={callbacks.onFocus}
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
  );
}

// ─── Payment ────────────────────────────────────────────────────────────────

function PaymentInput({ field, value, busyAction, callbacks, runAsyncFieldAction }: InputProps) {
  const runtimeSettings = getRuntimeFieldSettings(field);
  const paymentValue = decodeStructuredFieldValue<PaymentFieldValue>(value);
  return (
    <button
      type="button"
      onClick={() =>
        void runAsyncFieldAction("payment", async () => {
          await callbacks.onStartPayment(field);
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
  );
}

// ─── Identity Verification ──────────────────────────────────────────────────

function IdvInput({ field, value, busyAction, callbacks, runAsyncFieldAction }: InputProps) {
  const placeholder = field.placeholder ?? field.label;
  const verificationValue = decodeStructuredFieldValue<IdentityVerificationFieldValue>(value);
  return (
    <button
      type="button"
      onClick={() =>
        void runAsyncFieldAction("idv", async () => {
          await callbacks.onRunIdentityCheck(field);
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
  );
}

// ─── Social Verify ──────────────────────────────────────────────────────────

function SocialVerifyInput({ field, value, busyAction, callbacks }: InputProps) {
  const runtimeSettings = getRuntimeFieldSettings(field);
  const placeholder = field.placeholder ?? field.label;
  const socialVerifValue = decodeStructuredFieldValue<SocialVerificationFieldValue>(value);
  return (
    <button
      type="button"
      onClick={() => {
        callbacks.onFocus();
        callbacks.onStartSocialVerify(field);
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
  );
}

// ─── Signature / Initials ───────────────────────────────────────────────────

function SignatureInput({ field, value, signatureReady, callbacks, handleBlur }: InputProps) {
  const placeholder = field.placeholder ?? field.label;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <button
        type="button"
        onClick={() => {
          callbacks.onFocus();
          callbacks.onRequestSignature();
        }}
        onBlur={handleBlur}
        className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-sm text-primary"
        style={{ fontFamily: "'Georgia', serif" }}
      >
        {field.type === "initials" ? (
          <>
            <span className="truncate">
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL initials preview, not a remote image */}
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
          callbacks.onFocus();
          callbacks.onRequestPhoneDraw();
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
  );
}

// ─── Address Autocomplete ───────────────────────────────────────────────────

function AddressFieldInput({ field, value, handleValueChange, handleBlur, callbacks }: InputProps) {
  const placeholder = field.placeholder ?? field.label;
  const autocomplete = resolveFieldAutocomplete(field);
  return (
    <AddressAutocompleteInput
      value={value ?? ""}
      placeholder={placeholder}
      autoComplete={autocomplete}
      onChange={(nextValue) => handleValueChange(nextValue)}
      onFocus={callbacks.onFocus}
      onBlur={handleBlur}
      onSuggestionSelect={(suggestion) => callbacks.onApplyAddressSuggestion(field, suggestion)}
      loadSuggestions={(query) => callbacks.onLoadAddressSuggestions(query, field)}
      wrapperClassName="relative flex-1 min-w-[220px]"
      inputClassName="bg-transparent outline-none text-sm w-full min-w-0 text-primary placeholder:text-muted/50"
    />
  );
}

// ─── Default text/number/etc ────────────────────────────────────────────────

function DefaultInput({ field, value, handleValueChange, handleBlur, callbacks }: InputProps & { inputType: string }) {
  const runtimeSettings = getRuntimeFieldSettings(field);
  const placeholder = field.placeholder ?? field.label;
  const autocomplete = resolveFieldAutocomplete(field);
  const inputType = resolveFieldInputType(field);
  const htmlInputType =
    inputType === "wallet" || inputType === "initials" || inputType === "address-group" ? "text" : inputType;
  return (
    <input
      type={htmlInputType}
      value={value ?? ""}
      name={field.id}
      placeholder={placeholder}
      onChange={(event) => handleValueChange(event.target.value)}
      onFocus={callbacks.onFocus}
      onBlur={handleBlur}
      autoComplete={autocomplete}
      min={runtimeSettings.validation?.min}
      max={runtimeSettings.validation?.max}
      step={runtimeSettings.validation?.step}
      className="placeholder:text-muted/50 w-full min-w-0 bg-transparent text-sm text-primary outline-none"
      style={{ fontFamily: "'Georgia', serif" }}
    />
  );
}

// ─── Public renderer dispatch ───────────────────────────────────────────────

export function renderFieldInput(inputType: string, props: InputProps): ReactNode {
  switch (inputType) {
    case "textarea":
      return <TextareaInput {...props} />;
    case "select":
      return <SelectInput {...props} />;
    case "radio":
      return <RadioInput {...props} />;
    case "checkbox":
      return <CheckboxInput {...props} />;
    case "file":
      return <FileInput {...props} />;
    case "payment":
      return <PaymentInput {...props} />;
    case "idv":
      return <IdvInput {...props} />;
    case "social-verify":
      return <SocialVerifyInput {...props} />;
    case "signature":
      return <SignatureInput {...props} />;
    default:
      if (isAddressLikeField(props.field)) return <AddressFieldInput {...props} />;
      return <DefaultInput {...props} inputType={inputType} />;
  }
}
