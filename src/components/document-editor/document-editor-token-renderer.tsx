"use client";

import {
	ChevronDown,
	ChevronUp,
	CornerDownLeft,
	GripVertical,
	Heading,
	List,
	PenTool,
	Pilcrow,
	Plus,
	Trash2,
	Type as TypeIcon,
} from "lucide-react";
import React, { useState } from "react";
import type { AddressSuggestion } from "~/lib/address-autocomplete";
import type { DocToken, InlineField } from "~/lib/document/document-tokens";
import { W3SButton } from "../ui/motion";
import {
	EditorField,
	EditorSignatureBlock,
	type SignatureBlockToken,
} from "./document-editor-fields";
import type { PreviewValueMap, SignerDef } from "./document-editor-types";
import type { TokenSelection } from "./use-editor-clipboard";

// ── Types ──

type FieldCallbacks = {
	onFocus: () => void;
	onUpdate: (p: Partial<InlineField>) => void;
	onRemove: () => void;
	onDragStart: () => void;
	onDragEnd: () => void;
};

type TokenRendererProps = {
	tokens: DocToken[];
	fields: InlineField[];
	previewMode: boolean;
	effectivePreviewValues: PreviewValueMap;
	activeFieldId: string | null;
	addMode: InlineField["type"] | null;
	showPanel: boolean;
	activeSigner: number;
	signers: SignerDef[];
	isDragging: boolean;
	selection: TokenSelection | null;
	getCbs: (fid: string) => FieldCallbacks;
	insertFieldAfterToken: (
		afterIdx: number,
		type: InlineField["type"],
		label: string,
	) => void;
	insertFieldInlineAt: (
		tokenIdx: number,
		charOffset: number,
		type: InlineField["type"],
		label: string,
	) => void;
	insertTokenAfter: (afterIdx: number, token: DocToken) => void;
	updateTokenText: (idx: number, text: string) => void;
	removeToken: (idx: number) => void;
	moveSection: (hi: number, dir: "up" | "down") => void;
	removeSection: (hi: number) => void;
	updateSigBlock: (ti: number, patch: Partial<SignatureBlockToken>) => void;
	removeSigBlock: (ti: number) => void;
	setPreviewValue: (fieldId: string, value: string) => void;
	applyPreviewAddressSuggestion: (
		field: InlineField,
		suggestion: AddressSuggestion,
	) => void;
	loadAddressSuggestions: (query: string) => Promise<AddressSuggestion[]>;
	setActiveFieldId: (id: string | null) => void;
	onTokenClick?: (idx: number) => void;
};

// ── Hover toolbar for inserting elements ──

function HoverInsertToolbar({
	tokenIdx,
	insertFieldAfterToken,
	insertTokenAfter,
}: {
	tokenIdx: number;
	insertFieldAfterToken: TokenRendererProps["insertFieldAfterToken"];
	insertTokenAfter: TokenRendererProps["insertTokenAfter"];
}) {
	return (
		<div className="absolute -left-1 top-1/2 z-30 flex -translate-x-full -translate-y-1/2 items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-1 py-0.5 shadow-lg opacity-0 transition-opacity group-hover/line:opacity-100 pointer-events-none group-hover/line:pointer-events-auto">
			<button
				type="button"
				onClick={() => insertFieldAfterToken(tokenIdx, "free-text", "")}
				className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--accent)]"
				title="Insert field"
			>
				<Plus className="h-3.5 w-3.5" />
			</button>
			<button
				type="button"
				onClick={() => insertTokenAfter(tokenIdx, { kind: "text", text: "" })}
				className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--accent)]"
				title="Add paragraph"
			>
				<Pilcrow className="h-3 w-3" />
			</button>
			<button
				type="button"
				onClick={() =>
					insertFieldAfterToken(tokenIdx, "signature", "Signature")
				}
				className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-emerald-400"
				title="Insert signature"
			>
				<PenTool className="h-3 w-3" />
			</button>
		</div>
	);
}

// ── Between-block insert line (appears between blocks on hover) ──

