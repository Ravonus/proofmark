"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { InlineField } from "~/lib/document/document-tokens";
import {
  getRuntimeFieldSettings,
  type RuntimeInputType,
  resolveFieldAutocomplete,
  resolveFieldHelpText,
  resolveFieldInputType,
  resolveFieldOptions,
} from "~/lib/document/field-runtime";
import { getField, getSignerColor } from "../fields";
import { SearchDropdown } from "../ui/search-dropdown";
import { Select } from "../ui/select";
import { LogicSection, ValidationSection } from "./document-editor-field-validation";
import type { SignerDef } from "./document-editor-types";
import { fieldDropdownItems, INPUT_TYPE_OPTIONS } from "./document-editor-types";

type PopoverPos = { top: number; left: number };

type Props = {
  field: InlineField;
  popoverPos: PopoverPos;
  signerCount: number;
  signers: SignerDef[];
  allFields: InlineField[];
  previewValues: Record<string, string>;
  onUpdate: (patch: Partial<InlineField>) => void;
  onRemove: () => void;
  onClose: () => void;
};

export function EditorFieldPopover({
  field,
  popoverPos,
  signerCount,
  signers,
  allFields,
  onUpdate,
  onRemove,
  onClose,
}: Props) {
  const runtimeSettings = getRuntimeFieldSettings(field);
  const inputType = resolveFieldInputType(field);
  const placeholder = field.placeholder ?? "";
  const helpText = resolveFieldHelpText(field);
  const logicFields = allFields.filter((candidate) => candidate.id !== field.id);

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

  return createPortal(
    <AnimatePresence>
      <>
        <div className="fixed inset-0 z-[9998]" onClick={onClose} />
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.12 }}
          className="fixed z-[9999] w-72 space-y-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 shadow-xl"
          style={{
            top: popoverPos.top,
            left: popoverPos.left,
            maxHeight: "80vh",
            overflowY: "auto",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <PopoverHeader onRemove={onRemove} onClose={onClose} />
          <LabelSection field={field} placeholder={placeholder} onUpdate={onUpdate} />
          <TypeSection field={field} onUpdate={onUpdate} />
          <InputModeSection
            inputType={inputType}
            runtimeSettings={runtimeSettings}
            field={field}
            updateSettings={updateSettings}
          />
          <RequiredToggle field={field} onUpdate={onUpdate} />
          {(inputType === "select" || inputType === "radio") && <OptionsSection field={field} onUpdate={onUpdate} />}
          <PrefixSuffixSection runtimeSettings={runtimeSettings} updateSettings={updateSettings} />
          <BadgeLogoSection runtimeSettings={runtimeSettings} updateNestedSettings={updateNestedSettings} />
          <HelpTextSection helpText={helpText} updateNestedSettings={updateNestedSettings} />
          <ValidationSection
            inputType={inputType}
            runtimeSettings={runtimeSettings}
            updateSettings={updateSettings}
            updateNestedSettings={updateNestedSettings}
          />
          <LogicSection
            runtimeSettings={runtimeSettings}
            logicFields={logicFields}
            updateNestedSettings={updateNestedSettings}
          />
          <SignerAssignSection field={field} signerCount={signerCount} signers={signers} onUpdate={onUpdate} />
        </motion.div>
      </>
    </AnimatePresence>,
    document.body,
  );
}

// ── Sub-sections ──

function PopoverHeader({ onRemove, onClose }: { onRemove: () => void; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold text-primary">Field Settings</span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            onRemove();
            onClose();
          }}
          className="flex items-center gap-1 text-[11px] text-red-400 hover:text-red-300"
        >
          <Trash2 className="h-3 w-3" /> Remove
        </button>
        <button onClick={onClose} className="text-muted hover:text-secondary">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function LabelSection({
  field,
  placeholder,
  onUpdate,
}: {
  field: InlineField;
  placeholder: string;
  onUpdate: (p: Partial<InlineField>) => void;
}) {
  return (
    <>
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
    </>
  );
}

function TypeSection({ field, onUpdate }: { field: InlineField; onUpdate: (p: Partial<InlineField>) => void }) {
  return (
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
  );
}

function InputModeSection({
  inputType,
  runtimeSettings,
  field,
  updateSettings,
}: {
  inputType: string;
  runtimeSettings: ReturnType<typeof getRuntimeFieldSettings>;
  field: InlineField;
  updateSettings: (p: Record<string, unknown>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted">Input Mode</label>
        <Select
          value={inputType}
          onChange={(v) => updateSettings({ inputType: v as RuntimeInputType })}
          size="sm"
          options={INPUT_TYPE_OPTIONS.map((o) => ({
            value: o.value,
            label: o.label,
          }))}
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
  );
}

function RequiredToggle({ field, onUpdate }: { field: InlineField; onUpdate: (p: Partial<InlineField>) => void }) {
  return (
    <label className="flex items-center justify-between text-[11px] text-secondary">
      Required
      <input
        type="checkbox"
        defaultChecked={field.required ?? true}
        onChange={(e) => onUpdate({ required: e.target.checked })}
        className="rounded accent-[var(--accent)]"
      />
    </label>
  );
}

function OptionsSection({ field, onUpdate }: { field: InlineField; onUpdate: (p: Partial<InlineField>) => void }) {
  return (
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
  );
}

function PrefixSuffixSection({
  runtimeSettings,
  updateSettings,
}: {
  runtimeSettings: ReturnType<typeof getRuntimeFieldSettings>;
  updateSettings: (p: Record<string, unknown>) => void;
}) {
  return (
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
  );
}

function BadgeLogoSection({
  runtimeSettings,
  updateNestedSettings,
}: {
  runtimeSettings: ReturnType<typeof getRuntimeFieldSettings>;
  updateNestedSettings: (key: "display", p: Record<string, unknown>) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted">Badge</label>
        <input
          defaultValue={runtimeSettings.display?.badge ?? ""}
          onBlur={(e) =>
            updateNestedSettings("display", {
              badge: e.target.value || undefined,
            })
          }
          placeholder="KYC, Visa, PO"
          className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-muted">Logo / Mark</label>
        <input
          defaultValue={runtimeSettings.display?.logo ?? ""}
          onBlur={(e) =>
            updateNestedSettings("display", {
              logo: e.target.value || undefined,
            })
          }
          placeholder="VISA, ◎, 🏦"
          className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
        />
      </div>
    </div>
  );
}

function HelpTextSection({
  helpText,
  updateNestedSettings,
}: {
  helpText: string | null | undefined;
  updateNestedSettings: (key: "display", p: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium text-muted">Help Text</label>
      <input
        defaultValue={helpText ?? ""}
        onBlur={(e) =>
          updateNestedSettings("display", {
            helpText: e.target.value || undefined,
          })
        }
        placeholder="Shown under the field while signing"
        className="w-full rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
      />
    </div>
  );
}

function SignerAssignSection({
  field,
  signerCount,
  signers,
  onUpdate,
}: {
  field: InlineField;
  signerCount: number;
  signers: SignerDef[];
  onUpdate: (p: Partial<InlineField>) => void;
}) {
  return (
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
  );
}
