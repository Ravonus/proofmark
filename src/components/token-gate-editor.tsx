"use client";

import { Plus, Shield, Trash2 } from "lucide-react";
import {
  describeSignerTokenGate,
  type SignerTokenGate,
  type TokenGateRule,
  TOKEN_GATE_TYPE_OPTIONS,
} from "~/lib/token-gates";
import { Select } from "./ui/select";
import { W3SButton } from "./ui/motion";

type Props = {
  value: SignerTokenGate | null | undefined;
  onChange: (value: SignerTokenGate | null) => void;
};

function createRuleId() {
  return `gate-${Math.random().toString(36).slice(2, 10)}`;
}

function createRule(type: TokenGateRule["type"]): TokenGateRule {
  switch (type) {
    case "ERC20":
      return { id: createRuleId(), chain: "ETH", type: "ERC20", contractAddress: "", minAmount: "1" };
    case "ERC721":
      return { id: createRuleId(), chain: "ETH", type: "ERC721", contractAddress: "", tokenId: "", minAmount: "1" };
    case "SPL":
      return { id: createRuleId(), chain: "SOL", type: "SPL", mintAddress: "", minAmount: "1" };
    case "ORDINAL":
      return {
        id: createRuleId(),
        chain: "BTC",
        type: "ORDINAL",
        identifierType: "INSCRIPTION_ID",
        identifier: "",
      };
    case "RUNE":
      return { id: createRuleId(), chain: "BTC", type: "RUNE", identifier: "", minAmount: "1" };
  }
}

function nextGate(value: SignerTokenGate | null | undefined): SignerTokenGate {
  return value ?? { mode: "ALL", devBypass: false, rules: [] };
}

const inputClassName =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-hover)] px-2.5 py-1.5 text-[11px] text-primary outline-none transition-colors focus:border-[var(--accent)]";

