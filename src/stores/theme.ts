/**
 * Theme store — global dark/light mode state.
 *
 * Replaces the useState + useEffect pattern in ThemeToggle.
 * Persists to localStorage, syncs to document.documentElement class.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

type ThemeMode = "dark" | "light";

type ThemeStore = {
  mode: ThemeMode;
  toggle: () => void;
};

/** Apply the theme class to the document root. */
function applyTheme(mode: ThemeMode) {
  if (typeof document === "undefined") return;
  if (mode === "light") {
    document.documentElement.classList.add("light");
  } else {
    document.documentElement.classList.remove("light");
  }
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      mode: "dark" as ThemeMode,

      toggle: () => {
        const next = get().mode === "dark" ? "light" : "dark";
        applyTheme(next);
        set({ mode: next });
      },
    }),
    {
      name: "proofmark-theme",
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.mode);
      },
    },
  ),
);
