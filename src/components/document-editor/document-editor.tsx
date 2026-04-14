/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-empty-function -- premium router stubs expose `any` types */
"use client";

import { AnimatePresence, motion } from "framer-motion";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectedIdentity } from "~/components/hooks/use-connected-identity";
import {
	type DocToken,
	type InlineField,
	tokenizeDocument,
} from "~/lib/document/document-tokens";
import {
	EditorHistory,
	type EditorSnapshot,
} from "~/lib/document/editor-history";
import { trpc } from "~/lib/platform/trpc";
import { useEditorStore } from "~/stores/editor";
import { FieldPicker } from "../fields";
import {
	AddFieldIndicator,
	AddSectionModal,
	DragGhost,
	MobileFieldPanel,
} from "./document-editor-overlays";
import { SignersDrawer } from "./document-editor-signers";
import {
	BlockInsertToolbar,
	renderTokenElements,
} from "./document-editor-token-renderer";
import { EditorToolbar } from "./document-editor-toolbar";
import type {
	EditorResult,
	PreviewValueMap,
	SignerDef,
} from "./document-editor-types";
import { useEditorCallbacks } from "./use-editor-callbacks";
import { useEditorClipboard } from "./use-editor-clipboard";
import { useEditorDragDrop } from "./use-editor-drag-drop";
import { useEditorKeyboard } from "./use-editor-keyboard";

const CollabToolbar = dynamic(
	() => import("~/generated/premium/components/collab-toolbar"),
	{
		ssr: false,
		loading: () => null,
	},
);
const CollabAnnotationSidebar = dynamic(
	() => import("~/generated/premium/components/collab-annotations"),
	{
		ssr: false,
		loading: () => null,
	},
);
const CollabAiPanel = dynamic(
	() => import("~/generated/premium/components/collab-ai-panel"),
	{
		ssr: false,
		loading: () => null,
	},
);
const CollabSharePopover = dynamic(
	() => import("~/generated/premium/components/collab-share-popover"),
	{ ssr: false, loading: () => null },
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/consistent-type-imports
) as any as import("react").ComponentType<{
	sessionId: string;
	joinToken: string;
}>;

export type { EditorResult, SignerDef } from "./document-editor-types";

type Props = {
	initialTitle: string;
	initialContent: string;
	initialSigners: SignerDef[];
	onSubmit: (result: EditorResult) => void;
	onSaveTemplate?: (result: EditorResult) => void | Promise<void>;
	onBack: () => void;
	documentId?: string;
};

// ── Main Editor ──