function BlockInsertLine({
	tokenIdx,
	insertFieldAfterToken,
	insertTokenAfter,
}: {
	tokenIdx: number;
	insertFieldAfterToken: TokenRendererProps["insertFieldAfterToken"];
	insertTokenAfter: TokenRendererProps["insertTokenAfter"];
}) {
	const [showMenu, setShowMenu] = useState(false);

	return (
		<div
			className="group/insert relative -my-0.5 flex h-2 items-center"
			data-insert-line={tokenIdx}
		>
			{/* Hover line */}
			<div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors group-hover/insert:bg-[var(--accent-30)]" />

			{/* Center + button */}
			<div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
				<button
					type="button"
					onClick={() => setShowMenu(!showMenu)}
					className="flex h-5 w-5 items-center justify-center rounded-full border border-transparent bg-transparent text-transparent transition-all group-hover/insert:border-[var(--accent-30)] group-hover/insert:bg-[var(--bg-card)] group-hover/insert:text-[var(--accent)]"
					title="Insert here"
				>
					<Plus className="h-3 w-3" />
				</button>
			</div>

			{/* Dropdown menu */}
			{showMenu && (
				<>
					<div
						className="fixed inset-0 z-30"
						onClick={() => setShowMenu(false)}
					/>
					<div className="absolute left-1/2 top-full z-40 -translate-x-1/2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-1 shadow-xl">
						<div className="flex items-center gap-0.5">
							<button
								type="button"
								onClick={() => {
									insertTokenAfter(tokenIdx, { kind: "text", text: "" });
									setShowMenu(false);
								}}
								className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-secondary transition-colors hover:bg-[var(--bg-hover)]"
							>
								<Pilcrow className="h-3 w-3" /> Text
							</button>
							<button
								type="button"
								onClick={() => {
									insertFieldAfterToken(tokenIdx, "free-text", "");
									setShowMenu(false);
								}}
								className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-secondary transition-colors hover:bg-[var(--bg-hover)]"
							>
								<Plus className="h-3 w-3" /> Field
							</button>
							<button
								type="button"
								onClick={() => {
									const num = 1; // Will be recalculated
									insertTokenAfter(tokenIdx, {
										kind: "heading",
										text: "NEW SECTION",
										sectionNum: num,
									});
									setShowMenu(false);
								}}
								className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-secondary transition-colors hover:bg-[var(--bg-hover)]"
							>
								<Heading className="h-3 w-3" /> Heading
							</button>
							<button
								type="button"
								onClick={() => {
									insertTokenAfter(tokenIdx, { kind: "listItem", text: "- " });
									setShowMenu(false);
								}}
								className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-secondary transition-colors hover:bg-[var(--bg-hover)]"
							>
								<List className="h-3 w-3" /> List
							</button>
							<button
								type="button"
								onClick={() => {
									insertFieldAfterToken(tokenIdx, "signature", "Signature");
									setShowMenu(false);
								}}
								className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-emerald-400 transition-colors hover:bg-[var(--bg-hover)]"
							>
								<PenTool className="h-3 w-3" /> Signature
							</button>
						</div>
					</div>
				</>
			)}
		</div>
	);
}

// ── Inline text rendering ──

function renderInlineText(
	token: DocToken & { kind: "text" },
	idx: number,
	opts: {
		previewMode: boolean;
		updateTokenText: TokenRendererProps["updateTokenText"];
		insertTokenAfter: TokenRendererProps["insertTokenAfter"];
		removeToken: TokenRendererProps["removeToken"];
	},
) {
	// Text is always editable (no more add-mode gate)
	return (
		<span
			key={`t-${idx}`}
			data-token-idx={idx}
			contentEditable={!opts.previewMode}
			suppressContentEditableWarning
			onBlur={(e) => {
				const newText = e.currentTarget.textContent || "";
				if (newText !== token.text) opts.updateTokenText(idx, newText);
			}}
			onKeyDown={(e) => {
				if (e.key === "Enter" && !e.shiftKey) {
					e.preventDefault();
					(e.currentTarget as HTMLElement).blur();
					opts.insertTokenAfter(idx, { kind: "text", text: "" });
				}
				if (
					e.key === "Backspace" &&
					(e.currentTarget.textContent || "") === ""
				) {
					e.preventDefault();
					opts.removeToken(idx);
				}
			}}
			className={`text-sm leading-relaxed text-secondary outline-none ${!opts.previewMode ? "rounded-sm hover:bg-[var(--bg-hover-30)] focus:bg-[var(--bg-hover-30)]" : ""}`}
		>
			{token.text}
		</span>
	);
}

// ── Inline field rendering ──

