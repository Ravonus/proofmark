"use client";

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

export function StatusCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="bg-surface/30 rounded-xl border border-border p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{title}</p>
      <p className="mt-2 text-sm font-semibold text-primary">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
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
  const toneMap: Record<string, string> = {
    success: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
    warning: "border-amber-400/20 bg-amber-400/10 text-amber-200",
    danger: "border-red-400/20 bg-red-400/10 text-red-200",
    info: "border-sky-400/20 bg-sky-400/10 text-sky-200",
    muted: "border-border bg-surface/40 text-muted",
  };
  const className = toneMap[tone] ?? toneMap.muted;

  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${className}`}>{label}</span>
  );
}
