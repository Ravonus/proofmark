"use client";

import { useState, memo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Select } from "../ui/select";
import type { AddressSuggestion } from "~/lib/address-autocomplete";
import { isAddressLikeField } from "~/lib/address-autocomplete";
import type { DocToken, InlineField } from "~/lib/document/document-tokens";
import {
  formatEditableFieldValue,
  getFieldLogicState,
  getRuntimeFieldSettings,
  type LogicEffect,
  resolveFieldAutocomplete,
  resolveFieldBadge,
  resolveFieldHelpText,
  resolveFieldInputType,
  resolveFieldLogo,
  resolveFieldOptions,
  resolveFieldPlaceholder,
  resolveFieldPrefix,
  resolveFieldSuffix,
  type RuntimeInputType,
  type VisibilityOperator,
} from "~/lib/document/field-runtime";
import { getField, getSignerColor } from "../fields";
import { AddressAutocompleteInput } from "../fields/address-autocomplete-input";
import { getFieldIcon } from "../fields/field-picker";
import { SearchDropdown } from "../ui/search-dropdown";
import { GripVertical, Trash2, X, PenTool } from "lucide-react";
import type { SignerDef, PreviewValueMap } from "./document-editor-types";
import {
  fieldDropdownItems,
  INPUT_TYPE_OPTIONS,
  VALIDATION_KIND_OPTIONS,
  VISIBILITY_OPERATOR_OPTIONS,
  LOGIC_EFFECT_OPTIONS,
} from "./document-editor-types";
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
          rows={runtimeSettings.rows ?? 3}
          autoComplete={autocomplete}
          className="w-full resize-none bg-transparent text-sm text-primary outline-none placeholder:text-muted"
        />
        {helpText && <span className="text-[10px] text-muted">{helpText}</span>}
      </span>
    );
  }

  if (inputType === "select" || inputType === "radio") {
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

  if (inputType === "payment") {
    const amount = Number(runtimeSettings.amount ?? 0);
    const currency = runtimeSettings.currency ?? "usd";
    const paidLabel = amount > 0 ? `${formatCurrency(amount, currency)} paid` : "Marked paid";
    return (
      <button
        type="button"
        onClick={() => {
          onFocus();
          onChange(previewValue ? "" : paidLabel);
        }}
        className={`${fieldClasses} transition-colors`}
      >
        <FieldIcon className={`h-3 w-3 shrink-0 ${sc.text}`} />
        <span className={`text-[10px] font-medium uppercase tracking-wide ${sc.text}`}>{field.label}</span>
        <span className={`text-sm ${textClasses}`}>{previewValue || placeholder}</span>
      </button>
    );
  }

  if (inputType === "idv") {
    return (
      <button
        type="button"
        onClick={() => {
          onFocus();
          onChange(previewValue ? "" : "Verified");
        }}
        className={`${fieldClasses} transition-colors`}
      >
        <FieldIcon className={`h-3 w-3 shrink-0 ${sc.text}`} />
        <span className={`text-[10px] font-medium uppercase tracking-wide ${sc.text}`}>{field.label}</span>
        <span className={`text-sm ${textClasses}`}>{previewValue || placeholder}</span>
      </button>
    );
  }

  if (inputType === "signature" || inputType === "initials") {
    return (
      <button
        type="button"
        onClick={() => {
          onFocus();
          onChange(previewValue ? "" : inputType === "initials" ? "J.S." : "Signed");
        }}
        className={`${fieldClasses} transition-colors`}
      >
        <FieldIcon className={`h-3 w-3 shrink-0 ${sc.text}`} />
        <span className={`text-[10px] font-medium uppercase tracking-wide ${sc.text}`}>{field.label}</span>
        <span className={`text-sm ${textClasses}`}>{previewValue || placeholder}</span>
      </button>
    );
  }

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
          type={
            ["email", "tel", "date", "time", "datetime-local", "url", "number"].includes(inputType) ? inputType : "text"
          }
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
    const runtimeSettings = getRuntimeFieldSettings(field);
    const inputType = resolveFieldInputType(field);
    const placeholder = resolveFieldPlaceholder(field);
    const badge = resolveFieldBadge(field, previewValue);
    const logo = resolveFieldLogo(field, previewValue);
    const helpText = resolveFieldHelpText(field);
    const logicFields = allFields.filter((candidate) => candidate.id !== field.id);
    const logicState = getFieldLogicState(field, previewValues);
    const visibleInPreview = logicState.visible;

    const updateSettings = (patch: Record<string, unknown>) => {
      onUpdate({
        settings: {
          ...(field.settings ?? {}),
          ...patch,
        },
      });
    };

    const updateNestedSettings = (key: "validation" | "logic" | "display", patch: Record<string, unknown>) => {
      const current = (runtimeSettings[key] ?? {}) as Record<string, unknown>;
      updateSettings({
        [key]: {
          ...current,
          ...patch,
        },
      });
    };

    if (previewMode) {
      if (!visibleInPreview) return null;
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
      <span className="group/field relative mx-0.5 my-0.5 inline-flex items-center" id={field.id}>
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
            active ? "ring-[var(--accent)]/30 shadow-sm ring-2" : "hover:shadow-sm"
          }`}
          onClick={() => {
            onFocus();
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
        <AnimatePresence>
          {showPopover && active && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowPopover(false)} />
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.12 }}
                className="absolute left-0 top-full z-50 mt-2 w-72 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-primary">Field Settings</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        onRemove();
                        setShowPopover(false);
                      }}
                      className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="h-3 w-3" /> Remove
                    </button>
                    <button onClick={() => setShowPopover(false)} className="text-muted hover:text-secondary">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted">Label</label>
                  <input
                    defaultValue={field.label}
                    onBlur={(e) => onUpdate({ label: e.target.value })}
                    placeholder="Field label"
                    className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted">Placeholder</label>
                  <input
                    defaultValue={placeholder}
                    onBlur={(e) => onUpdate({ placeholder: e.target.value })}
                    placeholder="Placeholder"
                    className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted">Type</label>
                  <SearchDropdown
                    items={fieldDropdownItems}
                    value={field.type}
                    onSelect={(item) => {
                      const nextField = getField(item.id);
                      onUpdate({
                        type: item.id,
                        placeholder: nextField?.placeholder || "Enter value",
                        options: nextField?.validation?.options,
                        settings:
                          item.id === "custom-field"
                            ? { inputType: "text", validation: {}, logic: {}, display: {} }
                            : field.settings,
                      });
                    }}
                    placeholder="Search field types..."
                    className="w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Input Mode</label>
                    <Select
                      value={inputType}
                      onChange={(v) => updateSettings({ inputType: v as RuntimeInputType })}
                      size="sm"
                      options={INPUT_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Autocomplete</label>
                    <input
                      defaultValue={runtimeSettings.autocomplete ?? resolveFieldAutocomplete(field) ?? ""}
                      onBlur={(e) => updateSettings({ autocomplete: e.target.value.trim() || undefined })}
                      placeholder="street-address, email, cc-number"
                      className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                    />
                  </div>
                </div>

                <label className="flex items-center justify-between text-[11px] text-secondary">
                  Required
                  <input
                    type="checkbox"
                    defaultChecked={field.required ?? true}
                    onChange={(e) => onUpdate({ required: e.target.checked })}
                    className="rounded accent-[var(--accent)]"
                  />
                </label>

                {(inputType === "select" || inputType === "radio") && (
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Options</label>
                    <textarea
                      defaultValue={resolveFieldOptions(field).join("\n")}
                      onBlur={(e) =>
                        onUpdate({
                          options: e.target.value
                            .split("\n")
                            .map((o) => o.trim())
                            .filter(Boolean),
                        })
                      }
                      rows={3}
                      placeholder="One option per line"
                      className="w-full resize-none rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                    />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Prefix</label>
                    <input
                      defaultValue={runtimeSettings.prefix ?? ""}
                      onBlur={(e) => updateSettings({ prefix: e.target.value || undefined })}
                      placeholder="$  @  №"
                      className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Suffix</label>
                    <input
                      defaultValue={runtimeSettings.suffix ?? ""}
                      onBlur={(e) => updateSettings({ suffix: e.target.value || undefined })}
                      placeholder="%  days"
                      className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Badge</label>
                    <input
                      defaultValue={runtimeSettings.display?.badge ?? ""}
                      onBlur={(e) => updateNestedSettings("display", { badge: e.target.value || undefined })}
                      placeholder="KYC, Visa, PO"
                      className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted">Logo / Mark</label>
                    <input
                      defaultValue={runtimeSettings.display?.logo ?? ""}
                      onBlur={(e) => updateNestedSettings("display", { logo: e.target.value || undefined })}
                      placeholder="VISA, ◎, 🏦"
                      className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted">Help Text</label>
                  <input
                    defaultValue={helpText ?? ""}
                    onBlur={(e) => updateNestedSettings("display", { helpText: e.target.value || undefined })}
                    placeholder="Shown under the field while signing"
                    className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-muted">Validation</label>
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={runtimeSettings.validation?.kind ?? ""}
                      onChange={(v) => updateNestedSettings("validation", { kind: v || undefined })}
                      size="sm"
                      options={VALIDATION_KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    />
                    <input
                      defaultValue={runtimeSettings.validation?.message ?? ""}
                      onBlur={(e) => updateNestedSettings("validation", { message: e.target.value || undefined })}
                      placeholder="Custom error message"
                      className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                    />
                  </div>
                  <input
                    defaultValue={runtimeSettings.validation?.pattern ?? ""}
                    onBlur={(e) => updateNestedSettings("validation", { pattern: e.target.value || undefined })}
                    placeholder="Regex pattern"
                    className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      defaultValue={String(runtimeSettings.validation?.minLength ?? "")}
                      onBlur={(e) =>
                        updateNestedSettings("validation", {
                          minLength: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      placeholder="Min length"
                      className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                    />
                    <input
                      type="number"
                      defaultValue={String(runtimeSettings.validation?.maxLength ?? "")}
                      onBlur={(e) =>
                        updateNestedSettings("validation", {
                          maxLength: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      placeholder="Max length"
                      className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                    />
                  </div>
                  {inputType === "number" && (
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="number"
                        defaultValue={String(runtimeSettings.validation?.min ?? "")}
                        onBlur={(e) =>
                          updateNestedSettings("validation", {
                            min: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        placeholder="Min"
                        className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                      />
                      <input
                        type="number"
                        defaultValue={String(runtimeSettings.validation?.max ?? "")}
                        onBlur={(e) =>
                          updateNestedSettings("validation", {
                            max: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        placeholder="Max"
                        className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                      />
                      <input
                        type="number"
                        defaultValue={String(runtimeSettings.validation?.step ?? "")}
                        onBlur={(e) =>
                          updateNestedSettings("validation", {
                            step: e.target.value ? Number(e.target.value) : undefined,
                          })
                        }
                        placeholder="Step"
                        className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                      />
                    </div>
                  )}
                  {inputType === "textarea" && (
                    <input
                      type="number"
                      min="2"
                      max="12"
                      defaultValue={String(runtimeSettings.rows ?? 3)}
                      onBlur={(e) => updateSettings({ rows: e.target.value ? Number(e.target.value) : undefined })}
                      placeholder="Rows"
                      className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                    />
                  )}
                  {inputType === "file" && (
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        defaultValue={runtimeSettings.accept ?? ""}
                        onBlur={(e) => updateSettings({ accept: e.target.value || undefined })}
                        placeholder=".pdf,.png,.jpg"
                        className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                      />
                      <input
                        type="number"
                        min="1"
                        defaultValue={String(runtimeSettings.maxSizeMb ?? "")}
                        onBlur={(e) =>
                          updateSettings({ maxSizeMb: e.target.value ? Number(e.target.value) : undefined })
                        }
                        placeholder="Max MB"
                        className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                      />
                    </div>
                  )}
                  {inputType === "payment" && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          defaultValue={String(runtimeSettings.amount ?? "")}
                          onBlur={(e) =>
                            updateSettings({ amount: e.target.value ? Number(e.target.value) : undefined })
                          }
                          placeholder="Amount"
                          className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                        />
                        <input
                          defaultValue={runtimeSettings.currency ?? "usd"}
                          onBlur={(e) => updateSettings({ currency: e.target.value || undefined })}
                          placeholder="usd"
                          className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm uppercase outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                        />
                      </div>
                      <input
                        defaultValue={runtimeSettings.description ?? ""}
                        onBlur={(e) => updateSettings({ description: e.target.value || undefined })}
                        placeholder="What the payment is for"
                        className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                      />
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-medium text-muted">Logic & Conditions</label>
                  <Select
                    value={runtimeSettings.logic?.showWhenFieldId ?? ""}
                    onChange={(v) => updateNestedSettings("logic", { showWhenFieldId: v || undefined })}
                    size="sm"
                    options={[
                      { value: "", label: "Always show" },
                      ...logicFields.map((c) => ({ value: c.id, label: `${c.label} (${c.id})` })),
                    ]}
                  />
                  <Select
                    value={runtimeSettings.logic?.effect ?? "show"}
                    onChange={(v) => updateNestedSettings("logic", { effect: v as LogicEffect })}
                    size="sm"
                    options={LOGIC_EFFECT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <Select
                      value={runtimeSettings.logic?.operator ?? "equals"}
                      onChange={(v) =>
                        updateNestedSettings("logic", {
                          operator: v as VisibilityOperator,
                          values: v === "one_of" ? runtimeSettings.logic?.values : undefined,
                        })
                      }
                      size="sm"
                      options={VISIBILITY_OPERATOR_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                    />
                    {runtimeSettings.logic?.operator === "one_of" ? (
                      <input
                        defaultValue={(runtimeSettings.logic?.values ?? []).join(", ")}
                        onBlur={(e) =>
                          updateNestedSettings("logic", {
                            values: e.target.value
                              .split(/[,\n]/)
                              .map((entry) => entry.trim())
                              .filter(Boolean),
                            value: undefined,
                          })
                        }
                        placeholder="approved, pending"
                        className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                      />
                    ) : (
                      <input
                        defaultValue={runtimeSettings.logic?.value ?? ""}
                        onBlur={(e) =>
                          updateNestedSettings("logic", {
                            value: e.target.value || undefined,
                            values: undefined,
                          })
                        }
                        placeholder="Match value"
                        className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
                      />
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <label className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] text-secondary">
                      Make required on match
                      <input
                        type="checkbox"
                        defaultChecked={runtimeSettings.logic?.requireOnMatch ?? false}
                        onChange={(e) =>
                          updateNestedSettings("logic", { requireOnMatch: e.target.checked || undefined })
                        }
                        className="rounded accent-[var(--accent)]"
                      />
                    </label>
                    <label className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] text-secondary">
                      Lock field on match
                      <input
                        type="checkbox"
                        defaultChecked={runtimeSettings.logic?.lockOnMatch ?? false}
                        onChange={(e) => updateNestedSettings("logic", { lockOnMatch: e.target.checked || undefined })}
                        className="rounded accent-[var(--accent)]"
                      />
                    </label>
                    <label className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] text-secondary">
                      Clear value when hidden
                      <input
                        type="checkbox"
                        defaultChecked={runtimeSettings.logic?.clearWhenHidden ?? false}
                        onChange={(e) =>
                          updateNestedSettings("logic", { clearWhenHidden: e.target.checked || undefined })
                        }
                        className="rounded accent-[var(--accent)]"
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted">Assign to signer</label>
                  <div className="flex flex-wrap gap-1.5">
                    {Array.from({ length: signerCount }, (_, i) => {
                      const sColor = getSignerColor(i);
                      return (
                        <button
                          key={i}
                          onClick={() => onUpdate({ signerIdx: i })}
                          className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] transition-colors ${
                            field.signerIdx === i
                              ? `${sColor.border} ${sColor.bg} ${sColor.text} font-medium`
                              : "border-[var(--border)] text-muted hover:text-secondary"
                          }`}
                        >
                          <span className={`h-2 w-2 rounded-full ${sColor.dot}`} />
                          {signers[i]?.label || `Party ${String.fromCharCode(65 + i)}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>
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
      <div id={tokenId} className="group relative pb-4 pt-8">
        <div
          role="button"
          tabIndex={0}
          onClick={() => {
            onFocus();
            setShowPopover((s) => !s);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onFocus();
              setShowPopover((s) => !s);
            }
          }}
          className={`w-full cursor-pointer rounded-lg border-2 border-dashed px-6 py-4 text-left transition-all ${sc.border} ${sc.bg} ${active ? "ring-[var(--accent)]/20 ring-2" : "hover:shadow-sm"}`}
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
        <AnimatePresence>
          {showPopover && active && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowPopover(false)} />
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute left-0 top-full z-50 mt-2 w-64 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-xl"
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
          )}
        </AnimatePresence>
      </div>
    );
  },
  (prev, next) =>
    prev.token === next.token &&
    prev.active === next.active &&
    prev.previewMode === next.previewMode &&
    prev.signers === next.signers,
);