export function TokenGateEditor({ value, onChange }: Props) {
  const gate = nextGate(value);
  const summary = describeSignerTokenGate(value);

  const setRules = (rules: TokenGateRule[]) => {
    onChange(rules.length > 0 ? { ...gate, rules } : null);
  };

  const replaceRule = (ruleId: string | undefined, nextRule: TokenGateRule) => {
    setRules(gate.rules.map((rule) => (rule.id === ruleId ? nextRule : rule)));
  };

  const handleTypeChange = (ruleId: string | undefined, type: TokenGateRule["type"]) => {
    setRules(
      gate.rules.map((rule) => (rule.id === ruleId ? { ...createRule(type), id: rule.id ?? createRuleId() } : rule)),
    );
  };

  return (
    <div className="bg-[var(--bg-hover)]/40 rounded-lg border border-[var(--border)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-[11px] font-medium text-secondary">
            <Shield className="h-3.5 w-3.5 text-accent" />
            Token Gate
          </p>
          <p className="mt-1 text-[10px] text-muted">
            Require this signer to connect a wallet that already holds a token, NFT, ordinal, or rune.
          </p>
        </div>
        <W3SButton
          variant={gate.rules.length > 0 ? "secondary" : "accent-outline"}
          size="xs"
          onClick={() => setRules([...gate.rules, createRule("ERC20")])}
        >
          <Plus className="h-3 w-3" /> {gate.rules.length > 0 ? "Add rule" : "Enable"}
        </W3SButton>
      </div>

      {gate.rules.length > 0 && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-[120px,1fr]">
            <Select
              value={gate.mode}
              onChange={(nextMode) => onChange({ ...gate, mode: nextMode as SignerTokenGate["mode"] })}
              size="sm"
              variant="glass"
              label="Match"
              options={[
                { value: "ALL", label: "Match all", description: "Wallet must satisfy every rule" },
                { value: "ANY", label: "Match any", description: "Wallet can satisfy just one rule" },
              ]}
            />
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[10px] text-muted">
              {summary ?? "Add one or more rules below."}
            </div>
          </div>

          {gate.rules.map((rule, index) => (
            <div
              key={rule.id ?? `${rule.type}-${index}`}
              className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-3"
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Rule {index + 1}</p>
                </div>
                <Select
                  value={rule.type}
                  onChange={(nextType) => handleTypeChange(rule.id, nextType as TokenGateRule["type"])}
                  size="sm"
                  variant="glass"
                  options={TOKEN_GATE_TYPE_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                    description: option.chain,
                  }))}
                />
                <button
                  type="button"
                  onClick={() => setRules(gate.rules.filter((candidate) => candidate.id !== rule.id))}
                  className="rounded-md p-1.5 text-red-400/70 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  title="Remove rule"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Label</span>
                  <input
                    value={rule.label ?? ""}
                    onChange={(event) => replaceRule(rule.id, { ...rule, label: event.target.value })}
                    placeholder="Optional display label"
                    className={inputClassName}
                  />
                </label>

                {rule.type === "ORDINAL" ? (
                  <Select
                    label="Match by"
                    value={rule.identifierType}
                    onChange={(nextValue) =>
                      replaceRule(rule.id, { ...rule, identifierType: nextValue as "INSCRIPTION_ID" | "COLLECTION_ID" })
                    }
                    size="sm"
                    variant="glass"
                    options={[
                      {
                        value: "INSCRIPTION_ID",
                        label: "Inscription ID",
                        description: "Verified via ord / ordinals.com",
                      },
                      { value: "COLLECTION_ID", label: "Collection ID", description: "Not supported yet" },
                    ]}
                  />
                ) : (
                  <div />
                )}
              </div>

              {rule.type === "ERC20" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Contract</span>
                    <input
                      value={rule.contractAddress}
                      onChange={(event) => replaceRule(rule.id, { ...rule, contractAddress: event.target.value })}
                      placeholder="0x..."
                      className={inputClassName}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">
                      Minimum Amount
                    </span>
                    <input
                      value={rule.minAmount}
                      onChange={(event) => replaceRule(rule.id, { ...rule, minAmount: event.target.value })}
                      placeholder="1000"
                      className={inputClassName}
                    />
                  </label>
                </div>
              )}

              {rule.type === "ERC721" && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="space-y-1 sm:col-span-2">
                    <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Contract</span>
                    <input
                      value={rule.contractAddress}
                      onChange={(event) => replaceRule(rule.id, { ...rule, contractAddress: event.target.value })}
                      placeholder="0x..."
                      className={inputClassName}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Token ID</span>
                    <input
                      value={rule.tokenId ?? ""}
                      onChange={(event) => replaceRule(rule.id, { ...rule, tokenId: event.target.value })}
                      placeholder="Optional"
                      className={inputClassName}
                    />
                  </label>
                  <label className="space-y-1 sm:col-span-3">
                    <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Minimum NFTs</span>
                    <input
                      value={rule.minAmount}
                      onChange={(event) => replaceRule(rule.id, { ...rule, minAmount: event.target.value })}
                      placeholder="1"
                      className={inputClassName}
                    />
                  </label>
                </div>
              )}

              {rule.type === "SPL" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Mint</span>
                    <input
                      value={rule.mintAddress}
                      onChange={(event) => replaceRule(rule.id, { ...rule, mintAddress: event.target.value })}
                      placeholder="So111111..."
                      className={inputClassName}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">
                      Minimum Amount
                    </span>
                    <input
                      value={rule.minAmount}
                      onChange={(event) => replaceRule(rule.id, { ...rule, minAmount: event.target.value })}
                      placeholder="500000"
                      className={inputClassName}
                    />
                  </label>
                </div>
              )}

              {rule.type === "ORDINAL" && (
                <label className="space-y-1">
                  <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">
                    {rule.identifierType === "COLLECTION_ID" ? "Collection ID" : "Inscription ID"}
                  </span>
                  <input
                    value={rule.identifier}
                    onChange={(event) => replaceRule(rule.id, { ...rule, identifier: event.target.value })}
                    placeholder={rule.identifierType === "COLLECTION_ID" ? "collection-id" : "txidi0"}
                    className={inputClassName}
                  />
                </label>
              )}

              {rule.type === "RUNE" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">Rune</span>
                    <input
                      value={rule.identifier}
                      onChange={(event) => replaceRule(rule.id, { ...rule, identifier: event.target.value })}
                      placeholder="DOG•GO•TO•THE•MOON or 840000:3"
                      className={inputClassName}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-muted">
                      Minimum Amount
                    </span>
                    <input
                      value={rule.minAmount}
                      onChange={(event) => replaceRule(rule.id, { ...rule, minAmount: event.target.value })}
                      placeholder="1"
                      className={inputClassName}
                    />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
