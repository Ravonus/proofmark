"use client";

import type { LucideIcon } from "lucide-react";
import {
  Building2,
  Calendar,
  ChevronRight,
  DollarSign,
  FileText,
  Globe,
  GripVertical,
  Hash,
  Mail,
  MapPin,
  MoreHorizontal,
  PenTool,
  Phone,
  Scale,
  Search,
  ShieldCheck,
  Type,
  User,
  Wallet,
  X,
} from "lucide-react";
import { memo, useState } from "react";
import { FIELD_CATEGORIES, FIELD_REGISTRY, type FieldTypeId, SIGNER_COLORS } from "./field-registry";

const FIELD_ICONS: Record<string, LucideIcon> = {
  "full-name": User,
  "first-name": User,
  "middle-name": User,
  "last-name": User,
  "preferred-name": User,
  "company-name": Building2,
  "job-title": Type,
  "tax-id": Hash,
  ssn: Hash,
  "ssn-full": Hash,
  dob: Calendar,
  "passport-number": FileText,
  "drivers-license": FileText,
  "national-id": FileText,
  nationality: Globe,
  email: Mail,
  "secondary-email": Mail,
  phone: Phone,
  "fax-number": Phone,
  website: Globe,
  "linkedin-url": Globe,
  "street-address": MapPin,
  "address-line-2": Building2,
  "billing-address": MapPin,
  "mailing-address": MapPin,
  "full-address": MapPin,
  city: MapPin,
  county: MapPin,
  state: MapPin,
  zip: MapPin,
  "billing-zip": MapPin,
  country: Globe,
  "currency-amount": DollarSign,
  percentage: Hash,
  "bank-account": DollarSign,
  "account-holder-name": User,
  "routing-number": Hash,
  "credit-card-number": DollarSign,
  "cardholder-name": User,
  "credit-card-expiry": Calendar,
  "credit-card-cvc": ShieldCheck,
  iban: DollarSign,
  "swift-bic": Globe,
  "invoice-number": FileText,
  "purchase-order": FileText,
  "wallet-address": Wallet,
  "eth-address": Wallet,
  "btc-address": Wallet,
  "sol-address": Wallet,
  "ens-name": Globe,
  "token-amount": DollarSign,
  "tx-hash": Hash,
  "smart-contract": FileText,
  "chain-name": Globe,
  "nft-id": Hash,
  "dao-name": Building2,
  date: Calendar,
  "effective-date": Calendar,
  "expiration-date": Calendar,
  "renewal-date": Calendar,
  "term-length": Calendar,
  "notice-period": Calendar,
  jurisdiction: Scale,
  "governing-law": Scale,
  "witness-name": User,
  "notary-field": ShieldCheck,
  "clause-number": Hash,
  "contract-id": Hash,
  "acknowledge-checkbox": ShieldCheck,
  "risk-warning": ShieldCheck,
  "age-verification": ShieldCheck,
  "twitter-handle": Globe,
  "discord-handle": Globe,
  "telegram-handle": Globe,
  "github-handle": Globe,
  signature: PenTool,
  initials: PenTool,
  "free-text": Type,
  url: Globe,
  dropdown: MoreHorizontal,
  "radio-group": MoreHorizontal,
  number: Hash,
  time: Calendar,
  datetime: Calendar,
  "file-attachment": FileText,
  "payment-request": DollarSign,
  "custom-field": MoreHorizontal,
};

export function getFieldIcon(fieldId: string): LucideIcon {
  return FIELD_ICONS[fieldId] ?? MoreHorizontal;
}

type Props = {
  onSelect: (fieldTypeId: FieldTypeId) => void;
  activeType: string | null;
  onClearActive: () => void;
  onDragNewField?: (fieldTypeId: FieldTypeId) => void;
  onDragEnd?: () => void;
  activeSigner: number;
  signerCount: number;
  signerLabels: string[];
  onSignerChange: (idx: number) => void;
};

const isTouchDevice = () => typeof window !== "undefined" && ("ontouchstart" in window || navigator.maxTouchPoints > 0);

function makeDragHandlers(
  fieldId: string,
  onDragNewField: ((id: FieldTypeId) => void) | undefined,
  onDragEnd: (() => void) | undefined,
) {
  // Disable drag on touch devices — use tap-to-place instead
  if (isTouchDevice()) return {};
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", `new:${fieldId}`);
      const blank = document.createElement("div");
      blank.style.cssText = "width:1px;height:1px;opacity:0";
      document.body.appendChild(blank);
      e.dataTransfer.setDragImage(blank, 0, 0);
      setTimeout(() => blank.remove(), 0);
      onDragNewField?.(fieldId as FieldTypeId);
    },
    onDragEnd: () => onDragEnd?.(),
  };
}

