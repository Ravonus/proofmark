"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, PenTool } from "lucide-react";
import { memo } from "react";
import type { InlineField } from "~/lib/document/document-tokens";
import { getSignerColor } from "../fields";
import { getFieldIcon } from "../fields/field-picker";
import type { PdfPageDimensions } from "./pdf-renderer";

// ── Types ──────────────────────────────────────────────────────────────────

export type FieldPlacement = {
	fieldId: string;
	/** 0-based page index. */
	page: number;
	/** X position as fraction of page width (0-1). */
	x: number;
	/** Y position as fraction of page height (0-1). */
	y: number;
	/** Width as fraction of page width. */
	width: number;
	/** Height as fraction of page height. */
	height: number;
};

type OverlayFieldProps = {
	field: InlineField;
	placement: FieldPlacement;
	pageDims: PdfPageDimensions;
	value?: string;
	active: boolean;
	editable: boolean;
	onFocus: () => void;
	onChange?: (value: string) => void;
	onSignatureClick?: () => void;
};

// ── Single field overlay widget ────────────────────────────────────────────

const OverlayField = memo(function OverlayField({
	field,
	placement,
	pageDims,
	value,
	active,
	editable,
	onFocus,
	onChange,
	onSignatureClick,
}: OverlayFieldProps) {
	const sc = getSignerColor(field.signerIdx ?? 0);
	const FieldIcon = getFieldIcon(field.type);
	const filled = !!value;
	const isSignature = field.type === "signature" || field.type === "initials";

	// Convert fractional coords to pixel positions on the rendered page
	const left = placement.x * pageDims.width;
	const top = placement.y * pageDims.height;
	const width = placement.width * pageDims.width;
	const height = placement.height * pageDims.height;

	return (
		<motion.div
			initial={{ opacity: 0, scale: 0.95 }}
			animate={{ opacity: 1, scale: 1 }}
			className={`absolute cursor-pointer transition-shadow ${active ? "z-20" : "z-10"}`}
			style={{
				left: `${left}px`,
				top: `${top}px`,
				width: `${Math.max(width, 80)}px`,
				height: `${Math.max(height, 28)}px`,
			}}
			onClick={onFocus}
		>
			<div
				className={`flex h-full w-full items-center gap-1.5 rounded-md border px-2 transition-all ${sc.border} ${
					active
						? `${sc.bg} ring-2 ring-[var(--accent-30)] shadow-lg`
						: filled
							? "border-green-400/30 bg-green-400/5"
							: `${sc.bg} backdrop-blur-sm hover:shadow-md`
				}`}
			>
				{isSignature ? (
					editable && !filled ? (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onSignatureClick?.();
							}}
							className="flex items-center gap-1.5 text-xs text-emerald-400"
						>
							<PenTool className="h-3.5 w-3.5" />
							<span className="font-medium">Sign here</span>
						</button>
					) : filled ? (
						<div className="flex items-center gap-1">
							<CheckCircle className="h-3 w-3 text-green-400" />
							<span className="text-[10px] text-green-400">Signed</span>
						</div>
					) : (
						<span className="text-[10px] text-muted italic">{field.label}</span>
					)
				) : editable ? (
					<input
						type={
							field.type === "date"
								? "date"
								: field.type === "email"
									? "email"
									: "text"
						}
						value={value ?? ""}
						onChange={(e) => onChange?.(e.target.value)}
						placeholder={field.label}
						className="h-full w-full bg-transparent text-xs outline-none placeholder:text-muted/50"
						onClick={(e) => e.stopPropagation()}
					/>
				) : (
					<span
						className={`text-xs ${filled ? "text-primary" : "italic text-muted/50"}`}
					>
						{value || field.label}
					</span>
				)}

				{filled && !isSignature && (
					<CheckCircle className="h-3 w-3 shrink-0 text-green-400" />
				)}
			</div>

			{/* Label tooltip */}
			{active && (
				<div className="absolute -top-6 left-0 z-30 whitespace-nowrap rounded bg-[var(--bg-card)] px-2 py-0.5 text-[9px] font-medium text-secondary shadow-md">
					<FieldIcon className={`mr-1 inline h-3 w-3 ${sc.text}`} />
					{field.label}
					{field.required && <span className="ml-1 text-red-400">*</span>}
				</div>
			)}
		</motion.div>
	);
});

// ── Full overlay layer ─────────────────────────────────────────────────────

export type PdfFieldOverlayProps = {
	fields: InlineField[];
	placements: FieldPlacement[];
	pageDimensions: PdfPageDimensions[];
	values: Record<string, string>;
	activeFieldId: string | null;
	editable: boolean;
	onFieldFocus: (fieldId: string) => void;
	onFieldChange?: (fieldId: string, value: string) => void;
	onSignatureClick?: (fieldId: string) => void;
};

export function PdfFieldOverlay({
	fields,
	placements,
	pageDimensions,
	values,
	activeFieldId,
	editable,
	onFieldFocus,
	onFieldChange,
	onSignatureClick,
}: PdfFieldOverlayProps) {
	const fieldMap = new Map(fields.map((f) => [f.id, f]));

	return (
		<AnimatePresence>
			{placements.map((placement) => {
				const field = fieldMap.get(placement.fieldId);
				const pageDims = pageDimensions[placement.page];
				if (!field || !pageDims) return null;

				return (
					<div
						key={placement.fieldId}
						className="absolute left-0 top-0 pointer-events-none"
						style={{
							transform: `translateY(${pageDims.offsetTop}px)`,
						}}
						data-overlay-page={placement.page}
					>
						<div className="pointer-events-auto">
							<OverlayField
								field={field}
								placement={placement}
								pageDims={pageDims}
								value={values[placement.fieldId]}
								active={activeFieldId === placement.fieldId}
								editable={editable}
								onFocus={() => onFieldFocus(placement.fieldId)}
								onChange={(v) => onFieldChange?.(placement.fieldId, v)}
								onSignatureClick={() => onSignatureClick?.(placement.fieldId)}
							/>
						</div>
					</div>
				);
			})}
		</AnimatePresence>
	);
}

// ── Auto-placement from detected fields ────────────────────────────────────

/**
 * Generate field placements from detected field positions.
 * Maps line numbers to approximate page/Y positions.
 */
export function autoPlaceFields(
	fields: InlineField[],
	detectedFields: Array<{
		type: string;
		label: string;
		line: number;
		position: number;
	}>,
	totalLines: number,
	pageCount: number,
): FieldPlacement[] {
	const placements: FieldPlacement[] = [];
	const linesPerPage = Math.max(totalLines / pageCount, 1);

	for (const field of fields) {
		// Find matching detected field
		const detected = detectedFields.find(
			(d) => d.type === field.type && d.label === field.label,
		);

		if (detected) {
			const page = Math.min(
				Math.floor((detected.line - 1) / linesPerPage),
				pageCount - 1,
			);
			const lineInPage = detected.line - 1 - page * linesPerPage;
			const y = Math.min((lineInPage / linesPerPage) * 0.9 + 0.05, 0.95);
			const isSignature =
				field.type === "signature" || field.type === "initials";

			placements.push({
				fieldId: field.id,
				page,
				x: 0.55, // Right-aligned for form fields
				y,
				width: isSignature ? 0.35 : 0.3,
				height: isSignature ? 0.04 : 0.025,
			});
		}
	}

	return placements;
}
