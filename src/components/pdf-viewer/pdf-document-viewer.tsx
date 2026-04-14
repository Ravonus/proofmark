"use client";

import { ChevronLeft, ChevronRight, Minus, Plus, ZoomIn } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { InlineField } from "~/lib/document/document-tokens";
import {
	autoPlaceFields,
	type FieldPlacement,
	PdfFieldOverlay,
} from "./pdf-field-overlay";
import { type PdfPageDimensions, PdfRenderer } from "./pdf-renderer";

// ── Types ──────────────────────────────────────────────────────────────────

export type PdfDocumentViewerProps = {
	/** PDF source: ArrayBuffer, Uint8Array, or URL string. */
	source: ArrayBuffer | Uint8Array | string | null;
	/** Fields to overlay on the PDF. */
	fields?: InlineField[];
	/** Pre-computed field placements (if not provided, uses auto-placement). */
	fieldPlacements?: FieldPlacement[];
	/** Detected fields from PDF analysis (for auto-placement). */
	detectedFields?: Array<{
		type: string;
		label: string;
		line: number;
		position: number;
	}>;
	/** Total lines in the document content (for auto-placement). */
	totalLines?: number;
	/** Field values. */
	values?: Record<string, string>;
	/** Currently active field ID. */
	activeFieldId?: string | null;
	/** Whether fields are editable. */
	editable?: boolean;
	/** Called when a field is focused. */
	onFieldFocus?: (fieldId: string) => void;
	/** Called when a field value changes. */
	onFieldChange?: (fieldId: string, value: string) => void;
	/** Called when a signature field is clicked. */
	onSignatureClick?: (fieldId: string) => void;
	/** CSS class for the outer wrapper. */
	className?: string;
};

// ── Zoom toolbar ───────────────────────────────────────────────────────────

function ViewerToolbar({
	scale,
	setScale,
	pageCount,
	currentPage,
	scrollToPage,
}: {
	scale: number;
	setScale: (s: number) => void;
	pageCount: number;
	currentPage: number;
	scrollToPage: (page: number) => void;
}) {
	return (
		<div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5">
			<div className="flex items-center gap-1">
				<button
					type="button"
					onClick={() => setScale(Math.max(0.5, scale - 0.25))}
					className="rounded p-1 text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-secondary"
					title="Zoom out"
				>
					<Minus className="h-3.5 w-3.5" />
				</button>
				<span className="min-w-[3rem] text-center text-[10px] text-muted">
					{Math.round(scale * 100)}%
				</span>
				<button
					type="button"
					onClick={() => setScale(Math.min(3, scale + 0.25))}
					className="rounded p-1 text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-secondary"
					title="Zoom in"
				>
					<Plus className="h-3.5 w-3.5" />
				</button>
				<button
					type="button"
					onClick={() => setScale(1.0)}
					className="ml-1 rounded px-1.5 py-0.5 text-[10px] text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-secondary"
					title="Reset zoom"
				>
					<ZoomIn className="h-3 w-3" />
				</button>
			</div>
			{pageCount > 1 && (
				<div className="flex items-center gap-1">
					<button
						type="button"
						onClick={() => scrollToPage(Math.max(0, currentPage - 1))}
						disabled={currentPage <= 0}
						className="rounded p-1 text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-secondary disabled:opacity-30"
					>
						<ChevronLeft className="h-3.5 w-3.5" />
					</button>
					<span className="text-[10px] text-muted">
						{currentPage + 1} / {pageCount}
					</span>
					<button
						type="button"
						onClick={() =>
							scrollToPage(Math.min(pageCount - 1, currentPage + 1))
						}
						disabled={currentPage >= pageCount - 1}
						className="rounded p-1 text-muted transition-colors hover:bg-[var(--bg-hover)] hover:text-secondary disabled:opacity-30"
					>
						<ChevronRight className="h-3.5 w-3.5" />
					</button>
				</div>
			)}
		</div>
	);
}

// ── Main viewer component ──────────────────────────────────────────────────

export function PdfDocumentViewer({
	source,
	fields = [],
	fieldPlacements,
	detectedFields,
	totalLines,
	values = {},
	activeFieldId = null,
	editable = false,
	onFieldFocus,
	onFieldChange,
	onSignatureClick,
	className,
}: PdfDocumentViewerProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [scale, setScale] = useState<number | undefined>(undefined);
	const [pageDimensions, setPageDimensions] = useState<PdfPageDimensions[]>([]);
	const [currentPage, setCurrentPage] = useState(0);

	const handlePageDimensions = useCallback((dims: PdfPageDimensions[]) => {
		setPageDimensions(dims);
	}, []);

	// Compute field placements
	const placements =
		fieldPlacements ??
		(detectedFields && pageDimensions.length > 0
			? autoPlaceFields(
					fields,
					detectedFields,
					totalLines ?? 50,
					pageDimensions.length,
				)
			: []);

	const scrollToPage = useCallback((page: number) => {
		const target = containerRef.current?.querySelector(
			`[data-pdf-page="${page}"]`,
		);
		target?.scrollIntoView({ behavior: "smooth", block: "start" });
		setCurrentPage(page);
	}, []);

	// Track current page from scroll position
	const handleScroll = useCallback(() => {
		if (!containerRef.current) return;
		const pages = containerRef.current.querySelectorAll("[data-pdf-page]");
		const scrollTop = containerRef.current.scrollTop;
		let closest = 0;
		let minDist = Number.POSITIVE_INFINITY;
		pages.forEach((el, idx) => {
			const dist = Math.abs((el as HTMLElement).offsetTop - scrollTop);
			if (dist < minDist) {
				minDist = dist;
				closest = idx;
			}
		});
		setCurrentPage(closest);
	}, []);

	if (!source) return null;

	return (
		<div
			className={`flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] ${className ?? ""}`}
		>
			<ViewerToolbar
				scale={scale ?? 1.0}
				setScale={setScale}
				pageCount={pageDimensions.length}
				currentPage={currentPage}
				scrollToPage={scrollToPage}
			/>
			<div
				className="relative flex-1 overflow-auto"
				ref={containerRef}
				onScroll={handleScroll}
			>
				<PdfRenderer
					source={source}
					scale={scale}
					onPageDimensions={handlePageDimensions}
					containerRef={containerRef}
				/>

				{/* Field overlay layer */}
				{placements.length > 0 && pageDimensions.length > 0 && (
					<div className="absolute inset-0 pointer-events-none">
						<div className="mx-auto flex flex-col items-center gap-3 p-4">
							<PdfFieldOverlay
								fields={fields}
								placements={placements}
								pageDimensions={pageDimensions}
								values={values}
								activeFieldId={activeFieldId}
								editable={editable}
								onFieldFocus={onFieldFocus ?? (() => {})}
								onFieldChange={onFieldChange}
								onSignatureClick={onSignatureClick}
							/>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
