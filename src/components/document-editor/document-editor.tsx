"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { trpc } from "~/lib/trpc";
import { Select } from "../ui/select";
import { buildAddressSuggestionFieldUpdates, type AddressSuggestion } from "~/lib/address-autocomplete";
import {
  tokenizeDocument,
  tokensToContent,
  PLACEHOLDERS,
  type DocToken,
  type InlineField,
} from "~/lib/document/document-tokens";
import { formatEditableFieldValue, getFieldLogicState } from "~/lib/document/field-runtime";
import { EditorHistory, type EditorSnapshot } from "~/lib/document/editor-history";
import { FieldPicker, getField, SIGNER_COLORS } from "../fields";
import {
  GripVertical,
  Trash2,
  Plus,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  X,
  PenTool,
  Eye,
  EyeOff,
  Save,
  Send,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  Users,
  FileText,
  Heading,
  List,
  Type as TypeIcon,
  CornerDownLeft,
  Pilcrow,
  Maximize2,
  Minimize2,
  Undo2,
  Redo2,
} from "lucide-react";
import { W3SButton, W3SIconButton } from "../ui/motion";
import type { SignerDef, EditorResult, PreviewValueMap } from "./document-editor-types";
import { SIGNER_BORDER_COLORS } from "./document-editor-types";
import { EditorField, EditorSignatureBlock, type SignatureBlockToken } from "./document-editor-fields";
import { TokenGateEditor } from "../settings/token-gate-editor";

export type { EditorResult, SignerDef } from "./document-editor-types";

type Props = {
  initialTitle: string;
  initialContent: string;
  initialSigners: SignerDef[];
  onSubmit: (result: EditorResult) => void;
  onSaveTemplate?: (result: EditorResult) => void | Promise<void>;
  onBack: () => void;
};

// ── Main Editor ──

