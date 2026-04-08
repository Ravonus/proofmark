"use client";

import type { AddressSuggestion } from "~/lib/address-autocomplete";
import { isAddressLikeField } from "~/lib/address-autocomplete";
import type { InlineField } from "~/lib/document/document-tokens";
import {
  formatEditableFieldValue,
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
} from "~/lib/document/field-runtime";
import { getSignerColor } from "../fields";
import { AddressAutocompleteInput } from "../fields/address-autocomplete-input";
import { getFieldIcon } from "../fields/field-picker";
import { formatCurrency } from "../signing/sign-document-helpers";

// -- Preview Field --

type PreviewFieldProps = {
  field: InlineField;
  value?: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  onApplySuggestion?: (suggestion: AddressSuggestion) => void;
  loadAddressSuggestions?: (query: string, field: InlineField) => Promise<AddressSuggestion[]>;
};

/** Returns a toggle label for action-type inputs, or null for regular inputs. */
function resolveActionLabel(
  inputType: string,
  runtimeSettings: ReturnType<typeof getRuntimeFieldSettings>,
): string | null {
  if (inputType === "idv") return "Verified";
  if (inputType === "signature") return "Signed";
  if (inputType === "initials") return "J.S.";
  if (inputType === "payment") {
    const amount = Number(runtimeSettings.amount ?? 0);
    const currency = runtimeSettings.currency ?? "usd";
    return amount > 0 ? `${formatCurrency(amount, currency)} paid` : "Marked paid";
  }
  return null;
}

export function PreviewField({
  field,
  value,
  onChange,
  onFocus,
  onApplySuggestion,
  loadAddressSuggestions,
}: PreviewFieldProps) {
  const sc = getSignerColor(field.signerIdx ?? 0);
  const FieldIcon = getFieldIcon(field.type);
  const runtimeSettings = getRuntimeFieldSettings(field);
  const inputType = resolveFieldInputType(field);
  const options = resolveFieldOptions(field);
  const placeholder = resolveFieldPlaceholder(field);
  const autocomplete = resolveFieldAutocomplete(field);
  const prefix = resolveFieldPrefix(field);
  const suffix = resolveFieldSuffix(field);
  const logo = resolveFieldLogo(field, value);
  const badge = resolveFieldBadge(field, value);
  const helpText = resolveFieldHelpText(field);
  const previewValue = value ?? "";

  const fieldClasses = `inline-flex items-center gap-2 rounded-md border px-3 py-1.5 mx-0.5 my-0.5 transition-colors ${sc.border} ${sc.bg}`;
  const textClasses = previewValue ? "text-primary" : "text-muted italic";

  if (inputType === "textarea") {
    return (
      <PreviewTextarea
        field={field}
        sc={sc}
        FieldIcon={FieldIcon}
        previewValue={previewValue}
        placeholder={placeholder}
        autocomplete={autocomplete}
        helpText={helpText}
        rows={runtimeSettings.rows ?? 3}
        onChange={onChange}
        onFocus={onFocus}
      />
    );
  }

  if (inputType === "select" || inputType === "radio") {
    return (
      <PreviewSelectOrRadio
        field={field}
        sc={sc}
        FieldIcon={FieldIcon}
        inputType={inputType}
        previewValue={previewValue}
        placeholder={placeholder}
        options={options}
        helpText={helpText}
        fieldClasses={fieldClasses}
        onChange={onChange}
        onFocus={onFocus}
      />
    );
  }

  if (inputType === "checkbox") {
    return (
      <label className={`${fieldClasses} cursor-pointer`}>
        <input
          type="checkbox"
          checked={previewValue === "true"}
          onChange={(e) => onChange(e.target.checked ? "true" : "")}
          onFocus={onFocus}
          className="rounded accent-current"
        />
        <FieldIcon className={`h-3 w-3 shrink-0 ${sc.text}`} />
        <span className="text-sm text-primary">{placeholder}</span>
      </label>
    );
  }

  if (inputType === "file") {
    return (
      <label className={`${fieldClasses} cursor-pointer`}>
        <FieldIcon className={`h-3 w-3 shrink-0 ${sc.text}`} />
        <span className={`text-[10px] font-medium uppercase tracking-wide ${sc.text}`}>{field.label}</span>
        <input
          type="file"
          accept={runtimeSettings.accept}
          className="hidden"
          onFocus={onFocus}
          onChange={(e) => onChange(e.target.files?.[0]?.name ?? "")}
        />
        <span className={`text-sm ${textClasses}`}>{previewValue || placeholder}</span>
      </label>
    );
  }

  const actionLabel = resolveActionLabel(inputType, runtimeSettings);
  if (actionLabel) {
    return (
      <PreviewActionButton
        fieldClasses={fieldClasses}
        sc={sc}
        FieldIcon={FieldIcon}
        field={field}
        previewValue={previewValue}
        placeholder={placeholder}
        textClasses={textClasses}
        toggleLabel={actionLabel}
        onFocus={onFocus}
        onChange={onChange}
      />
    );
  }

  // Default: text input (email, tel, date, url, number, etc.)
  return (
    <PreviewDefaultInput
      field={field}
      sc={sc}
      FieldIcon={FieldIcon}
      inputType={inputType}
      previewValue={previewValue}
      placeholder={placeholder}
      autocomplete={autocomplete}
      prefix={prefix}
      suffix={suffix}
      logo={logo}
      badge={badge}
      runtimeSettings={runtimeSettings}
      fieldClasses={fieldClasses}
      onChange={onChange}
      onFocus={onFocus}
      onApplySuggestion={onApplySuggestion}
      loadAddressSuggestions={loadAddressSuggestions}
    />
  );
}