function renderInlineField(
	token: DocToken & { kind: "field" },
	idx: number,
	props: TokenRendererProps,
) {
	const cbs = props.getCbs(token.field.id);
	return (
		<span key={`t-${idx}`} data-token-idx={idx} className="inline">
			<EditorField
				field={token.field}
				active={props.activeFieldId === token.field.id}
				previewMode={props.previewMode}
				previewValue={props.effectivePreviewValues[token.field.id]}
				previewValues={props.effectivePreviewValues}
				allFields={props.fields}
				signerCount={props.signers.length}
				signers={props.signers}
				onFocus={cbs.onFocus}
				onPreviewChange={(value) =>
					props.setPreviewValue(token.field.id, value)
				}
				onPreviewAddressSuggestion={(suggestion) =>
					props.applyPreviewAddressSuggestion(token.field, suggestion)
				}
				loadAddressSuggestions={props.loadAddressSuggestions}
				onUpdate={cbs.onUpdate}
				onRemove={cbs.onRemove}
				onDragStart={cbs.onDragStart}
				onDragEnd={cbs.onDragEnd}
			/>
		</span>
	);
}

// ── Block token rendering ──

function renderHeading(
	token: DocToken & { kind: "heading" },
	ti: number,
	props: TokenRendererProps,
) {
	return (
		<span key={`t-${ti}`} data-token-idx={ti}>
			<div
				className="group relative pb-2 pt-6"
				data-section={ti}
				draggable={!props.previewMode}
			>
				{(token.sectionNum || 0) > 1 && (
					<div className="absolute left-0 right-0 top-1 h-px bg-[var(--border)]" />
				)}
				<div className="flex items-center gap-2">
					{!props.previewMode && (
						<div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
							<GripVertical className="text-muted/50 h-3.5 w-3.5 cursor-grab" />
							<button
								type="button"
								onClick={() => props.moveSection(ti, "up")}
								className="text-muted/50 hover:text-secondary"
							>
								<ChevronUp className="h-3 w-3" />
							</button>
							<button
								type="button"
								onClick={() => props.moveSection(ti, "down")}
								className="text-muted/50 hover:text-secondary"
							>
								<ChevronDown className="h-3 w-3" />
							</button>
						</div>
					)}
					{props.previewMode ? (
						<h3 className="flex-1 text-base font-bold text-primary">
							{token.text}
						</h3>
					) : (
						<input
							defaultValue={token.text}
							onBlur={(e) => {
								if (e.target.value !== token.text)
									props.updateTokenText(ti, e.target.value);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									(e.target as HTMLInputElement).blur();
									props.insertTokenAfter(ti, {
										kind: "text",
										text: "",
									});
								}
							}}
							className="flex-1 border-b border-transparent bg-transparent text-base font-bold text-primary outline-none transition-colors focus:border-[var(--accent-30)]"
							placeholder="Section heading..."
						/>
					)}
					{!props.previewMode && (
						<button
							type="button"
							onClick={() => props.removeSection(ti)}
							className="text-red-400/40 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
						>
							<Trash2 className="h-3.5 w-3.5" />
						</button>
					)}
				</div>
			</div>
		</span>
	);
}

function renderSubheading(
	token: DocToken & { kind: "subheading" },
	ti: number,
	props: TokenRendererProps,
) {
	if (props.previewMode) {
		return (
			<span key={`t-${ti}`} data-token-idx={ti}>
				<h4 className="pb-2 pt-6 text-sm font-bold uppercase tracking-widest text-secondary">
					{token.text}
				</h4>
			</span>
		);
	}
	return (
		<span key={`t-${ti}`} data-token-idx={ti}>
			<div className="group relative pb-2 pt-6">
				<input
					defaultValue={token.text}
					onBlur={(e) => {
						if (e.target.value !== token.text)
							props.updateTokenText(ti, e.target.value);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							(e.target as HTMLInputElement).blur();
							props.insertTokenAfter(ti, {
								kind: "text",
								text: "",
							});
						}
					}}
					className="w-full border-b border-transparent bg-transparent text-sm font-bold uppercase tracking-widest text-secondary outline-none transition-colors focus:border-[var(--accent-30)]"
					placeholder="Sub-heading..."
				/>
				<button
					type="button"
					onClick={() => props.removeToken(ti)}
					className="absolute right-0 top-6 text-red-400/40 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
				>
					<Trash2 className="h-3 w-3" />
				</button>
			</div>
		</span>
	);
}

