import { useEffect } from "react";

type UseEditorKeyboardOptions = {
  fullscreen: boolean;
  setFullscreen: (v: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onEscape: () => void;
};

/** Check if the event target is a text input element. */
function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/** Check if event has the platform modifier key (Cmd on Mac, Ctrl elsewhere). */
function hasMod(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey;
}

/**
 * Keyboard shortcuts for the document editor.
 * Handles Escape, Cmd+Z (undo), Cmd+Shift+Z / Cmd+Y (redo).
 */
export function useEditorKeyboard({ fullscreen, setFullscreen, onUndo, onRedo, onEscape }: UseEditorKeyboardOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Fullscreen escape takes priority
      if (e.key === "Escape" && fullscreen) {
        setFullscreen(false);
        return;
      }

      // Undo: Cmd+Z (no shift)
      if (hasMod(e) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        onUndo();
        return;
      }

      // Redo: Cmd+Shift+Z or Cmd+Y
      if (hasMod(e) && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
        e.preventDefault();
        onRedo();
        return;
      }

      // Escape for non-input elements
      if (e.key === "Escape" && !isTextInput(e.target)) {
        onEscape();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fullscreen, setFullscreen, onUndo, onRedo, onEscape]);
}
