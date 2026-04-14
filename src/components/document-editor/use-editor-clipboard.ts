"use client";

import { useCallback, useRef, useState } from "react";
import type { DocToken, InlineField } from "~/lib/document/document-tokens";
import type {
	EditorHistory,
	EditorSnapshot,
} from "~/lib/document/editor-history";

// ── Clipboard data format ──

type ClipboardPayload = {
	kind: "proofmark-tokens";
	tokens: DocToken[];
	fields: InlineField[];
};

// ── Selection state ──

export type TokenSelection = {
	/** Start token index (inclusive). */
	start: number;
	/** End token index (inclusive). */
	end: number;
};

// ── Hook ──

type UseEditorClipboardOpts = {
	tokens: DocToken[];
	setTokens: React.Dispatch<React.SetStateAction<DocToken[]>>;
	fields: InlineField[];
	setFields: React.Dispatch<React.SetStateAction<InlineField[]>>;
	title: string;
	historyRef: React.RefObject<EditorHistory>;
	setCanUndo: (v: boolean) => void;
	setCanRedo: (v: boolean) => void;
	fieldCounter: React.MutableRefObject<number>;
};

function pushSnapshot(opts: UseEditorClipboardOpts, label?: string) {
	const snap: EditorSnapshot = {
		title: opts.title,
		tokens: opts.tokens as unknown[],
		fields: opts.fields as unknown[],
		timestamp: Date.now(),
		label,
	};
	opts.historyRef.current.push(snap);
	opts.setCanUndo(true);
	opts.setCanRedo(false);
}

/** Serialize tokens to plain text for external clipboard. */
function tokensToPlainText(tokens: DocToken[]): string {
	return tokens
		.map((t) => {
			switch (t.kind) {
				case "text":
				case "heading":
				case "subheading":
				case "listItem":
					return t.text;
				case "field":
					return `[${t.field.label}]`;
				case "signatureBlock":
					return `[Signature: ${t.label}]`;
				case "break":
					return "";
				default:
					return "";
			}
		})
		.join("\n");
}

/** Remap field IDs so pasted fields don't collide with existing ones. */
function remapFieldIds(
	tokens: DocToken[],
	fields: InlineField[],
	counter: React.MutableRefObject<number>,
): { tokens: DocToken[]; fields: InlineField[] } {
	const idMap = new Map<string, string>();
	const newFields: InlineField[] = [];

	for (const f of fields) {
		const newId = `field-${counter.current++}`;
		idMap.set(f.id, newId);
		newFields.push({ ...f, id: newId });
	}

	const newTokens = tokens.map((t) => {
		if (t.kind === "field") {
			const newId = idMap.get(t.field.id) ?? t.field.id;
			return { ...t, field: { ...t.field, id: newId } };
		}
		return t;
	});

	return { tokens: newTokens, fields: newFields };
}

