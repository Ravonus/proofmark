"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Plus, X } from "lucide-react";
import { useState } from "react";
import type { InlineField } from "~/lib/document/document-tokens";
import { SIGNER_COLORS } from "../fields";
import { TokenGateEditor } from "../settings/token-gate-editor";
import { W3SButton } from "../ui/motion";
import { Select } from "../ui/select";
import type { SignerDef } from "./document-editor-types";
import { SIGNER_BORDER_COLORS } from "./document-editor-types";

type SignersDrawerProps = {
  showSigners: boolean;
  signers: SignerDef[];
  fields: InlineField[];
  onAddSigner: () => void;
  onSignerChange: <K extends keyof SignerDef>(idx: number, key: K, value: SignerDef[K]) => void;
  onRemoveSigner: (idx: number) => void;
};

export function SignersDrawer({
  showSigners,
  signers,
  fields,
  onAddSigner,
  onSignerChange,
  onRemoveSigner,
}: SignersDrawerProps) {
  const [expandedSignerPhone, setExpandedSignerPhone] = useState<number | null>(null);

  return (
    <AnimatePresence>
      {showSigners && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="shrink-0 overflow-hidden border-b border-[var(--border)] bg-[var(--bg-card)]"
        >
          <div className="space-y-2 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-secondary">Signers</span>
              <W3SButton variant="secondary" size="xs" onClick={onAddSigner}>
                <Plus className="h-3 w-3" /> Add
              </W3SButton>
            </div>
            <div className="space-y-1.5">
              {signers.map((s, idx) => (
                <SignerRow
                  key={idx}
                  idx={idx}
                  signer={s}
                  fieldCount={fields.filter((f) => f.signerIdx === idx).length}
                  expanded={expandedSignerPhone === idx}
                  onToggleExpand={() => setExpandedSignerPhone(expandedSignerPhone === idx ? null : idx)}
                  canRemove={signers.length > 2}
                  onChange={onSignerChange}
                  onRemove={() => onRemoveSigner(idx)}
                />
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SignerRow({
  idx,
  signer,
  fieldCount,
  expanded,
  onToggleExpand,
  canRemove,
  onChange,
  onRemove,
}: {
  idx: number;
  signer: SignerDef;
  fieldCount: number;
  expanded: boolean;
  onToggleExpand: () => void;
  canRemove: boolean;
  onChange: <K extends keyof SignerDef>(idx: number, key: K, value: SignerDef[K]) => void;
  onRemove: () => void;
}) {
  const sc = SIGNER_COLORS[idx % SIGNER_COLORS.length]!;
  return (
    <div
      className="overflow-hidden rounded-lg bg-[var(--bg-surface)]"
      style={{
        borderLeft: `3px solid ${SIGNER_BORDER_COLORS[idx % SIGNER_BORDER_COLORS.length]}`,
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={`h-2.5 w-2.5 rounded-full ${sc.dot} shrink-0`} />
        <input
          value={signer.label}
          onChange={(e) => onChange(idx, "label", e.target.value)}
          placeholder={`Party ${String.fromCharCode(65 + idx)}`}
          className="min-w-0 flex-1 border-b border-transparent bg-transparent px-1.5 py-0.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
        />
        <input
          value={signer.email}
          onChange={(e) => onChange(idx, "email", e.target.value)}
          placeholder="email@example.com"
          className="min-w-0 flex-1 border-b border-transparent bg-transparent px-1.5 py-0.5 text-sm text-muted outline-none transition-colors focus:border-[var(--accent)]"
        />
        <span className="shrink-0 text-[10px] tabular-nums text-muted">
          {fieldCount} field{fieldCount !== 1 ? "s" : ""}
        </span>
        <button onClick={onToggleExpand} className="shrink-0 text-muted hover:text-secondary">
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
        {canRemove && (
          <button onClick={onRemove} className="shrink-0 text-red-400/50 hover:text-red-400">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {expanded && (
        <div className="space-y-2 px-3 pb-3 pl-8">
          <div className="flex gap-2">
            <input
              value={signer.phone ?? ""}
              onChange={(e) => onChange(idx, "phone", e.target.value)}
              placeholder="Phone (optional)"
              className="max-w-xs flex-1 rounded-lg bg-[var(--bg-hover)] px-2.5 py-1.5 text-sm text-muted outline-none"
            />
            <Select
              value={signer.role ?? "SIGNER"}
              onChange={(v) => onChange(idx, "role", v as SignerDef["role"])}
              size="sm"
              variant="glass"
              options={[
                { value: "SIGNER", label: "Signer" },
                { value: "APPROVER", label: "Approver" },
                { value: "WITNESS", label: "Witness" },
                { value: "CC", label: "CC" },
                { value: "OBSERVER", label: "Observer" },
              ]}
            />
            <Select
              value={signer.signMethod ?? "WALLET"}
              onChange={(v) => onChange(idx, "signMethod", v as SignerDef["signMethod"])}
              size="sm"
              variant="glass"
              options={[
                { value: "WALLET", label: "Wallet" },
                { value: "EMAIL_OTP", label: "Email OTP" },
              ]}
            />
          </div>
          <TokenGateEditor
            value={signer.tokenGates ?? null}
            onChange={(nextValue) => onChange(idx, "tokenGates", nextValue)}
          />
        </div>
      )}
    </div>
  );
}
