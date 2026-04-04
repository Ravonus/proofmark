/**
 * Document editor store — global state for the document editing experience.
 *
 * Replaces 27 useState + 5 useEffect in document-editor.tsx.
 * Handles: tokens, fields, signers, undo/redo, preview mode, panels.
 */

import { create } from "zustand";
import type { DocToken, InlineField } from "~/lib/document/document-tokens";
import type { SignerDef } from "~/lib/schemas/signer";

// Re-export so consumers can import from ~/stores
export type { SignerDef };

// ── Undo/Redo stack (pure data, no React) ────────────────────────────────────

type Snapshot = {
  tokens: DocToken[];
  fields: InlineField[];
};

const MAX_HISTORY = 50;

type HistoryState = {
  past: Snapshot[];
  future: Snapshot[];
};

// ── Store ────────────────────────────────────────────────────────────────────

type EditorState = {
  // Document content
  title: string;
  tokens: DocToken[];
  fields: InlineField[];
  signers: SignerDef[];

  // Preview
  previewMode: boolean;
  previewValues: Record<string, string>;

  // UI panels
  showPanel: boolean;
  showSigners: boolean;
  showAiPanel: boolean;
  fullscreen: boolean;
  addMode: string | null;
  activeFieldId: string | null;
  activeSigner: number;
  mobilePanel: string | null;

  // Undo/redo
  history: HistoryState;
  canUndo: boolean;
  canRedo: boolean;
};

type EditorActions = {
  // Content
  setTitle: (title: string) => void;
  setTokens: (tokens: DocToken[]) => void;
  setFields: (fields: InlineField[]) => void;
  setSigners: (signers: SignerDef[]) => void;
  updateSigner: (index: number, patch: Partial<SignerDef>) => void;
  addSigner: () => void;
  removeSigner: (index: number) => void;

  // Field operations
  setActiveFieldId: (id: string | null) => void;
  setPreviewValue: (fieldId: string, value: string) => void;
  clearPreviewValues: () => void;

  // UI
  setPreviewMode: (on: boolean) => void;
  togglePanel: () => void;
  setShowSigners: (show: boolean) => void;
  setShowAiPanel: (show: boolean) => void;
  setFullscreen: (on: boolean) => void;
  setAddMode: (mode: string | null) => void;
  setActiveSigner: (index: number) => void;
  setMobilePanel: (panel: string | null) => void;

  // Undo/redo
  pushSnapshot: () => void;
  undo: () => void;
  redo: () => void;

  // Bulk reset
  reset: () => void;
};

const DEFAULT_SIGNER: SignerDef = {
  label: "Signer 1",
  address: "",
  chain: "ETH",
  email: "",
  phone: "",
  role: "signer",
  signMethod: "WALLET",
  deliveryMethod: "link",
};

const INITIAL: EditorState = {
  title: "",
  tokens: [],
  fields: [],
  signers: [{ ...DEFAULT_SIGNER }],
  previewMode: false,
  previewValues: {},
  showPanel: true,
  showSigners: false,
  showAiPanel: false,
  fullscreen: false,
  addMode: null,
  activeFieldId: null,
  activeSigner: 0,
  mobilePanel: null,
  history: { past: [], future: [] },
  canUndo: false,
  canRedo: false,
};

export const useEditorStore = create<EditorState & EditorActions>()((set) => ({
  ...INITIAL,

  // ── Content ────────────────────────────────────────────────────────────────

  setTitle: (title) => set({ title }),

  setTokens: (tokens) => set({ tokens }),

  setFields: (fields) => set({ fields }),

  setSigners: (signers) => set({ signers }),

  updateSigner: (index, patch) =>
    set((s) => ({
      signers: s.signers.map((sg, i) => (i === index ? { ...sg, ...patch } : sg)),
    })),

  addSigner: () =>
    set((s) => ({
      signers: [
        ...s.signers,
        {
          ...DEFAULT_SIGNER,
          label: `Signer ${s.signers.length + 1}`,
        },
      ],
    })),

  removeSigner: (index) =>
    set((s) => ({
      signers: s.signers.filter((_, i) => i !== index),
      activeSigner: Math.min(s.activeSigner, s.signers.length - 2),
    })),

  // ── Fields ─────────────────────────────────────────────────────────────────

  setActiveFieldId: (id) => set({ activeFieldId: id }),

  setPreviewValue: (fieldId, value) =>
    set((s) => ({
      previewValues: { ...s.previewValues, [fieldId]: value },
    })),

  clearPreviewValues: () => set({ previewValues: {} }),

  // ── UI ─────────────────────────────────────────────────────────────────────

  setPreviewMode: (on) => set({ previewMode: on }),
  togglePanel: () => set((s) => ({ showPanel: !s.showPanel })),
  setShowSigners: (show) => set({ showSigners: show }),
  setShowAiPanel: (show) => set({ showAiPanel: show }),
  setFullscreen: (on) => set({ fullscreen: on }),
  setAddMode: (mode) => set({ addMode: mode }),
  setActiveSigner: (index) => set({ activeSigner: index }),
  setMobilePanel: (panel) => set({ mobilePanel: panel }),

  // ── Undo/Redo ──────────────────────────────────────────────────────────────

  pushSnapshot: () =>
    set((s) => {
      const snapshot: Snapshot = {
        tokens: structuredClone(s.tokens),
        fields: structuredClone(s.fields),
      };
      const past = [...s.history.past, snapshot].slice(-MAX_HISTORY);
      return {
        history: { past, future: [] },
        canUndo: past.length > 0,
        canRedo: false,
      };
    }),

  undo: () =>
    set((s) => {
      if (s.history.past.length === 0) return s;
      const past = [...s.history.past];
      const snapshot = past.pop()!;
      const current: Snapshot = {
        tokens: structuredClone(s.tokens),
        fields: structuredClone(s.fields),
      };
      return {
        tokens: snapshot.tokens,
        fields: snapshot.fields,
        history: {
          past,
          future: [current, ...s.history.future].slice(0, MAX_HISTORY),
        },
        canUndo: past.length > 0,
        canRedo: true,
      };
    }),

  redo: () =>
    set((s) => {
      if (s.history.future.length === 0) return s;
      const future = [...s.history.future];
      const snapshot = future.shift()!;
      const current: Snapshot = {
        tokens: structuredClone(s.tokens),
        fields: structuredClone(s.fields),
      };
      return {
        tokens: snapshot.tokens,
        fields: snapshot.fields,
        history: {
          past: [...s.history.past, current].slice(-MAX_HISTORY),
          future,
        },
        canUndo: true,
        canRedo: future.length > 0,
      };
    }),

  // ── Reset ──────────────────────────────────────────────────────────────────

  reset: () => set(INITIAL),
}));