export function useEditorClipboard(opts: UseEditorClipboardOpts) {
	const [selection, setSelection] = useState<TokenSelection | null>(null);
	const clipboardRef = useRef<ClipboardPayload | null>(null);

	// ── Select all ──
	const selectAll = useCallback(() => {
		if (opts.tokens.length === 0) return;
		setSelection({ start: 0, end: opts.tokens.length - 1 });
	}, [opts.tokens.length]);

	// ── Clear selection ──
	const clearSelection = useCallback(() => {
		setSelection(null);
	}, []);

	// ── Get selected tokens ──
	const getSelectedTokens = useCallback((): {
		tokens: DocToken[];
		fields: InlineField[];
	} | null => {
		if (!selection) return null;
		const start = Math.min(selection.start, selection.end);
		const end = Math.max(selection.start, selection.end);
		const selectedTokens = opts.tokens.slice(start, end + 1);
		const selectedFieldIds = new Set(
			selectedTokens
				.filter((t): t is DocToken & { kind: "field" } => t.kind === "field")
				.map((t) => t.field.id),
		);
		const selectedFields = opts.fields.filter((f) =>
			selectedFieldIds.has(f.id),
		);
		return { tokens: selectedTokens, fields: selectedFields };
	}, [selection, opts.tokens, opts.fields]);

	// ── Copy ──
	const copy = useCallback(async () => {
		const selected = getSelectedTokens();
		if (!selected || selected.tokens.length === 0) return;

		const payload: ClipboardPayload = {
			kind: "proofmark-tokens",
			tokens: selected.tokens,
			fields: selected.fields,
		};

		// Store internally for rich paste
		clipboardRef.current = payload;

		// Also put plain text on system clipboard
		const plainText = tokensToPlainText(selected.tokens);
		try {
			await navigator.clipboard.writeText(plainText);
		} catch {
			// Fallback: no-op if clipboard API not available
		}
	}, [getSelectedTokens]);

	// ── Cut ──
	const cut = useCallback(async () => {
		const selected = getSelectedTokens();
		if (!selected || selected.tokens.length === 0 || !selection) return;

		// Copy first
		const payload: ClipboardPayload = {
			kind: "proofmark-tokens",
			tokens: selected.tokens,
			fields: selected.fields,
		};
		clipboardRef.current = payload;

		const plainText = tokensToPlainText(selected.tokens);
		try {
			await navigator.clipboard.writeText(plainText);
		} catch {
			// no-op
		}

		// Push undo snapshot
		pushSnapshot(opts, "Cut");

		// Remove selected tokens
		const start = Math.min(selection.start, selection.end);
		const end = Math.max(selection.start, selection.end);
		const removedFieldIds = new Set(selected.fields.map((f) => f.id));

		opts.setTokens((prev) => prev.filter((_, i) => i < start || i > end));
		if (removedFieldIds.size > 0) {
			opts.setFields((prev) => prev.filter((f) => !removedFieldIds.has(f.id)));
		}

		setSelection(null);
	}, [getSelectedTokens, selection, opts]);

	// ── Paste ──
	const paste = useCallback(async () => {
		pushSnapshot(opts, "Paste");

		// Determine insertion point
		const insertAfter = selection
			? Math.max(selection.start, selection.end)
			: opts.tokens.length - 1;

		// If we have a selection, remove it first
		if (selection) {
			const start = Math.min(selection.start, selection.end);
			const end = Math.max(selection.start, selection.end);
			const removedFieldIds = new Set(
				opts.tokens
					.slice(start, end + 1)
					.filter((t): t is DocToken & { kind: "field" } => t.kind === "field")
					.map((t) => t.field.id),
			);

			opts.setTokens((prev) => {
				const filtered = prev.filter((_, i) => i < start || i > end);

				// Try internal clipboard first (rich paste)
				if (clipboardRef.current) {
					const remapped = remapFieldIds(
						clipboardRef.current.tokens,
						clipboardRef.current.fields,
						opts.fieldCounter,
					);
					opts.setFields((prevFields) => [
						...prevFields.filter((f) => !removedFieldIds.has(f.id)),
						...remapped.fields,
					]);
					const result = [...filtered];
					result.splice(start, 0, ...remapped.tokens);
					return result;
				}

				// Remove fields from selection
				if (removedFieldIds.size > 0) {
					opts.setFields((prevFields) =>
						prevFields.filter((f) => !removedFieldIds.has(f.id)),
					);
				}
				return filtered;
			});

			setSelection(null);

			// If we used internal clipboard, we're done
			if (clipboardRef.current) return;
		}

		// Try internal clipboard (rich paste with fields)
		if (clipboardRef.current) {
			const remapped = remapFieldIds(
				clipboardRef.current.tokens,
				clipboardRef.current.fields,
				opts.fieldCounter,
			);

			opts.setTokens((prev) => {
				const result = [...prev];
				result.splice(insertAfter + 1, 0, ...remapped.tokens);
				return result;
			});
			opts.setFields((prev) => [...prev, ...remapped.fields]);
			setSelection(null);
			return;
		}

		// Fallback: paste from system clipboard as plain text
		try {
			const text = await navigator.clipboard.readText();
			if (!text) return;

			const newTokens: DocToken[] = text.split("\n").map((line) => {
				if (!line.trim()) return { kind: "break" as const };
				return { kind: "text" as const, text: line };
			});

			opts.setTokens((prev) => {
				const result = [...prev];
				result.splice(insertAfter + 1, 0, ...newTokens);
				return result;
			});
		} catch {
			// Clipboard API not available
		}

		setSelection(null);
	}, [selection, opts]);

	// ── Delete selection ──
	const deleteSelection = useCallback(() => {
		if (!selection) return;

		pushSnapshot(opts, "Delete");

		const start = Math.min(selection.start, selection.end);
		const end = Math.max(selection.start, selection.end);
		const removedFieldIds = new Set(
			opts.tokens
				.slice(start, end + 1)
				.filter((t): t is DocToken & { kind: "field" } => t.kind === "field")
				.map((t) => t.field.id),
		);

		opts.setTokens((prev) => prev.filter((_, i) => i < start || i > end));
		if (removedFieldIds.size > 0) {
			opts.setFields((prev) => prev.filter((f) => !removedFieldIds.has(f.id)));
		}

		setSelection(null);
	}, [selection, opts]);

	// ── Duplicate selection ──
	const duplicate = useCallback(() => {
		const selected = getSelectedTokens();
		if (!selected || selected.tokens.length === 0 || !selection) return;

		pushSnapshot(opts, "Duplicate");

		const end = Math.max(selection.start, selection.end);
		const remapped = remapFieldIds(
			selected.tokens,
			selected.fields,
			opts.fieldCounter,
		);

		opts.setTokens((prev) => {
			const result = [...prev];
			result.splice(end + 1, 0, ...remapped.tokens);
			return result;
		});
		opts.setFields((prev) => [...prev, ...remapped.fields]);

		// Select the duplicated range
		setSelection({
			start: end + 1,
			end: end + remapped.tokens.length,
		});
	}, [getSelectedTokens, selection, opts]);

	return {
		selection,
		setSelection,
		selectAll,
		clearSelection,
		copy,
		cut,
		paste,
		deleteSelection,
		duplicate,
		hasSelection: selection !== null,
	};
}
