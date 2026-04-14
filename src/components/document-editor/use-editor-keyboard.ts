import { useEffect } from "react";

type UseEditorKeyboardOptions = {
	fullscreen: boolean;
	setFullscreen: (v: boolean) => void;
	onUndo: () => void;
	onRedo: () => void;
	onEscape: () => void;
	onCopy?: () => void;
	onCut?: () => void;
	onPaste?: () => void;
	onSelectAll?: () => void;
	onDuplicate?: () => void;
	onDeleteSelection?: () => void;
	hasSelection?: boolean;
};

/** Check if the event target is a text input element. */
function isTextInput(target: EventTarget | null): boolean {
	if (target instanceof HTMLInputElement) return true;
	if (target instanceof HTMLTextAreaElement) return true;
	if (target instanceof HTMLElement && target.isContentEditable) return true;
	return false;
}

/** Check if event has the platform modifier key (Cmd on Mac, Ctrl elsewhere). */
function hasMod(e: KeyboardEvent): boolean {
	return e.metaKey || e.ctrlKey;
}

/**
 * Keyboard shortcuts for the document editor.
 * Handles undo/redo, clipboard, select all, duplicate, and escape.
 */
export function useEditorKeyboard({
	fullscreen,
	setFullscreen,
	onUndo,
	onRedo,
	onEscape,
	onCopy,
	onCut,
	onPaste,
	onSelectAll,
	onDuplicate,
	onDeleteSelection,
	hasSelection,
}: UseEditorKeyboardOptions) {
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const inTextInput = isTextInput(e.target);

			// Fullscreen escape takes priority
			if (e.key === "Escape" && fullscreen) {
				setFullscreen(false);
				return;
			}

			// Undo: Cmd+Z (no shift)
			if (hasMod(e) && e.key === "z" && !e.shiftKey) {
				// Allow native undo in text inputs
				if (inTextInput) return;
				e.preventDefault();
				onUndo();
				return;
			}

			// Redo: Cmd+Shift+Z or Cmd+Y
			if (hasMod(e) && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
				if (inTextInput) return;
				e.preventDefault();
				onRedo();
				return;
			}

			// Select All: Cmd+A
			if (hasMod(e) && e.key === "a" && !e.shiftKey) {
				if (inTextInput) return;
				e.preventDefault();
				onSelectAll?.();
				return;
			}

			// Copy: Cmd+C
			if (hasMod(e) && e.key === "c" && !e.shiftKey) {
				if (inTextInput) return;
				if (!hasSelection) return;
				e.preventDefault();
				onCopy?.();
				return;
			}

			// Cut: Cmd+X
			if (hasMod(e) && e.key === "x" && !e.shiftKey) {
				if (inTextInput) return;
				if (!hasSelection) return;
				e.preventDefault();
				onCut?.();
				return;
			}

			// Paste: Cmd+V
			if (hasMod(e) && e.key === "v" && !e.shiftKey) {
				if (inTextInput) return;
				e.preventDefault();
				onPaste?.();
				return;
			}

			// Duplicate: Cmd+D
			if (hasMod(e) && e.key === "d") {
				if (inTextInput) return;
				if (!hasSelection) return;
				e.preventDefault();
				onDuplicate?.();
				return;
			}

			// Delete/Backspace: remove selection
			if ((e.key === "Delete" || e.key === "Backspace") && hasSelection) {
				if (inTextInput) return;
				e.preventDefault();
				onDeleteSelection?.();
				return;
			}

			// Escape for non-input elements
			if (e.key === "Escape" && !inTextInput) {
				onEscape();
			}
		};
		document.addEventListener("keydown", handler);
		return () => document.removeEventListener("keydown", handler);
	}, [
		fullscreen,
		setFullscreen,
		onUndo,
		onRedo,
		onEscape,
		onCopy,
		onCut,
		onPaste,
		onSelectAll,
		onDuplicate,
		onDeleteSelection,
		hasSelection,
	]);
}
