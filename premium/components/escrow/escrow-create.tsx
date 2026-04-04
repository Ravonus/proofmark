// @ts-nocheck -- premium module with dynamic types from private repo
"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Shield,
  Users,
  Eye,
  Lock,
  Handshake,
  DollarSign,
  TrendingUp,
  Plus,
  Trash2,
  AlertTriangle,
  ExternalLink,
  Info,
  Sparkles,
  Send,
  Gavel,
  Car,
  Home,
  Watch,
  Gem,
  CreditCard,
  Package,
  X,
} from "lucide-react";
import { useWallet } from "~/components/wallet-provider";
import { GlassCard, W3SButton } from "~/components/ui/motion";
// Inlined from premium/escrow/types to avoid hard import
type EscrowMode =
  | "FULL_ESCROW"
  | "MULTI_ESCROW"
  | "COMMUNITY_ESCROW"
  | "SELF_CUSTODY"
  | "LOCKED_CANCELLABLE"
  | "LOCKED_PERMANENT"
  | "HONOR_SYSTEM"
  | "CASUAL"
  | "PLATFORM_ESCROW"
  | "DESIGNATED_ORACLE";
type AssetKind =
  | "NATIVE"
  | "ERC20"
  | "ERC721"
  | "ERC1155"
  | "SPL_TOKEN"
  | "SPL_NFT"
  | "BRC20"
  | "ORDINAL"
  | "USD"
  | "FIAT_OTHER"
  | "RWA_VEHICLE"
  | "RWA_REAL_ESTATE"
  | "RWA_WATCH"
  | "RWA_JEWELRY"
  | "RWA_COLLECTIBLE"
  | "RWA_ELECTRONICS"
  | "RWA_COMMODITY"
  | "RWA_OTHER"
  | "CUSTOM";

/* ------------------------------------------------------------------ */
/*  Steps                                                              */
/* ------------------------------------------------------------------ */

const STEPS = ["Mode", "Details", "Parties", "Assets", "Outcomes", "Review"] as const;

/* ------------------------------------------------------------------ */
/*  Mode config                                                        */
/* ------------------------------------------------------------------ */

type ModeOption = {
  mode: EscrowMode;
  label: string;
  description: string;
  icon: typeof Shield;
  tags: string[];
  warning?: string;
  trustLevel: "none" | "low" | "medium" | "high";
};

const MODES: ModeOption[] = [
  {
    mode: "CASUAL",
    label: "Casual Bet",
    icon: DollarSign,
    description: "Fun bet between friends. USD or crypto. No enforcement, just tracking.",
    tags: ["fun", "friends", "usd"],
    trustLevel: "none",
  },
  {
    mode: "HONOR_SYSTEM",
    label: "Honor System",
    icon: Handshake,
    description: "Track it, optionally verify asset ownership. No funds locked.",
    tags: ["trust", "simple"],
    trustLevel: "low",
  },
  {
    mode: "DESIGNATED_ORACLE",
    label: "Pick a Judge",
    icon: Gavel,
    description: "Choose specific people to decide the winner. They sign their decision.",
    tags: ["judge", "arbitrator", "friend"],
    trustLevel: "medium",
  },
  {
    mode: "SELF_CUSTODY",
    label: "Self Custody",
    icon: Eye,
    description: "Funds stay in your wallet. System watches — move them and the bet is voided.",
    tags: ["trustless", "monitor"],
    trustLevel: "low",
  },
  {
    mode: "FULL_ESCROW",
    label: "Full Escrow",
    icon: Shield,
    description: "Funds in smart contract. Trusted escrow agent releases to winner.",
    tags: ["escrow", "contract"],
    trustLevel: "medium",
  },
  {
    mode: "MULTI_ESCROW",
    label: "Multi-Sig Escrow",
    icon: Users,
    description: "Multiple escrow agents must agree. More security, more trust.",
    tags: ["multisig", "secure"],
    trustLevel: "high",
  },
  {
    mode: "COMMUNITY_ESCROW",
    label: "Community Vote",
    icon: Users,
    description: "Community members vote to decide. Quorum + threshold.",
    tags: ["dao", "community", "vote"],
    trustLevel: "high",
  },
  {
    mode: "PLATFORM_ESCROW",
    label: "Oracle / Market",
    icon: TrendingUp,
    description: "Link to Polymarket or Kalshi. Auto-resolves when the market settles. 1.5% fee.",
    tags: ["oracle", "polymarket", "kalshi", "auto"],
    trustLevel: "medium",
  },
  {
    mode: "LOCKED_CANCELLABLE",
    label: "Locked (Cancellable)",
    icon: Lock,
    description: "Funds locked. All parties must agree to cancel.",
    tags: ["locked", "safe"],
    trustLevel: "high",
  },
  {
    mode: "LOCKED_PERMANENT",
    label: "Locked Forever",
    icon: Lock,
    description: "Funds locked FOREVER if no resolution. Cannot be cancelled. Ever.",
    tags: ["permanent", "dangerous"],
    trustLevel: "high",
    warning: "Funds may be permanently lost",
  },
];

