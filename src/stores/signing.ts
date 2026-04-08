/**
 * Document signing store — global state for the signing flow.
 *
 * Replaces 15 useState + 9 useEffect in sign-document.tsx.
 * Handles: signing status, field values, navigation, modals, drafts.
 */

import { create } from "zustand";

// ── Types ────────────────────────────────────────────────────────────────────

type SigningPhase = "idle" | "signing" | "done" | "declined";

type SigningState = {
  // Core state
  phase: SigningPhase;
  email: string;
  handSignature: string | null;

  // Field tracking
  fieldValues: Record<string, string>;
  activeField: string | null;
  currentFieldIdx: number;

  // QR mobile signing
  qrToken: string | null;
  qrUrl: string | null;
  qrImage: string | null;
  qrMode: "signature" | "initials";
  qrFieldId: string | null;

  // Modals
  showSigPad: boolean;
  showQr: boolean;
  showConfirmModal: boolean;

  // Error display
  signingError: string | null;

  // Draft persistence key
  draftStorageKey: string | null;
};

type SigningActions = {
  // Phase transitions
  startSigning: () => void;
  completeSigning: () => void;
  declineSigning: () => void;
  resetSigning: () => void;
  setSigningError: (error: string | null) => void;

  // Field management
  setFieldValue: (fieldId: string, value: string) => void;
  setFieldValues: (values: Record<string, string>) => void;
  setActiveField: (fieldId: string | null) => void;
  setCurrentFieldIdx: (idx: number) => void;
  navigateField: (direction: "next" | "prev", totalFields: number) => void;

  // Email & signature
  setEmail: (email: string) => void;
  setHandSignature: (data: string | null) => void;

  // QR
  setQrData: (
    token: string,
    url: string,
    image: string,
    mode?: "signature" | "initials",
    fieldId?: string | null,
  ) => void;
  clearQr: () => void;

  // Modals
  setShowSigPad: (show: boolean) => void;
  setShowQr: (show: boolean) => void;
  setShowConfirmModal: (show: boolean) => void;

  // Drafts
  setDraftStorageKey: (key: string | null) => void;
  saveDraft: () => void;
  loadDraft: () => boolean;
  clearDraft: () => void;
};

export type SigningStoreState = SigningState & SigningActions;

const INITIAL: SigningState = {
  phase: "idle",
  email: "",
  handSignature: null,
  fieldValues: {},
  activeField: null,
  currentFieldIdx: 0,
  qrToken: null,
  qrUrl: null,
  qrImage: null,
  qrMode: "signature" as const,
  qrFieldId: null,
  showSigPad: false,
  showQr: false,
  showConfirmModal: false,
  signingError: null,
  draftStorageKey: null,
};

// ── Store ────────────────────────────────────────────────────────────────────

export const useSigningStore = create<SigningState & SigningActions>()((set, get) => ({
  ...INITIAL,

  // ── Phase ──────────────────────────────────────────────────────────────────

  startSigning: () => set({ phase: "signing" }),
  completeSigning: () => set({ phase: "done" }),
  declineSigning: () => set({ phase: "declined" }),
  // Only reset phase — preserve field values, hand signature, email so
  // the user doesn't lose their work if signing fails (wallet rejected, etc.)
  resetSigning: () => set({ phase: "idle" }),
  setSigningError: (error) => set({ signingError: error }),

  // ── Fields ─────────────────────────────────────────────────────────────────

  setFieldValue: (fieldId, value) =>
    set((s) => ({
      fieldValues: { ...s.fieldValues, [fieldId]: value },
    })),

  setFieldValues: (values) => set({ fieldValues: values }),

  setActiveField: (fieldId) => set({ activeField: fieldId }),

  setCurrentFieldIdx: (idx) => set({ currentFieldIdx: idx }),

  navigateField: (direction, totalFields) =>
    set((s) => {
      if (totalFields === 0) return s;
      const next =
        direction === "next"
          ? (s.currentFieldIdx + 1) % totalFields
          : (s.currentFieldIdx - 1 + totalFields) % totalFields;
      return { currentFieldIdx: next };
    }),

  // ── Email & signature ──────────────────────────────────────────────────────

  setEmail: (email) => set({ email }),
  setHandSignature: (data) => set({ handSignature: data }),

  // ── QR ─────────────────────────────────────────────────────────────────────

  setQrData: (token, url, image, mode = "signature", fieldId = null) =>
    set({
      qrToken: token,
      qrUrl: url,
      qrImage: image,
      qrMode: mode,
      qrFieldId: fieldId,
    }),
  clearQr: () =>
    set({
      qrToken: null,
      qrUrl: null,
      qrImage: null,
      qrMode: "signature",
      qrFieldId: null,
    }),

  // ── Modals ─────────────────────────────────────────────────────────────────

  setShowSigPad: (show) => set({ showSigPad: show }),
  setShowQr: (show) => set({ showQr: show }),
  setShowConfirmModal: (show) => set({ showConfirmModal: show }),

  // ── Draft persistence ──────────────────────────────────────────────────────

  setDraftStorageKey: (key) => set({ draftStorageKey: key }),

  saveDraft: () => {
    const { draftStorageKey, fieldValues, email } = get();
    if (!draftStorageKey) return;
    try {
      sessionStorage.setItem(draftStorageKey, JSON.stringify({ fieldValues, email, savedAt: Date.now() }));
    } catch {}
  },

  loadDraft: () => {
    const { draftStorageKey } = get();
    if (!draftStorageKey) return false;
    try {
      const raw = sessionStorage.getItem(draftStorageKey);
      if (!raw) return false;
      const draft = JSON.parse(raw) as {
        fieldValues?: Record<string, string>;
        email?: string;
      };
      set({
        fieldValues: draft.fieldValues ?? {},
        email: draft.email ?? "",
      });
      return true;
    } catch {
      return false;
    }
  },

  clearDraft: () => {
    const { draftStorageKey } = get();
    if (draftStorageKey) {
      try {
        sessionStorage.removeItem(draftStorageKey);
      } catch {}
    }
  },
}));
