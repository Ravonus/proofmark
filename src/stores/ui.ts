/**
 * UI store — global UI state shared across components.
 *
 * Handles: sidebar visibility, active modals, navigation state,
 * toast notifications, and global loading indicators.
 */

import { create } from "zustand";

type ModalId = "signature-pad" | "qr-mobile" | "confirm-sign" | "add-section" | "create-document" | null;

type ToastType = "success" | "error" | "info" | "warning";

type Toast = {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
};

type UiState = {
  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  // Modals
  activeModal: ModalId;
  modalData: Record<string, unknown>;
  openModal: (id: NonNullable<ModalId>, data?: Record<string, unknown>) => void;
  closeModal: () => void;

  // Global loading
  globalLoading: boolean;
  setGlobalLoading: (loading: boolean) => void;

  // Toasts
  toasts: Toast[];
  addToast: (type: ToastType, message: string, duration?: number) => void;
  removeToast: (id: string) => void;

  // Mobile panels
  mobilePanel: string | null;
  setMobilePanel: (panel: string | null) => void;
};

let toastCounter = 0;

export const useUiStore = create<UiState>()((set) => ({
  // Sidebar
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  // Modals
  activeModal: null,
  modalData: {},
  openModal: (id, data = {}) => set({ activeModal: id, modalData: data }),
  closeModal: () => set({ activeModal: null, modalData: {} }),

  // Global loading
  globalLoading: false,
  setGlobalLoading: (loading) => set({ globalLoading: loading }),

  // Toasts
  toasts: [],
  addToast: (type, message, duration = 4000) => {
    const id = `toast-${++toastCounter}`;
    set((s) => ({ toasts: [...s.toasts, { id, type, message, duration }] }));
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  // Mobile panels
  mobilePanel: null,
  setMobilePanel: (panel) => set({ mobilePanel: panel }),
}));
