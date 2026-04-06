"use client";

import { useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";
import { GlassCard } from "../ui/motion";
import type { PostSignReveal } from "~/server/db/schema";
import { deriveLabel } from "./post-sign-download-manager";

async function readApiResponse(response: Response): Promise<{ reveal: PostSignReveal }> {
  const body = (await response.json().catch(() => null)) as { error?: string; reveal?: PostSignReveal } | null;
  if (!response.ok) {
    throw new Error(body?.error ?? "Upload failed");
  }
  if (!body?.reveal) {
    throw new Error("The upload completed but no updated document list was returned");
  }
  return { reveal: body.reveal };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : "Upload failed";
}

export function PostSignRevealUploader({
  documentId,
  onUploaded,
}: {
  documentId: string;
  onUploaded: (reveal: PostSignReveal) => Promise<void> | void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [inputKey, setInputKey] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleUpload = async () => {
    if (!file) {
      setError("Choose a document to upload.");
      return;
    }

    setError(null);
    setMessage(null);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.set("documentId", documentId);
      formData.set("label", label.trim() || deriveLabel(file.name));
      formData.set("description", description.trim());
      formData.set("file", file);

      const response = await fetch("/api/document-downloads", {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });

      const body = await readApiResponse(response);
      await onUploaded(body.reveal);
      setFile(null);
      setLabel("");
      setDescription("");
      setInputKey((current) => current + 1);
      setMessage("Document uploaded to this contract.");
    } catch (uploadError) {
      setError(getErrorMessage(uploadError));
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <GlassCard className="p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="bg-accent/10 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-accent">
          <UploadCloud className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-lg font-semibold">Upload More Documents</h3>
          <p className="mt-1 text-sm text-secondary">
            Signed participants can add more documents here. The contract owner can review and manage the full list from
            the dashboard.
          </p>
        </div>
      </div>

      {message && (
        <div className="mt-4 rounded-lg border border-[var(--success-20)] bg-[var(--success-subtle)] px-3 py-2 text-sm text-[var(--success)]">
          {message}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-[var(--danger-20)] bg-[var(--danger-subtle)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      <div className="mt-4 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Document</span>
          <input
            key={inputKey}
            type="file"
            onChange={(e) => {
              const nextFile = e.target.files?.[0] ?? null;
              setFile(nextFile);
              if (nextFile && !label.trim()) {
                setLabel(deriveLabel(nextFile.name));
              }
            }}
            className="mt-1 block w-full cursor-pointer rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[11px] text-muted file:mr-3 file:rounded-xs file:border-0 file:bg-[var(--accent-subtle)] file:px-2 file:py-1 file:text-[10px] file:font-medium file:text-accent"
          />
        </label>

        <div className="space-y-3">
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Label</span>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[12px] outline-none transition-colors focus:border-[var(--accent)]"
              placeholder="Compliance packet"
            />
          </label>

          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[12px] outline-none transition-colors focus:border-[var(--accent)]"
              placeholder="Optional context for everyone with access"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleUpload}
          disabled={!file || isUploading}
          className="inline-flex items-center gap-2 rounded-sm bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {isUploading ? "Uploading..." : "Upload to contract"}
        </button>
        <p className="text-xs text-muted">Any new upload appears in the document list right away.</p>
      </div>
    </GlassCard>
  );
}