// ── Sub-components ──

type SignerColor = ReturnType<typeof getSignerColor>;

function PreviewTextarea({
  field,
  sc,
  FieldIcon,
  previewValue,
  placeholder,
  autocomplete,
  helpText,
  rows,
  onChange,
  onFocus,
}: {
  field: InlineField;
  sc: SignerColor;
  FieldIcon: React.ComponentType<{ className?: string }>;
  previewValue: string;
  placeholder: string;
  autocomplete: string | undefined;
  helpText: string | null | undefined;
  rows: number;
  onChange: (v: string) => void;
  onFocus: () => void;
}) {
  return (
    <span
      className={`mx-0.5 my-0.5 inline-flex min-w-[240px] max-w-[420px] flex-col gap-1.5 rounded-md border px-3 py-2 ${sc.border} ${sc.bg}`}
    >
      <span className="inline-flex items-center gap-1.5">
        <FieldIcon className={`h-3 w-3 shrink-0 ${sc.text}`} />
        <span className={`text-[10px] font-medium uppercase tracking-wide ${sc.text}`}>{field.label}</span>
      </span>
      <textarea
        value={previewValue}
        onChange={(e) => onChange(formatEditableFieldValue(field, e.target.value))}
        onFocus={onFocus}
        placeholder={placeholder}
        rows={rows}
        autoComplete={autocomplete}
        className="w-full resize-none bg-transparent text-sm text-primary outline-none placeholder:text-muted"
      />
      {helpText && <span className="text-[10px] text-muted">{helpText}</span>}
    </span>
  );
}

function PreviewSelectOrRadio({
  field,
  sc,
  FieldIcon,
  inputType,
  previewValue,
  placeholder,
  options,
  helpText,
  fieldClasses,
  onChange,
  onFocus,
}: {
  field: InlineField;
  sc: SignerColor;
  FieldIcon: React.ComponentType<{ className?: string }>;
  inputType: string;
  previewValue: string;
  placeholder: string;
  options: string[];
  helpText: string | null | undefined;
  fieldClasses: string;
  onChange: (v: string) => void;
  onFocus: () => void;
}) {
  return (
    <span className={`${fieldClasses} ${inputType === "radio" ? "flex-wrap" : ""}`}>
      <FieldIcon className={`h-3 w-3 shrink-0 ${sc.text}`} />
      <span className={`text-[10px] font-medium uppercase tracking-wide ${sc.text}`}>{field.label}</span>
      {inputType === "select" ? (
        <select
          value={previewValue}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          className="min-w-[120px] bg-transparent text-sm text-primary outline-none"
        >
          <option value="" className="bg-[var(--bg-card)] text-muted">
            {placeholder}
          </option>
          {options.map((o) => (
            <option key={o} value={o} className="bg-[var(--bg-card)] text-primary">
              {o}
            </option>
          ))}
        </select>
      ) : (
        <span className="flex flex-wrap gap-2">
          {options.map((option) => (
            <label
              key={option}
              className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1 text-xs text-primary"
            >
              <input
                type="radio"
                name={`preview-${field.id}`}
                checked={previewValue === option}
                onChange={() => onChange(option)}
                onFocus={onFocus}
                className="accent-current"
              />
              {option}
            </label>
          ))}
        </span>
      )}
      {helpText && <span className="w-full text-[10px] text-muted">{helpText}</span>}
    </span>
  );
}

