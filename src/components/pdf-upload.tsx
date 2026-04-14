"use client";

import { motion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import type { PdfAnalysisResult } from "~/lib/document/pdf-types";
import {
	type DetectedFieldInfo,
	PdfReview,
	type SignerFormRow,
} from "./pdf-upload-review";
import { AnimatedButton, FadeIn, GlassCard, ScaleIn } from "./ui/motion";

// TODO: re-integrate AI scraper review (AiScraperReview from ~/components/ai/ai-scraper-review) for premium build

// ─── Result type for the parent ─────────────────────────────────────────────

type SignerFieldLike = { type: string; label: string; value: string | null };

type PdfUploadResult = {
	title: string;
	content: string;
	signers: Array<{ label: string; email: string; fields?: SignerFieldLike[] }>;
	/** Original PDF bytes for the viewer (base64 encoded). */
	pdfBase64?: string;
	/** Detected fields with line positions for overlay placement. */
	detectedFields?: Array<{
		type: string;
		label: string;
		line: number;
		position: number;
		blank: boolean;
	}>;
	/** Page count from analysis. */
	pageCount?: number;
};

type Props = {
	onComplete: (result: PdfUploadResult) => void;
	onCancel: () => void;
};

type Step = "upload" | "analyzing" | "review" | "error";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toDetectedFieldInfo(f: {
	type: string;
	label: string;
	value: string | null;
}): DetectedFieldInfo {
	return {
		type: f.type,
		label: f.label,
		value: f.value,
		required: false, // Users can toggle required in the editor
	};
}

/** Build editable signer rows from analysis result. */
function buildSignerFormRows(result: PdfAnalysisResult): SignerFormRow[] {
	const signers: SignerFormRow[] = result.detectedSigners.map((s, idx) => ({
		id: `signer-${idx}`,
		label: s.label,
		email: "",
		role: s.role,
		enabled: true,
		fields: (s.fields ?? []).filter((f) => f.blank).map(toDetectedFieldInfo),
	}));

	if (signers.length > 0) return signers;

	// No signers detected — create placeholder slots with general blank fields
	const count = result.suggestedSignerCount || 2;
	const generalFields = result.detectedFields
		.filter((f) => f.blank && !f.partyRole)
		.map(toDetectedFieldInfo);
	const perSigner =
		generalFields.length > 0 ? Math.ceil(generalFields.length / count) : 0;

	for (let i = 0; i < count; i++) {
		signers.push({
			id: `signer-${i}`,
			label: "",
			email: "",
			role: null,
			enabled: true,
			fields: generalFields.slice(i * perSigner, (i + 1) * perSigner),
		});
	}
	return signers;
}

/** Embed detected fields into the content at their detected line positions. */
function embedDetectedFields(
	analysis: PdfAnalysisResult,
	enabledSigners: Array<{ label: string; fields?: SignerFieldLike[] }>,
): string {
	const lines = analysis.content.split("\n");
	const fieldsByLine = new Map<
		number,
		Array<{ type: string; label: string; signerIdx: number }>
	>();
	let fieldCounter = 0;

	// Collect all fields from signers with their detected line positions
	for (let si = 0; si < enabledSigners.length; si++) {
		const signer = enabledSigners[si];
		if (!signer?.fields) continue;
		for (const f of signer.fields) {
			// Find the matching detected field to get line position
			const detected = analysis.detectedFields.find(
				(d) => d.type === f.type && d.label === f.label && d.blank,
			);
			if (detected && detected.line > 0 && detected.line <= lines.length) {
				const lineIdx = detected.line - 1; // Convert to 0-based
				if (!fieldsByLine.has(lineIdx)) fieldsByLine.set(lineIdx, []);
				fieldsByLine
					.get(lineIdx)!
					.push({ type: f.type, label: f.label, signerIdx: si });
			}
		}
	}

	// Rebuild content with field markers inserted at appropriate lines
	const result: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		result.push(lines[i]!);
		const fieldsHere = fieldsByLine.get(i);
		if (fieldsHere) {
			for (const f of fieldsHere) {
				const id = `field-${fieldCounter++}`;
				const payload = encodeURIComponent(
					JSON.stringify({
						id,
						type: f.type,
						label: f.label,
						signerIdx: f.signerIdx,
						required: false,
					}),
				);
				if (f.type === "signature") {
					result.push(
						`{{W3S_SIGNATURE:${encodeURIComponent(JSON.stringify({ label: f.label, signerIdx: f.signerIdx }))}}}`,
					);
				} else {
					result.push(`{{W3S_FIELD:${payload}}}`);
				}
			}
		}
	}

	return result.join("\n");
}

