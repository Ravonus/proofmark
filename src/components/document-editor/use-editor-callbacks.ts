"use client";

import { useCallback, useMemo, useRef } from "react";
import { getField } from "~/components/fields/field-registry";
import {
	type AddressSuggestion,
	buildAddressSuggestionFieldUpdates,
} from "~/lib/address-autocomplete";
import {
	type DocToken,
	type InlineField,
	PLACEHOLDERS,
	tokensToContent,
} from "~/lib/document/document-tokens";
import {
	formatEditableFieldValue,
	getFieldLogicState,
} from "~/lib/document/field-runtime";
import { trpc } from "~/lib/platform/trpc";
import { useEditorStore } from "~/stores/editor";
import type { SignatureBlockToken } from "./document-editor-fields";
import type {
	EditorResult,
	PreviewValueMap,
	SignerDef,
} from "./document-editor-types";

// ── Helpers (pure) ──

function spliceFieldIntoTokens(
	tokens: DocToken[],
	targetIdx: number,
	fieldToken: DocToken,
	charOffset: number,
): DocToken[] {
	const target = tokens[targetIdx];
	if (
		target &&
		(target.kind === "text" || target.kind === "listItem") &&
		charOffset >= 0 &&
		charOffset <= target.text.length
	) {
		const before = target.text.slice(0, charOffset);
		const after = target.text.slice(charOffset);
		const newTokens: DocToken[] = [];
		if (before) newTokens.push({ ...target, text: before });
		newTokens.push(fieldToken);
		if (after) newTokens.push({ ...target, text: after });
		tokens.splice(targetIdx, 1, ...newTokens);
	} else {
		tokens.splice(targetIdx + 1, 0, fieldToken);
	}
	return tokens;
}

export function moveSectionInTokens(
	c: DocToken[],
	hi: number,
	dir: "up" | "down",
): DocToken[] {
	const end = findSectionEnd(c, hi);
	const chunk = c.splice(hi, end - hi);
	const prevHi =
		dir === "up"
			? (() => {
					for (let i = hi - 1; i >= 0; i--)
						if (c[i]!.kind === "heading" || c[i]!.kind === "subheading")
							return i;
					return 0;
				})()
			: (() => {
					const afterHi = hi;
					return findSectionEnd(c, afterHi);
				})();
	c.splice(prevHi, 0, ...chunk);
	return c;
}

function findSectionEnd(tokens: DocToken[], hi: number): number {
	let ei = hi + 1;
	while (
		ei < tokens.length &&
		tokens[ei]!.kind !== "heading" &&
		tokens[ei]!.kind !== "subheading"
	)
		ei++;
	return ei;
}

// ── Hook ──

interface EditorCallbacksOpts {
	tokens: DocToken[];
	setTokens: React.Dispatch<React.SetStateAction<DocToken[]>>;
	fields: InlineField[];
	setFields: React.Dispatch<React.SetStateAction<InlineField[]>>;
	previewValues: PreviewValueMap;
	setPreviewValues: React.Dispatch<React.SetStateAction<PreviewValueMap>>;
	signers: SignerDef[];
	title: string;
	fieldCounter: React.MutableRefObject<number>;
	/** Called before any mutation to push an undo snapshot. */
	onBeforeMutate?: (label?: string) => void;
}

