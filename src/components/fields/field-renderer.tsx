"use client";

import { memo, useState, useRef } from "react";
import { getField, getSignerColor, type FieldConfig, type FieldTypeId } from "./field-registry";
import { getFieldIcon } from "./field-picker";
import { Lock, Unlock } from "lucide-react";

type FieldMode = "edit" | "fill" | "view";

type Props = {
  fieldTypeId: FieldTypeId;
  fieldId: string;
  mode: FieldMode;
  signerIndex?: number;
  value?: string;
  label?: string;
  required?: boolean;
  customOptions?: string[];
  autoFillValue?: string;
  onChange?: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onRemove?: () => void;
  onConfigure?: () => void;
  active?: boolean;
};

export const FieldRenderer = memo(function FieldRenderer({
  fieldTypeId,
  fieldId,
  mode,
  signerIndex = 0,
  value,
  label,
  required: _required,
  customOptions,
  autoFillValue,
  onChange,
  onFocus,
  onBlur,
  onRemove,
  onConfigure,
  active,
}: Props) {
  const config = getField(fieldTypeId);
  if (!config) return <UnknownField label={label || fieldTypeId} />;

  const displayLabel = label || config.label;
  // Use signer-based color instead of field-type color
  const sc = getSignerColor(signerIndex);
  const c = {
    border: sc.border,
    bg: sc.bg,
    text: sc.text,
    glow: sc.glow,
  };

  // View mode
  if (mode === "view") {
    return (
      <span
        className={`mx-0.5 my-0.5 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 ${c.border} ${c.bg}`}
      >
        <TypeBadge fieldTypeId={fieldTypeId} textClass={c.text} />
        <span className={`text-[9px] font-medium uppercase tracking-wider ${c.text}`}>{displayLabel}</span>
        <span className="text-sm text-white/80" style={{ fontFamily: "Georgia, serif" }}>
          {value || config.placeholder}
        </span>
      </span>
    );
  }

  // Edit mode
  if (mode === "edit") {
    return (
      <EditorFieldPill
        config={config}
        fieldTypeId={fieldTypeId}
        label={displayLabel}
        active={active}
        c={c}
        onConfigure={onConfigure}
        onRemove={onRemove}
      />
    );
  }

  // Fill mode
  switch (config.inputType) {
    case "checkbox":
      return (
        <CheckboxField
          config={config}
          fieldId={fieldId}
          label={displayLabel}
          value={value}
          onChange={onChange}
          c={c}
          fieldTypeId={fieldTypeId}
        />
      );
    case "select":
      return (
        <SelectField
          config={config}
          fieldId={fieldId}
          label={displayLabel}
          value={value}
          customOptions={customOptions}
          onChange={onChange}
          active={active}
          onFocus={onFocus}
          onBlur={onBlur}
          c={c}
          fieldTypeId={fieldTypeId}
        />
      );
    case "textarea":
      return (
        <TextareaField
          config={config}
          fieldId={fieldId}
          label={displayLabel}
          value={value}
          onChange={onChange}
          active={active}
          onFocus={onFocus}
          onBlur={onBlur}
          c={c}
          fieldTypeId={fieldTypeId}
        />
      );
    case "signature":
    case "initials":
      return (
        <SignatureFieldPill
          config={config}
          label={displayLabel}
          value={value}
          active={active}
          onFocus={onFocus}
          c={c}
          fieldTypeId={fieldTypeId}
        />
      );
    case "file":
      return (
        <FileFieldPill
          config={config}
          label={displayLabel}
          active={active}
          onFocus={onFocus}
          c={c}
          fieldTypeId={fieldTypeId}
        />
      );
    case "payment":
      return (
        <ActionFieldPill
          config={config}
          label={displayLabel}
          active={active}
          onFocus={onFocus}
          c={c}
          fieldTypeId={fieldTypeId}
          actionLabel="Pay now"
        />
      );
    case "idv":
      return (
        <ActionFieldPill
          config={config}
          label={displayLabel}
          active={active}
          onFocus={onFocus}
          c={c}
          fieldTypeId={fieldTypeId}
          actionLabel="Verify ID"
        />
      );
    case "wallet":
      return (
        <InputField
          config={config}
          fieldId={fieldId}
          label={displayLabel}
          value={value || autoFillValue}
          type="text"
          onChange={onChange}
          active={active}
          onFocus={onFocus}
          onBlur={onBlur}
          c={c}
          prefix={config.prefix}
          fieldTypeId={fieldTypeId}
        />
      );
    default:
      return (
        <InputField
          config={config}
          fieldId={fieldId}
          label={displayLabel}
          value={value || autoFillValue}
          type={config.inputType}
          onChange={onChange}
          active={active}
          onFocus={onFocus}
          onBlur={onBlur}
          c={c}
          prefix={config.prefix}
          fieldTypeId={fieldTypeId}
        />
      );
  }
});

// Small type icon/label badge inside each field
function TypeBadge({ fieldTypeId, textClass }: { fieldTypeId: string; textClass: string }) {
  const Icon = getFieldIcon(fieldTypeId);
  return <Icon className={`h-3 w-3 shrink-0 ${textClass}`} />;
}