/** Upload a PDF and parse the response, returning the analysis result. */
async function uploadAndParsePdf(
	file: File,
	signal: AbortSignal,
): Promise<PdfAnalysisResult> {
	const formData = new FormData();
	formData.append("file", file);

	const res = await fetch("/api/upload-pdf", {
		method: "POST",
		body: formData,
		signal,
	});

	const contentType = res.headers.get("content-type") || "";
	if (!contentType.includes("application/json")) {
		throw new Error("Server error — please try again.");
	}

	const data = (await res.json()) as PdfAnalysisResult & { error?: string };
	if (!res.ok) throw new Error(data.error ?? "Upload failed");
	return data;
}

// ─── Step sub-components ──────────────────────────────────────────────────────

function UploadStep({
	onFile,
	onCancel,
}: {
	onFile: (file: File) => void;
	onCancel: () => void;
}) {
	const [dragging, setDragging] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			setDragging(false);
			const file = e.dataTransfer.files[0];
			if (file) onFile(file);
		},
		[onFile],
	);

	return (
		<FadeIn>
			<div className="space-y-4">
				<motion.div
					className={`glass-card relative cursor-pointer rounded-2xl border-2 border-dashed p-12 text-center transition-colors ${
						dragging
							? "bg-accent/5 border-accent"
							: "hover:border-accent/40 border-border"
					}`}
					onDragOver={(e) => {
						e.preventDefault();
						setDragging(true);
					}}
					onDragLeave={() => setDragging(false)}
					onDrop={handleDrop}
					onClick={() => fileRef.current?.click()}
					whileHover={{ scale: 1.005 }}
					whileTap={{ scale: 0.995 }}
				>
					<input
						ref={fileRef}
						type="file"
						accept=".pdf,application/pdf"
						onChange={(e) => {
							const f = e.target.files?.[0];
							if (f) onFile(f);
						}}
						className="hidden"
					/>
					<motion.div
						className="mb-4 text-5xl opacity-40"
						animate={dragging ? { scale: 1.2, y: -4 } : { scale: 1, y: 0 }}
						transition={{ type: "spring", stiffness: 300, damping: 20 }}
						dangerouslySetInnerHTML={{ __html: "&#128196;" }}
					/>
					<p className="text-sm font-medium text-secondary">
						{dragging
							? "Drop your PDF here"
							: "Drag & drop a PDF or click to browse"}
					</p>
					<p className="mt-2 text-xs text-muted">
						We&apos;ll detect every field, signature spot, address, and signer
						automatically. Upload size is capped by your server configuration.
					</p>
				</motion.div>
				<AnimatedButton
					variant="ghost"
					className="px-3 py-1.5 text-xs"
					onClick={onCancel}
				>
					&larr; Back to templates
				</AnimatedButton>
			</div>
		</FadeIn>
	);
}

function AnalyzingStep({ fileName }: { fileName: string | null }) {
	return (
		<FadeIn>
			<GlassCard className="space-y-4 p-8 text-center">
				<motion.div
					className="border-accent/30 inline-block h-8 w-8 rounded-full border-2 border-t-accent"
					animate={{ rotate: 360 }}
					transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
				/>
				<div>
					<p className="font-medium text-secondary">
						Analyzing document structure...
					</p>
					{fileName && (
						<p className="mt-1 font-mono text-xs text-muted">{fileName}</p>
					)}
				</div>
				<div className="flex flex-wrap justify-center gap-3 text-xs text-muted">
					{[
						"Extracting text...",
						"Detecting fields...",
						"Finding signatures...",
						"Mapping parties...",
					].map((msg, i) => (
						<motion.span
							key={msg}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={{ delay: i * 0.6 }}
						>
							{msg}
						</motion.span>
					))}
				</div>
			</GlassCard>
		</FadeIn>
	);
}