function renderListItem(
	token: DocToken & { kind: "listItem" },
	ti: number,
	props: TokenRendererProps,
) {
	if (props.previewMode) {
		return (
			<span key={`t-${ti}`} data-token-idx={ti}>
				<div className="flex items-start gap-2 py-0.5 pl-4 text-sm leading-relaxed text-secondary">
					<span className="mt-0.5 shrink-0 text-muted">&#8226;</span>
					<span>{token.text.replace(/^[-*•()\da-z]+\s*/, "")}</span>
				</div>
			</span>
		);
	}
	return (
		<span key={`t-${ti}`} data-token-idx={ti}>
			<div className="group/list relative flex items-start gap-2 py-0.5 pl-4">
				<span className="mt-1 shrink-0 text-sm text-muted">&#8226;</span>
				<span
					contentEditable
					suppressContentEditableWarning
					data-token-idx={ti}
					onBlur={(e) => {
						const v = e.currentTarget.textContent || "";
						if (v !== token.text) props.updateTokenText(ti, `- ${v}`);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							(e.currentTarget as HTMLElement).blur();
							props.insertTokenAfter(ti, {
								kind: "listItem",
								text: "- ",
							});
						}
						if (
							e.key === "Backspace" &&
							(e.currentTarget.textContent || "") === ""
						) {
							e.preventDefault();
							props.removeToken(ti);
						}
					}}
					className="flex-1 text-sm leading-relaxed text-secondary outline-none"
				>
					{token.text.replace(/^[-*•]\s*/, "")}
				</span>
				<button
					type="button"
					onClick={() => props.removeToken(ti)}
					className="mt-0.5 shrink-0 text-red-400/30 opacity-0 transition-opacity hover:text-red-400 group-hover/list:opacity-100"
				>
					<Trash2 className="h-3 w-3" />
				</button>
			</div>
		</span>
	);
}

function renderSignatureBlock(
	token: DocToken & { kind: "signatureBlock" },
	ti: number,
	props: TokenRendererProps,
) {
	const sid = `sig-${ti}`;
	return (
		<span key={`t-${ti}`} data-token-idx={ti}>
			<EditorSignatureBlock
				token={token}
				tokenId={sid}
				active={props.activeFieldId === sid}
				previewMode={props.previewMode}
				signers={props.signers}
				onFocus={() => props.setActiveFieldId(sid)}
				onUpdate={(p) => props.updateSigBlock(ti, p)}
				onRemove={() => props.removeSigBlock(ti)}
			/>
		</span>
	);
}

// ── Selection helper ──

const INLINE_KINDS = new Set(["text", "field"]);

function isTokenSelected(
	idx: number,
	selection: TokenSelection | null,
): boolean {
	if (!selection) return false;
	const start = Math.min(selection.start, selection.end);
	const end = Math.max(selection.start, selection.end);
	return idx >= start && idx <= end;
}

// ── Inline paragraph collector ──

function collectInlineParagraph(
	props: TokenRendererProps,
	startIdx: number,
): { element: React.ReactNode; nextIdx: number } {
	const inlineChildren: React.ReactNode[] = [];
	let i = startIdx;
	while (i < props.tokens.length && INLINE_KINDS.has(props.tokens[i]!.kind)) {
		const t = props.tokens[i]!;
		const selected = isTokenSelected(i, props.selection);
		const selClass = selected
			? " bg-[var(--accent-10)] ring-1 ring-[var(--accent-30)] rounded-sm"
			: "";

		if (t.kind === "text") {
			const el = renderInlineText(t, i, {
				previewMode: props.previewMode,
				updateTokenText: props.updateTokenText,
				insertTokenAfter: props.insertTokenAfter,
				removeToken: props.removeToken,
			});
			inlineChildren.push(
				selected ? (
					<span key={`sel-${i}`} className={selClass}>
						{el}
					</span>
				) : (
					el
				),
			);
		} else if (t.kind === "field") {
			const el = renderInlineField(t as DocToken & { kind: "field" }, i, props);
			inlineChildren.push(
				selected ? (
					<span key={`sel-${i}`} className={selClass}>
						{el}
					</span>
				) : (
					el
				),
			);
		}
		i++;
	}

	const lastInlineIdx = i - 1;

	return {
		element: (
			<div
				key={`para-${startIdx}`}
				className="group/line relative leading-relaxed"
				style={{ wordBreak: "break-word" }}
			>
				{/* Hover toolbar on left side - only in edit mode */}
				{!props.previewMode && (
					<HoverInsertToolbar
						tokenIdx={lastInlineIdx}
						insertFieldAfterToken={props.insertFieldAfterToken}
						insertTokenAfter={props.insertTokenAfter}
					/>
				)}
				{inlineChildren}
			</div>
		),
		nextIdx: i,
	};
}

