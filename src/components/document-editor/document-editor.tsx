/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-empty-function -- premium router stubs expose `any` types */
"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
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
import { useEditorKeyboard } from "./use-editor-keyboard";
import { useEditorStore } from "~/stores/editor";
import { TokenGateEditor } from "../settings/token-gate-editor";
import { useConnectedIdentity } from "~/components/hooks/use-connected-identity";
// Premium collab components — loaded dynamically to keep OSS bundle clean
// CollabSessionPanel removed — sessions auto-start when documentId is present
const CollabToolbar = dynamic(
  () => import("../../../premium/components/collab/collab-toolbar").then((m) => m.CollabToolbar),
  { ssr: false, loading: () => null },
);
const CollabAnnotationSidebar = dynamic(
  () => import("../../../premium/components/collab/collab-annotations").then((m) => m.CollabAnnotationSidebar),
  { ssr: false, loading: () => null },
);
const CollabAiPanel = dynamic(
  () => import("../../../premium/components/collab/collab-ai-panel").then((m) => m.CollabAiPanel),
  { ssr: false, loading: () => null },
);
const CollabSharePopover = dynamic(
  () => import("../../../premium/components/collab/collab-share-popover").then((m) => m.CollabSharePopover),
  { ssr: false, loading: () => null },
);

export type { EditorResult, SignerDef } from "./document-editor-types";

type Props = {
  initialTitle: string;
  initialContent: string;
  initialSigners: SignerDef[];
  onSubmit: (result: EditorResult) => void;
  onSaveTemplate?: (result: EditorResult) => void | Promise<void>;
  onBack: () => void;
  /** Pass to enable collab features (start/join from editor) */
  documentId?: string;
};

// ── Main Editor ──