export function DocumentEditor({
	initialTitle,
	initialContent,
	initialSigners,
	onSubmit,
	onSaveTemplate,
	onBack,
	documentId,
}: Props) {
	const [title, setTitle] = useState(initialTitle);
	const [tokens, setTokens] = useState<DocToken[]>(
		() => tokenizeDocument(initialContent, initialSigners.length).tokens,
	);
	const [fields, setFields] = useState<InlineField[]>(
		() => tokenizeDocument(initialContent, initialSigners.length).fields,
	);
	const [previewValues, setPreviewValues] = useState<PreviewValueMap>({});
	const [signers, setSigners] = useState<SignerDef[]>(
		initialSigners.length > 0
			? initialSigners
			: [
					{ label: "Party A", email: "", phone: "", tokenGates: null },
					{ label: "Party B", email: "", phone: "", tokenGates: null },
				],
	);

	const addMode = useEditorStore((s) => s.addMode);
	const setAddMode = useEditorStore((s) => s.setAddMode);
	const activeFieldId = useEditorStore((s) => s.activeFieldId);
	const setActiveFieldId = useEditorStore((s) => s.setActiveFieldId);
	const previewMode = useEditorStore((s) => s.previewMode);
	const setPreviewMode = useEditorStore((s) => s.setPreviewMode);
	const activeSigner = useEditorStore((s) => s.activeSigner);
	const setActiveSigner = useEditorStore((s) => s.setActiveSigner);
	const showPanel = useEditorStore((s) => s.showPanel);
	const togglePanel = useEditorStore((s) => s.togglePanel);
	const showSigners = useEditorStore((s) => s.showSigners);
	const setShowSigners = useEditorStore((s) => s.setShowSigners);
	const mobilePanel = useEditorStore((s) => s.mobilePanel);
	const setMobilePanel = useEditorStore((s) => s.setMobilePanel);
	const fullscreen = useEditorStore((s) => s.fullscreen);
	const setFullscreen = useEditorStore((s) => s.setFullscreen);

	const [showAddSection, setShowAddSection] = useState(false);
	const [newSectionTitle, setNewSectionTitle] = useState("");
	const [newSectionContent, setNewSectionContent] = useState("");
	const fieldCounter = useRef(fields.length);

	// ── Undo/redo (must be before callbacks so pushUndoSnapshot is available) ──
	const historyRef = useRef(new EditorHistory());
	const [canUndo, setCanUndo] = useState(false);
	const [canRedo, setCanRedo] = useState(false);

	const pushUndoSnapshot = useCallback(
		(label?: string) => {
			const snap = {
				title,
				tokens: tokens as unknown[],
				fields: fields as unknown[],
				timestamp: Date.now(),
				label,
			};
			historyRef.current.push(snap);
			setCanUndo(true);
			setCanRedo(false);
		},
		[title, tokens, fields],
	);

	// ── Callbacks (extracted hook) ──
	const cb = useEditorCallbacks({
		tokens,
		setTokens,
		fields,
		setFields,
		previewValues,
		setPreviewValues,
		signers,
		title,
		fieldCounter,
		onBeforeMutate: pushUndoSnapshot,
	});

	// ── Drag & drop (extracted hook) ──
	const drag = useEditorDragDrop(
		fields,
		cb.moveFieldInlineAt,
		cb.moveFieldToIdx,
		cb.insertFieldAfterToken,
		cb.insertFieldInlineAt,
	);

	// ── Clipboard (copy/cut/paste/select) ──
	const clipboard = useEditorClipboard({
		tokens,
		setTokens,
		fields,
		setFields,
		title,
		historyRef,
		setCanUndo,
		setCanRedo,
		fieldCounter,
	});

	// ── Collaboration ──
	const identity = useConnectedIdentity();
	const collabCapabilities = trpc.collab.capabilities.useQuery();
	const collabAvailable = collabCapabilities.data?.available ?? false;
	const [showAnnotations, setShowAnnotations] = useState(false);
	const [showAiPanel, setShowAiPanel] = useState(false);
	const displayName =
		identity.session?.user?.name ??
		identity.wallet?.address?.slice(0, 8) ??
		"Anonymous";
	const autoCollab = trpc.collab.getOrCreateForDocument.useMutation();
	const [collabSessionId, setCollabSessionId] = useState<string | null>(null);
	const autoCollabInitiated = useRef(false);

	useEffect(() => {
		if (
			!collabAvailable ||
			!documentId ||
			!displayName ||
			autoCollabInitiated.current
		)
			return;
		autoCollabInitiated.current = true;
		autoCollab
			.mutateAsync({ documentId, documentTitle: title, displayName })
			.then((res) => setCollabSessionId(res.sessionId))
			.catch(() => {
				autoCollabInitiated.current = false;
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [collabAvailable, documentId, displayName]);

	const collabSessionQuery = trpc.collab.get.useQuery(
		{ sessionId: collabSessionId! },
		{ enabled: !!collabSessionId },
	);
	const collabSession = collabSessionQuery.data;

	// ── Undo/redo handlers ──

	const handleUndo = useCallback(() => {
		const current: EditorSnapshot = {
			title,
			tokens: tokens as unknown[],
			fields: fields as unknown[],
			timestamp: Date.now(),
		};
		const prev = historyRef.current.undo(current);
		if (prev) {
			setTitle(prev.title);
			setTokens(prev.tokens as DocToken[]);
			setFields(prev.fields as InlineField[]);
		}
		setCanUndo(historyRef.current.canUndo);
		setCanRedo(historyRef.current.canRedo);
	}, [title, tokens, fields]);

	const handleRedo = useCallback(() => {
		const current: EditorSnapshot = {
			title,
			tokens: tokens as unknown[],
			fields: fields as unknown[],
			timestamp: Date.now(),
		};
		const next = historyRef.current.redo(current);
		if (next) {
			setTitle(next.title);
			setTokens(next.tokens as DocToken[]);
			setFields(next.fields as InlineField[]);
		}
		setCanUndo(historyRef.current.canUndo);
		setCanRedo(historyRef.current.canRedo);
	}, [title, tokens, fields]);

	const handleEscape = useCallback(() => {
		if (clipboard.hasSelection) {
			clipboard.clearSelection();
			return;
		}
		setAddMode(null);
		setActiveFieldId(null);
	}, [setActiveFieldId, setAddMode, clipboard]);

	useEditorKeyboard({
		fullscreen,
		setFullscreen,
		onUndo: handleUndo,
		onRedo: handleRedo,
		onEscape: handleEscape,
		onCopy: clipboard.copy,
		onCut: clipboard.cut,
		onPaste: clipboard.paste,
		onSelectAll: clipboard.selectAll,
		onDuplicate: clipboard.duplicate,
		onDeleteSelection: clipboard.deleteSelection,
		hasSelection: clipboard.hasSelection,
	});

	const addSigner = useCallback(() => {
		setSigners((p) => [
			...p,
			{
				label: `Party ${String.fromCharCode(65 + p.length)}`,
				email: "",
				phone: "",
				tokenGates: null,
			},
		]);
	}, []);

	const addSection = useCallback(() => {
		if (!newSectionTitle.trim()) return;
		const nt: DocToken[] = [
			{ kind: "break" },
			{
				kind: "heading",
				text: `${tokens.filter((t) => t.kind === "heading").length + 1}. ${newSectionTitle.toUpperCase()}`,
				sectionNum: tokens.filter((t) => t.kind === "heading").length + 1,
			},
			{ kind: "break" },
		];
		if (newSectionContent.trim())
			newSectionContent.split("\n").forEach((l) => {
				if (l.trim()) nt.push({ kind: "text", text: l.trim() });
				else nt.push({ kind: "break" });
			});
		setTokens((p) => [...p, ...nt]);
		setNewSectionTitle("");
		setNewSectionContent("");
		setShowAddSection(false);
	}, [newSectionTitle, newSectionContent, tokens]);

	const handleSignerChange = useCallback(
		<K extends keyof SignerDef>(idx: number, key: K, value: SignerDef[K]) => {
			setSigners((p) =>
				p.map((s, i) => (i === idx ? { ...s, [key]: value } : s)),
			);
		},
		[],
	);

	// ── Memoized document body ──
	const documentPaper = useMemo(
		() => (
			<div
				ref={drag.docContainerRef}
				className="relative rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-sm"
				onDragOver={drag.isDragging ? drag.handleDocDragOver : undefined}
				onDragLeave={
					drag.isDragging ? () => drag.setDropTarget(null) : undefined
				}
				onDrop={drag.isDragging ? drag.handleDocDrop : undefined}
			>
				{drag.isDragging &&
					drag.dropTarget !== null &&
					(drag.dropTarget.vertical ? (
						<div
							className="pointer-events-none absolute z-40 w-0.5 rounded-full bg-[var(--accent)]"
							style={{
								left: `${drag.dropTarget.x}px`,
								top: `${drag.dropTarget.y}px`,
								height: `${drag.dropTarget.h}px`,
								transition: "left 0.06s ease, top 0.06s ease",
							}}
						/>
					) : (
						<div
							className="pointer-events-none absolute left-6 right-6 z-40 h-0.5 rounded-full bg-[var(--accent)]"
							style={{
								top: `${drag.dropTarget.y}px`,
								transition: "top 0.08s ease",
							}}
						/>
					))}
				<div
					className="space-y-1 px-6 py-8 sm:px-12 sm:py-12"
					style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
				>
					{renderTokenElements({
						tokens,
						fields,
						previewMode,
						effectivePreviewValues: cb.effectivePreviewValues,
						activeFieldId,
						addMode,
						showPanel,
						activeSigner,
						signers,
						isDragging: drag.isDragging,
						selection: clipboard.selection,
						getCbs: cb.getCbs,
						insertFieldAfterToken: cb.insertFieldAfterToken,
						insertFieldInlineAt: cb.insertFieldInlineAt,
						insertTokenAfter: cb.insertTokenAfter,
						updateTokenText: cb.updateTokenText,
						removeToken: cb.removeToken,
						moveSection: cb.moveSection,
						removeSection: cb.removeSection,
						updateSigBlock: cb.updateSigBlock,
						removeSigBlock: cb.removeSigBlock,
						setPreviewValue: cb.setPreviewValue,
						applyPreviewAddressSuggestion: cb.applyPreviewAddressSuggestion,
						loadAddressSuggestions: cb.loadAddressSuggestions,
						setActiveFieldId,
						onTokenClick: clipboard.hasSelection ? undefined : undefined,
					})}
					<div data-token-idx={tokens.length} className="h-8" />
					{!previewMode && (
						<BlockInsertToolbar
							tokens={tokens}
							activeSigner={activeSigner}
							insertTokenAfter={cb.insertTokenAfter}
						/>
					)}
				</div>
			</div>
		),
		[
			tokens,
			fields,
			previewMode,
			cb,
			activeFieldId,
			addMode,
			showPanel,
			activeSigner,
			signers,
			drag,
			setActiveFieldId,
		],
	);

	return (
		<div
			className={`flex flex-col ${fullscreen ? "fixed inset-0 z-50 bg-[var(--bg-surface)]" : "h-full"}`}
		>
			<EditorToolbar
				title={title}
				onTitleChange={setTitle}
				fieldCount={fields.length}
				signerCount={signers.length}
				showPanel={showPanel}
				showSigners={showSigners}
				previewMode={previewMode}
				fullscreen={fullscreen}
				canUndo={canUndo}
				canRedo={canRedo}
				collabSessionId={collabSessionId}
				collabSession={collabSession}
				mobilePanel={mobilePanel}
				onBack={onBack}
				togglePanel={togglePanel}
				setMobilePanel={setMobilePanel}
				setShowAddSection={setShowAddSection}
				setShowSigners={setShowSigners}
				handleUndo={handleUndo}
				handleRedo={handleRedo}
				setPreviewMode={setPreviewMode}
				setFullscreen={setFullscreen}
				onSaveTemplate={
					onSaveTemplate
						? () => onSaveTemplate(cb.buildResult(title))
						: undefined
				}
				onSubmit={() => onSubmit(cb.buildResult(title))}
				submitDisabled={!title.trim()}
				CollabSharePopover={CollabSharePopover}
			/>
			<SignersDrawer
				showSigners={showSigners}
				signers={signers}
				fields={fields}
				onAddSigner={addSigner}
				onSignerChange={handleSignerChange}
				onRemoveSigner={(idx) =>
					setSigners((p) => p.filter((_, i) => i !== idx))
				}
			/>
			<div className="flex min-h-0 flex-1">
				<AnimatePresence>
					{showPanel && (
						<motion.div
							initial={{ width: 0, opacity: 0 }}
							animate={{ width: 260, opacity: 1 }}
							exit={{ width: 0, opacity: 0 }}
							transition={{ duration: 0.2 }}
							className="hidden shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--bg-card)] sm:flex"
						>
							<FieldPicker
								onSelect={(id) => setAddMode(id as InlineField["type"])}
								activeType={addMode}
								onClearActive={() => setAddMode(null)}
								onDragNewField={(id) => {
									drag.setDragNewType(id as InlineField["type"]);
									setAddMode(null);
								}}
								onDragEnd={() => {
									drag.setDragNewType(null);
									drag.setDropTarget(null);
								}}
								activeSigner={activeSigner}
								signerCount={signers.length}
								signerLabels={signers.map((s) => s.label)}
								onSignerChange={setActiveSigner}
							/>
						</motion.div>
					)}
				</AnimatePresence>
				<div className="flex-1 overflow-y-auto bg-[var(--bg-surface)]">
					<div
						className={`mx-auto px-4 py-4 sm:px-8 sm:py-6 ${fullscreen ? "max-w-6xl" : "max-w-5xl"}`}
					>
						{documentPaper}
					</div>
				</div>
			</div>
			<MobileFieldPanel
				mobilePanel={mobilePanel}
				addMode={addMode}
				activeSigner={activeSigner}
				signerCount={signers.length}
				signerLabels={signers.map((s) => s.label)}
				setAddMode={setAddMode}
				setDragNewType={drag.setDragNewType}
				setDropTarget={drag.setDropTarget}
				setMobilePanel={setMobilePanel}
				setActiveSigner={setActiveSigner}
			/>
			<AddSectionModal
				show={showAddSection}
				sectionTitle={newSectionTitle}
				sectionContent={newSectionContent}
				onTitleChange={setNewSectionTitle}
				onContentChange={setNewSectionContent}
				onAdd={addSection}
				onClose={() => setShowAddSection(false)}
			/>
			<DragGhost
				isDragging={drag.isDragging}
				ghostPos={drag.ghostPos}
				label={drag.dragGhostLabel}
			/>
			<AddFieldIndicator addMode={addMode} onClear={() => setAddMode(null)} />
			{collabSessionId && collabSession && (
				<>
					<CollabToolbar
						sessionId={collabSessionId}
						sessionTitle={collabSession.session?.title ?? title}
						joinToken={collabSession.session?.joinToken ?? ""}
						isHost={collabSession.myRole === "host"}
						connected={true}
						participants={(collabSession.participants ?? []).map(
							(p: Record<string, unknown>) => ({
								userId: p.userId as string,
								displayName: p.displayName as string,
								color: p.color as string,
								role: p.role as string,
								isActive: Boolean(p.isActive),
							}),
						)}
						remoteUsers={[]}
						onClose={() => setCollabSessionId(null)}
						hasDocument={!!documentId}
					/>
					<CollabAnnotationSidebar
						sessionId={collabSessionId}
						isOpen={showAnnotations}
						onClose={() => setShowAnnotations(false)}
						onNavigate={() => {}}
						currentUserId={
							identity.currentWallet?.address ??
							identity.session?.user?.id ??
							""
						}
						isHost={collabSession.myRole === "host"}
					/>
					<CollabAiPanel
						isOpen={showAiPanel}
						onClose={() => setShowAiPanel(false)}
						sessionId={collabSessionId}
						displayName={displayName}
					/>
				</>
			)}
		</div>
	);
}