export function DocumentEditor({
  initialTitle,
  initialContent,
  initialSigners,
  onSubmit,
  onSaveTemplate,
  onBack,
}: Props) {
  const addressSuggestionsMut = trpc.account.addressSuggestions.useMutation();
  const addressSuggestionsRef = useRef(addressSuggestionsMut);
  addressSuggestionsRef.current = addressSuggestionsMut;
  const [title, setTitle] = useState(initialTitle);
  const [tokens, setTokens] = useState<DocToken[]>(
    () => tokenizeDocument(initialContent, initialSigners.length).tokens,
  );
  const [fields, setFields] = useState<InlineField[]>(
    () => tokenizeDocument(initialContent, initialSigners.length).fields,
  );
  const [previewValues, setPreviewValues] = useState<PreviewValueMap>({});
  const [signers, setSigners] = useState<SignerDef[]>(
    initialSigners.length > 0
      ? initialSigners
      : [
          { label: "Party A", email: "", phone: "", tokenGates: null },
          { label: "Party B", email: "", phone: "", tokenGates: null },
        ],
  );
  const [addMode, setAddMode] = useState<InlineField["type"] | null>(null);
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [newSectionContent, setNewSectionContent] = useState("");
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [activeSigner, setActiveSigner] = useState(0);
  const [expandedSignerPhone, setExpandedSignerPhone] = useState<number | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [showSigners, setShowSigners] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const fieldCounter = useRef(fields.length);

  // ── Undo/redo ──
  const historyRef = useRef(new EditorHistory());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const handleUndo = useCallback(() => {
    const current: EditorSnapshot = {
      title,
      tokens: tokens as unknown[],
      fields: fields as unknown[],
      timestamp: Date.now(),
    };
    const prev = historyRef.current.undo(current);
    if (prev) {
      setTitle(prev.title);
      setTokens(prev.tokens as DocToken[]);
      setFields(prev.fields as InlineField[]);
    }
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
  }, [title, tokens, fields]);

  const handleRedo = useCallback(() => {
    const current: EditorSnapshot = {
      title,
      tokens: tokens as unknown[],
      fields: fields as unknown[],
      timestamp: Date.now(),
    };
    const next = historyRef.current.redo(current);
    if (next) {
      setTitle(next.title);
      setTokens(next.tokens as DocToken[]);
      setFields(next.fields as InlineField[]);
    }
    setCanUndo(historyRef.current.canUndo);
    setCanRedo(historyRef.current.canRedo);
  }, [title, tokens, fields]);

  const [dragFieldId, setDragFieldId] = useState<string | null>(null);
  const [dragNewType, setDragNewType] = useState<InlineField["type"] | null>(null);
  const [dropTargetIdx, setDropTargetIdx] = useState<number | null>(null);
  const dropTargetIdxRef = useRef<number | null>(null);
  const [dropIndicatorY, setDropIndicatorY] = useState(0);
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 });
  const isDragging = dragFieldId !== null || dragNewType !== null;
  const docContainerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isDragging) return;
    let lastX = 0,
      lastY = 0,
      scheduled = false;
    const handleDrag = (e: DragEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!scheduled) {
        scheduled = true;
        rafRef.current = requestAnimationFrame(() => {
          setGhostPos({ x: lastX, y: lastY });
          scheduled = false;
        });
      }
    };
    document.addEventListener("drag", handleDrag);
    document.addEventListener("dragover", handleDrag);
    return () => {
      document.removeEventListener("drag", handleDrag);
      document.removeEventListener("dragover", handleDrag);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isDragging]);

  const dragGhostLabel = useMemo(() => {
    if (dragNewType) {
      const f = getField(dragNewType);
      return f ? f.label : dragNewType;
    }
    if (dragFieldId) {
      const f = fields.find((ff) => ff.id === dragFieldId);
      return f ? f.label : "Field";
    }
    return "";
  }, [dragNewType, dragFieldId, fields]);

  /** Find the nearest token element to the cursor and show a drop indicator above or below it. */
  const handleDocDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const container = docContainerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const wrappers = container.querySelectorAll("[data-token-idx]");
    let closestIdx = 0,
      closestDist = Infinity,
      indicatorY = 0;
    wrappers.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const dist = Math.abs(e.clientY - midpoint);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = parseInt(el.getAttribute("data-token-idx") || "0");
        indicatorY = e.clientY < midpoint ? rect.top - containerRect.top : rect.bottom - containerRect.top;
      }
    });
    dropTargetIdxRef.current = closestIdx;
    setDropTargetIdx(closestIdx);
    setDropIndicatorY(indicatorY);
  }, []);

  const insertFieldAfterToken = useCallback(
    (afterIdx: number, type: InlineField["type"], label: string) => {
      const id = `field-${fieldCounter.current++}`;
      const config = getField(type);
      const nf: InlineField = {
        id,
        type,
        label: label || config?.label || "Field",
        placeholder: config?.placeholder || PLACEHOLDERS[type] || "Enter value",
        signerIdx: activeSigner,
        required: true,
        options: config?.validation?.options,
        settings: type === "custom-field" ? { inputType: "text", validation: {}, logic: {}, display: {} } : undefined,
      };
      setTokens((prev) => {
        const c = [...prev];
        c.splice(afterIdx + 1, 0, { kind: "field", field: nf });
        return c;
      });
      setFields((prev) => [...prev, nf]);
      setAddMode(null);
      setActiveFieldId(id);
    },
    [activeSigner],
  );

  const removeField = useCallback((fid: string) => {
    setTokens((p) => p.filter((t) => !(t.kind === "field" && t.field.id === fid)));
    setFields((p) => p.filter((f) => f.id !== fid));
    setPreviewValues((current) => {
      const next = { ...current };
      delete next[fid];
      return next;
    });
    setActiveFieldId(null);
  }, []);

  const moveFieldToIdx = useCallback((fid: string, toIdx: number) => {
    setTokens((prev) => {
      const fi = prev.findIndex((t) => t.kind === "field" && t.field.id === fid);
      if (fi === -1) return prev;
      const c = [...prev];
      const [r] = c.splice(fi, 1);
      c.splice(toIdx > fi ? toIdx - 1 : toIdx, 0, r!);
      return c;
    });
  }, []);

  const handleDrop = useCallback(
    (afterIdx: number) => {
      if (dragFieldId) moveFieldToIdx(dragFieldId, afterIdx + 1);
      else if (dragNewType) insertFieldAfterToken(afterIdx, dragNewType, "");
      setDragFieldId(null);
      setDragNewType(null);
      setDropTargetIdx(null);
    },
    [dragFieldId, dragNewType, moveFieldToIdx, insertFieldAfterToken],
  );

  const handleDocDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const idx = dropTargetIdxRef.current;
      if (idx !== null) handleDrop(idx - 1);
      dropTargetIdxRef.current = null;
      setDropTargetIdx(null);
    },
    [handleDrop],
  );

  const updateField = useCallback((fid: string, patch: Partial<InlineField>) => {
    setFields((p) => p.map((f) => (f.id === fid ? { ...f, ...patch } : f)));
    setTokens((p) =>
      p.map((t) => (t.kind === "field" && t.field.id === fid ? { ...t, field: { ...t.field, ...patch } } : t)),
    );
  }, []);

  const setPreviewValue = useCallback((fieldId: string, value: string) => {
    setPreviewValues((current) => {
      if (!value) {
        const next = { ...current };
        delete next[fieldId];
        return next;
      }
      return {
        ...current,
        [fieldId]: value,
      };
    });
  }, []);

  const loadAddressSuggestions = useCallback(async (query: string) => {
    if (query.trim().length < 3) return [];
    const result = await addressSuggestionsRef.current.mutateAsync({ query: query.trim(), limit: 5 });
    return result.suggestions;
  }, []);

  const applyPreviewAddressSuggestion = useCallback(
    (field: InlineField, suggestion: AddressSuggestion) => {
      const updates = buildAddressSuggestionFieldUpdates({
        anchorField: field,
        fields,
        suggestion,
      });

      setPreviewValues((current) => {
        const next = { ...current };
        for (const [fieldId, rawValue] of Object.entries(updates)) {
          const targetField = fields.find((candidate) => candidate.id === fieldId);
          if (!targetField) continue;
          next[fieldId] = formatEditableFieldValue(targetField, rawValue);
        }
        return next;
      });
    },
    [fields],
  );

  useEffect(() => {
    setPreviewValues((current) => {
      const nextEntries = Object.entries(current).filter(([fieldId]) => fields.some((field) => field.id === fieldId));
      if (nextEntries.length === Object.keys(current).length) return current;
      return Object.fromEntries(nextEntries);
    });
  }, [fields]);

  useEffect(() => {
    setPreviewValues((current) => {
      let changed = false;
      const next = { ...current };
      for (const field of fields) {
        const logicState = getFieldLogicState(field, next);
        if (!logicState.visible && logicState.clearWhenHidden && field.id in next) {
          delete next[field.id];
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [fields]);

  const updateSigBlock = useCallback((ti: number, patch: Partial<SignatureBlockToken>) => {
    setTokens((p) => p.map((t, i) => (i === ti && t.kind === "signatureBlock" ? { ...t, ...patch } : t)));
  }, []);
  const removeSigBlock = useCallback((ti: number) => {
    setTokens((p) => p.filter((_, i) => i !== ti));
    setActiveFieldId(null);
  }, []);

  // ── Text editing helpers ──
  const updateTokenText = useCallback((idx: number, text: string) => {
    setTokens((p) =>
      p.map((t, i) => {
        if (i !== idx) return t;
        if (t.kind === "text" || t.kind === "heading" || t.kind === "subheading" || t.kind === "listItem")
          return { ...t, text };
        return t;
      }),
    );
  }, []);

  const removeToken = useCallback((idx: number) => {
    setTokens((p) => {
      const t = p[idx];
      if (!t) return p;
      if (t.kind === "field") {
        setFields((f) => f.filter((ff) => ff.id !== t.field.id));
      }
      return p.filter((_, i) => i !== idx);
    });
    setActiveFieldId(null);
  }, []);

  const insertTokenAfter = useCallback((afterIdx: number, token: DocToken) => {
    setTokens((p) => {
      const c = [...p];
      c.splice(afterIdx + 1, 0, token);
      return c;
    });
  }, []);

  const addSection = useCallback(() => {
    if (!newSectionTitle.trim()) return;
    const nt: DocToken[] = [
      { kind: "break" },
      {
        kind: "heading",
        text: `${tokens.filter((t) => t.kind === "heading").length + 1}. ${newSectionTitle.toUpperCase()}`,
        sectionNum: tokens.filter((t) => t.kind === "heading").length + 1,
      },
      { kind: "break" },
    ];
    if (newSectionContent.trim())
      newSectionContent.split("\n").forEach((l) => {
        if (l.trim()) nt.push({ kind: "text", text: l.trim() });
        else nt.push({ kind: "break" });
      });
    setTokens((p) => [...p, ...nt]);
    setNewSectionTitle("");
    setNewSectionContent("");
    setShowAddSection(false);
  }, [newSectionTitle, newSectionContent, tokens]);

  const removeSection = useCallback((hi: number) => {
    setTokens((prev) => {
      const c = [...prev];
      let ei = hi + 1;
      while (ei < c.length && c[ei]!.kind !== "heading" && c[ei]!.kind !== "subheading") ei++;
      const rm = c.splice(hi, ei - hi);
      const rids = new Set(
        rm.filter((t): t is Extract<DocToken, { kind: "field" }> => t.kind === "field").map((t) => t.field.id),
      );
      if (rids.size > 0) setFields((f) => f.filter((ff) => !rids.has(ff.id)));
      return c;
    });
  }, []);

  const addSigner = useCallback(() => {
    setSigners((p) => [
      ...p,
      {
        label: `Party ${String.fromCharCode(65 + p.length)}`,
        email: "",
        phone: "",
        tokenGates: null,
      },
    ]);
  }, []);
  const moveSection = useCallback((hi: number, dir: "up" | "down") => {
    setTokens((prev) => {
      const c = [...prev];
      let ei = hi + 1;
      while (ei < c.length && c[ei]!.kind !== "heading") ei++;
      const sec = c.splice(hi, ei - hi);
      if (dir === "up") {
        let ph = hi - 1;
        while (ph >= 0 && c[ph]!.kind !== "heading") ph--;
        c.splice(Math.max(ph, 0), 0, ...sec);
      } else {
        let nh = hi;
        while (nh < c.length && c[nh]!.kind !== "heading") nh++;
        let ne = nh + 1;
        while (ne < c.length && c[ne]!.kind !== "heading") ne++;
        c.splice(ne, 0, ...sec);
      }
      return c;
    });
  }, []);

  const fieldCallbacks = useRef(
    new Map<
      string,
      {
        onFocus: () => void;
        onUpdate: (p: Partial<InlineField>) => void;
        onRemove: () => void;
        onDragStart: () => void;
        onDragEnd: () => void;
      }
    >(),
  );
  const getCbs = useCallback(
    (fid: string) => {
      let c = fieldCallbacks.current.get(fid);
      if (!c) {
        c = {
          onFocus: () => setActiveFieldId(fid),
          onUpdate: (p: Partial<InlineField>) => updateField(fid, p),
          onRemove: () => removeField(fid),
          onDragStart: () => setDragFieldId(fid),
          onDragEnd: () => {
            setDragFieldId(null);
            setDropTargetIdx(null);
          },
        };
        fieldCallbacks.current.set(fid, c);
      }
      return c;
    },
    [updateField, removeField],
  );

  const buildResult = (): EditorResult => {
    const content = tokensToContent(tokens);
    const sf = signers.map((_, idx) =>
      fields
        .filter((f) => f.signerIdx === idx)
        .map((f) => ({
          id: f.id,
          type: f.type,
          label: f.label,
          value: null,
          required: f.required ?? true,
          options: f.options,
          settings: f.settings,
        })),
    );
    return {
      title: title.trim() || "Untitled Document",
      content,
      signers: signers.map((s, i) => ({
        label: s.label.trim() || `Party ${String.fromCharCode(65 + i)}`,
        email: s.email.trim(),
        phone: s.phone?.trim() || "",
        role: s.role ?? "SIGNER",
        signMethod: s.signMethod ?? "WALLET",
        tokenGates: s.tokenGates ?? null,
        fields: sf[i] ?? [],
      })),
    };
  };

  const handleSignerChange = useCallback(<K extends keyof SignerDef>(idx: number, key: K, value: SignerDef[K]) => {
    setSigners((p) => p.map((s, i) => (i === idx ? { ...s, [key]: value } : s)));
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape" && fullscreen) {
        setFullscreen(false);
        return;
      }
      // Undo/redo keyboard shortcuts
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        setAddMode(null);
        setActiveFieldId(null);
      }
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [fullscreen, handleUndo, handleRedo]);

  // ── Memoized document body ──
  // This is the expensive part (renders every token). We memoize it so UI-only
  // state changes (fullscreen, showPanel, showSigners, title, mobilePanel, etc.)
  // skip re-rendering the entire document.
  const documentPaper = useMemo(
    () => (
      <div
        ref={docContainerRef}
        className="relative overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm"
        onDragOver={isDragging ? handleDocDragOver : undefined}
        onDragLeave={isDragging ? () => setDropTargetIdx(null) : undefined}
        onDrop={isDragging ? handleDocDrop : undefined}
      >
        {isDragging && dropTargetIdx !== null && (
          <div
            className="pointer-events-none absolute left-6 right-6 z-40 h-0.5 rounded-full bg-[var(--accent)]"
            style={{ top: `${dropIndicatorY}px`, transition: "top 0.08s ease" }}
          />
        )}
        <div
          className="space-y-1 px-6 py-8 sm:px-12 sm:py-12"
          style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
        >
          {tokens.map((token, i) => {
            const canInsert = addMode && !previewMode && !isDragging;

            const insertBetween =
              !previewMode && token.kind !== "break" && i > 0 ? (
                <div key={`ins-${i}`} className="group/insert relative z-10 -my-px h-0">
                  <div className="absolute left-0 right-0 top-1/2 flex -translate-y-1/2 items-center opacity-0 transition-opacity group-hover/insert:opacity-100">
                    <div className="bg-[var(--accent)]/30 h-px flex-1" />
                    <div className="flex items-center gap-0.5 px-1">
                      <button
                        onClick={() => insertTokenAfter(i - 1, { kind: "text", text: "" })}
                        className="w3s-icon-btn !h-5 !w-5"
                        title="Paragraph"
                      >
                        <Pilcrow className="h-2.5 w-2.5" />
                      </button>
                      <button
                        onClick={() => {
                          const n = tokens.filter((t) => t.kind === "heading").length + 1;
                          insertTokenAfter(i - 1, { kind: "heading", text: "", sectionNum: n });
                        }}
                        className="w3s-icon-btn !h-5 !w-5"
                        title="Heading"
                      >
                        <Heading className="h-2.5 w-2.5" />
                      </button>
                      <button
                        onClick={() => insertTokenAfter(i - 1, { kind: "listItem", text: "- " })}
                        className="w3s-icon-btn !h-5 !w-5"
                        title="Bullet"
                      >
                        <List className="h-2.5 w-2.5" />
                      </button>
                      <button
                        onClick={() =>
                          insertTokenAfter(i - 1, {
                            kind: "signatureBlock",
                            label: "Signature",
                            signerIdx: activeSigner,
                          })
                        }
                        className="w3s-icon-btn !h-5 !w-5"
                        title="Signature"
                      >
                        <PenTool className="h-2.5 w-2.5" />
                      </button>
                    </div>
                    <div className="bg-[var(--accent)]/30 h-px flex-1" />
                  </div>
                </div>
              ) : null;

            const tokenEl = (() => {
              switch (token.kind) {
                case "heading":
                  return (
                    <span key={`t-${i}`} data-token-idx={i}>
                      <div className="group relative pb-2 pt-6" data-section={i} draggable={!previewMode}>
                        {(token.sectionNum || 0) > 1 && (
                          <div className="absolute left-0 right-0 top-1 h-px bg-[var(--border)]" />
                        )}
                        <div className="flex items-center gap-2">
                          {!previewMode && (
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <GripVertical className="text-muted/50 h-3.5 w-3.5 cursor-grab" />
                              <button
                                onClick={() => moveSection(i, "up")}
                                className="text-muted/50 hover:text-secondary"
                              >
                                <ChevronUp className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => moveSection(i, "down")}
                                className="text-muted/50 hover:text-secondary"
                              >
                                <ChevronDown className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                          {previewMode ? (
                            <h3 className="flex-1 text-base font-bold text-primary">{token.text}</h3>
                          ) : (
                            <input
                              defaultValue={token.text}
                              onBlur={(e) => {
                                if (e.target.value !== token.text) updateTokenText(i, e.target.value);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  (e.target as HTMLInputElement).blur();
                                  insertTokenAfter(i, { kind: "text", text: "" });
                                }
                              }}
                              className="focus:border-[var(--accent)]/30 flex-1 border-b border-transparent bg-transparent text-base font-bold text-primary outline-none transition-colors"
                              placeholder="Section heading..."
                            />
                          )}
                          {!previewMode && (
                            <button
                              onClick={() => removeSection(i)}
                              className="text-red-400/40 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        {canInsert && (
                          <div
                            className="bg-[var(--accent)]/15 hover:bg-[var(--accent)]/40 absolute -bottom-1 left-0 right-0 h-1 cursor-pointer rounded transition-colors"
                            onClick={() => insertFieldAfterToken(i, addMode, "")}
                          />
                        )}
                      </div>
                    </span>
                  );
                case "subheading":
                  return (
                    <span key={`t-${i}`} data-token-idx={i}>
                      {previewMode ? (
                        <h4 className="pb-2 pt-6 text-sm font-bold uppercase tracking-widest text-secondary">
                          {token.text}
                        </h4>
                      ) : (
                        <div className="group relative pb-2 pt-6">
                          <input
                            defaultValue={token.text}
                            onBlur={(e) => {
                              if (e.target.value !== token.text) updateTokenText(i, e.target.value);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                (e.target as HTMLInputElement).blur();
                                insertTokenAfter(i, { kind: "text", text: "" });
                              }
                            }}
                            className="focus:border-[var(--accent)]/30 w-full border-b border-transparent bg-transparent text-sm font-bold uppercase tracking-widest text-secondary outline-none transition-colors"
                            placeholder="Sub-heading..."
                          />
                          <button
                            onClick={() => removeToken(i)}
                            className="absolute right-0 top-6 text-red-400/40 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </span>
                  );
                case "text":
                  return (
                    <span key={`t-${i}`} data-token-idx={i}>
                      {previewMode ? (
                        <span className="text-sm leading-relaxed text-secondary">{token.text}</span>
                      ) : (
                        <span className="group/text relative block">
                          <textarea
                            defaultValue={token.text}
                            onBlur={(e) => {
                              if (e.target.value !== token.text) updateTokenText(i, e.target.value);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                (e.target as HTMLTextAreaElement).blur();
                                insertTokenAfter(i, { kind: "text", text: "" });
                              }
                              if (e.key === "Backspace" && (e.target as HTMLTextAreaElement).value === "") {
                                e.preventDefault();
                                removeToken(i);
                              }
                            }}
                            onInput={(e) => {
                              const el = e.target as HTMLTextAreaElement;
                              el.style.height = "auto";
                              el.style.height = el.scrollHeight + "px";
                            }}
                            rows={1}
                            className="focus:border-[var(--accent)]/20 -ml-2 w-full resize-none overflow-hidden border-l-2 border-transparent bg-transparent pl-2 text-sm leading-relaxed text-secondary outline-none transition-colors [field-sizing:content]"
                            placeholder="Type paragraph text..."
                          />
                          {canInsert && (
                            <span
                              className="bg-[var(--accent)]/15 hover:bg-[var(--accent)]/40 absolute right-0 top-0 inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-[var(--accent)] opacity-0 transition-colors group-hover/text:opacity-100"
                              onClick={() => insertFieldAfterToken(i, addMode, "")}
                            >
                              <Plus className="h-2.5 w-2.5" />
                            </span>
                          )}
                          <button
                            onClick={() => removeToken(i)}
                            className="absolute -left-6 top-0.5 text-red-400/30 opacity-0 transition-opacity hover:text-red-400 group-hover/text:opacity-100"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </span>
                      )}
                    </span>
                  );
                case "listItem":
                  return (
                    <span key={`t-${i}`} data-token-idx={i}>
                      {previewMode ? (
                        <div className="flex items-start gap-2 py-0.5 pl-4 text-sm leading-relaxed text-secondary">
                          <span className="mt-0.5 shrink-0 text-muted">&#8226;</span>
                          <span>{token.text.replace(/^[-*•()\da-z]+\s*/, "")}</span>
                        </div>
                      ) : (
                        <div className="group/list relative flex items-start gap-2 py-0.5 pl-4">
                          <span className="mt-1 shrink-0 text-sm text-muted">&#8226;</span>
                          <textarea
                            defaultValue={token.text.replace(/^[-*•]\s*/, "")}
                            onBlur={(e) => {
                              const v = e.target.value;
                              if (v !== token.text) updateTokenText(i, `- ${v}`);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                (e.target as HTMLTextAreaElement).blur();
                                insertTokenAfter(i, { kind: "listItem", text: "- " });
                              }
                              if (e.key === "Backspace" && (e.target as HTMLTextAreaElement).value === "") {
                                e.preventDefault();
                                removeToken(i);
                              }
                            }}
                            onInput={(e) => {
                              const el = e.target as HTMLTextAreaElement;
                              el.style.height = "auto";
                              el.style.height = el.scrollHeight + "px";
                            }}
                            rows={1}
                            className="flex-1 resize-none overflow-hidden bg-transparent text-sm leading-relaxed text-secondary outline-none [field-sizing:content]"
                            placeholder="List item..."
                          />
                          <button
                            onClick={() => removeToken(i)}
                            className="mt-0.5 shrink-0 text-red-400/30 opacity-0 transition-opacity hover:text-red-400 group-hover/list:opacity-100"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </span>
                  );
                case "field": {
                  const cbs = getCbs(token.field.id);
                  return (
                    <span key={`t-${i}`} data-token-idx={i}>
                      <EditorField
                        field={token.field}
                        active={activeFieldId === token.field.id}
                        previewMode={previewMode}
                        previewValue={previewValues[token.field.id]}
                        previewValues={previewValues}
                        allFields={fields}
                        signerCount={signers.length}
                        signers={signers}
                        onFocus={cbs.onFocus}
                        onPreviewChange={(value) => setPreviewValue(token.field.id, value)}
                        onPreviewAddressSuggestion={(suggestion) =>
                          applyPreviewAddressSuggestion(token.field, suggestion)
                        }
                        loadAddressSuggestions={loadAddressSuggestions}
                        onUpdate={cbs.onUpdate}
                        onRemove={cbs.onRemove}
                        onDragStart={cbs.onDragStart}
                        onDragEnd={cbs.onDragEnd}
                      />
                    </span>
                  );
                }
                case "break":
                  return (
                    <span key={`t-${i}`} data-token-idx={i}>
                      <div className="h-3" />
                    </span>
                  );
                case "signatureBlock": {
                  const sid = `sig-${i}`;
                  return (
                    <span key={`t-${i}`} data-token-idx={i}>
                      <EditorSignatureBlock
                        token={token}
                        tokenId={sid}
                        active={activeFieldId === sid}
                        previewMode={previewMode}
                        signers={signers}
                        onFocus={() => setActiveFieldId(sid)}
                        onUpdate={(p) => updateSigBlock(i, p)}
                        onRemove={() => removeSigBlock(i)}
                      />
                    </span>
                  );
                }
                default:
                  return null;
              }
            })();

            return insertBetween ? (
              <>
                {insertBetween}
                {tokenEl}
              </>
            ) : (
              tokenEl
            );
          })}
          <div data-token-idx={tokens.length} className="h-8" />

          {/* ── Block insert toolbar ── */}
          {!previewMode && (
            <div className="flex items-center gap-1 border-t border-dashed border-[var(--border)] pt-4">
              <span className="mr-1 text-[10px] text-muted">Add:</span>
              <W3SButton
                variant="ghost"
                size="xs"
                onClick={() => insertTokenAfter(tokens.length - 1, { kind: "text", text: "" })}
              >
                <Pilcrow className="h-3 w-3" /> Paragraph
              </W3SButton>
              <W3SButton
                variant="ghost"
                size="xs"
                onClick={() => {
                  const num = tokens.filter((t) => t.kind === "heading").length + 1;
                  insertTokenAfter(tokens.length - 1, {
                    kind: "heading",
                    text: `${num}. NEW SECTION`,
                    sectionNum: num,
                  });
                }}
              >
                <Heading className="h-3 w-3" /> Heading
              </W3SButton>
              <W3SButton
                variant="ghost"
                size="xs"
                onClick={() => insertTokenAfter(tokens.length - 1, { kind: "subheading", text: "SUB-HEADING" })}
              >
                <TypeIcon className="h-3 w-3" /> Sub
              </W3SButton>
              <W3SButton
                variant="ghost"
                size="xs"
                onClick={() => insertTokenAfter(tokens.length - 1, { kind: "listItem", text: "- " })}
              >
                <List className="h-3 w-3" /> Bullet
              </W3SButton>
              <W3SButton
                variant="ghost"
                size="xs"
                onClick={() =>
                  insertTokenAfter(tokens.length - 1, {
                    kind: "signatureBlock",
                    label: "Signature",
                    signerIdx: activeSigner,
                  })
                }
              >
                <PenTool className="h-3 w-3" /> Signature
              </W3SButton>
              <W3SButton
                variant="ghost"
                size="xs"
                onClick={() => insertTokenAfter(tokens.length - 1, { kind: "break" })}
              >
                <CornerDownLeft className="h-3 w-3" /> Break
              </W3SButton>
            </div>
          )}
        </div>
      </div>
    ),
    [
      tokens,
      fields,
      previewMode,
      previewValues,
      activeFieldId,
      addMode,
      activeSigner,
      signers,
      isDragging,
      dropTargetIdx,
      dropIndicatorY,
      handleDocDragOver,
      handleDocDrop,
      insertFieldAfterToken,
      insertTokenAfter,
      updateTokenText,
      removeToken,
      moveSection,
      removeSection,
      updateSigBlock,
      removeSigBlock,
      getCbs,
      setPreviewValue,
      applyPreviewAddressSuggestion,
      loadAddressSuggestions,
    ],
  );

  return (
    <div className={`flex flex-col ${fullscreen ? "fixed inset-0 z-50 bg-[var(--bg-surface)]" : "h-full"}`}>
      {/* ── Top Toolbar ── */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 sm:gap-2 sm:px-4">
        <W3SIconButton onClick={onBack} title="Back">
          <ArrowLeft className="h-4 w-4" />
        </W3SIconButton>

        <div className="hidden h-5 w-px bg-[var(--border)] sm:block" />

        <W3SIconButton
          onClick={() => setShowPanel(!showPanel)}
          active={showPanel}
          className="hidden sm:inline-flex"
          title="Fields panel"
        >
          {showPanel ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </W3SIconButton>

        <W3SIconButton onClick={() => setMobilePanel(!mobilePanel)} className="sm:hidden" title="Fields">
          <Menu className="h-4 w-4" />
        </W3SIconButton>

        <W3SButton variant="ghost" size="xs" onClick={() => setShowAddSection(true)}>
          <Plus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Section</span>
        </W3SButton>

        <div className="min-w-0 flex-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled Document"
            className="w-full max-w-xs truncate bg-transparent text-sm font-semibold outline-none placeholder:text-muted"
          />
        </div>

        <span className="hidden text-[10px] text-muted sm:inline">{fields.length} fields</span>

        <W3SButton
          variant={showSigners ? "accent-outline" : "ghost"}
          size="xs"
          onClick={() => setShowSigners(!showSigners)}
        >
          <Users className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Signers</span>
          <span className="rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10px]">{signers.length}</span>
        </W3SButton>

        <div className="h-5 w-px bg-[var(--border)]" />

        {/* Undo/Redo */}
        <W3SIconButton onClick={handleUndo} disabled={!canUndo} title="Undo (⌘Z)">
          <Undo2 className="h-3.5 w-3.5" />
        </W3SIconButton>
        <W3SIconButton onClick={handleRedo} disabled={!canRedo} title="Redo (⌘⇧Z)">
          <Redo2 className="h-3.5 w-3.5" />
        </W3SIconButton>

        <div className="h-5 w-px bg-[var(--border)]" />

        <W3SButton variant={previewMode ? "primary" : "ghost"} size="xs" onClick={() => setPreviewMode(!previewMode)}>
          {previewMode ? (
            <>
              <EyeOff className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Edit</span>
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Preview</span>
            </>
          )}
        </W3SButton>

        <W3SIconButton
          onClick={() => setFullscreen((f) => !f)}
          className="hidden sm:inline-flex"
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </W3SIconButton>

        {onSaveTemplate && (
          <W3SIconButton
            onClick={() => onSaveTemplate(buildResult())}
            className="hidden sm:inline-flex"
            title="Save template"
          >
            <Save className="h-3.5 w-3.5" />
          </W3SIconButton>
        )}

        <W3SButton variant="primary" size="xs" onClick={() => onSubmit(buildResult())} disabled={!title.trim()}>
          <Send className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Send</span>
        </W3SButton>
      </div>

      {/* ── Signers drawer ── */}
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
                <W3SButton variant="secondary" size="xs" onClick={addSigner}>
                  <Plus className="h-3 w-3" /> Add
                </W3SButton>
              </div>
              <div className="space-y-1.5">
                {signers.map((s, idx) => {
                  const sc = SIGNER_COLORS[idx % SIGNER_COLORS.length]!;
                  const fc = fields.filter((f) => f.signerIdx === idx).length;
                  const sp = expandedSignerPhone === idx;
                  return (
                    <div
                      key={idx}
                      className="overflow-hidden rounded-lg bg-[var(--bg-surface)]"
                      style={{ borderLeft: `3px solid ${SIGNER_BORDER_COLORS[idx % SIGNER_BORDER_COLORS.length]}` }}
                    >
                      <div className="flex items-center gap-2 px-3 py-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${sc.dot} shrink-0`} />
                        <input
                          value={s.label}
                          onChange={(e) => handleSignerChange(idx, "label", e.target.value)}
                          placeholder={`Party ${String.fromCharCode(65 + idx)}`}
                          className="min-w-0 flex-1 border-b border-transparent bg-transparent px-1.5 py-0.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
                        />
                        <input
                          value={s.email}
                          onChange={(e) => handleSignerChange(idx, "email", e.target.value)}
                          placeholder="email@example.com"
                          className="min-w-0 flex-1 border-b border-transparent bg-transparent px-1.5 py-0.5 text-sm text-muted outline-none transition-colors focus:border-[var(--accent)]"
                        />
                        <span className="shrink-0 text-[10px] tabular-nums text-muted">
                          {fc} field{fc !== 1 ? "s" : ""}
                        </span>
                        <button
                          onClick={() => setExpandedSignerPhone(sp ? null : idx)}
                          className="shrink-0 text-muted hover:text-secondary"
                        >
                          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${sp ? "rotate-90" : ""}`} />
                        </button>
                        {signers.length > 2 && (
                          <button
                            onClick={() => setSigners((p) => p.filter((_, i) => i !== idx))}
                            className="shrink-0 text-red-400/50 hover:text-red-400"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {sp && (
                        <div className="space-y-2 px-3 pb-3 pl-8">
                          <div className="flex gap-2">
                            <input
                              value={s.phone ?? ""}
                              onChange={(e) => handleSignerChange(idx, "phone", e.target.value)}
                              placeholder="Phone (optional)"
                              className="max-w-xs flex-1 rounded-lg bg-[var(--bg-hover)] px-2.5 py-1.5 text-sm text-muted outline-none"
                            />
                            <Select
                              value={s.role ?? "SIGNER"}
                              onChange={(v) => handleSignerChange(idx, "role", v as SignerDef["role"])}
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
                              value={s.signMethod ?? "WALLET"}
                              onChange={(v) => handleSignerChange(idx, "signMethod", v as SignerDef["signMethod"])}
                              size="sm"
                              variant="glass"
                              options={[
                                { value: "WALLET", label: "Wallet" },
                                { value: "EMAIL_OTP", label: "Email OTP" },
                              ]}
                            />
                          </div>
                          <TokenGateEditor
                            value={s.tokenGates ?? null}
                            onChange={(nextValue) => handleSignerChange(idx, "tokenGates", nextValue)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Main content area ── */}
      <div className="flex min-h-0 flex-1">
        {/* Desktop sidebar */}
        <AnimatePresence>
          {showPanel && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 260, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="hidden shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--bg-card)] sm:flex"
            >
              <FieldPicker
                onSelect={(id) => setAddMode(id as InlineField["type"])}
                activeType={addMode}
                onClearActive={() => setAddMode(null)}
                onDragNewField={(id) => {
                  setDragNewType(id as InlineField["type"]);
                  setAddMode(null);
                }}
                onDragEnd={() => {
                  setDragNewType(null);
                  setDropTargetIdx(null);
                }}
                activeSigner={activeSigner}
                signerCount={signers.length}
                signerLabels={signers.map((s) => s.label)}
                onSignerChange={setActiveSigner}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Document area */}
        <div className="flex-1 overflow-y-auto bg-[var(--bg-surface)]">
          <div className={`mx-auto px-4 py-4 sm:px-8 sm:py-6 ${fullscreen ? "max-w-6xl" : "max-w-5xl"}`}>
            {documentPaper}
          </div>
        </div>
      </div>

      {/* ── Mobile bottom sheet for fields ── */}
      <AnimatePresence>
        {mobilePanel && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40 sm:hidden"
              onClick={() => setMobilePanel(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl border-t border-[var(--border)] bg-[var(--bg-card)] shadow-2xl sm:hidden"
              style={{ maxHeight: "70vh" }}
            >
              <div className="flex items-center justify-center py-2">
                <div className="h-1 w-10 rounded-full bg-[var(--border)]" />
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: "calc(70vh - 40px)" }}>
                <FieldPicker
                  onSelect={(id) => {
                    setAddMode(id as InlineField["type"]);
                    setMobilePanel(false);
                  }}
                  activeType={addMode}
                  onClearActive={() => setAddMode(null)}
                  onDragNewField={(id) => {
                    setDragNewType(id as InlineField["type"]);
                    setAddMode(null);
                    setMobilePanel(false);
                  }}
                  onDragEnd={() => {
                    setDragNewType(null);
                    setDropTargetIdx(null);
                  }}
                  activeSigner={activeSigner}
                  signerCount={signers.length}
                  signerLabels={signers.map((s) => s.label)}
                  onSignerChange={setActiveSigner}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Add Section Modal */}
      <AnimatePresence>
        {showAddSection && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowAddSection(false);
            }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl"
            >
              <h3 className="text-lg font-semibold">Add Section</h3>
              <input
                value={newSectionTitle}
                onChange={(e) => setNewSectionTitle(e.target.value)}
                placeholder="Section title"
                className="w-full rounded-lg bg-[var(--bg-surface)] px-4 py-2.5 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
              />
              <textarea
                value={newSectionContent}
                onChange={(e) => setNewSectionContent(e.target.value)}
                placeholder="Content (optional)"
                rows={4}
                className="w-full resize-none rounded-lg bg-[var(--bg-surface)] px-4 py-2.5 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
              />
              <div className="flex gap-2">
                <W3SButton
                  variant="primary"
                  size="md"
                  onClick={addSection}
                  disabled={!newSectionTitle.trim()}
                  className="flex-1"
                >
                  Add
                </W3SButton>
                <W3SButton variant="secondary" size="md" onClick={() => setShowAddSection(false)}>
                  Cancel
                </W3SButton>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drag ghost */}
      {isDragging && ghostPos.x > 0 && (
        <div
          className="pointer-events-none fixed z-[999]"
          style={{ left: `${ghostPos.x + 16}px`, top: `${ghostPos.y - 16}px` }}
        >
          <div className="border-[var(--accent)]/40 bg-[var(--accent)]/10 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium text-[var(--accent)] backdrop-blur-sm">
            {dragGhostLabel}
          </div>
        </div>
      )}

      {/* Mobile: floating add-field indicator */}
      {addMode && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2 sm:hidden">
          <div className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-xs font-medium text-white shadow-lg">
            <FileText className="h-3.5 w-3.5" />
            <span>Tap in document to place field</span>
            <button onClick={() => setAddMode(null)} className="ml-1 rounded-full p-0.5 hover:bg-surface-elevated">
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
