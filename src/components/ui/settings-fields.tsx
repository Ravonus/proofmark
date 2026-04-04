"use client";

/**
 * Shared settings field components — DRY extraction from admin-panel,
 * user-settings, and workspace-settings.
 *
 * These components were duplicated across 3 files with identical implementations.
 * Now they're defined once and imported everywhere.
 */

import type { ReactNode } from "react";

// ── Text field ───────────────────────────────────────────────────────────────

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  mono = false,
  disabled = false,
  required = false,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  disabled?: boolean;
  required?: boolean;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">
        {label}
        {required && <span className="text-red-400"> *</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w3s-input w-full ${mono ? "font-mono text-xs" : ""} ${error ? "border-red-500/50" : ""}`}
      />
      {error && <span className="mt-0.5 block text-xs text-red-400">{error}</span>}
    </label>
  );
}

// ── Textarea field ───────────────────────────────────────────────────────────

export function TextareaField({
  label,
  value,
  onChange,
  placeholder,
  rows = 3,
  mono = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        className={`w3s-input w-full resize-none ${mono ? "font-mono text-xs" : ""}`}
      />
    </label>
  );
}

// ── Color field ──────────────────────────────────────────────────────────────

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-3">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent"
      />
      <div>
        <span className="block text-xs text-muted">{label}</span>
        <span className="font-mono text-xs text-secondary">{value}</span>
      </div>
    </label>
  );
}

// ── Select field ─────────────────────────────────────────────────────────────

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w3s-input w-full"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ── Status pill ──────────────────────────────────────────────────────────────

export function StatusPill({
  active,
  label,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean;
  label?: string;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  const text = label ?? (active ? (activeLabel ?? "Active") : (inactiveLabel ?? "Inactive"));
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        active
          ? "bg-green-500/15 text-green-400"
          : "bg-zinc-500/15 text-zinc-400"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-green-400" : "bg-zinc-500"}`} />
      {text}
    </span>
  );
}

// ── Stat card ────────────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="glass-card rounded-lg p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className={`text-lg font-bold ${accent ? "text-accent" : "text-primary"}`}>{value}</p>
      {sub && <p className="text-xs text-secondary">{sub}</p>}
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────────────────────

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-primary">{title}</h3>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {children}
    </div>
  );
}

// ── Toggle switch ────────────────────────────────────────────────────────────

export function ToggleSwitch({
  label,
  checked,
  onChange,
  description,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-3 ${disabled ? "opacity-50" : ""}`}>
      <div>
        <span className="text-sm text-primary">{label}</span>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-zinc-600"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          } mt-0.5`}
        />
      </button>
    </label>
  );
}
