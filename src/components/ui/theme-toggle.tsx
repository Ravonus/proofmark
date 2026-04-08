"use client";

import { Moon, Sun } from "lucide-react";
import { useThemeStore } from "~/stores";

/** Theme toggle — zero useEffect, zero useState. Reads/writes from Zustand. */
export function ThemeToggle() {
  const { mode, toggle } = useThemeStore();

  return (
    <button onClick={toggle} className="w3s-icon-btn" title={mode === "dark" ? "Light mode" : "Dark mode"}>
      {mode === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