type ColorSet = { border: string; bg: string; text: string; glow: string };

// ---- Input field (text, email, tel, date, number) ----

function InputField({
  config,
  fieldId,
  label,
  value,
  type,
  onChange,
  active,
  onFocus,
  onBlur,
  c,
  prefix,
  fieldTypeId,
}: {
  config: FieldConfig;
  fieldId: string;
  label: string;
  value?: string;
  type: string;
  onChange?: (v: string) => void;
  active?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  c: ColorSet;
  prefix?: string;
  fieldTypeId: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [showValue, setShowValue] = useState(!config.sensitive);

  return (
    <span className="mx-0.5 my-1 inline-block align-baseline" id={fieldId}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 transition-all ${c.border} ${c.bg} ${active ? `ring-1 ring-offset-1 ring-offset-transparent ${c.glow}` : ""}`}
        style={{ minWidth: type === "date" ? "150px" : config.id.includes("address") ? "240px" : "170px" }}
      >
        <TypeBadge fieldTypeId={fieldTypeId} textClass={c.text} />
        <span className={`shrink-0 text-[9px] font-medium uppercase tracking-wider ${c.text}`}>{label}</span>
        {config.sensitive && (
          <button
            onClick={() => setShowValue(!showValue)}
            className="shrink-0 text-white/30 transition-colors hover:text-white/60"
            title={showValue ? "Hide value" : "Show value"}
            type="button"
          >
            {showValue ? <Unlock className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          </button>
        )}
        {prefix && <span className="text-xs text-white/30">{prefix}</span>}
        <span className="relative inline-flex min-w-0 flex-1">
          <input
            ref={ref}
            type={type === "number" ? "text" : type}
            inputMode={type === "number" ? "decimal" : type === "tel" ? "tel" : undefined}
            defaultValue={value ?? ""}
            placeholder={config.placeholder}
            onChange={(e) => onChange?.(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            autoComplete={config.sensitive ? "off" : undefined}
            className="w-full min-w-0 bg-transparent text-sm text-white/90 outline-none placeholder:text-white/20"
            style={{ fontFamily: "Georgia, serif" }}
          />
          {config.sensitive && !showValue && (
            <div
              className="absolute inset-0 cursor-pointer rounded transition-all"
              style={{ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)", background: "rgba(0,0,0,0.15)" }}
              onClick={() => setShowValue(true)}
              title="Click to reveal"
            />
          )}
        </span>
      </span>
    </span>
  );
}

// ---- Checkbox field ----

function CheckboxField({
  config,
  fieldId,
  label: _label,
  value,
  onChange,
  c,
  fieldTypeId,
}: {
  config: FieldConfig;
  fieldId: string;
  label: string;
  value?: string;
  onChange?: (v: string) => void;
  c: ColorSet;
  fieldTypeId: string;
}) {
  const [checked, setChecked] = useState(value === "true");

  return (
    <span className="mx-0.5 my-1 inline-block" id={fieldId}>
      <label
        className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-all ${c.border} ${c.bg} ${checked ? c.glow : ""}`}
      >
        <TypeBadge fieldTypeId={fieldTypeId} textClass={c.text} />
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => {
            setChecked(e.target.checked);
            onChange?.(String(e.target.checked));
          }}
          className="rounded accent-current"
        />
        <span className="text-sm text-white/80">{config.placeholder}</span>
      </label>
    </span>
  );
}

// ---- Select / dropdown field ----