function ErrorStep({
	error,
	onRetry,
	onCancel,
}: {
	error: string | null;
	onRetry: () => void;
	onCancel: () => void;
}) {
	return (
		<ScaleIn>
			<GlassCard className="space-y-4 p-8 text-center">
				<div
					className="text-4xl"
					dangerouslySetInnerHTML={{ __html: "&#9888;&#65039;" }}
				/>
				<p className="font-medium text-red-400">{error}</p>
				<div className="flex justify-center gap-3">
					<AnimatedButton
						variant="secondary"
						className="px-4 py-2"
						onClick={onRetry}
					>
						Try Again
					</AnimatedButton>
					<AnimatedButton
						variant="ghost"
						className="px-4 py-2"
						onClick={onCancel}
					>
						Back to Templates
					</AnimatedButton>
				</div>
			</GlassCard>
		</ScaleIn>
	);
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PdfUpload({ onComplete, onCancel }: Props) {
	const [step, setStep] = useState<Step>("upload");
	const [analysis, setAnalysis] = useState<PdfAnalysisResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [fileName, setFileName] = useState<string | null>(null);

	// Review state
	const [reviewTitle, setReviewTitle] = useState("");
	const [signerData, setSignerData] = useState<SignerFormRow[]>([]);

	const abortRef = useRef<AbortController | null>(null);
	const pdfBytesRef = useRef<string | null>(null);

	const handleFile = useCallback(async (file: File) => {
		if (!file.type.includes("pdf")) {
			setError("Please upload a PDF file");
			setStep("error");
			return;
		}

		abortRef.current?.abort();
		const controller = new AbortController();
		abortRef.current = controller;
		const timeout = setTimeout(() => controller.abort(), 30_000);

		setFileName(file.name);
		setStep("analyzing");
		setError(null);

		// Capture PDF bytes for the viewer
		try {
			const arrayBuf = await file.arrayBuffer();
			const bytes = new Uint8Array(arrayBuf);
			let binary = "";
			for (let i = 0; i < bytes.length; i++)
				binary += String.fromCharCode(bytes[i]!);
			pdfBytesRef.current = btoa(binary);
		} catch {
			pdfBytesRef.current = null;
		}

		try {
			const result = await uploadAndParsePdf(file, controller.signal);
			clearTimeout(timeout);
			setAnalysis(result);
			setReviewTitle(result.title);
			setSignerData(buildSignerFormRows(result));
			setStep("review");
		} catch (err) {
			clearTimeout(timeout);
			if (err instanceof DOMException && err.name === "AbortError") {
				setError("Analysis took too long — try a smaller or simpler PDF.");
			} else {
				setError(err instanceof Error ? err.message : "Upload failed");
			}
			setStep("error");
		}
	}, []);

	if (step === "upload") {
		return (
			<UploadStep onFile={(f) => void handleFile(f)} onCancel={onCancel} />
		);
	}

	if (step === "analyzing") {
		return <AnalyzingStep fileName={fileName} />;
	}

	if (step === "error") {
		return (
			<ErrorStep
				error={error}
				onRetry={() => {
					setStep("upload");
					setError(null);
				}}
				onCancel={onCancel}
			/>
		);
	}

	if (!analysis) return null;

	return (
		<PdfReview
			analysis={analysis}
			initialTitle={reviewTitle}
			initialSigners={signerData}
			onSubmit={(title, signers) => {
				const enabled = signers
					.filter((s) => s.enabled && s.label.trim())
					.map((s) => ({
						label: s.label.trim(),
						email: s.email.trim(),
						fields: s.fields.length > 0 ? s.fields : undefined,
					}));
				if (enabled.length === 0) return;

				// Enrich content with detected fields placed at their line positions
				const enrichedContent = embedDetectedFields(analysis, enabled);

				onComplete({
					title: title.trim() || "Uploaded Document",
					content: enrichedContent,
					signers: enabled,
					pdfBase64: pdfBytesRef.current ?? undefined,
					detectedFields: analysis.detectedFields.map((f) => ({
						type: f.type,
						label: f.label,
						line: f.line,
						position: f.position,
						blank: f.blank,
					})),
					pageCount: analysis.pageCount,
				});
			}}
			onDifferentPdf={() => {
				setStep("upload");
				setAnalysis(null);
			}}
			onCancel={onCancel}
		/>
	);
}