export function DocumentEditor({
  initialTitle,
  initialContent,
  initialSigners,
  onSubmit,
  onSaveTemplate,
  onBack,
  documentId,
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
  // UI state from Zustand store (shared, no useEffect sync needed)
  const addMode = useEditorStore((s) => s.addMode);
  const setAddMode = useEditorStore((s) => s.setAddMode);
  const activeFieldId = useEditorStore((s) => s.activeFieldId);
  const setActiveFieldId = useEditorStore((s) => s.setActiveFieldId);
  const previewMode = useEditorStore((s) => s.previewMode);
  const setPreviewMode = useEditorStore((s) => s.setPreviewMode);
  const activeSigner = useEditorStore((s) => s.activeSigner);
  const setActiveSigner = useEditorStore((s) => s.setActiveSigner);
  const showPanel = useEditorStore((s) => s.showPanel);
  const togglePanel = useEditorStore((s) => s.togglePanel);
  const showSigners = useEditorStore((s) => s.showSigners);
  const setShowSigners = useEditorStore((s) => s.setShowSigners);
  const mobilePanel = useEditorStore((s) => s.mobilePanel);
  const setMobilePanel = useEditorStore((s) => s.setMobilePanel);
  const fullscreen = useEditorStore((s) => s.fullscreen);
  const setFullscreen = useEditorStore((s) => s.setFullscreen);

  // Local-only UI state (transient, not shared)
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [newSectionContent, setNewSectionContent] = useState("");
  const [expandedSignerPhone, setExpandedSignerPhone] = useState<number | null>(null);
  const fieldCounter = useRef(fields.length);

  // ── Collaboration (auto-start) ──
  const identity = useConnectedIdentity();
  const collabCapabilities = trpc.collab.capabilities.useQuery();
  const collabAvailable = collabCapabilities.data?.available ?? false;
  const [showAnnotations, setShowAnnotations] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const displayName = identity.session?.user?.name ?? identity.wallet?.address?.slice(0, 8) ?? "Anonymous";

  // Auto-create/join a collab session when documentId is present and collab is available
  const autoCollab = trpc.collab.getOrCreateForDocument.useMutation();
  const [collabSessionId, setCollabSessionId] = useState<string | null>(null);
  const autoCollabInitiated = useRef(false);

  useEffect(() => {
    if (!collabAvailable || !documentId || !displayName || autoCollabInitiated.current) return;
    autoCollabInitiated.current = true;
    autoCollab
      .mutateAsync({ documentId, documentTitle: title, displayName })
      .then((res) => setCollabSessionId(res.sessionId))
      .catch(() => {
        autoCollabInitiated.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collabAvailable, documentId, displayName]);

  const collabSessionQuery = trpc.collab.get.useQuery({ sessionId: collabSessionId! }, { enabled: !!collabSessionId });
  const collabSession = collabSessionQuery.data;

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
  type DropTarget = {
    tokenIdx: number;
    charOffset: number; // -1 = between tokens, >= 0 = within text at char position
    x: number;
    y: number;
    h: number;
    vertical: boolean; // true = vertical cursor (inline), false = horizontal line (block)
  };
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
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

  /** Find the nearest inline position (character offset within text, or between tokens). */
  const handleDocDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = dragFieldId ? "move" : "copy";
      const container = docContainerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();

      // Try inline caret placement first (within text/field tokens in a paragraph)
      const caretRange = "caretRangeFromPoint" in document ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;

      if (caretRange) {
        const node = caretRange.startContainer;
        const offset = caretRange.startOffset;
        // Walk up to find nearest [data-token-idx] ancestor
        let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
        while (el && el !== container && !el.hasAttribute("data-token-idx")) el = el.parentElement;
        if (el?.hasAttribute("data-token-idx")) {
          const tokenIdx = parseInt(el.getAttribute("data-token-idx") ?? "0");
          // Calculate caret pixel position using a range rect
          const rangeRect = caretRange.getBoundingClientRect();
          if (rangeRect.height > 0) {
            const dt: DropTarget = {
              tokenIdx,
              charOffset: offset,
              x: rangeRect.left - containerRect.left,
              y: rangeRect.top - containerRect.top,
              h: rangeRect.height,
              vertical: true,
            };
            dropTargetRef.current = dt;
            setDropTarget(dt);
            return;
          }
        }
      }

      // Fallback: between-token horizontal line (for headings, breaks, sig blocks, etc.)
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
      const dt: DropTarget = {
        tokenIdx: closestIdx,
        charOffset: -1,
        x: 0,
        y: indicatorY,
        h: 0,
        vertical: false,
      };
      dropTargetRef.current = dt;
      setDropTarget(dt);
    },
    [dragFieldId],
  );

  const makeNewField = useCallback(
    (type: InlineField["type"], label: string) => {
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
      return nf;
    },
    [activeSigner],
  );

  const insertFieldAfterToken = useCallback(
    (afterIdx: number, type: InlineField["type"], label: string) => {
      const nf = makeNewField(type, label);
      setTokens((prev) => {
        const c = [...prev];
        c.splice(afterIdx + 1, 0, { kind: "field", field: nf });
        return c;
      });
      setFields((prev) => [...prev, nf]);
      setAddMode(null);
      setActiveFieldId(nf.id);
    },
    [makeNewField],
  );

  /** Insert a field inline within a text token, splitting the text at charOffset. */
  const insertFieldInlineAt = useCallback(
    (tokenIdx: number, charOffset: number, type: InlineField["type"], label: string) => {
      const nf = makeNewField(type, label);
      setTokens((prev) => {
        const token = prev[tokenIdx];
        if (!token) return prev;
        // For text-like tokens, split into [before, field, after]
        if (token.kind === "text" || token.kind === "listItem") {
          const fullText = token.text;
          const before = fullText.slice(0, charOffset);
          const after = fullText.slice(charOffset);
          const newTokens: DocToken[] = [];
          if (before) newTokens.push({ ...token, text: before });
          newTokens.push({ kind: "field", field: nf });
          if (after) newTokens.push({ ...token, text: after });
          const c = [...prev];
          c.splice(tokenIdx, 1, ...newTokens);
          return c;
        }
        // Fallback: insert after
        const c = [...prev];
        c.splice(tokenIdx + 1, 0, { kind: "field", field: nf });
        return c;
      });
      setFields((prev) => [...prev, nf]);
      setAddMode(null);
      setActiveFieldId(nf.id);
    },
    [makeNewField],
  );

  /** Move a field to an inline position within a text token at charOffset. */
  const moveFieldInlineAt = useCallback((fid: string, tokenIdx: number, charOffset: number) => {
    setTokens((prev) => {
      // First remove the field from its old position
      const fi = prev.findIndex((t) => t.kind === "field" && t.field.id === fid);
      if (fi === -1) return prev;
      const c = [...prev];
      const [fieldToken] = c.splice(fi, 1);
      if (!fieldToken) return prev;
      // Adjust target idx if it was after the removed element
      const adjIdx = tokenIdx > fi ? tokenIdx - 1 : tokenIdx;
      const target = c[adjIdx];
      if (!target) {
        c.push(fieldToken);
        return c;
      }
      if (target.kind === "text" || target.kind === "listItem") {
        const before = target.text.slice(0, charOffset);
        const after = target.text.slice(charOffset);
        const newTokens: DocToken[] = [];
        if (before) newTokens.push({ ...target, text: before });
        newTokens.push(fieldToken);
        if (after) newTokens.push({ ...target, text: after });
        c.splice(adjIdx, 1, ...newTokens);
      } else {
        c.splice(adjIdx + 1, 0, fieldToken);
      }
      return c;
    });
  }, []);

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

  const handleDocDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const dt = dropTargetRef.current;
      if (!dt) return;

      if (dt.charOffset >= 0) {
        // Inline drop within a text token
        if (dragFieldId) moveFieldInlineAt(dragFieldId, dt.tokenIdx, dt.charOffset);
        else if (dragNewType) insertFieldInlineAt(dt.tokenIdx, dt.charOffset, dragNewType, "");
      } else {
        // Block-level drop between tokens
        if (dragFieldId) moveFieldToIdx(dragFieldId, dt.tokenIdx + 1);
        else if (dragNewType) insertFieldAfterToken(dt.tokenIdx, dragNewType, "");
      }
      setDragFieldId(null);
      setDragNewType(null);
      dropTargetRef.current = null;
      setDropTarget(null);
    },
    [dragFieldId, dragNewType, moveFieldToIdx, insertFieldAfterToken, moveFieldInlineAt, insertFieldInlineAt],
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

  // Derived preview values: filters out deleted fields and hidden-by-logic fields.
  // Replaces two useEffects that reacted to [fields] changes.
  const effectivePreviewValues = useMemo(() => {
    const fieldIds = new Set(fields.map((f) => f.id));
    const filtered: PreviewValueMap = {};
    for (const [id, val] of Object.entries(previewValues)) {
      if (!fieldIds.has(id)) continue;
      filtered[id] = val;
    }
    // Clear values for fields hidden by conditional logic
    for (const field of fields) {
      const logicState = getFieldLogicState(field, filtered);
      if (!logicState.visible && logicState.clearWhenHidden) {
        delete filtered[field.id];
      }
    }
    return filtered;
  }, [fields, previewValues]);

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
            setDropTarget(null);
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

  const handleEscape = useCallback(() => {
    setAddMode(null);
    setActiveFieldId(null);
  }, []);

  useEditorKeyboard({
    fullscreen,
    setFullscreen,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onEscape: handleEscape,
  });

  // ── Memoized document body ──
  // This is the expensive part (renders every token). We memoize it so UI-only
  // state changes (fullscreen, showPanel, showSigners, title, mobilePanel, etc.)
  // skip re-rendering the entire document.
  const documentPaper = useMemo(
    () => (
      <div
        ref={docContainerRef}
        className="relative rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm"
        onDragOver={isDragging ? handleDocDragOver : undefined}
        onDragLeave={isDragging ? () => setDropTarget(null) : undefined}
        onDrop={isDragging ? handleDocDrop : undefined}
      >
        {isDragging &&
          dropTarget !== null &&
          (dropTarget.vertical ? (
            <div
              className="pointer-events-none absolute z-40 w-0.5 rounded-full bg-[var(--accent)]"
              style={{
                left: `${dropTarget.x}px`,
                top: `${dropTarget.y}px`,
                height: `${dropTarget.h}px`,
                transition: "left 0.06s ease, top 0.06s ease",
              }}
            />
          ) : (
            <div
              className="pointer-events-none absolute left-6 right-6 z-40 h-0.5 rounded-full bg-[var(--accent)]"
              style={{ top: `${dropTarget.y}px`, transition: "top 0.08s ease" }}
            />
          ))}
        <div
          className="space-y-1 px-6 py-8 sm:px-12 sm:py-12"
          style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
        >
          {(() => {
            const isInline = (k: string) => k === "text" || k === "field";
            const canInsert = (addMode || showPanel) && !previewMode && !isDragging;
            const elements: React.ReactNode[] = [];
            let i = 0;

            const renderInlineText = (token: DocToken & { kind: "text" }, idx: number) => {
              // When addMode is active, show word-level insertion targets
              if (canInsert && token.text.length > 0) {
                // Split on word boundaries, keeping whitespace attached
                const parts = token.text.match(/\S+\s*/g) || [token.text];
                let charPos = 0;
                return (
                  <span key={`t-${idx}`} data-token-idx={idx} className="text-sm leading-relaxed text-secondary">
                    {/* + at the very start of text */}
                    <span
                      className="mx-px inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-[var(--accent-10)] align-middle text-[var(--accent)] transition-colors hover:bg-[var(--accent-30)]"
                      onClick={() => insertFieldInlineAt(idx, 0, addMode || "free-text", "")}
                      title="Insert field here"
                    >
                      <Plus className="h-2 w-2" />
                    </span>
                    {parts.map((word, wi) => {
                      const endPos = charPos + word.length;
                      const cp = endPos; // capture for closure
                      charPos = endPos;
                      return (
                        <span key={wi}>
                          {word}
                          <span
                            className="mx-px inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-[var(--accent-10)] align-middle text-[var(--accent)] transition-colors hover:bg-[var(--accent-30)]"
                            onClick={() => insertFieldInlineAt(idx, cp, addMode || "free-text", "")}
                            title="Insert field here"
                          >
                            <Plus className="h-2 w-2" />
                          </span>
                        </span>
                      );
                    })}
                  </span>
                );
              }

              return (
                <span
                  key={`t-${idx}`}
                  data-token-idx={idx}
                  contentEditable={!previewMode}
                  suppressContentEditableWarning
                  onBlur={(e) => {
                    const newText = e.currentTarget.textContent || "";
                    if (newText !== token.text) updateTokenText(idx, newText);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      (e.currentTarget as HTMLElement).blur();
                      insertTokenAfter(idx, { kind: "text", text: "" });
                    }
                    if (e.key === "Backspace" && (e.currentTarget.textContent || "") === "") {
                      e.preventDefault();
                      removeToken(idx);
                    }
                  }}
                  className={`text-sm leading-relaxed text-secondary outline-none ${!previewMode ? "rounded-sm hover:bg-[var(--bg-hover-30)] focus:bg-[var(--bg-hover-30)]" : ""}`}
                >
                  {token.text}
                </span>
              );
            };

            const renderInlineField = (token: DocToken & { kind: "field" }, idx: number) => {
              const cbs = getCbs(token.field.id);
              return (
                <span key={`t-${idx}`} data-token-idx={idx} className="inline">
                  <EditorField
                    field={token.field}
                    active={activeFieldId === token.field.id}
                    previewMode={previewMode}
                    previewValue={effectivePreviewValues[token.field.id]}
                    previewValues={effectivePreviewValues}
                    allFields={fields}
                    signerCount={signers.length}
                    signers={signers}
                    onFocus={cbs.onFocus}
                    onPreviewChange={(value) => setPreviewValue(token.field.id, value)}
                    onPreviewAddressSuggestion={(suggestion) => applyPreviewAddressSuggestion(token.field, suggestion)}
                    loadAddressSuggestions={loadAddressSuggestions}
                    onUpdate={cbs.onUpdate}
                    onRemove={cbs.onRemove}
                    onDragStart={cbs.onDragStart}
                    onDragEnd={cbs.onDragEnd}
                  />
                </span>
              );
            };

            while (i < tokens.length) {
              const token = tokens[i]!;

              // Group consecutive text + field tokens into an inline-flowing paragraph
              if (isInline(token.kind)) {
                const groupStart = i;
                const inlineChildren: React.ReactNode[] = [];
                while (i < tokens.length && isInline(tokens[i]!.kind)) {
                  const t = tokens[i]!;
                  if (t.kind === "text") inlineChildren.push(renderInlineText(t, i));
                  else if (t.kind === "field")
                    inlineChildren.push(renderInlineField(t as DocToken & { kind: "field" }, i));
                  i++;
                }
                elements.push(
                  <div
                    key={`para-${groupStart}`}
                    className="group/para relative leading-relaxed"
                    style={{ wordBreak: "break-word" }}
                  >
                    {inlineChildren}
                  </div>,
                );
                continue;
              }

              // Block-level tokens rendered individually
              // Capture loop index in block-scoped const so closures get the correct value
              const ti = i;

              if (token.kind === "heading") {
                elements.push(
                  <span key={`t-${ti}`} data-token-idx={ti}>
                    <div className="group relative pb-2 pt-6" data-section={ti} draggable={!previewMode}>
                      {(token.sectionNum || 0) > 1 && (
                        <div className="absolute left-0 right-0 top-1 h-px bg-[var(--border)]" />
                      )}
                      <div className="flex items-center gap-2">
                        {!previewMode && (
                          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <GripVertical className="text-muted/50 h-3.5 w-3.5 cursor-grab" />
                            <button
                              onClick={() => moveSection(ti, "up")}
                              className="text-muted/50 hover:text-secondary"
                            >
                              <ChevronUp className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => moveSection(ti, "down")}
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
                              if (e.target.value !== token.text) updateTokenText(ti, e.target.value);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                (e.target as HTMLInputElement).blur();
                                insertTokenAfter(ti, { kind: "text", text: "" });
                              }
                            }}
                            className="flex-1 border-b border-transparent bg-transparent text-base font-bold text-primary outline-none transition-colors focus:border-[var(--accent-30)]"
                            placeholder="Section heading..."
                          />
                        )}
                        {!previewMode && (
                          <button
                            onClick={() => removeSection(ti)}
                            className="text-red-400/40 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      {canInsert && (
                        <div
                          className="absolute -bottom-1 left-0 right-0 flex h-5 cursor-pointer items-center justify-center rounded bg-[var(--accent-25)] transition-colors hover:bg-[var(--accent-50)]"
                          onClick={() => insertFieldAfterToken(ti, addMode || "free-text", "")}
                        >
                          <Plus className="h-3 w-3 text-[var(--accent)]" />
                        </div>
                      )}
                    </div>
                  </span>,
                );
              } else if (token.kind === "subheading") {
                elements.push(
                  <span key={`t-${ti}`} data-token-idx={ti}>
                    {previewMode ? (
                      <h4 className="pb-2 pt-6 text-sm font-bold uppercase tracking-widest text-secondary">
                        {token.text}
                      </h4>
                    ) : (
                      <div className="group relative pb-2 pt-6">
                        <input
                          defaultValue={token.text}
                          onBlur={(e) => {
                            if (e.target.value !== token.text) updateTokenText(ti, e.target.value);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              (e.target as HTMLInputElement).blur();
                              insertTokenAfter(ti, { kind: "text", text: "" });
                            }
                          }}
                          className="w-full border-b border-transparent bg-transparent text-sm font-bold uppercase tracking-widest text-secondary outline-none transition-colors focus:border-[var(--accent-30)]"
                          placeholder="Sub-heading..."
                        />
                        <button
                          onClick={() => removeToken(ti)}
                          className="absolute right-0 top-6 text-red-400/40 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </span>,
                );
              } else if (token.kind === "listItem") {
                elements.push(
                  <span key={`t-${ti}`} data-token-idx={ti}>
                    {previewMode ? (
                      <div className="flex items-start gap-2 py-0.5 pl-4 text-sm leading-relaxed text-secondary">
                        <span className="mt-0.5 shrink-0 text-muted">&#8226;</span>
                        <span>{token.text.replace(/^[-*•()\da-z]+\s*/, "")}</span>
                      </div>
                    ) : (
                      <div className="group/list relative flex items-start gap-2 py-0.5 pl-4">
                        <span className="mt-1 shrink-0 text-sm text-muted">&#8226;</span>
                        <span
                          contentEditable
                          suppressContentEditableWarning
                          data-token-idx={ti}
                          onBlur={(e) => {
                            const v = e.currentTarget.textContent || "";
                            if (v !== token.text) updateTokenText(ti, `- ${v}`);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              (e.currentTarget as HTMLElement).blur();
                              insertTokenAfter(ti, { kind: "listItem", text: "- " });
                            }
                            if (e.key === "Backspace" && (e.currentTarget.textContent || "") === "") {
                              e.preventDefault();
                              removeToken(ti);
                            }
                          }}
                          className="flex-1 text-sm leading-relaxed text-secondary outline-none"
                        >
                          {token.text.replace(/^[-*•]\s*/, "")}
                        </span>
                        <button
                          onClick={() => removeToken(ti)}
                          className="mt-0.5 shrink-0 text-red-400/30 opacity-0 transition-opacity hover:text-red-400 group-hover/list:opacity-100"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </span>,
                );
              } else if (token.kind === "break") {
                elements.push(
                  <span key={`t-${ti}`} data-token-idx={ti}>
                    <div className="h-3" />
                  </span>,
                );
              } else if (token.kind === "signatureBlock") {
                const sid = `sig-${ti}`;
                elements.push(
                  <span key={`t-${ti}`} data-token-idx={ti}>
                    <EditorSignatureBlock
                      token={token}
                      tokenId={sid}
                      active={activeFieldId === sid}
                      previewMode={previewMode}
                      signers={signers}
                      onFocus={() => setActiveFieldId(sid)}
                      onUpdate={(p) => updateSigBlock(ti, p)}
                      onRemove={() => removeSigBlock(ti)}
                    />
                  </span>,
                );
              }
              i++;
            }
            return elements;
          })()}
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
      effectivePreviewValues,
      activeFieldId,
      addMode,
      showPanel,
      activeSigner,
      signers,
      isDragging,
      dropTarget,
      handleDocDragOver,
      handleDocDrop,
      insertFieldAfterToken,
      insertFieldInlineAt,
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

        <W3SIconButton onClick={togglePanel} active={showPanel} className="hidden sm:inline-flex" title="Fields panel">
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
          onClick={() => setFullscreen(!fullscreen)}
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

        {collabSessionId && collabSession && (
          <CollabSharePopover sessionId={collabSessionId} joinToken={collabSession.session?.joinToken ?? ""} />
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
                  setDropTarget(null);
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
                    setDropTarget(null);
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
              className="w-full max-w-md space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl"
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
          <div className="whitespace-nowrap rounded-lg border border-[var(--accent-40)] bg-[var(--accent-10)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] backdrop-blur-sm">
            {dragGhostLabel}
          </div>
        </div>
      )}

      {/* Floating add-field indicator (mobile + desktop) */}
      {addMode && (
        <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
          <div className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2.5 text-xs font-medium text-white shadow-lg">
            <Plus className="h-3.5 w-3.5" />
            <span>
              Tap a <span className="font-bold">+</span> in the text to place field
            </span>
            <button
              onClick={() => setAddMode(null)}
              className="ml-1 rounded-full bg-white/20 p-1 transition-colors hover:bg-white/30"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* ── Collaboration overlays ── */}
      {collabSessionId && collabSession && (
        <>
          <CollabToolbar
            sessionId={collabSessionId}
            sessionTitle={collabSession.session?.title ?? title}
            joinToken={collabSession.session?.joinToken ?? ""}
            isHost={collabSession.myRole === "host"}
            connected={true}
            participants={(collabSession.participants ?? []).map((p: Record<string, unknown>) => ({
              userId: p.userId as string,
              displayName: p.displayName as string,
              color: p.color as string,
              role: p.role as string,
              isActive: Boolean(p.isActive),
            }))}
            remoteUsers={[]}
            onClose={() => setCollabSessionId(null)}
            hasDocument={!!documentId}
          />

          <CollabAnnotationSidebar
            sessionId={collabSessionId}
            isOpen={showAnnotations}
            onClose={() => setShowAnnotations(false)}
            onNavigate={() => {}}
            currentUserId={identity.currentWallet?.address ?? identity.session?.user?.id ?? ""}
            isHost={collabSession.myRole === "host"}
          />

          <CollabAiPanel
            isOpen={showAiPanel}
            onClose={() => setShowAiPanel(false)}
            sessionId={collabSessionId}
            displayName={displayName}
          />
        </>
      )}

      {/* CollabSessionPanel removed — sessions auto-start when documentId is present */}
    </div>
  );
}
