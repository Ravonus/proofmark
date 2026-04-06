import { useEffect } from "react";

type UseEditorKeyboardOptions = {
  fullscreen: boolean;
  setFullscreen: (v: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onEscape: () => void;
};

/**
 * Keyboard shortcuts for the document editor.
 * Handles Escape, Cmd+Z (undo), Cmd+Shift+Z / Cmd+Y (redo).
 */
export function useEditorKeyboard({ fullscreen, setFullscreen, onUndo, onRedo, onEscape }: UseEditorKeyboardOptions) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && fullscreen) {
        setFullscreen(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        onUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        onRedo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "y") {
        e.preventDefault();
        onRedo();
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        onEscape();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [fullscreen, setFullscreen, onUndo, onRedo, onEscape]);
}
