"use client";

import { Trash2 } from "lucide-react";
import { AnimatedButton } from "~/components/ui/motion";

/* ── Tone lookup tables ──────────────────────────────────────── */

const STAT_TONES: Record<string, string> = {
  success: "border-emerald-400/20 bg-emerald-400/5",
  warning: "border-amber-400/20 bg-amber-400/5",
  danger: "border-red-400/20 bg-red-400/5",
  info: "border-sky-400/20 bg-sky-400/5",
  muted: "border-border bg-surface/30",
};

const PILL_TONES: Record<string, string> = {
  success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  danger: "border-red-400/20 bg-red-400/10 text-red-200",
  info: "border-sky-400/20 bg-sky-400/10 text-sky-200",
  muted: "border-border bg-surface/40 text-muted",
};

const TIER_TONES: Record<string, string> = {
  success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  info: "border-sky-400/20 bg-sky-400/10 text-sky-200",
  warning: "border-amber-400/20 bg-amber-400/10 text-amber-200",
};

const SYSTEM_TONES: Record<string, string> = {
  success: "text-emerald-300",
  warning: "text-amber-300",
  danger: "text-red-300",
  info: "text-sky-300",
  muted: "text-muted",
};

/* ── Components ──────────────────────────────────────────────── */

export function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: "success" | "warning" | "danger" | "info" | "muted";
}) {
  return (
    <div className={`rounded-xl border p-4 ${STAT_TONES[tone]}`}>
      <div className="flex items-center gap-2 text-muted">
        {icon}
        <span className="text-xs uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}

export function TierCard({
  title,
  count,
  tone,
  items,
}: {
  title: string;
  count: number;
  tone: "success" | "info" | "warning";
  items: Array<{ id: string; label: string }>;
}) {
  return (
    <div className={`rounded-xl border p-4 ${TIER_TONES[tone]}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        <span className="border-current/20 rounded-full border px-1.5 py-0.5 text-[10px]">{count}</span>
      </div>
      <div className="mt-3 space-y-1.5 text-xs">
        {items.map((item) => (
          <p key={item.id}>{item.label}</p>
        ))}
      </div>
    </div>
  );
}

export function SystemRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger" | "info" | "muted";
}) {
  const toneClass = tone ? (SYSTEM_TONES[tone] ?? "text-secondary") : "text-secondary";
  return (
    <div className="bg-surface/30 flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <p className="text-sm text-muted">{label}</p>
      <p className={`text-sm font-medium ${toneClass}`}>{value}</p>
    </div>
  );
}

export function EnvRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface/20 flex items-center justify-between rounded-lg px-3 py-2 font-mono text-xs">
      <span className="text-muted">{label}</span>
      <span className="text-secondary">{value}</span>
    </div>
  );
}

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "danger" | "info" | "muted";
}) {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${PILL_TONES[tone]}`}>
      {label}
    </span>
  );
}

export function TextField({
  label,
  value,
  onChange,
  password = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  password?: boolean;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <input
        type={password ? "password" : "text"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-surface/50 w-full rounded-xl px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-accent"
      />
    </label>
  );
}

export function TextareaField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="bg-surface/50 w-full rounded-xl px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-accent"
      />
    </label>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <div className="bg-surface/50 flex items-center gap-3 rounded-xl px-3 py-2 ring-1 ring-border focus-within:ring-accent">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-10 rounded border-0 bg-transparent p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="flex-1 bg-transparent text-sm outline-none"
        />
      </div>
    </label>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="bg-surface/50 w-full rounded-xl px-3 py-2 text-sm outline-none ring-1 ring-border focus:ring-accent"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function IntegrationList({
  items,
  onDelete,
}: {
  items: Array<{
    id: string;
    label: string;
    provider: string;
    isDefault: boolean;
    config: { enabled?: boolean };
  }>;
  onDelete: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Configured</p>
      {items.map((entry) => (
        <div
          key={entry.id}
          className="bg-surface/30 flex items-center justify-between rounded-xl border border-border p-3 text-sm"
        >
          <div className="flex items-center gap-2">
            <div
              className={`h-2 w-2 rounded-full ${entry.config.enabled !== false ? "bg-emerald-400" : "bg-zinc-600"}`}
            />
            <div>
              <p className="font-medium">{entry.label}</p>
              <p className="text-xs text-muted">
                {entry.provider}
                {entry.isDefault ? " \u00B7 Default" : ""}
              </p>
            </div>
          </div>
          <AnimatedButton variant="danger" className="px-2 py-1 text-xs" onClick={() => onDelete(entry.id)}>
            <Trash2 className="h-3 w-3" />
          </AnimatedButton>
        </div>
      ))}
    </div>
  );
}