function SelectField({
  config,
  fieldId,
  label,
  value,
  customOptions,
  onChange,
  active,
  onFocus,
  onBlur,
  c,
  fieldTypeId,
}: {
  config: FieldConfig;
  fieldId: string;
  label: string;
  value?: string;
  customOptions?: string[];
  onChange?: (v: string) => void;
  active?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  c: ColorSet;
  fieldTypeId: string;
}) {
  const options = customOptions ?? config.validation?.options ?? [];

  return (
    <span className="mx-0.5 my-1 inline-block align-baseline" id={fieldId}>
      <span
        className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 transition-all ${c.border} ${c.bg} ${active ? c.glow : ""}`}
      >
        <TypeBadge fieldTypeId={fieldTypeId} textClass={c.text} />
        <span className={`shrink-0 text-[9px] font-medium uppercase tracking-wider ${c.text}`}>{label}</span>
        <select
          defaultValue={value ?? ""}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          className="min-w-[120px] bg-transparent text-sm text-white/90 outline-none"
        >
          <option value="" className="bg-gray-900">
            {config.placeholder}
          </option>
          {options.map((opt) => (
            <option key={opt} value={opt} className="bg-gray-900">
              {opt}
            </option>
          ))}
        </select>
      </span>
    </span>
  );
}

// ---- Textarea field ----

function TextareaField({
  config,
  fieldId,
  label,
  value,
  onChange,
  active,
  onFocus,
  onBlur,
  c,
  fieldTypeId,
}: {
  config: FieldConfig;
  fieldId: string;
  label: string;
  value?: string;
  onChange?: (v: string) => void;
  active?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  c: ColorSet;
  fieldTypeId: string;
}) {
  return (
    <span className="mx-0.5 my-2 block" id={fieldId}>
      <span className={`block rounded-lg border p-3 transition-all ${c.border} ${c.bg} ${active ? c.glow : ""}`}>
        <span
          className={`mb-1 inline-flex items-center gap-1 text-[9px] font-medium uppercase tracking-wider ${c.text}`}
        >
          <TypeBadge fieldTypeId={fieldTypeId} textClass={c.text} />
          {label}
        </span>
        <textarea
          defaultValue={value ?? ""}
          placeholder={config.placeholder}
          rows={3}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          className="block w-full resize-none bg-transparent text-sm text-white/90 outline-none placeholder:text-white/20"
          style={{ fontFamily: "Georgia, serif" }}
        />
      </span>
    </span>
  );
}

// ---- Signature / Initials pill ----

function SignatureFieldPill({
  config,
  label: _label,
  value,
  active: _active,
  onFocus,
  c,
  fieldTypeId,
}: {
  config: FieldConfig;
  label: string;
  value?: string;
  active?: boolean;
  onFocus?: () => void;
  c: ColorSet;
  fieldTypeId: string;
}) {
  return (
    <span className="mx-0.5 my-1 inline-block">
      {value ? (
        <span className={`inline-block rounded-lg border px-3 py-1.5 ${c.border} ${c.bg}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL signature preview, not a remote image */}
          <img src={value} alt="Signature" className="h-8" />
        </span>
      ) : (
        <button
          onClick={onFocus}
          className={`inline-flex items-center gap-2 rounded-xl border border-dashed px-5 py-3 transition-all ${c.border} ${c.text} ${c.bg} hover:${c.glow}`}
        >
          <TypeBadge fieldTypeId={fieldTypeId} textClass={c.text} />
          {config.inputType === "initials" ? "Add initials" : "Sign here"}
        </button>
      )}
    </span>
  );
}

// ---- File upload pill ----

function FileFieldPill({
  config: _config,
  label,
  active: _active,
  onFocus,
  c,
  fieldTypeId,
}: {
  config: FieldConfig;
  label: string;
  active?: boolean;
  onFocus?: () => void;
  c: ColorSet;
  fieldTypeId: string;
}) {
  return (
    <span className="mx-0.5 my-1 inline-block">
      <button
        onClick={onFocus}
        className={`inline-flex items-center gap-2 rounded-lg border border-dashed px-4 py-2 transition-all ${c.border} ${c.text} ${c.bg}`}
      >
        <TypeBadge fieldTypeId={fieldTypeId} textClass={c.text} />
        {label}
      </button>
    </span>
  );
}

function ActionFieldPill({
  config: _config,
  label,
  active,
  onFocus,
  c,
  fieldTypeId,
  actionLabel,
}: {
  config: FieldConfig;
  label: string;
  active?: boolean;
  onFocus?: () => void;
  c: ColorSet;
  fieldTypeId: string;
  actionLabel: string;
}) {
  return (
    <span className="mx-0.5 my-1 inline-block">
      <button
        onClick={onFocus}
        className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 transition-all ${c.border} ${c.text} ${c.bg} ${active ? c.glow : ""}`}
      >
        <TypeBadge fieldTypeId={fieldTypeId} textClass={c.text} />
        <span>{label}</span>
        <span className="text-[10px] opacity-70">{actionLabel}</span>
      </button>
    </span>
  );
}

// ---- Editor pill (for the document editor) ----

function EditorFieldPill({
  config,
  fieldTypeId,
  label,
  active,
  c,
  onConfigure,
  onRemove: _onRemove,
}: {
  config: FieldConfig;
  fieldTypeId: string;
  label: string;
  active?: boolean;
  c: ColorSet;
  onConfigure?: () => void;
  onRemove?: () => void;
}) {
  return (
    <span className="relative mx-0.5 my-0.5 inline-block">
      <span
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1 transition-all ${c.border} ${c.bg} ${active ? `ring-1 ring-offset-1 ring-offset-transparent ${c.glow}` : ""}`}
        style={{ minWidth: "140px" }}
        onClick={onConfigure}
      >
        <TypeBadge fieldTypeId={fieldTypeId} textClass={c.text} />
        <span className={`text-[9px] font-medium uppercase tracking-wider ${c.text}`}>{label}</span>
        <span className="text-xs italic text-white/20" style={{ fontFamily: "Georgia, serif" }}>
          {config.placeholder}
        </span>
      </span>
    </span>
  );
}

// ---- Unknown/fallback ----

function UnknownField({ label }: { label: string }) {
  return (
    <span className="mx-0.5 inline-flex items-center gap-1 rounded-lg border border-gray-500/30 bg-gray-500/5 px-3 py-1">
      <span className="text-[9px] uppercase tracking-wider text-gray-400">?</span>
      <span className="text-xs italic text-white/30">{label}</span>
    </span>
  );
}

export { FIELD_CATEGORIES } from "./field-registry";
