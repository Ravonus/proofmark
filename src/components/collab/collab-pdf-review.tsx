"use client";

/**
 * Collaborative PDF review component.
 *
 * For importing and reviewing existing PDFs/contracts:
 * - Already-signed contracts for review
 * - Opposing counsel's drafts
 * - Client documents for analysis
 * - Any PDF for collaborative annotation and AI research
 *
 * Shows the PDF with collaborative annotation overlays,
 * section navigation, and AI-powered analysis.
 */

import { useState, useRef } from "react";
import {
  Upload,
  FileText,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  List,
  Highlighter,
  MessageSquare,
  Bookmark,
  Loader2,
} from "lucide-react";
import { trpc } from "~/lib/trpc";

type PdfSection = {
  title: string;
  pageStart: number;
  pageEnd: number;
  textPreview: string;
};

type Props = {
  sessionId: string;
  pdfBlobUrl: string | null;
  pdfAnalysis: {
    pageCount: number;
    title?: string;
    sections: PdfSection[];
    rawText: string;
  } | null;
  /** Called when a new PDF is imported */
  onPdfImported: () => void;
  /** Called when user wants to create an annotation at a position */
  onCreateAnnotation: (anchor: {
    kind: "pdf";
    page: number;
    rect: { x: number; y: number; width: number; height: number };
  }) => void;
  isHost: boolean;
  canEdit: boolean;
};

export function CollabPdfReview({
  sessionId,
  pdfBlobUrl,
  pdfAnalysis,
  onPdfImported,
  onCreateAnnotation,
  isHost,
  canEdit,
}: Props) {
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [showSections, setShowSections] = useState(true);
  const [annotationMode, setAnnotationMode] = useState<"highlight" | "comment" | "bookmark" | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const importPdf = trpc.collab.importPdf.useMutation();

  const pageCount = pdfAnalysis?.pageCount ?? 1;

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    try {
      // Upload the PDF file (using existing upload endpoint)
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/upload-pdf", {
        method: "POST",
        body: formData,
      });
      const uploadData = await uploadRes.json();

      if (!uploadRes.ok) throw new Error(uploadData.error || "Upload failed");

      // Import into the collaboration session
      await importPdf.mutateAsync({
        sessionId,
        pdfBlobUrl: uploadData.url || `/api/pdf/${uploadData.id}`,
        title: file.name.replace(/\.pdf$/i, ""),
        rawText: uploadData.rawText ?? "",
        pageCount: uploadData.pageCount ?? 0,
        sections: uploadData.sections ?? [],
      });

      onPdfImported();
    } catch (err: any) {
      console.error("PDF import failed:", err);
    } finally {
      setIsUploading(false);
    }
  };

  // No PDF loaded — show upload prompt
  if (!pdfBlobUrl) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <FileText className="mb-4 h-12 w-12 text-zinc-600" />
        <h3 className="mb-2 text-lg font-medium text-zinc-300">Import a Document for Review</h3>
        <p className="mb-6 max-w-sm text-center text-sm text-zinc-500">
          Upload an existing contract, agreement, or any PDF. Everyone in the session can annotate, highlight, and
          discuss it together with AI.
        </p>
        {(isHost || canEdit) && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
            >
              {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Upload PDF
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Sections sidebar */}
      {showSections && pdfAnalysis?.sections && pdfAnalysis.sections.length > 0 && (
        <div className="w-64 shrink-0 overflow-y-auto border-r border-white/10 bg-zinc-900/50">
          <div className="p-3">
            <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500">Sections</h4>
            {pdfAnalysis.sections.map((section, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(section.pageStart)}
                className={`mb-1 w-full rounded-md px-3 py-2 text-left text-xs transition-colors hover:bg-zinc-800 ${
                  currentPage >= section.pageStart && currentPage <= section.pageEnd
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-400"
                }`}
              >
                <p className="font-medium">{section.title}</p>
                <p className="mt-0.5 truncate text-zinc-500">
                  p.{section.pageStart}
                  {section.pageEnd !== section.pageStart && `-${section.pageEnd}`}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* PDF viewer area */}
      <div className="flex flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
          <button
            onClick={() => setShowSections(!showSections)}
            className={`rounded-md p-1.5 transition-colors ${
              showSections ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"
            }`}
            title="Toggle sections"
          >
            <List className="h-4 w-4" />
          </button>

          <div className="h-4 w-px bg-zinc-700" />

          {/* Page navigation */}
          <button
            onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="rounded-md p-1.5 text-zinc-400 hover:text-white disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs text-zinc-400">
            {currentPage} / {pageCount}
          </span>
          <button
            onClick={() => setCurrentPage(Math.min(pageCount, currentPage + 1))}
            disabled={currentPage >= pageCount}
            className="rounded-md p-1.5 text-zinc-400 hover:text-white disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <div className="h-4 w-px bg-zinc-700" />

          {/* Zoom */}
          <button
            onClick={() => setZoom(Math.max(50, zoom - 25))}
            className="rounded-md p-1.5 text-zinc-400 hover:text-white"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-xs text-zinc-400">{zoom}%</span>
          <button
            onClick={() => setZoom(Math.min(200, zoom + 25))}
            className="rounded-md p-1.5 text-zinc-400 hover:text-white"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          <div className="flex-1" />

          {/* Annotation tools */}
          {canEdit && (
            <div className="flex items-center gap-1">
              {(["highlight", "comment", "bookmark"] as const).map((tool) => {
                const icons = { highlight: Highlighter, comment: MessageSquare, bookmark: Bookmark };
                const Icon = icons[tool];
                return (
                  <button
                    key={tool}
                    onClick={() => setAnnotationMode(annotationMode === tool ? null : tool)}
                    className={`rounded-md p-1.5 transition-colors ${
                      annotationMode === tool ? "bg-blue-600/20 text-blue-400" : "text-zinc-400 hover:text-white"
                    }`}
                    title={tool}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* PDF content area */}
        <div className="relative flex-1 overflow-auto bg-zinc-950 p-4">
          <div className="mx-auto" style={{ transform: `scale(${zoom / 100})`, transformOrigin: "top center" }}>
            {/* PDF embed — uses the blob URL */}
            <div className="relative mx-auto max-w-3xl rounded-lg bg-white shadow-2xl">
              <iframe
                src={`${pdfBlobUrl}#page=${currentPage}`}
                className="h-[800px] w-full rounded-lg"
                title="PDF Review"
              />

              {/* Annotation overlay — clicks create annotations in the selected mode */}
              {annotationMode && (
                <div
                  className="absolute inset-0 cursor-crosshair rounded-lg"
                  style={{
                    background: annotationMode === "highlight" ? "rgba(250, 204, 21, 0.05)" : "transparent",
                  }}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = ((e.clientX - rect.left) / rect.width) * 100;
                    const y = ((e.clientY - rect.top) / rect.height) * 100;
                    onCreateAnnotation({
                      kind: "pdf",
                      page: currentPage,
                      rect: { x, y, width: 10, height: 2 },
                    });
                  }}
                />
              )}
            </div>
          </div>
        </div>

        {/* Document title */}
        {pdfAnalysis?.title && (
          <div className="border-t border-white/10 px-4 py-2">
            <p className="text-xs text-zinc-500">
              Reviewing: <span className="text-zinc-300">{pdfAnalysis.title}</span>
              {" · "}
              {pageCount} pages
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