/* ------------------------------------------------------------------ */
/*  RWA categories                                                     */
/* ------------------------------------------------------------------ */

type RwaCategory = {
  kind: AssetKind;
  label: string;
  icon: typeof Car;
  placeholder: string;
  identifierLabel: string;
  suggestedVerifications: string[];
};

const RWA_CATEGORIES: RwaCategory[] = [
  {
    kind: "RWA_VEHICLE",
    label: "Vehicle",
    icon: Car,
    placeholder: "2024 Tesla Model 3 Long Range",
    identifierLabel: "VIN",
    suggestedVerifications: ["TITLE_CHECK", "PHOTO_EVIDENCE"],
  },
  {
    kind: "RWA_REAL_ESTATE",
    label: "Real Estate",
    icon: Home,
    placeholder: "123 Main St, Austin TX 78701",
    identifierLabel: "Property ID / APN",
    suggestedVerifications: ["TITLE_CHECK", "APPRAISAL", "NOTARIZED"],
  },
  {
    kind: "RWA_WATCH",
    label: "Watch",
    icon: Watch,
    placeholder: "Rolex Submariner 126610LN",
    identifierLabel: "Serial Number",
    suggestedVerifications: ["SERIAL_NUMBER", "CERTIFICATE", "PHOTO_EVIDENCE"],
  },
  {
    kind: "RWA_JEWELRY",
    label: "Jewelry",
    icon: Gem,
    placeholder: "2ct Diamond Ring, GIA certified",
    identifierLabel: "Certificate ID",
    suggestedVerifications: ["APPRAISAL", "CERTIFICATE", "PHOTO_EVIDENCE"],
  },
  {
    kind: "RWA_COLLECTIBLE",
    label: "Collectible",
    icon: Package,
    placeholder: "PSA 10 Charizard Base Set 1st Edition",
    identifierLabel: "Cert / Serial #",
    suggestedVerifications: ["GRADING", "CERTIFICATE", "PHOTO_EVIDENCE"],
  },
  {
    kind: "RWA_ELECTRONICS",
    label: "Electronics",
    icon: CreditCard,
    placeholder: "iPhone 16 Pro Max 1TB",
    identifierLabel: "Serial / IMEI",
    suggestedVerifications: ["SERIAL_NUMBER", "RECEIPT", "PHOTO_EVIDENCE"],
  },
  {
    kind: "RWA_OTHER",
    label: "Other",
    icon: Package,
    placeholder: "Describe the asset...",
    identifierLabel: "ID / Reference",
    suggestedVerifications: ["PHOTO_EVIDENCE", "SELF_ATTESTED"],
  },
];

/* ------------------------------------------------------------------ */
/*  Form state                                                         */
/* ------------------------------------------------------------------ */

type PartyInput = {
  id: string;
  label: string;
  address: string;
  chain: string;
  role: string;
  email: string;
};

type AssetInput = {
  id: string;
  category: "crypto" | "fiat" | "rwa";
  chain: string;
  kind: string;
  amount: string;
  symbol: string;
  contractAddress: string;
  tokenId: string;
  fromParticipantId: string;
  // RWA
  rwaDescription: string;
  rwaEstimatedValueUsd: string;
  rwaIdentifier: string;
  rwaKind: string;
};

type OutcomeInput = {
  id: string;
  description: string;
  winnerPartyIds: string[];
};

type FormState = {
  mode: EscrowMode | null;
  title: string;
  description: string;
  parties: PartyInput[];
  assets: AssetInput[];
  outcomes: OutcomeInput[];
  oracle: {
    provider: string;
    marketId: string;
    marketUrl: string;
  };
  designatedOracle: {
    requiredAgreement: number;
    requireRationale: boolean;
    allowCustomSplit: boolean;
  };
  expiresInDays: string;
};

function createParty(index: number, role = "PARTY"): PartyInput {
  return {
    id: crypto.randomUUID(),
    label:
      role === "PARTY" ? `Party ${String.fromCharCode(65 + index)}` : role === "DESIGNATED_ORACLE" ? "Judge" : "Agent",
    address: "",
    chain: "",
    role,
    email: "",
  };
}

function createAsset(): AssetInput {
  return {
    id: crypto.randomUUID(),
    category: "crypto",
    chain: "",
    kind: "",
    amount: "",
    symbol: "",
    contractAddress: "",
    tokenId: "",
    fromParticipantId: "",
    rwaDescription: "",
    rwaEstimatedValueUsd: "",
    rwaIdentifier: "",
    rwaKind: "",
  };
}

function createOutcome(): OutcomeInput {
  return { id: crypto.randomUUID(), description: "", winnerPartyIds: [] };
}

function initialState(preselectedMode?: string): FormState {
  return {
    mode: (preselectedMode as EscrowMode) ?? null,
    title: "",
    description: "",
    parties: [createParty(0), createParty(1)],
    assets: [createAsset()],
    outcomes: [createOutcome(), createOutcome()],
    oracle: { provider: "", marketId: "", marketUrl: "" },
    designatedOracle: { requiredAgreement: 1, requireRationale: true, allowCustomSplit: false },
    expiresInDays: "",
  };
}

