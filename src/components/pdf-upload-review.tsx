"use client";

import { AnimatePresence, motion } from "framer-motion";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { FieldType, PdfAnalysisResult } from "~/lib/document/pdf-types";

// ─── Types ──────────────────────────────────────────────────────────────────

export type DetectedFieldInfo = {
	type: string;
	label: string;
	value: string | null;
	required: boolean;
};

export type SignerFormRow = {
	id: string;
	label: string;
	email: string;
	role: string | null;
	enabled: boolean;
	fields: DetectedFieldInfo[];
};

// ─── Field icon/color mapping ─────────────────────────────────────────────────

const FIELD_META: Record<
	FieldType,
	{ icon: string; color: string; label: string }
> = {
	name: { icon: "&#128100;", color: "text-accent", label: "Name" },
	address: { icon: "&#127968;", color: "text-blue-400", label: "Address" },
	date: { icon: "&#128197;", color: "text-orange-400", label: "Date" },
	signature: {
		icon: "&#9999;&#65039;",
		color: "text-success",
		label: "Signature",
	},
	initials: { icon: "&#9997;", color: "text-emerald-400", label: "Initials" },
	wallet: { icon: "&#128279;", color: "text-yellow-400", label: "Wallet" },
	title: { icon: "&#127183;", color: "text-purple-400", label: "Title" },
	email: { icon: "&#9993;", color: "text-cyan-400", label: "Email" },
	company: { icon: "&#127970;", color: "text-amber-400", label: "Company" },
	phone: { icon: "&#128222;", color: "text-teal-400", label: "Phone" },
	witness: { icon: "&#128065;", color: "text-indigo-400", label: "Witness" },
	notary: { icon: "&#128220;", color: "text-rose-400", label: "Notary" },
	amount: { icon: "&#128178;", color: "text-lime-400", label: "Amount" },
	reference: { icon: "&#128209;", color: "text-slate-400", label: "Reference" },
	checkbox: { icon: "&#9745;", color: "text-sky-400", label: "Checkbox" },
	other: { icon: "&#128196;", color: "text-muted", label: "Field" },
};

// ─── Signer color palette ────────────────────────────────────────────────────

const SIGNER_HUES = [210, 150, 30, 280, 0, 180, 60, 330, 100, 240];
const SIGNER_ICONS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

function signerColor(idx: number, opacity = 1): string {
	const hue = SIGNER_HUES[idx % SIGNER_HUES.length]!;
	return `hsla(${hue}, 70%, 60%, ${opacity})`;
}

function signerBg(idx: number, opacity = 0.12): string {
	const hue = SIGNER_HUES[idx % SIGNER_HUES.length]!;
	return `hsla(${hue}, 70%, 60%, ${opacity})`;
}

// ─── Signer badge (colored circle with letter) ──────────────────────────────