export function useEditorCallbacks(opts: EditorCallbacksOpts) {
	const {
		tokens,
		setTokens,
		fields,
		setFields,
		previewValues,
		setPreviewValues,
		signers,
		title,
		fieldCounter,
		onBeforeMutate,
	} = opts;
	void title; // used by caller via buildResult

	const snapshot = useCallback(
		(label?: string) => {
			onBeforeMutate?.(label);
		},
		[onBeforeMutate],
	);
	const setAddMode = useEditorStore((s) => s.setAddMode);
	const setActiveFieldId = useEditorStore((s) => s.setActiveFieldId);
	const activeSigner = useEditorStore((s) => s.activeSigner);

	const addressSuggestionsMut = trpc.account.addressSuggestions.useMutation();
	const addressSuggestionsRef = useRef(addressSuggestionsMut);
	addressSuggestionsRef.current = addressSuggestionsMut;

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
				settings:
					type === "custom-field"
						? { inputType: "text", validation: {}, logic: {}, display: {} }
						: undefined,
			};
			return nf;
		},
		[activeSigner, fieldCounter],
	);

	const insertFieldAfterToken = useCallback(
		(afterIdx: number, type: InlineField["type"], label: string) => {
			snapshot("Insert field");
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
		[
			makeNewField,
			setActiveFieldId,
			setAddMode,
			setTokens,
			setFields,
			snapshot,
		],
	);

	const insertFieldInlineAt = useCallback(
		(
			tokenIdx: number,
			charOffset: number,
			type: InlineField["type"],
			label: string,
		) => {
			snapshot("Insert inline field");
			const nf = makeNewField(type, label);
			setTokens((prev) => {
				const token = prev[tokenIdx];
				if (!token) return prev;
				if (token.kind === "text" || token.kind === "listItem") {
					const before = token.text.slice(0, charOffset);
					const after = token.text.slice(charOffset);
					const newTokens: DocToken[] = [];
					if (before) newTokens.push({ ...token, text: before });
					newTokens.push({ kind: "field", field: nf });
					if (after) newTokens.push({ ...token, text: after });
					const c = [...prev];
					c.splice(tokenIdx, 1, ...newTokens);
					return c;
				}
				const c = [...prev];
				c.splice(tokenIdx + 1, 0, { kind: "field", field: nf });
				return c;
			});
			setFields((prev) => [...prev, nf]);
			setAddMode(null);
			setActiveFieldId(nf.id);
		},
		[
			makeNewField,
			setActiveFieldId,
			setAddMode,
			setTokens,
			setFields,
			snapshot,
		],
	);

	const moveFieldInlineAt = useCallback(
		(fid: string, tokenIdx: number, charOffset: number) => {
			snapshot("Move field");
			setTokens((prev) => {
				const fi = prev.findIndex(
					(t) => t.kind === "field" && t.field.id === fid,
				);
				if (fi === -1) return prev;
				const c = [...prev];
				const [fieldToken] = c.splice(fi, 1);
				if (!fieldToken) return prev;
				const adjIdx = tokenIdx > fi ? tokenIdx - 1 : tokenIdx;
				return spliceFieldIntoTokens(c, adjIdx, fieldToken, charOffset);
			});
		},
		[setTokens, snapshot],
	);

	const moveFieldToIdx = useCallback(
		(fid: string, toIdx: number) => {
			snapshot("Move field");
			setTokens((prev) => {
				const fi = prev.findIndex(
					(t) => t.kind === "field" && t.field.id === fid,
				);
				if (fi === -1) return prev;
				const c = [...prev];
				const [r] = c.splice(fi, 1);
				c.splice(toIdx > fi ? toIdx - 1 : toIdx, 0, r!);
				return c;
			});
		},
		[setTokens, snapshot],
	);

	const removeField = useCallback(
		(fid: string) => {
			snapshot("Remove field");
			setTokens((p) =>
				p.filter((t) => !(t.kind === "field" && t.field.id === fid)),
			);
			setFields((p) => p.filter((f) => f.id !== fid));
			setPreviewValues((current) => {
				const next = { ...current };
				delete next[fid];
				return next;
			});
			setActiveFieldId(null);
		},
		[setActiveFieldId, setTokens, setFields, setPreviewValues, snapshot],
	);

	const updateField = useCallback(
		(fid: string, patch: Partial<InlineField>) => {
			setFields((p) => p.map((f) => (f.id === fid ? { ...f, ...patch } : f)));
			setTokens((p) =>
				p.map((t) =>
					t.kind === "field" && t.field.id === fid
						? { ...t, field: { ...t.field, ...patch } }
						: t,
				),
			);
		},
		[setFields, setTokens],
	);

	const updateTokenText = useCallback(
		(idx: number, text: string) => {
			setTokens((p) =>
				p.map((t, i) => {
					if (i !== idx) return t;
					if (
						t.kind === "text" ||
						t.kind === "heading" ||
						t.kind === "subheading" ||
						t.kind === "listItem"
					)
						return { ...t, text };
					return t;
				}),
			);
		},
		[setTokens],
	);

	const removeToken = useCallback(
		(idx: number) => {
			snapshot("Remove token");
			setTokens((p) => {
				const t = p[idx];
				if (!t) return p;
				if (t.kind === "field") {
					setFields((f) => f.filter((ff) => ff.id !== t.field.id));
				}
				return p.filter((_, i) => i !== idx);
			});
			setActiveFieldId(null);
		},
		[setActiveFieldId, setTokens, setFields, snapshot],
	);

	const insertTokenAfter = useCallback(
		(afterIdx: number, token: DocToken) => {
			snapshot("Insert token");
			setTokens((p) => {
				const c = [...p];
				c.splice(afterIdx + 1, 0, token);
				return c;
			});
		},
		[setTokens, snapshot],
	);

	const removeSection = useCallback(
		(hi: number) => {
			snapshot("Remove section");
			setTokens((prev) => {
				const c = [...prev];
				let ei = hi + 1;
				while (
					ei < c.length &&
					c[ei]!.kind !== "heading" &&
					c[ei]!.kind !== "subheading"
				)
					ei++;
				const rm = c.splice(hi, ei - hi);
				const rids = new Set(
					rm
						.filter(
							(t): t is Extract<DocToken, { kind: "field" }> =>
								t.kind === "field",
						)
						.map((t) => t.field.id),
				);
				if (rids.size > 0) setFields((f) => f.filter((ff) => !rids.has(ff.id)));
				return c;
			});
		},
		[setTokens, setFields, snapshot],
	);

	const moveSection = useCallback(
		(hi: number, dir: "up" | "down") => {
			snapshot("Move section");
			setTokens((prev) => moveSectionInTokens([...prev], hi, dir));
		},
		[setTokens, snapshot],
	);

	const updateSigBlock = useCallback(
		(ti: number, patch: Partial<SignatureBlockToken>) => {
			setTokens((p) =>
				p.map((t, i) =>
					i === ti && t.kind === "signatureBlock" ? { ...t, ...patch } : t,
				),
			);
		},
		[setTokens],
	);

	const removeSigBlock = useCallback(
		(ti: number) => {
			snapshot("Remove signature block");
			setTokens((p) => p.filter((_, i) => i !== ti));
			setActiveFieldId(null);
		},
		[setActiveFieldId, setTokens, snapshot],
	);

	const setPreviewValue = useCallback(
		(fieldId: string, value: string) => {
			setPreviewValues((current) => {
				if (!value) {
					const next = { ...current };
					delete next[fieldId];
					return next;
				}
				return { ...current, [fieldId]: value };
			});
		},
		[setPreviewValues],
	);

	const loadAddressSuggestions = useCallback(async (query: string) => {
		if (query.trim().length < 3) return [];
		const result = await addressSuggestionsRef.current.mutateAsync({
			query: query.trim(),
			limit: 5,
		});
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
					const targetField = fields.find(
						(candidate) => candidate.id === fieldId,
					);
					if (!targetField) continue;
					next[fieldId] = formatEditableFieldValue(targetField, rawValue);
				}
				return next;
			});
		},
		[fields, setPreviewValues],
	);

	const effectivePreviewValues = useMemo(() => {
		const fieldIds = new Set(fields.map((f) => f.id));
		const filtered: PreviewValueMap = {};
		for (const [id, val] of Object.entries(previewValues)) {
			if (!fieldIds.has(id)) continue;
			filtered[id] = val;
		}
		for (const field of fields) {
			const logicState = getFieldLogicState(field, filtered);
			if (!logicState.visible && logicState.clearWhenHidden) {
				delete filtered[field.id];
			}
		}
		return filtered;
	}, [fields, previewValues]);

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
					onDragStart: () => {
						/* noop */
					},
					onDragEnd: () => {
						/* noop */
					},
				};
				fieldCallbacks.current.set(fid, c);
			}
			return c;
		},
		[removeField, setActiveFieldId, updateField],
	);

	const buildResult = (title: string): EditorResult => {
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

	return {
		insertFieldAfterToken,
		insertFieldInlineAt,
		moveFieldInlineAt,
		moveFieldToIdx,
		removeField,
		updateField,
		updateTokenText,
		removeToken,
		insertTokenAfter,
		removeSection,
		moveSection,
		updateSigBlock,
		removeSigBlock,
		setPreviewValue,
		loadAddressSuggestions,
		applyPreviewAddressSuggestion,
		effectivePreviewValues,
		getCbs,
		buildResult,
	};
}