export const FieldPicker = memo(function FieldPicker({
  onSelect,
  activeType,
  onClearActive,
  onDragNewField,
  onDragEnd,
  activeSigner,
  signerCount,
  signerLabels,
  onSignerChange,
}: Props) {
  const signerColor = SIGNER_COLORS[activeSigner % SIGNER_COLORS.length]!;
  const [search, setSearch] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const searchLower = search.toLowerCase();

  const toggleCat = (id: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* Signer tabs */}
      <div className="border-b border-[var(--border)] px-3 py-3">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">Assign to</p>
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: signerCount }, (_, i) => {
            const sc = SIGNER_COLORS[i % SIGNER_COLORS.length]!;
            const isActive = activeSigner === i;
            return (
              <button
                key={i}
                onClick={() => onSignerChange(i)}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all ${
                  isActive
                    ? `${sc.bg} ${sc.text} ${sc.border} border`
                    : "border border-transparent text-muted hover:border-[var(--border)] hover:text-secondary"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${sc.dot}`} />
                {signerLabels[i] || `Party ${String.fromCharCode(65 + i)}`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active field hint */}
      {activeType && (
        <div
          className={`mx-3 mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] ${signerColor.bg} ${signerColor.border} border`}
        >
          {(() => {
            const Icon = getFieldIcon(activeType);
            return <Icon className={`h-3.5 w-3.5 ${signerColor.text}`} />;
          })()}
          <span className={`${signerColor.text} flex-1`}>
            {(FIELD_REGISTRY as Record<string, { label: string }>)[activeType]?.label}
          </span>
          <span className="text-[10px] text-muted">tap in doc</span>
          <button onClick={onClearActive} className="text-muted hover:text-secondary">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="px-3 pb-1 pt-3">
        <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-surface)] px-2.5 py-1.5 ring-1 ring-[var(--border)] transition-colors focus-within:ring-[var(--accent)]">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fields..."
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-muted hover:text-secondary">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Field list */}
      <div className="flex-1 overflow-y-auto py-1">
        {FIELD_CATEGORIES.map((cat) => {
          const filteredFields = search
            ? cat.fields.filter((fid) => {
                const f = (FIELD_REGISTRY as Record<string, { label: string; description: string }>)[fid];
                return (
                  f &&
                  (f.label.toLowerCase().includes(searchLower) || f.description.toLowerCase().includes(searchLower))
                );
              })
            : cat.fields;

          if (filteredFields.length === 0) return null;
          const collapsed = collapsedCats.has(cat.id) && !search;

          return (
            <div key={cat.id} className="mb-0.5">
              <button
                onClick={() => toggleCat(cat.id)}
                className="flex w-full items-center gap-1.5 px-3 pb-1.5 pt-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
              >
                <ChevronRight className={`h-3 w-3 text-muted transition-transform ${collapsed ? "" : "rotate-90"}`} />
                <span className="flex-1 text-[10px] font-medium uppercase tracking-wider text-muted">{cat.label}</span>
                <span className="text-muted/50 text-[10px]">{filteredFields.length}</span>
              </button>
              {!collapsed && (
                <div className="space-y-px px-1.5 pb-1">
                  {filteredFields.map((fieldId) => {
                    const f = (FIELD_REGISTRY as Record<string, { label: string; description: string }>)[fieldId];
                    if (!f) return null;
                    const FieldIcon = FIELD_ICONS[fieldId] ?? MoreHorizontal;
                    const isActive = activeType === fieldId;

                    return (
                      <button
                        key={fieldId}
                        {...makeDragHandlers(fieldId, onDragNewField, onDragEnd)}
                        onClick={() => onSelect(fieldId)}
                        className={`group flex w-full cursor-grab items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all active:cursor-grabbing ${
                          isActive
                            ? `${signerColor.bg} ${signerColor.text}`
                            : "text-secondary hover:bg-[var(--bg-hover)]"
                        }`}
                        title={f.description}
                      >
                        <GripVertical className="text-muted/30 group-hover:text-muted/60 h-3 w-3 shrink-0" />
                        <FieldIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-[12px]">{f.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});
