"use client";

import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
	type RefObject,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

// ── pdf.js setup ───────────────────────────────────────────────────────────

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function getPdfjs() {
	if (pdfjsLib) return pdfjsLib;
	const lib = await import("pdfjs-dist");
	lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
	pdfjsLib = lib;
	return lib;
}

// ── Types ──────────────────────────────────────────────────────────────────

export type PdfPageDimensions = {
	pageIndex: number;
	width: number;
	height: number;
	scale: number;
	offsetTop: number;
};

// ── Single page canvas renderer ────────────────────────────────────────────

function PdfPageCanvas({
	page,
	scale,
	onDimensions,
}: {
	page: PDFPageProxy;
	scale: number;
	onDimensions?: (dims: { width: number; height: number }) => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const viewport = page.getViewport({ scale });
		canvas.width = viewport.width;
		canvas.height = viewport.height;
		canvas.style.width = `${viewport.width}px`;
		canvas.style.height = `${viewport.height}px`;

		onDimensions?.({ width: viewport.width, height: viewport.height });

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// Cancel any in-flight render
		renderTaskRef.current?.cancel();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const task = page.render({ canvasContext: ctx, viewport } as any);
		renderTaskRef.current = task;
		task.promise.catch(() => {
			// Cancelled renders throw — ignore
		});

		return () => {
			renderTaskRef.current?.cancel();
		};
	}, [page, scale, onDimensions]);

	return <canvas ref={canvasRef} className="block" />;
}

// ── Hook: load PDF document ────────────────────────────────────────────────

export function usePdfDocument(
	source: ArrayBuffer | Uint8Array | string | null,
) {
	const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const docRef = useRef<PDFDocumentProxy | null>(null);

	useEffect(() => {
		if (!source) {
			setPdfDoc(null);
			return;
		}

		let cancelled = false;
		setLoading(true);
		setError(null);

		void (async () => {
			try {
				const lib = await getPdfjs();
				const data =
					typeof source === "string" ? { url: source } : { data: source };
				const doc = await lib.getDocument(data).promise;
				if (cancelled) {
					doc.destroy();
					return;
				}
				docRef.current?.destroy();
				docRef.current = doc;
				setPdfDoc(doc);
			} catch (err) {
				if (!cancelled) {
					setError(err instanceof Error ? err.message : "Failed to load PDF");
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [source]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			docRef.current?.destroy();
		};
	}, []);

	return { pdfDoc, loading, error };
}

// ── Hook: load pages ───────────────────────────────────────────────────────

export function usePdfPages(pdfDoc: PDFDocumentProxy | null) {
	const [pages, setPages] = useState<PDFPageProxy[]>([]);

	useEffect(() => {
		if (!pdfDoc) {
			setPages([]);
			return;
		}

		let cancelled = false;
		void (async () => {
			const loaded: PDFPageProxy[] = [];
			for (let i = 1; i <= pdfDoc.numPages; i++) {
				if (cancelled) break;
				loaded.push(await pdfDoc.getPage(i));
			}
			if (!cancelled) setPages(loaded);
		})();

		return () => {
			cancelled = true;
		};
	}, [pdfDoc]);

	return pages;
}

// ── Main PDF renderer component ────────────────────────────────────────────

export type PdfRendererProps = {
	source: ArrayBuffer | Uint8Array | string | null;
	/** Scale factor (1.0 = 72dpi native). Default auto-fits container width. */
	scale?: number;
	/** Called when page dimensions are computed (for overlay positioning). */
	onPageDimensions?: (dims: PdfPageDimensions[]) => void;
	/** Ref to the scroll container for overlay positioning. */
	containerRef?: RefObject<HTMLDivElement | null>;
	/** CSS class for the outer wrapper. */
	className?: string;
};

export function PdfRenderer({
	source,
	scale: scaleProp,
	onPageDimensions,
	containerRef: externalContainerRef,
	className,
}: PdfRendererProps) {
	const { pdfDoc, loading, error } = usePdfDocument(source);
	const pages = usePdfPages(pdfDoc);
	const internalContainerRef = useRef<HTMLDivElement>(null);
	const containerRef = externalContainerRef ?? internalContainerRef;
	const [autoScale, setAutoScale] = useState(1.0);
	const [_pageDims, setPageDims] = useState<PdfPageDimensions[]>([]);
	const pageRefs = useRef<Map<number, { width: number; height: number }>>(
		new Map(),
	);

	// Auto-fit scale to container width
	useEffect(() => {
		if (scaleProp || pages.length === 0 || !containerRef.current) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;
			const containerWidth = entry.contentRect.width - 32; // padding
			const firstPage = pages[0];
			if (!firstPage) return;
			const nativeWidth = firstPage.getViewport({ scale: 1.0 }).width;
			setAutoScale(Math.min(containerWidth / nativeWidth, 2.5));
		});

		observer.observe(containerRef.current);
		return () => observer.disconnect();
	}, [pages, scaleProp, containerRef]);

	const scale = scaleProp ?? autoScale;

	// Collect page dimensions for overlay positioning
	const handlePageDimensions = useCallback(
		(pageIndex: number, dims: { width: number; height: number }) => {
			pageRefs.current.set(pageIndex, dims);
			if (pageRefs.current.size === pages.length) {
				const allDims: PdfPageDimensions[] = [];
				let offsetTop = 0;
				for (let i = 0; i < pages.length; i++) {
					const d = pageRefs.current.get(i) ?? {
						width: 0,
						height: 0,
					};
					allDims.push({
						pageIndex: i,
						width: d.width,
						height: d.height,
						scale,
						offsetTop,
					});
					offsetTop += d.height + 12; // 12px gap between pages
				}
				setPageDims(allDims);
				onPageDimensions?.(allDims);
			}
		},
		[pages.length, scale, onPageDimensions],
	);

	if (loading) {
		return (
			<div
				className={`flex items-center justify-center py-20 ${className ?? ""}`}
			>
				<div className="flex flex-col items-center gap-3">
					<div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
					<span className="text-xs text-muted">Loading PDF...</span>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div
				className={`flex items-center justify-center py-20 ${className ?? ""}`}
			>
				<p className="text-sm text-red-400">{error}</p>
			</div>
		);
	}

	if (!pdfDoc || pages.length === 0) return null;

	return (
		<div
			ref={containerRef as RefObject<HTMLDivElement>}
			className={`relative overflow-auto ${className ?? ""}`}
		>
			<div className="mx-auto flex flex-col items-center gap-3 p-4">
				{pages.map((page, idx) => (
					<div key={idx} className="relative shadow-lg" data-pdf-page={idx}>
						<PdfPageCanvas
							page={page}
							scale={scale}
							onDimensions={(dims) => handlePageDimensions(idx, dims)}
						/>
					</div>
				))}
			</div>
		</div>
	);
}