/* ------------------------------------------------------------------ */
/*  Shared UI                                                          */
/* ------------------------------------------------------------------ */

function Field({
  label,
  children,
  hint,
  required,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-secondary">
        {label}
        {required && <span className="text-red-400">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted focus:border-[var(--accent)]";

function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${className ?? ""}`} />;
}

function TextArea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} ${className ?? ""}`} />;
}

function Select({
  options,
  placeholder,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: { value: string; label: string; group?: string }[];
  placeholder?: string;
}) {
  // Group options
  const groups = new Map<string, { value: string; label: string }[]>();
  for (const o of options) {
    const g = o.group ?? "";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(o);
  }

  return (
    <select {...props} className={`${inputClass} ${className ?? ""}`}>
      <option value="">{placeholder ?? "Select..."}</option>
      {[...groups.entries()].map(([group, opts]) =>
        group ? (
          <optgroup key={group} label={group}>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ) : (
          opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))
        ),
      )}
    </select>
  );
}

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-[var(--bg-hover)] p-3 text-xs text-muted">
      <Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function WarningBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <GlassCard hover={false} className="space-y-3">
      <h4 className="text-sm font-semibold">{title}</h4>
      {children}
    </GlassCard>
  );
}

/* ------------------------------------------------------------------ */
/*  AI Chat Drawer                                                     */
/* ------------------------------------------------------------------ */

function AiChatDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setLoading(true);

    // TODO: Wire to tRPC ai.escrowAssistant mutation
    // For now, show a placeholder
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            'I can help you set up your escrow! Tell me what you want to bet on, who\'s involved, and what the stakes are. I\'ll generate the full config for you.\n\nFor example:\n- "I want to bet my friend 0.5 ETH that Bitcoin hits $100k by June"\n- "Set up an escrow for selling my car — buyer deposits $30k, I put up the title"\n- "Create a casual $50 bet about who wins the Super Bowl"',
        },
      ]);
      setLoading(false);
    }, 800);
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 25, stiffness: 200 }}
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-[var(--border)] bg-[var(--bg-surface)]"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[var(--accent)]" />
          <span className="text-sm font-semibold">AI Escrow Assistant</span>
        </div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted transition-colors hover:bg-[var(--bg-hover)]">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="py-8 text-center">
            <Sparkles className="mx-auto mb-3 h-8 w-8 text-muted" />
            <p className="text-sm font-medium">Describe your bet or escrow</p>
            <p className="mt-1 text-xs text-muted">
              I&apos;ll help you set everything up — mode, terms, assets, outcomes, the works.
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-[var(--accent)] text-white"
                  : "border border-[var(--border)] bg-[var(--bg-hover)]"
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-hover)] px-3 py-2">
              <span className="inline-flex gap-1">
                <span className="bg-muted h-1.5 w-1.5 animate-bounce rounded-full" style={{ animationDelay: "0ms" }} />
                <span
                  className="bg-muted h-1.5 w-1.5 animate-bounce rounded-full"
                  style={{ animationDelay: "150ms" }}
                />
                <span
                  className="bg-muted h-1.5 w-1.5 animate-bounce rounded-full"
                  style={{ animationDelay: "300ms" }}
                />
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-[var(--border)] p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
            placeholder="Describe your bet or escrow..."
            className={`${inputClass} flex-1`}
          />
          <W3SButton variant="primary" size="sm" onClick={sendMessage} disabled={!input.trim() || loading}>
            <Send className="h-4 w-4" />
          </W3SButton>
        </div>
      </div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step: Mode                                                         */
/* ------------------------------------------------------------------ */