// ── Block token rendering ──

function renderBlockToken(
	token: DocToken,
	ti: number,
	props: TokenRendererProps,
): React.ReactNode {
	if (token.kind === "heading") return renderHeading(token, ti, props);
	if (token.kind === "subheading") return renderSubheading(token, ti, props);
	if (token.kind === "listItem") return renderListItem(token, ti, props);
	if (token.kind === "break") {
		return (
			<span key={`t-${ti}`} data-token-idx={ti}>
				<div className="h-3" />
			</span>
		);
	}
	if (token.kind === "signatureBlock")
		return renderSignatureBlock(token, ti, props);
	return null;
}

// ── Main renderer ──

export function renderTokenElements(
	props: TokenRendererProps,
): React.ReactNode[] {
	const elements: React.ReactNode[] = [];
	let i = 0;

	while (i < props.tokens.length) {
		const token = props.tokens[i]!;

		// Add between-block insert line (not before first element)
		if (i > 0 && !props.previewMode) {
			elements.push(
				<BlockInsertLine
					key={`ins-${i}`}
					tokenIdx={i - 1}
					insertFieldAfterToken={props.insertFieldAfterToken}
					insertTokenAfter={props.insertTokenAfter}
				/>,
			);
		}

		if (INLINE_KINDS.has(token.kind)) {
			const { element, nextIdx } = collectInlineParagraph(props, i);
			elements.push(element);
			i = nextIdx;
			continue;
		}

		const block = renderBlockToken(token, i, props);
		if (block) {
			const selected = isTokenSelected(i, props.selection);
			if (selected) {
				elements.push(
					<div
						key={`sel-block-${i}`}
						className="bg-[var(--accent-10)] ring-1 ring-[var(--accent-30)] rounded-sm"
					>
						{block}
					</div>,
				);
			} else {
				elements.push(block);
			}
		}
		i++;
	}
	return elements;
}

// ── Block insert toolbar (bottom of document) ──

export function BlockInsertToolbar({
	tokens,
	activeSigner,
	insertTokenAfter,
}: {
	tokens: DocToken[];
	activeSigner: number;
	insertTokenAfter: (afterIdx: number, token: DocToken) => void;
}) {
	return (
		<div className="flex flex-wrap items-center gap-1 border-t border-dashed border-[var(--border)] pt-4">
			<span className="mr-1 text-[10px] text-muted">Add:</span>
			<W3SButton
				variant="ghost"
				size="xs"
				onClick={() =>
					insertTokenAfter(tokens.length - 1, {
						kind: "text",
						text: "",
					})
				}
			>
				<Pilcrow className="h-3 w-3" /> Paragraph
			</W3SButton>
			<W3SButton
				variant="ghost"
				size="xs"
				onClick={() => {
					const num = tokens.filter((t) => t.kind === "heading").length + 1;
					insertTokenAfter(tokens.length - 1, {
						kind: "heading",
						text: `${num}. NEW SECTION`,
						sectionNum: num,
					});
				}}
			>
				<Heading className="h-3 w-3" /> Heading
			</W3SButton>
			<W3SButton
				variant="ghost"
				size="xs"
				onClick={() =>
					insertTokenAfter(tokens.length - 1, {
						kind: "subheading",
						text: "SUB-HEADING",
					})
				}
			>
				<TypeIcon className="h-3 w-3" /> Sub
			</W3SButton>
			<W3SButton
				variant="ghost"
				size="xs"
				onClick={() =>
					insertTokenAfter(tokens.length - 1, {
						kind: "listItem",
						text: "- ",
					})
				}
			>
				<List className="h-3 w-3" /> Bullet
			</W3SButton>
			<W3SButton
				variant="ghost"
				size="xs"
				onClick={() =>
					insertTokenAfter(tokens.length - 1, {
						kind: "signatureBlock",
						label: "Signature",
						signerIdx: activeSigner,
					})
				}
			>
				<PenTool className="h-3 w-3" /> Signature
			</W3SButton>
			<W3SButton
				variant="ghost"
				size="xs"
				onClick={() => insertTokenAfter(tokens.length - 1, { kind: "break" })}
			>
				<CornerDownLeft className="h-3 w-3" /> Break
			</W3SButton>
		</div>
	);
}
