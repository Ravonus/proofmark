"use client";

import type { InlineField } from "~/lib/document/document-tokens";
import type { getRuntimeFieldSettings, LogicEffect, VisibilityOperator } from "~/lib/document/field-runtime";
import { Select } from "../ui/select";
import { LOGIC_EFFECT_OPTIONS, VALIDATION_KIND_OPTIONS, VISIBILITY_OPERATOR_OPTIONS } from "./document-editor-types";

type RuntimeSettings = ReturnType<typeof getRuntimeFieldSettings>;

export function ValidationSection({
  inputType,
  runtimeSettings,
  updateSettings,
  updateNestedSettings,
}: {
  inputType: string;
  runtimeSettings: RuntimeSettings;
  updateSettings: (p: Record<string, unknown>) => void;
  updateNestedSettings: (key: "validation" | "logic" | "display", p: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[11px] font-medium text-muted">Validation</label>
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={runtimeSettings.validation?.kind ?? ""}
          onChange={(v) => updateNestedSettings("validation", { kind: v || undefined })}
          size="sm"
          options={VALIDATION_KIND_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
        />
        <input
          defaultValue={runtimeSettings.validation?.message ?? ""}
          onBlur={(e) =>
            updateNestedSettings("validation", {
              message: e.target.value || undefined,
            })
          }
          placeholder="Custom error message"
          className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
        />
      </div>
      <input
        defaultValue={runtimeSettings.validation?.pattern ?? ""}
        onBlur={(e) =>
          updateNestedSettings("validation", {
            pattern: e.target.value || undefined,
          })
        }
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
        <NumberValidation runtimeSettings={runtimeSettings} updateNestedSettings={updateNestedSettings} />
      )}
      {inputType === "textarea" && (
        <input
          type="number"
          min="2"
          max="12"
          defaultValue={String(runtimeSettings.rows ?? 3)}
          onBlur={(e) =>
            updateSettings({
              rows: e.target.value ? Number(e.target.value) : undefined,
            })
          }
          placeholder="Rows"
          className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
        />
      )}
      {inputType === "file" && <FileValidation runtimeSettings={runtimeSettings} updateSettings={updateSettings} />}
      {inputType === "payment" && <PaymentSettings runtimeSettings={runtimeSettings} updateSettings={updateSettings} />}
    </div>
  );
}

function NumberValidation({
  runtimeSettings,
  updateNestedSettings,
}: {
  runtimeSettings: RuntimeSettings;
  updateNestedSettings: (key: "validation", p: Record<string, unknown>) => void;
}) {
  return (
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
  );
}

function FileValidation({
  runtimeSettings,
  updateSettings,
}: {
  runtimeSettings: RuntimeSettings;
  updateSettings: (p: Record<string, unknown>) => void;
}) {
  return (
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
          updateSettings({
            maxSizeMb: e.target.value ? Number(e.target.value) : undefined,
          })
        }
        placeholder="Max MB"
        className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
      />
    </div>
  );
}

function PaymentSettings({
  runtimeSettings,
  updateSettings,
}: {
  runtimeSettings: RuntimeSettings;
  updateSettings: (p: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          min="0"
          step="0.01"
          defaultValue={String(runtimeSettings.amount ?? "")}
          onBlur={(e) =>
            updateSettings({
              amount: e.target.value ? Number(e.target.value) : undefined,
            })
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
  );
}

export function LogicSection({
  runtimeSettings,
  logicFields,
  updateNestedSettings,
}: {
  runtimeSettings: RuntimeSettings;
  logicFields: InlineField[];
  updateNestedSettings: (key: "logic", p: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[11px] font-medium text-muted">Logic & Conditions</label>
      <Select
        value={runtimeSettings.logic?.showWhenFieldId ?? ""}
        onChange={(v) => updateNestedSettings("logic", { showWhenFieldId: v || undefined })}
        size="sm"
        options={[
          { value: "", label: "Always show" },
          ...logicFields.map((c) => ({
            value: c.id,
            label: `${c.label} (${c.id})`,
          })),
        ]}
      />
      <Select
        value={runtimeSettings.logic?.effect ?? "show"}
        onChange={(v) => updateNestedSettings("logic", { effect: v as LogicEffect })}
        size="sm"
        options={LOGIC_EFFECT_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
        }))}
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
          options={VISIBILITY_OPERATOR_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
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
      <LogicToggles runtimeSettings={runtimeSettings} updateNestedSettings={updateNestedSettings} />
    </div>
  );
}

function LogicToggles({
  runtimeSettings,
  updateNestedSettings,
}: {
  runtimeSettings: RuntimeSettings;
  updateNestedSettings: (key: "logic", p: Record<string, unknown>) => void;
}) {
  const toggles = [
    { key: "requireOnMatch", label: "Make required on match" },
    { key: "lockOnMatch", label: "Lock field on match" },
    { key: "clearWhenHidden", label: "Clear value when hidden" },
  ] as const;

  return (
    <div className="grid grid-cols-1 gap-2">
      {toggles.map(({ key, label }) => (
        <label
          key={key}
          className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] text-secondary"
        >
          {label}
          <input
            type="checkbox"
            defaultChecked={runtimeSettings.logic?.[key] ?? false}
            onChange={(e) =>
              updateNestedSettings("logic", {
                [key]: e.target.checked || undefined,
              })
            }
            className="rounded accent-[var(--accent)]"
          />
        </label>
      ))}
    </div>
  );
}
