"use client";

import { useRef, useState } from "react";
import { FileDown, Loader2, PackageOpen, Save, Trash2, Upload } from "lucide-react";
import { trpc } from "~/lib/platform/trpc";
import type { PostSignReveal } from "~/server/db/schema";

type PostSignDownload = NonNullable<PostSignReveal["downloads"]>[number];

type EditableDownload = PostSignDownload & {
  replacementFile: File | null;
};

export function deriveLabel(name: string): string {
  const withoutExtension = name.replace(/\.[^.]+$/, "");
  return withoutExtension.replace(/[-_]+/g, " ").trim() || name;
}

function toEditableDownloads(reveal: PostSignReveal | null | undefined): EditableDownload[] {
  return (reveal?.downloads ?? []).map((download) => ({
    ...download,
    replacementFile: null,
  }));
}

async function readApiResponse(response: Response): Promise<{ reveal: PostSignReveal }> {
  const body = (await response.json().catch(() => null)) as { error?: string; reveal?: PostSignReveal } | null;
  if (!response.ok) {
    throw new Error(body?.error ?? "Shared file request failed");
  }
  if (!body?.reveal) {
    throw new Error("Shared file response was missing reveal data");
  }
  return { reveal: body.reveal };
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function formatUploadMeta(download: PostSignDownload): string | null {
  const uploader = download.uploadedByLabel?.trim();
  const uploadedAt = download.uploadedAt ? new Date(download.uploadedAt) : null;
  const uploadedAtText = uploadedAt && !Number.isNaN(uploadedAt.getTime()) ? uploadedAt.toLocaleString() : null;

  if (uploader && uploadedAtText) return `Uploaded by ${uploader} on ${uploadedAtText}`;
  if (uploader) return `Uploaded by ${uploader}`;
  if (uploadedAtText) return `Uploaded ${uploadedAtText}`;
  return null;
}

export function PostSignDownloadManager({
  documentId,
  documentTitle,
  reveal,
}: {
  documentId: string;
  documentTitle: string;
  reveal: PostSignReveal | null;
}) {
  const utils = trpc.useUtils();
  // Reset items when reveal changes (replaces useEffect sync)
  const prevRevealRef = useRef(reveal);
  const [items, setItems] = useState<EditableDownload[]>(() => toEditableDownloads(reveal));
  if (prevRevealRef.current !== reveal) {
    prevRevealRef.current = reveal;
    setItems(toEditableDownloads(reveal));
  }
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftInputKey, setDraftInputKey] = useState(0);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const syncReveal = async (nextReveal: PostSignReveal) => {
    setItems(toEditableDownloads(nextReveal));
    await utils.document.listByAddress.invalidate();
  };

  const resetFeedback = () => {
    setError(null);
    setMessage(null);
  };

  const updateItem = (filename: string, patch: Partial<EditableDownload>) => {
    setItems((current) => current.map((item) => (item.filename === filename ? { ...item, ...patch } : item)));
  };

  const handleAdd = async () => {
    if (!draftFile) {
      setError("Choose a file to add.");
      return;
    }

    resetFeedback();
    setBusyKey("add");
    try {
      const formData = new FormData();
      formData.set("documentId", documentId);
      formData.set("label", draftLabel.trim() || deriveLabel(draftFile.name));
      formData.set("description", draftDescription.trim());
      formData.set("file", draftFile);

      const response = await fetch("/api/document-downloads", {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });

      const body = await readApiResponse(response);
      await syncReveal(body.reveal);
      setDraftFile(null);
      setDraftLabel("");
      setDraftDescription("");
      setDraftInputKey((current) => current + 1);
      setMessage("Shared file added.");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to add shared file"));
    } finally {
      setBusyKey(null);
    }
  };

  const handleSave = async (item: EditableDownload) => {
    if (!item.label.trim()) {
      setError("Each shared file needs a label.");
      return;
    }

    resetFeedback();
    setBusyKey(`save:${item.filename}`);
    try {
      const formData = new FormData();
      formData.set("documentId", documentId);
      formData.set("existingFilename", item.filename);
      formData.set("label", item.label.trim());
      formData.set("description", item.description?.trim() ?? "");
      if (item.replacementFile) {
        formData.set("file", item.replacementFile);
      }

      const response = await fetch("/api/document-downloads", {
        method: "POST",
        body: formData,
        credentials: "same-origin",
      });

      const body = await readApiResponse(response);
      await syncReveal(body.reveal);
      setMessage(item.replacementFile ? "Shared file replaced." : "Shared file updated.");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to update shared file"));
    } finally {
      setBusyKey(null);
    }
  };

  const handleRemove = async (filename: string) => {
    if (!confirm("Remove this shared file from the post-sign reveal page?")) {
      return;
    }

    resetFeedback();
    setBusyKey(`remove:${filename}`);
    try {
      const response = await fetch("/api/document-downloads", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ documentId, filename }),
        credentials: "same-origin",
      });

      const body = await readApiResponse(response);
      await syncReveal(body.reveal);
      setMessage("Shared file removed.");
    } catch (err) {
      setError(getErrorMessage(err, "Failed to remove shared file"));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card-80)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Contract documents</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            These documents show up on the reveal page for the creator and any signer who has completed {documentTitle}.
            Signed users can upload more from the reveal page.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-xs border border-[var(--border)] bg-[var(--bg-inset)] px-2 py-1 text-[10px] font-medium text-muted">
          <PackageOpen className="h-3 w-3" />
          {items.length} file{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {message && (
        <div className="mt-3 rounded-sm border border-[var(--success-20)] bg-[var(--success-subtle)] px-3 py-2 text-[11px] text-[var(--success)]">
          {message}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-sm border border-[var(--danger-20)] bg-[var(--danger-subtle)] px-3 py-2 text-[11px] text-[var(--danger)]">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--bg-inset-40)] px-4 py-5 text-[12px] text-muted">
            No shared files yet. Add one below to make it available immediately after signing.
          </div>
        ) : (
          items.map((item) => {
            const saveKey = `save:${item.filename}`;
            const removeKey = `remove:${item.filename}`;

            return (
              <div key={item.filename} className="rounded-md border border-[var(--border)] bg-[var(--bg-inset-30)] p-3">
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Label</span>
                      <input
                        type="text"
                        value={item.label}
                        onChange={(e) => updateItem(item.filename, { label: e.target.value })}
                        className="mt-1 w-full rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[12px] outline-none transition-colors focus:border-[var(--accent)]"
                        placeholder="Signer handoff pack"
                      />
                    </label>

                    <label className="block">
                      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
                        Description
                      </span>
                      <textarea
                        value={item.description ?? ""}
                        onChange={(e) => updateItem(item.filename, { description: e.target.value })}
                        rows={2}
                        className="mt-1 w-full rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[12px] outline-none transition-colors focus:border-[var(--accent)]"
                        placeholder="Optional note shown to signers before they download it"
                      />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
                        Stored file
                      </span>
                      <p className="mt-1 truncate rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 font-mono text-[11px] text-secondary">
                        {item.filename}
                      </p>
                      {formatUploadMeta(item) && (
                        <p className="mt-1 text-[10px] text-muted">{formatUploadMeta(item)}</p>
                      )}
                    </div>

                    <label className="block">
                      <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
                        Replace file
                      </span>
                      <input
                        type="file"
                        onChange={(e) => updateItem(item.filename, { replacementFile: e.target.files?.[0] ?? null })}
                        className="mt-1 block w-full cursor-pointer rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[11px] text-muted file:mr-3 file:rounded-xs file:border-0 file:bg-[var(--accent-subtle)] file:px-2 file:py-1 file:text-[10px] file:font-medium file:text-accent"
                      />
                    </label>

                    {item.replacementFile && (
                      <p className="text-[10px] text-accent">Queued replacement: {item.replacementFile.name}</p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => handleSave(item)}
                    disabled={busyKey !== null}
                    className="inline-flex items-center gap-1 rounded-xs bg-[var(--accent-subtle)] px-2.5 py-1.5 text-[10px] font-medium text-accent transition-colors hover:bg-[var(--accent-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyKey === saveKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                    {busyKey === saveKey ? "Saving..." : item.replacementFile ? "Save + replace" : "Save changes"}
                  </button>

                  <a
                    href={`/api/download/${encodeURIComponent(item.filename)}?documentId=${documentId}`}
                    download
                    className="inline-flex items-center gap-1 rounded-xs border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[10px] font-medium text-secondary transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    <FileDown className="h-3 w-3" />
                    Download
                  </a>

                  <button
                    onClick={() => handleRemove(item.filename)}
                    disabled={busyKey !== null}
                    className="inline-flex items-center gap-1 rounded-xs bg-[var(--danger-subtle)] px-2.5 py-1.5 text-[10px] font-medium text-[var(--danger)] transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busyKey === removeKey ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    {busyKey === removeKey ? "Removing..." : "Remove"}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 rounded-md border border-dashed border-[var(--border)] bg-[var(--bg-inset-40)] p-4">
        <p className="text-[12px] font-medium text-primary">Add a new contract document</p>
        <div className="mt-3 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <label className="block">
            <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">File</span>
            <input
              key={draftInputKey}
              type="file"
              onChange={(e) => {
                const nextFile = e.target.files?.[0] ?? null;
                setDraftFile(nextFile);
                if (nextFile && !draftLabel.trim()) {
                  setDraftLabel(deriveLabel(nextFile.name));
                }
              }}
              className="mt-1 block w-full cursor-pointer rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[11px] text-muted file:mr-3 file:rounded-xs file:border-0 file:bg-[var(--accent-subtle)] file:px-2 file:py-1 file:text-[10px] file:font-medium file:text-accent"
            />
          </label>

          <div className="space-y-2">
            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Label</span>
              <input
                type="text"
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                className="mt-1 w-full rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[12px] outline-none transition-colors focus:border-[var(--accent)]"
                placeholder="Executive summary deck"
              />
            </label>

            <label className="block">
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">Description</span>
              <textarea
                value={draftDescription}
                onChange={(e) => setDraftDescription(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-sm border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[12px] outline-none transition-colors focus:border-[var(--accent)]"
                placeholder="Optional context for the signer"
              />
            </label>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={handleAdd}
            disabled={busyKey !== null || !draftFile}
            className="inline-flex items-center gap-1 rounded-xs bg-[var(--accent)] px-3 py-1.5 text-[10px] font-medium text-white transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busyKey === "add" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            {busyKey === "add" ? "Uploading..." : "Upload file"}
          </button>
          <p className="text-[10px] text-muted">
            New documents become visible on the reveal page immediately after this saves.
          </p>
        </div>
      </div>
    </div>
  );
}