function SignerBadge({ idx, size = 16 }: { idx: number; size?: number }) {
	return (
		<span
			className="inline-flex shrink-0 items-center justify-center rounded-full font-bold"
			style={{
				width: size,
				height: size,
				fontSize: size * 0.55,
				background: signerColor(idx),
				color: "#111",
			}}
		>
			{SIGNER_ICONS[idx % SIGNER_ICONS.length]}
		</span>
	);
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({
	icon,
	label,
	value,
}: {
	icon: string;
	label: string;
	value: number;
}) {
	return (
		<div className="bg-surface/50 space-y-1 rounded-lg p-3 text-center">
			<div className="text-lg" dangerouslySetInnerHTML={{ __html: icon }} />
			<div className="text-sm font-semibold">{value}</div>
			<div className="text-[10px] text-muted">{label}</div>
		</div>
	);
}

// ─── Analysis display ────────────────────────────────────────────────────────

// ─── Section kind display ───────────────────────────────────────────────────

const SECTION_ICONS: Record<string, string> = {
	preamble: "&#128220;",
	recitals: "&#128214;",
	definitions: "&#128209;",
	parties: "&#128101;",
	term: "&#128197;",
	payment: "&#128178;",
	obligations: "&#128203;",
	confidentiality: "&#128274;",
	"intellectual-property": "&#128161;",
	representations: "&#9989;",
	indemnification: "&#128737;",
	termination: "&#128683;",
	"governing-law": "&#9878;",
	miscellaneous: "&#128221;",
	clause: "&#128196;",
	signatures: "&#9999;",
};

// ─── Analysis display ────────────────────────────────────────────────────────

const AnalysisSummary = memo(function AnalysisSummary({
	analysis,
}: {
	analysis: PdfAnalysisResult;
}) {
	const blankFields = analysis.detectedFields.filter((f) => f.blank);
	const sections = analysis.sections ?? [];
	const walkthrough = analysis.walkthrough ?? [];
	const acroformFields = analysis.acroformFields ?? [];
	const isFilled = analysis.isFilled ?? false;
	const blankCount = analysis.blankFieldCount ?? blankFields.length;
	const filledCount = analysis.filledFieldCount ?? 0;

	return (
		<div className="space-y-4">
			{/* Main stats card */}
			<div className="glass-card space-y-4 rounded-2xl p-5">
				<div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
					<div>
						<h2 className="text-lg font-semibold">Document Analysis</h2>
						<p className="mt-0.5 text-xs text-muted">
							{isFilled
								? "This document has been filled out — you can create a blank template from it"
								: "Every input field, signature spot, and party detected"}
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{analysis.documentType && (
							<span className="bg-accent/15 border-accent/20 rounded-full border px-2.5 py-0.5 text-[10px] font-medium text-accent">
								{analysis.documentType}
							</span>
						)}
						<span className="rounded-full border border-border bg-surface-hover px-2.5 py-0.5 text-[10px] text-muted">
							{analysis.pageCount} page{analysis.pageCount !== 1 ? "s" : ""}
						</span>
						{isFilled && (
							<span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-400">
								Pre-filled
							</span>
						)}
					</div>
				</div>

				{/* Field stats */}
				<div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
					<StatCard
						icon="&#9999;&#65039;"
						label="Signatures"
						value={blankFields.filter((f) => f.type === "signature").length}
					/>
					<StatCard
						icon="&#9997;"
						label="Initials"
						value={blankFields.filter((f) => f.type === "initials").length}
					/>
					<StatCard
						icon="&#128100;"
						label="Names"
						value={blankFields.filter((f) => f.type === "name").length}
					/>
					<StatCard
						icon="&#128197;"
						label="Dates"
						value={blankFields.filter((f) => f.type === "date").length}
					/>
					<StatCard
						icon="&#128279;"
						label="Wallets"
						value={analysis.detectedAddresses.length}
					/>
				</div>

				{/* Filled vs blank indicator */}
				{(filledCount > 0 || blankCount > 0) && (
					<div className="flex items-center gap-3 rounded-lg bg-surface/50 px-3 py-2">
						<div className="flex-1">
							<div className="mb-1 flex justify-between text-[10px]">
								<span className="text-muted">{blankCount} blank</span>
								<span className="text-muted">{filledCount} filled</span>
							</div>
							<div className="h-1.5 overflow-hidden rounded-full bg-border/50">
								<div
									className="h-full rounded-full bg-emerald-400/60 transition-all"
									style={{
										width: `${filledCount + blankCount > 0 ? (filledCount / (filledCount + blankCount)) * 100 : 0}%`,
									}}
								/>
							</div>
						</div>
					</div>
				)}

				{/* AcroForm detection */}
				{acroformFields.length > 0 && (
					<div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs text-blue-400">
						<span dangerouslySetInnerHTML={{ __html: "&#128203;" }} />
						<span>
							{acroformFields.length} interactive form field
							{acroformFields.length !== 1 ? "s" : ""} detected (PDF AcroForm)
						</span>
					</div>
				)}
			</div>

			{/* Document structure */}
			{sections.length > 0 && (
				<div className="glass-card space-y-3 rounded-2xl p-5">
					<h3 className="text-sm font-medium text-secondary">
						Document Structure
					</h3>
					<div className="flex flex-wrap gap-1.5">
						{sections.map((s, idx) => (
							<span
								key={idx}
								className="inline-flex items-center gap-1 rounded-lg border border-border bg-surface/50 px-2.5 py-1 text-[11px] text-secondary transition-colors hover:bg-surface-hover"
							>
								<span
									dangerouslySetInnerHTML={{
										__html: SECTION_ICONS[s.kind] ?? "&#128196;",
									}}
									className="text-xs"
								/>
								{s.title}
							</span>
						))}
					</div>
				</div>
			)}

			{/* Walkthrough preview */}
			{walkthrough.length > 0 && (
				<div className="glass-card space-y-3 rounded-2xl p-5">
					<div className="flex items-center justify-between">
						<h3 className="text-sm font-medium text-secondary">
							Signing Walkthrough
						</h3>
						<span className="text-[10px] text-muted">
							{walkthrough.length} steps
						</span>
					</div>
					<div className="space-y-1.5">
						{walkthrough.map((step) => (
							<div key={step.step} className="flex items-start gap-2.5">
								<span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">
									{step.step}
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-xs font-medium text-secondary">
										{step.title}
									</p>
									<p className="text-[10px] text-muted">{step.description}</p>
								</div>
								{step.required && (
									<span className="shrink-0 rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-400">
										Required
									</span>
								)}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
});

// ─── Owned field chip (clickable, shows signer color, reassignable) ─────────

const OwnedFieldChip = memo(function OwnedFieldChip({
	field,
	fieldIdx,
	ownerIdx,
	getSigners,
	onReassignField,
}: {
	field: DetectedFieldInfo;
	fieldIdx: number;
	ownerIdx: number;
	getSigners: () => SignerFormRow[];
	onReassignField: (fromIdx: number, fieldIdx: number, toIdx: number) => void;
}) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLSpanElement>(null);
	const meta = FIELD_META[field.type as FieldType] ?? FIELD_META.other;

	// Close dropdown when clicking outside or pressing Escape
	useEffect(() => {
		if (!open) return;
		const onClickOutside = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node))
				setOpen(false);
		};
		const onEscape = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onClickOutside);
		document.addEventListener("keydown", onEscape);
		return () => {
			document.removeEventListener("mousedown", onClickOutside);
			document.removeEventListener("keydown", onEscape);
		};
	}, [open]);

	// Only read signers when the dropdown is actually open
	const currentSigners = open ? getSigners() : null;

	return (
		<span className="relative" ref={ref}>
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					setOpen(!open);
				}}
				className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] transition-all hover:brightness-125"
				style={{
					borderColor: signerColor(ownerIdx, 0.25),
					background: signerBg(ownerIdx, 0.1),
					color: signerColor(ownerIdx),
				}}
				title="Click to reassign"
			>
				<SignerBadge idx={ownerIdx} size={12} />
				<span dangerouslySetInnerHTML={{ __html: meta.icon }} />
				{field.label}
				{field.required && <span className="ml-0.5 text-red-400">*</span>}
			</button>

			<AnimatePresence>
				{open && currentSigners && (
					<motion.div
						initial={{ opacity: 0, y: -4, scale: 0.95 }}
						animate={{ opacity: 1, y: 0, scale: 1 }}
						exit={{ opacity: 0, y: -4, scale: 0.95 }}
						transition={{ duration: 0.12 }}
						className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-surface-card p-1 shadow-xl"
						onClick={(e) => e.stopPropagation()}
					>
						<p className="px-2 py-1 text-[9px] font-medium uppercase tracking-wider text-muted">
							Assign to:
						</p>
						{currentSigners.map((s, i) => (
							<button
								key={s.id}
								type="button"
								className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors ${
									i === ownerIdx ? "bg-white/5 font-medium" : "hover:bg-white/5"
								}`}
								onClick={(e) => {
									e.stopPropagation();
									if (i !== ownerIdx) onReassignField(ownerIdx, fieldIdx, i);
									setOpen(false);
								}}
							>
								<SignerBadge idx={i} size={14} />
								<span style={{ color: signerColor(i) }}>
									{s.label || s.role || `Signer ${i + 1}`}
								</span>
								{i === ownerIdx && (
									<span className="ml-auto text-[9px] text-muted">
										(current)
									</span>
								)}
							</button>
						))}
					</motion.div>
				)}
			</AnimatePresence>
		</span>
	);
});

// ─── Individual signer card ─────────────────────────────────────────────────

const SignerCard = memo(function SignerCard({
	idx,
	signer,
	getSigners,
	canRemove,
	onUpdate,
	onRemove,
	onReassignField,
}: {
	idx: number;
	signer: SignerFormRow;
	getSigners: () => SignerFormRow[];
	canRemove: boolean;
	onUpdate: (idx: number, updates: Partial<SignerFormRow>) => void;
	onRemove: (idx: number) => void;
	onReassignField: (fromIdx: number, fieldIdx: number, toIdx: number) => void;
}) {
	const labelRef = useRef(signer.label);
	const emailRef = useRef(signer.email);

	const handleLabelBlur = useCallback(
		(e: React.FocusEvent<HTMLInputElement>) => {
			const v = e.target.value;
			if (v !== labelRef.current) {
				labelRef.current = v;
				onUpdate(idx, { label: v });
			}
		},
		[idx, onUpdate],
	);

	const handleEmailBlur = useCallback(
		(e: React.FocusEvent<HTMLInputElement>) => {
			const v = e.target.value;
			if (v !== emailRef.current) {
				emailRef.current = v;
				onUpdate(idx, { email: v });
			}
		},
		[idx, onUpdate],
	);

	const handleToggle = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			onUpdate(idx, { enabled: e.target.checked });
		},
		[idx, onUpdate],
	);

	const handleRemove = useCallback(() => {
		onRemove(idx);
	}, [idx, onRemove]);

	return (
		<div
			className={`space-y-3 rounded-xl border border-l-[3px] p-4 transition-colors ${
				signer.enabled
					? "bg-surface/50 border-border"
					: "bg-surface/20 border-border/50 opacity-50"
			}`}
			style={{ borderLeftColor: signerColor(idx) }}
		>
			<div className="flex items-center justify-between">
				<div className="flex flex-wrap items-center gap-2">
					<SignerBadge idx={idx} />
					<span
						className="text-xs font-medium"
						style={{ color: signerColor(idx) }}
					>
						Signer {idx + 1}
					</span>
					{signer.role && (
						<span
							className="rounded-full border px-2 py-0.5 text-[10px]"
							style={{
								borderColor: signerColor(idx, 0.2),
								background: signerBg(idx, 0.08),
								color: signerColor(idx),
							}}
						>
							{signer.role}
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted">
						<input
							type="checkbox"
							checked={signer.enabled}
							onChange={handleToggle}
							className="rounded accent-accent"
						/>
						Include
					</label>
					{canRemove && (
						<button
							className="rounded-lg bg-red-500/15 px-2 py-1 text-xs text-red-400 transition-colors hover:bg-red-500/25"
							onClick={handleRemove}
						>
							Remove
						</button>
					)}
				</div>
			</div>
			<input
				defaultValue={labelRef.current}
				onBlur={handleLabelBlur}
				placeholder="Name / Company / Pseudonym"
				className="bg-surface-card/60 w-full rounded-lg px-3 py-2 text-sm outline-none ring-1 ring-border transition-all focus:ring-accent"
			/>
			<input
				defaultValue={emailRef.current}
				onBlur={handleEmailBlur}
				placeholder="Email (optional — sends signing invite)"
				className="bg-surface-card/60 w-full rounded-lg px-3 py-2 text-sm text-secondary outline-none ring-1 ring-border transition-all focus:ring-accent"
			/>
			{signer.fields.length > 0 && (
				<div className="pt-1">
					<p className="mb-1.5 text-[10px] text-muted">
						Fields to fill when signing:
					</p>
					<div className="flex flex-wrap gap-1.5">
						{signer.fields.map((f, fi) => (
							<OwnedFieldChip
								key={fi}
								field={f}
								fieldIdx={fi}
								ownerIdx={idx}
								getSigners={getSigners}
								onReassignField={onReassignField}
							/>
						))}
					</div>
				</div>
			)}
		</div>
	);
});

// ─── Review form ────────────────────────────────────────────────────────────

export function PdfReview({
	analysis,
	initialTitle,
	initialSigners,
	onSubmit,
	onDifferentPdf,
	onCancel,
}: {
	analysis: PdfAnalysisResult;
	initialTitle: string;
	initialSigners: SignerFormRow[];
	onSubmit: (title: string, signers: SignerFormRow[]) => void;
	onDifferentPdf: () => void;
	onCancel: () => void;
}) {
	const titleRef = useRef(initialTitle);
	const [signers, setSigners] = useState(initialSigners);
	const validCount = signers.filter((s) => s.enabled && s.label.trim()).length;

	// Stable ref so memoized children can read current signers without re-rendering
	const signersRef = useRef(signers);
	signersRef.current = signers;
	const getSigners = useCallback(() => signersRef.current, []);

	// Stable callbacks — functional updates don't depend on outer state
	const updateSigner = useCallback(
		(idx: number, updates: Partial<SignerFormRow>) => {
			setSigners((prev) =>
				prev.map((s, i) => (i === idx ? { ...s, ...updates } : s)),
			);
		},
		[],
	);

	const removeSigner = useCallback((idx: number) => {
		setSigners((prev) => prev.filter((_, i) => i !== idx));
	}, []);

	const addSigner = useCallback(() => {
		setSigners((prev) => [
			...prev,
			{
				id: `signer-${Date.now()}`,
				label: "",
				email: "",
				role: null,
				enabled: true,
				fields: [],
			},
		]);
	}, []);

	const reassignField = useCallback(
		(fromSignerIdx: number, fieldIdx: number, toSignerIdx: number) => {
			setSigners((prev) => {
				const next = prev.map((s) => ({ ...s, fields: [...s.fields] }));
				const [field] = next[fromSignerIdx]!.fields.splice(fieldIdx, 1);
				if (field) next[toSignerIdx]!.fields.push(field);
				return next;
			});
		},
		[],
	);

	return (
		<div className="space-y-6">
			<AnalysisSummary analysis={analysis} />

			{/* Signer legend */}
			{signers.length > 1 && (
				<div className="glass-card rounded-2xl p-4">
					<p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted">
						Signer Colors
					</p>
					<div className="flex flex-wrap gap-2">
						{signers.map((s, idx) => (
							<span
								key={s.id}
								className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium"
								style={{
									borderColor: signerColor(idx, 0.3),
									background: signerBg(idx, 0.08),
									color: signerColor(idx),
								}}
							>
								<SignerBadge idx={idx} size={14} />
								{s.label || s.role || `Signer ${idx + 1}`}
							</span>
						))}
					</div>
				</div>
			)}

			{/* Title */}
			<div className="glass-card space-y-3 rounded-2xl p-5">
				<label className="text-sm font-medium text-secondary">
					Document Title
				</label>
				<input
					defaultValue={titleRef.current}
					onChange={(e) => {
						titleRef.current = e.target.value;
					}}
					className="bg-surface/50 w-full rounded-lg px-4 py-2.5 text-sm outline-none ring-1 ring-border transition-all focus:ring-accent"
				/>
			</div>

			{/* Signers */}
			<div className="glass-card space-y-4 rounded-2xl p-5">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-medium text-secondary">
						Signers{" "}
						<span className="ml-2 text-[10px] font-normal text-muted">
							({analysis.detectedSigners.length} detected)
						</span>
					</h3>
					<button
						className="rounded-lg bg-surface-hover px-3 py-1.5 text-xs text-secondary transition-colors hover:text-primary"
						onClick={addSigner}
					>
						+ Add Signer
					</button>
				</div>
				<div className="space-y-3">
					{signers.map((signer, idx) => (
						<SignerCard
							key={signer.id}
							idx={idx}
							signer={signer}
							getSigners={getSigners}
							canRemove={signers.length > 1}
							onUpdate={updateSigner}
							onRemove={removeSigner}
							onReassignField={reassignField}
						/>
					))}
				</div>
			</div>

			{/* Signature blocks (compact) */}
			{analysis.signatureBlocks.length > 0 && (
				<div className="glass-card space-y-3 rounded-2xl p-5">
					<h3 className="text-sm font-medium text-secondary">
						Signature Blocks ({analysis.signatureBlocks.length})
					</h3>
					<div className="space-y-2">
						{analysis.signatureBlocks.map((block, idx) => (
							<div
								key={idx}
								className="bg-surface/50 flex items-center justify-between rounded-xl border border-border p-3"
							>
								<span className="text-sm font-medium">{block.partyLabel}</span>
								<span className="bg-accent/15 border-accent/20 rounded-full border px-2 py-0.5 text-[10px] text-accent">
									Line {block.line}
								</span>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Actions */}
			<div className="flex flex-col gap-3 sm:flex-row">
				<button
					className="flex-1 rounded-xl bg-accent py-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
					onClick={() => onSubmit(titleRef.current, signers)}
					disabled={validCount === 0}
				>
					Create Document with {validCount} Signer{validCount !== 1 ? "s" : ""}
				</button>
				<button
					className="rounded-xl bg-surface-hover px-4 py-3 text-sm text-secondary transition-colors hover:text-primary"
					onClick={onDifferentPdf}
				>
					Different PDF
				</button>
				<button
					className="hover:bg-surface-hover/50 rounded-xl px-4 py-3 text-sm text-muted transition-colors hover:text-secondary"
					onClick={onCancel}
				>
					Cancel
				</button>
			</div>
		</div>
	);
}