function StepMode({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const [search, setSearch] = useState("");

  const filtered = search
    ? MODES.filter(
        (m) =>
          m.label.toLowerCase().includes(search.toLowerCase()) ||
          m.description.toLowerCase().includes(search.toLowerCase()) ||
          m.tags.some((t) => t.includes(search.toLowerCase())),
      )
    : MODES;

  return (
    <div className="space-y-3">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search modes... (e.g. 'oracle', 'friends', 'locked')"
      />

      <div className="grid gap-2 sm:grid-cols-2">
        {filtered.map((m) => {
          const Icon = m.icon;
          const selected = form.mode === m.mode;
          return (
            <motion.button
              key={m.mode}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
                selected
                  ? "bg-[var(--accent)]/10 border-[var(--accent)]"
                  : "hover:border-[var(--accent)]/50 border-[var(--border)] bg-[var(--bg-surface)]"
              }`}
              whileTap={{ scale: 0.98 }}
              onClick={() => {
                const next = { ...form, mode: m.mode };
                // Auto-add designated oracle participant
                if (m.mode === "DESIGNATED_ORACLE" && !form.parties.some((p) => p.role === "DESIGNATED_ORACLE")) {
                  next.parties = [...form.parties, createParty(form.parties.length, "DESIGNATED_ORACLE")];
                }
                // Auto-add escrow agent participant
                if (
                  (m.mode === "FULL_ESCROW" || m.mode === "MULTI_ESCROW") &&
                  !form.parties.some((p) => p.role === "ESCROW_AGENT")
                ) {
                  next.parties = [
                    ...(next.parties ?? form.parties),
                    createParty((next.parties ?? form.parties).length, "ESCROW_AGENT"),
                  ];
                }
                setForm(next);
              }}
            >
              <div className="rounded-lg border border-[var(--border)] p-2">
                <Icon className="h-4 w-4 text-[var(--accent)]" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{m.label}</p>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                      m.trustLevel === "none"
                        ? "bg-gray-500/10 text-muted"
                        : m.trustLevel === "low"
                          ? "bg-green-500/10 text-green-400"
                          : m.trustLevel === "medium"
                            ? "bg-yellow-500/10 text-yellow-400"
                            : "bg-blue-500/10 text-blue-400"
                    }`}
                  >
                    {m.trustLevel === "none" ? "No trust needed" : `${m.trustLevel} trust`}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted">{m.description}</p>
                {m.warning && (
                  <p className="mt-1 flex items-center gap-1 text-xs text-red-400">
                    <AlertTriangle className="h-3 w-3" /> {m.warning}
                  </p>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step: Details                                                      */
/* ------------------------------------------------------------------ */

function StepDetails({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  return (
    <div className="space-y-4">
      <Field label="Title" required hint="Short name for this bet or escrow">
        <Input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder="e.g. Superbowl 2026 bet, Car sale escrow"
        />
      </Field>

      <Field label="Terms" required hint="Full terms everyone will sign. Be specific about what counts as winning.">
        <TextArea
          rows={5}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Describe the bet, agreement, or escrow terms in detail. What constitutes a win? What are the edge cases? What happens if X?"
        />
      </Field>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Expires in (days)" hint="Leave blank for no expiry">
          <Input
            type="number"
            min="1"
            value={form.expiresInDays}
            onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })}
            placeholder="Optional"
          />
        </Field>
      </div>

      {/* Oracle config for PLATFORM_ESCROW */}
      {form.mode === "PLATFORM_ESCROW" && (
        <SectionCard title="Oracle / Prediction Market">
          <Field label="Provider" required>
            <Select
              value={form.oracle.provider}
              onChange={(e) => setForm({ ...form, oracle: { ...form.oracle, provider: e.target.value } })}
              options={[
                { value: "POLYMARKET", label: "Polymarket" },
                { value: "KALSHI", label: "Kalshi" },
                { value: "CUSTOM_API", label: "Custom API" },
              ]}
            />
          </Field>
          <Field label="Market ID" required hint="Condition ID or market ticker">
            <Input
              value={form.oracle.marketId}
              onChange={(e) => setForm({ ...form, oracle: { ...form.oracle, marketId: e.target.value } })}
              placeholder={
                form.oracle.provider === "POLYMARKET"
                  ? "0x1234abcd..."
                  : form.oracle.provider === "KALSHI"
                    ? "KXBTC-100K-DEC25"
                    : "market-id"
              }
            />
          </Field>
          <Field label="Market URL" hint="Link for verification">
            <Input
              value={form.oracle.marketUrl}
              onChange={(e) => setForm({ ...form, oracle: { ...form.oracle, marketUrl: e.target.value } })}
              placeholder="https://..."
            />
          </Field>
          {form.oracle.marketUrl && (
            <a
              href={form.oracle.marketUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              View market <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <InfoBox>1.5% platform fee deducted from payout when the market resolves.</InfoBox>
        </SectionCard>
      )}

      {/* Designated oracle config */}
      {form.mode === "DESIGNATED_ORACLE" && (
        <SectionCard title="Judge Configuration">
          <Field label="Required agreement" hint="How many judges must agree on the outcome">
            <Input
              type="number"
              min="1"
              value={form.designatedOracle.requiredAgreement}
              onChange={(e) =>
                setForm({
                  ...form,
                  designatedOracle: { ...form.designatedOracle, requiredAgreement: Number(e.target.value) || 1 },
                })
              }
            />
          </Field>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.designatedOracle.requireRationale}
                onChange={(e) =>
                  setForm({
                    ...form,
                    designatedOracle: { ...form.designatedOracle, requireRationale: e.target.checked },
                  })
                }
                className="rounded"
              />
              Require written rationale for decision
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.designatedOracle.allowCustomSplit}
                onChange={(e) =>
                  setForm({
                    ...form,
                    designatedOracle: { ...form.designatedOracle, allowCustomSplit: e.target.checked },
                  })
                }
                className="rounded"
              />
              Allow judges to set custom payout splits
            </label>
          </div>
          <InfoBox>
            Judges sign their decision with their crypto wallet. Their rationale is stored on the audit trail.
          </InfoBox>
        </SectionCard>
      )}

      {form.mode === "LOCKED_PERMANENT" && (
        <WarningBox>
          If no resolution is reached, the funds will be locked FOREVER. No one — not the parties, not the judges, not
          the platform — can recover them. This cannot be reversed.
        </WarningBox>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step: Parties                                                      */
/* ------------------------------------------------------------------ */

function StepParties({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const addParty = (role = "PARTY") => {
    setForm({ ...form, parties: [...form.parties, createParty(form.parties.length, role)] });
  };

  const removeParty = (id: string) => {
    if (
      form.parties.filter((p) => p.role === "PARTY").length <= 2 &&
      form.parties.find((p) => p.id === id)?.role === "PARTY"
    )
      return;
    setForm({ ...form, parties: form.parties.filter((p) => p.id !== id) });
  };

  const update = (id: string, field: keyof PartyInput, value: string) => {
    setForm({ ...form, parties: form.parties.map((p) => (p.id === id ? { ...p, [field]: value } : p)) });
  };

  const needsAddress = form.mode !== "CASUAL";
  const roleLabels: Record<string, string> = {
    PARTY: "Bettor / Party",
    ESCROW_AGENT: "Escrow Agent",
    DESIGNATED_ORACLE: "Judge / Oracle",
    COMMUNITY_VOTER: "Community Voter",
    OBSERVER: "Observer",
  };

  // Detect chain from address format
  const detectChain = (addr: string): string => {
    if (!addr) return "";
    if (addr.startsWith("0x") && addr.length === 42) return "ETH";
    if (addr.length >= 32 && addr.length <= 44 && !addr.startsWith("0x") && !addr.startsWith("bc1")) return "SOL";
    if (addr.startsWith("bc1") || addr.startsWith("1") || addr.startsWith("3")) return "BTC";
    return "";
  };

  return (
    <div className="space-y-3">
      {form.parties.map((party) => (
        <GlassCard key={party.id} hover={false} className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] font-medium text-muted">
                {roleLabels[party.role] ?? party.role}
              </span>
            </div>
            {!(party.role === "PARTY" && form.parties.filter((p) => p.role === "PARTY").length <= 2) && (
              <button
                className="rounded-lg p-1.5 text-muted transition-colors hover:text-red-400"
                onClick={() => removeParty(party.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name / Label" required>
              <Input
                value={party.label}
                onChange={(e) => update(party.id, "label", e.target.value)}
                placeholder="Who is this?"
              />
            </Field>
            <Field label="Email" hint="For notifications">
              <Input
                type="email"
                value={party.email}
                onChange={(e) => update(party.id, "email", e.target.value)}
                placeholder="Optional"
              />
            </Field>
          </div>

          {needsAddress && (
            <Field label="Wallet Address" hint="We'll auto-detect the chain">
              <Input
                value={party.address}
                onChange={(e) => {
                  const addr = e.target.value;
                  const chain = detectChain(addr);
                  setForm({
                    ...form,
                    parties: form.parties.map((p) => (p.id === party.id ? { ...p, address: addr, chain } : p)),
                  });
                }}
                placeholder="0x... / So... / bc1..."
              />
              {party.chain && (
                <span className="mt-1 inline-flex items-center gap-1 text-xs text-green-400">
                  Detected: {party.chain}
                </span>
              )}
            </Field>
          )}
        </GlassCard>
      ))}

      <div className="flex flex-wrap gap-2">
        <W3SButton variant="secondary" size="sm" onClick={() => addParty("PARTY")}>
          <Plus className="h-4 w-4" /> Add Party
        </W3SButton>
        {(form.mode === "FULL_ESCROW" || form.mode === "MULTI_ESCROW") && (
          <W3SButton variant="ghost" size="sm" onClick={() => addParty("ESCROW_AGENT")}>
            <Plus className="h-4 w-4" /> Add Escrow Agent
          </W3SButton>
        )}
        {form.mode === "DESIGNATED_ORACLE" && (
          <W3SButton variant="ghost" size="sm" onClick={() => addParty("DESIGNATED_ORACLE")}>
            <Plus className="h-4 w-4" /> Add Judge
          </W3SButton>
        )}
        <W3SButton variant="ghost" size="sm" onClick={() => addParty("OBSERVER")}>
          <Plus className="h-4 w-4" /> Add Observer
        </W3SButton>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step: Assets (supports multiple)                                   */
/* ------------------------------------------------------------------ */

function StepAssets({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const addAsset = () => setForm({ ...form, assets: [...form.assets, createAsset()] });
  const removeAsset = (id: string) => {
    if (form.assets.length <= 1) return;
    setForm({ ...form, assets: form.assets.filter((a) => a.id !== id) });
  };
  const update = (id: string, updates: Partial<AssetInput>) => {
    setForm({ ...form, assets: form.assets.map((a) => (a.id === id ? { ...a, ...updates } : a)) });
  };

  return (
    <div className="space-y-4">
      <InfoBox>
        Add one or more assets. Each party can put up different things — crypto, fiat, or real-world assets.
      </InfoBox>

      {form.assets.map((asset, i) => (
        <GlassCard key={asset.id} hover={false} className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-secondary">Asset {i + 1}</span>
            {form.assets.length > 1 && (
              <button
                className="rounded-lg p-1.5 text-muted transition-colors hover:text-red-400"
                onClick={() => removeAsset(asset.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Asset category */}
          <div className="flex gap-2">
            {(["crypto", "fiat", "rwa"] as const).map((cat) => (
              <button
                key={cat}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  asset.category === cat
                    ? "bg-[var(--accent)]/10 border-[var(--accent)] text-[var(--accent)]"
                    : "hover:border-[var(--accent)]/50 border-[var(--border)] text-muted"
                }`}
                onClick={() => update(asset.id, { category: cat, chain: "", kind: "", symbol: "" })}
              >
                {cat === "crypto" ? "Crypto" : cat === "fiat" ? "Fiat / USD" : "Real-World Asset"}
              </button>
            ))}
          </div>

          {/* Crypto asset */}
          {asset.category === "crypto" && (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Chain" required>
                  <Select
                    value={asset.chain}
                    onChange={(e) =>
                      update(asset.id, {
                        chain: e.target.value,
                        kind: "",
                        symbol:
                          e.target.value === "ETH"
                            ? "ETH"
                            : e.target.value === "SOL"
                              ? "SOL"
                              : e.target.value === "BTC"
                                ? "BTC"
                                : "",
                      })
                    }
                    options={[
                      { value: "ETH", label: "Ethereum" },
                      { value: "SOL", label: "Solana" },
                      { value: "BTC", label: "Bitcoin" },
                    ]}
                  />
                </Field>
                <Field label="Asset Type" required>
                  <Select
                    value={asset.kind}
                    onChange={(e) => update(asset.id, { kind: e.target.value })}
                    options={
                      asset.chain === "ETH"
                        ? [
                            { value: "NATIVE", label: "ETH" },
                            { value: "ERC20", label: "ERC-20 Token" },
                            { value: "ERC721", label: "NFT (ERC-721)" },
                          ]
                        : asset.chain === "SOL"
                          ? [
                              { value: "NATIVE", label: "SOL" },
                              { value: "SPL_TOKEN", label: "SPL Token" },
                              { value: "SPL_NFT", label: "NFT (Metaplex)" },
                            ]
                          : asset.chain === "BTC"
                            ? [
                                { value: "NATIVE", label: "BTC" },
                                { value: "ORDINAL", label: "Ordinal" },
                                { value: "BRC20", label: "BRC-20" },
                              ]
                            : []
                    }
                  />
                </Field>
                <Field label="Amount" required>
                  <Input
                    value={asset.amount}
                    onChange={(e) => update(asset.id, { amount: e.target.value })}
                    placeholder="0.1"
                  />
                </Field>
              </div>
              {["ERC20", "ERC721", "SPL_TOKEN", "SPL_NFT"].includes(asset.kind) && (
                <Field label="Contract / Mint Address" required>
                  <Input
                    value={asset.contractAddress}
                    onChange={(e) => update(asset.id, { contractAddress: e.target.value })}
                    placeholder="Token contract address"
                  />
                </Field>
              )}
              {["ERC721", "ORDINAL"].includes(asset.kind) && (
                <Field label="Token ID / Inscription ID">
                  <Input
                    value={asset.tokenId}
                    onChange={(e) => update(asset.id, { tokenId: e.target.value })}
                    placeholder="Token ID"
                  />
                </Field>
              )}
            </>
          )}

          {/* Fiat */}
          {asset.category === "fiat" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Currency">
                <Select
                  value={asset.symbol || "USD"}
                  onChange={(e) => update(asset.id, { symbol: e.target.value, kind: "USD" })}
                  options={[
                    { value: "USD", label: "US Dollar ($)" },
                    { value: "EUR", label: "Euro (€)" },
                    { value: "GBP", label: "British Pound (£)" },
                    { value: "CAD", label: "Canadian Dollar (C$)" },
                  ]}
                />
              </Field>
              <Field label="Amount" required>
                <Input
                  value={asset.amount}
                  onChange={(e) => update(asset.id, { amount: e.target.value })}
                  placeholder="50.00"
                />
              </Field>
            </div>
          )}

          {/* Real-world asset */}
          {asset.category === "rwa" && (
            <>
              <Field label="Asset Type" required>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {RWA_CATEGORIES.map((cat) => {
                    const Icon = cat.icon;
                    return (
                      <button
                        key={cat.kind}
                        className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-colors ${
                          asset.rwaKind === cat.kind
                            ? "bg-[var(--accent)]/10 border-[var(--accent)]"
                            : "hover:border-[var(--accent)]/50 border-[var(--border)]"
                        }`}
                        onClick={() => update(asset.id, { rwaKind: cat.kind, kind: cat.kind })}
                      >
                        <Icon className="h-4 w-4 text-[var(--accent)]" />
                        <span className="text-[10px] font-medium">{cat.label}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>

              {asset.rwaKind &&
                (() => {
                  const cat = RWA_CATEGORIES.find((c) => c.kind === asset.rwaKind);
                  if (!cat) return null;
                  return (
                    <>
                      <Field label="Description" required hint={cat.placeholder}>
                        <Input
                          value={asset.rwaDescription}
                          onChange={(e) => update(asset.id, { rwaDescription: e.target.value })}
                          placeholder={cat.placeholder}
                        />
                      </Field>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={cat.identifierLabel} required>
                          <Input
                            value={asset.rwaIdentifier}
                            onChange={(e) => update(asset.id, { rwaIdentifier: e.target.value })}
                            placeholder={`Enter ${cat.identifierLabel}`}
                          />
                        </Field>
                        <Field label="Estimated Value (USD)" required>
                          <Input
                            value={asset.rwaEstimatedValueUsd}
                            onChange={(e) => update(asset.id, { rwaEstimatedValueUsd: e.target.value })}
                            placeholder="30,000"
                          />
                        </Field>
                      </div>
                      <InfoBox>
                        Suggested verifications for {cat.label.toLowerCase()}:{" "}
                        {cat.suggestedVerifications.join(", ").toLowerCase().replace(/_/g, " ")}. You can add
                        verification documents after creating the escrow.
                      </InfoBox>
                    </>
                  );
                })()}
            </>
          )}

          {/* Who's putting this up */}
          {form.parties.filter((p) => p.role === "PARTY").length > 1 && (
            <Field label="From" hint="Which party is putting up this asset?">
              <Select
                value={asset.fromParticipantId}
                onChange={(e) => update(asset.id, { fromParticipantId: e.target.value })}
                options={form.parties.filter((p) => p.role === "PARTY").map((p) => ({ value: p.id, label: p.label }))}
                placeholder="All parties equally"
              />
            </Field>
          )}
        </GlassCard>
      ))}

      <W3SButton variant="secondary" size="sm" onClick={addAsset}>
        <Plus className="h-4 w-4" /> Add Another Asset
      </W3SButton>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step: Outcomes                                                     */
/* ------------------------------------------------------------------ */

function StepOutcomes({ form, setForm }: { form: FormState; setForm: (f: FormState) => void }) {
  const addOutcome = () => setForm({ ...form, outcomes: [...form.outcomes, createOutcome()] });
  const removeOutcome = (id: string) => {
    if (form.outcomes.length <= 2) return;
    setForm({ ...form, outcomes: form.outcomes.filter((o) => o.id !== id) });
  };
  const update = (id: string, updates: Partial<OutcomeInput>) => {
    setForm({ ...form, outcomes: form.outcomes.map((o) => (o.id === id ? { ...o, ...updates } : o)) });
  };

  const parties = form.parties.filter((p) => p.role === "PARTY");

  return (
    <div className="space-y-3">
      <InfoBox>Define what can happen and who wins in each case. You can have as many outcomes as you need.</InfoBox>

      {form.outcomes.map((outcome, i) => (
        <GlassCard key={outcome.id} hover={false} className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-secondary">Outcome {i + 1}</span>
            {form.outcomes.length > 2 && (
              <button
                className="rounded-lg p-1.5 text-muted transition-colors hover:text-red-400"
                onClick={() => removeOutcome(outcome.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Field label="What happens?" required>
            <Input
              value={outcome.description}
              onChange={(e) => update(outcome.id, { description: e.target.value })}
              placeholder={i === 0 ? "e.g. Team A wins" : i === 1 ? "e.g. Team B wins" : "e.g. Draw / tie"}
            />
          </Field>

          <Field label="Winner(s)" hint="Who gets paid if this outcome happens?">
            <div className="flex flex-wrap gap-2">
              {parties.map((p) => {
                const selected = outcome.winnerPartyIds.includes(p.id);
                return (
                  <button
                    key={p.id}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? "border-green-500/50 bg-green-500/10 text-green-400"
                        : "border-[var(--border)] text-muted hover:border-green-500/30"
                    }`}
                    onClick={() => {
                      const next = selected
                        ? outcome.winnerPartyIds.filter((id) => id !== p.id)
                        : [...outcome.winnerPartyIds, p.id];
                      update(outcome.id, { winnerPartyIds: next });
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </Field>

          {/* Outcome mapping for oracle */}
          {form.mode === "PLATFORM_ESCROW" && (
            <Field label="Oracle mapping" hint="What does the oracle call this outcome?">
              <Input placeholder={i === 0 ? "Yes" : "No"} />
            </Field>
          )}
        </GlassCard>
      ))}

      <W3SButton variant="secondary" size="sm" onClick={addOutcome}>
        <Plus className="h-4 w-4" /> Add Outcome
      </W3SButton>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Step: Review                                                       */
/* ------------------------------------------------------------------ */

function StepReview({ form }: { form: FormState }) {
  const modeConfig = MODES.find((m) => m.mode === form.mode);
  const parties = form.parties.filter((p) => p.role === "PARTY");
  const agents = form.parties.filter((p) => p.role === "ESCROW_AGENT" || p.role === "DESIGNATED_ORACLE");

  return (
    <div className="space-y-4">
      <GlassCard hover={false}>
        <h4 className="mb-3 text-sm font-semibold">Summary</h4>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Mode</dt>
            <dd className="font-medium">{modeConfig?.label}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Title</dt>
            <dd className="font-medium">{form.title || "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Parties</dt>
            <dd className="font-medium">{parties.map((p) => p.label).join(", ")}</dd>
          </div>
          {agents.length > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">Judges / Agents</dt>
              <dd className="font-medium">{agents.map((p) => p.label).join(", ")}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted">Assets</dt>
            <dd className="font-medium">{form.assets.length} asset(s)</dd>
          </div>
          {form.assets.map((a, i) => (
            <div key={a.id} className="flex justify-between pl-4">
              <dt className="text-muted">Asset {i + 1}</dt>
              <dd className="font-medium">
                {a.category === "rwa" ? a.rwaDescription || a.rwaKind : `${a.amount} ${a.symbol}`}
              </dd>
            </div>
          ))}
          <div className="flex justify-between">
            <dt className="text-muted">Outcomes</dt>
            <dd className="font-medium">{form.outcomes.length}</dd>
          </div>
          {form.expiresInDays && (
            <div className="flex justify-between">
              <dt className="text-muted">Expires</dt>
              <dd className="font-medium">{form.expiresInDays} days</dd>
            </div>
          )}
        </dl>
      </GlassCard>

      {form.description && (
        <GlassCard hover={false}>
          <h4 className="mb-2 text-sm font-semibold">Terms</h4>
          <p className="whitespace-pre-wrap text-xs text-secondary">{form.description}</p>
        </GlassCard>
      )}

      <InfoBox>
        All parties will need to sign these terms with their crypto wallet before the escrow becomes active.
      </InfoBox>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main wizard                                                        */
/* ------------------------------------------------------------------ */

export function EscrowCreate() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { authenticated } = useWallet();

  const [form, setForm] = useState<FormState>(() => initialState(searchParams.get("mode") ?? undefined));
  const [stepIndex, setStepIndex] = useState(form.mode ? 1 : 0);
  const [aiOpen, setAiOpen] = useState(false);

  const currentStep = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  const canProceed = useCallback((): boolean => {
    switch (currentStep) {
      case "Mode":
        return form.mode !== null;
      case "Details":
        return form.title.trim().length > 0 && form.description.trim().length > 0;
      case "Parties":
        return form.parties.filter((p) => p.role === "PARTY").length >= 2 && form.parties.every((p) => p.label.trim());
      case "Assets":
        return (
          form.assets.length > 0 && form.assets.every((a) => (a.category === "rwa" ? !!a.rwaDescription : !!a.amount))
        );
      case "Outcomes":
        return form.outcomes.length >= 2 && form.outcomes.every((o) => o.description.trim());
      case "Review":
        return true;
      default:
        return false;
    }
  }, [currentStep, form]);

  const handleNext = () => {
    if (isLast) {
      // TODO: Submit via trpc.escrow.create
      alert("Ready to submit! Wire to trpc.escrow.create");
      return;
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };

  if (!authenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Lock className="mb-4 h-8 w-8 text-muted" />
        <h3 className="text-lg font-semibold">Connect your wallet</h3>
        <p className="mt-1 text-sm text-muted">Sign in to create an escrow</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Progress + AI button */}
        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center gap-1">
            {STEPS.map((step, i) => (
              <button
                key={step}
                className={`flex-1 rounded-full py-1 text-center text-xs font-medium transition-colors ${
                  i === stepIndex
                    ? "bg-[var(--accent)] text-white"
                    : i < stepIndex
                      ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                      : "bg-[var(--bg-surface)] text-muted"
                }`}
                onClick={() => i < stepIndex && setStepIndex(i)}
                disabled={i > stepIndex}
              >
                {step}
              </button>
            ))}
          </div>
          <W3SButton variant="ghost" size="sm" onClick={() => setAiOpen(true)} className="flex-shrink-0">
            <Sparkles className="h-4 w-4" /> AI
          </W3SButton>
        </div>

        {/* Step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {currentStep === "Mode" && <StepMode form={form} setForm={setForm} />}
            {currentStep === "Details" && <StepDetails form={form} setForm={setForm} />}
            {currentStep === "Parties" && <StepParties form={form} setForm={setForm} />}
            {currentStep === "Assets" && <StepAssets form={form} setForm={setForm} />}
            {currentStep === "Outcomes" && <StepOutcomes form={form} setForm={setForm} />}
            {currentStep === "Review" && <StepReview form={form} />}
          </motion.div>
        </AnimatePresence>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-4">
          <W3SButton
            variant="secondary"
            size="sm"
            onClick={() => (isFirst ? router.push("/escrow") : setStepIndex((i) => i - 1))}
          >
            <ArrowLeft className="h-4 w-4" /> {isFirst ? "Cancel" : "Back"}
          </W3SButton>
          <W3SButton variant="primary" size="sm" onClick={handleNext} disabled={!canProceed()}>
            {isLast ? "Create Escrow" : "Next"} <ArrowRight className="h-4 w-4" />
          </W3SButton>
        </div>
      </div>

      {/* AI Chat Drawer */}
      <AnimatePresence>
        {aiOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black"
              onClick={() => setAiOpen(false)}
            />
            <AiChatDrawer open={aiOpen} onClose={() => setAiOpen(false)} />
          </>
        )}
      </AnimatePresence>
    </>
  );
}