function PreviewActionButton({
  fieldClasses,
  sc,
  FieldIcon,
  field,
  previewValue,
  placeholder,
  textClasses,
  toggleLabel,
  onFocus,
  onChange,
}: {
  fieldClasses: string;
  sc: SignerColor;
  FieldIcon: React.ComponentType<{ className?: string }>;
  field: InlineField;
  previewValue: string;
  placeholder: string;
  textClasses: string;
  toggleLabel: string;
  onFocus: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        onFocus();
        onChange(previewValue ? "" : toggleLabel);
      }}
      className={`${fieldClasses} transition-colors`}
    >
      <FieldIcon className={`h-3 w-3 shrink-0 ${sc.text}`} />
      <span className={`text-[10px] font-medium uppercase tracking-wide ${sc.text}`}>{field.label}</span>
      <span className={`text-sm ${textClasses}`}>{previewValue || placeholder}</span>
    </button>
  );
}

const PREVIEW_INPUT_TYPES = new Set(["email", "tel", "date", "time", "datetime-local", "url", "number"]);

function PreviewDefaultInput({
  field,
  sc,
  FieldIcon,
  inputType,
  previewValue,
  placeholder,
  autocomplete,
  prefix,
  suffix,
  logo,
  badge,
  runtimeSettings,
  fieldClasses,
  onChange,
  onFocus,
  onApplySuggestion,
  loadAddressSuggestions,
}: {
  field: InlineField;
  sc: SignerColor;
  FieldIcon: React.ComponentType<{ className?: string }>;
  inputType: string;
  previewValue: string;
  placeholder: string;
  autocomplete: string | undefined;
  prefix: string | null | undefined;
  suffix: string | null | undefined;
  logo: string | null | undefined;
  badge: string | null | undefined;
  runtimeSettings: ReturnType<typeof getRuntimeFieldSettings>;
  fieldClasses: string;
  onChange: (v: string) => void;
  onFocus: () => void;
  onApplySuggestion?: (suggestion: AddressSuggestion) => void;
  loadAddressSuggestions?: (query: string, field: InlineField) => Promise<AddressSuggestion[]>;
}) {
  return (
    <span className={fieldClasses} style={{ minWidth: field.type === "address" ? "220px" : "150px" }}>
      <FieldIcon className={`h-3 w-3 shrink-0 ${sc.text}`} />
      <span className={`text-[10px] font-medium uppercase tracking-wide ${sc.text}`}>{field.label}</span>
      {logo && (
        <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-secondary">{logo}</span>
      )}
      {badge && (
        <span className="rounded-full border border-border px-1.5 py-0.5 text-[9px] text-secondary">{badge}</span>
      )}
      {prefix && <span className="text-xs text-muted">{prefix}</span>}
      {isAddressLikeField(field) && loadAddressSuggestions ? (
        <AddressAutocompleteInput
          value={previewValue}
          placeholder={placeholder}
          autoComplete={autocomplete}
          onChange={(nextValue) => onChange(formatEditableFieldValue(field, nextValue))}
          onFocus={onFocus}
          onSuggestionSelect={(suggestion) => onApplySuggestion?.(suggestion)}
          loadSuggestions={(query) => loadAddressSuggestions(query, field)}
          wrapperClassName="relative flex-1 min-w-[220px]"
          inputClassName="bg-transparent outline-none text-sm w-full min-w-0 text-primary placeholder:text-muted"
        />
      ) : (
        <input
          type={PREVIEW_INPUT_TYPES.has(inputType) ? inputType : "text"}
          value={previewValue}
          onChange={(e) => onChange(formatEditableFieldValue(field, e.target.value))}
          onFocus={onFocus}
          placeholder={placeholder}
          autoComplete={autocomplete}
          min={runtimeSettings.validation?.min}
          max={runtimeSettings.validation?.max}
          step={runtimeSettings.validation?.step}
          className="w-full min-w-0 bg-transparent text-sm text-primary outline-none placeholder:text-muted"
        />
      )}
      {suffix && <span className="text-xs text-muted">{suffix}</span>}
    </span>
  );
}
