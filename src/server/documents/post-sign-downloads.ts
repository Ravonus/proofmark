import { randomBytes } from "crypto";
import { mkdir, unlink, writeFile } from "fs/promises";
import path from "path";
import type { PostSignReveal } from "~/server/db/schema";

export type PostSignDownload = NonNullable<PostSignReveal["downloads"]>[number];

const POST_SIGN_DOWNLOAD_ROOT = process.env.PLATFORM_PERSIST_FAST_ROOT
  ? path.join(process.env.PLATFORM_PERSIST_FAST_ROOT, "downloads")
  : path.resolve(process.cwd(), "private", "downloads");

export const MAX_POST_SIGN_DOWNLOAD_BYTES = 25 * 1024 * 1024;

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeSection(section: { title: string; content: string; icon?: string }) {
  return {
    title: section.title.trim(),
    content: section.content.trim(),
    ...(normalizeOptionalText(section.icon) ? { icon: normalizeOptionalText(section.icon) } : {}),
  };
}

function normalizeTimestamp(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

export function sanitizeDownloadName(name: string): string {
  return (
    name
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 160) || "download"
  );
}

export function deriveDownloadLabel(name: string): string {
  const safeName = sanitizeDownloadName(name);
  const withoutExtension = safeName.replace(/\.[^.]+$/, "");
  return withoutExtension.replace(/[-_]+/g, " ").trim() || safeName;
}

export function getPostSignDownloadPath(filename: string): string {
  return path.join(POST_SIGN_DOWNLOAD_ROOT, sanitizeDownloadName(filename));
}

export async function savePostSignDownloadFile(params: {
  documentId: string;
  originalName: string;
  mimeType: string;
  bytes: Uint8Array;
}) {
  const safeOriginalName = sanitizeDownloadName(params.originalName);
  const docPrefix = sanitizeDownloadName(params.documentId).slice(0, 24) || "document";
  const storedName = `${docPrefix}-${Date.now()}-${randomBytes(6).toString("hex")}-${safeOriginalName}`;

  await mkdir(POST_SIGN_DOWNLOAD_ROOT, { recursive: true });
  await writeFile(getPostSignDownloadPath(storedName), params.bytes);

  return {
    storedName,
    originalName: safeOriginalName,
    mimeType: params.mimeType || "application/octet-stream",
    size: params.bytes.byteLength,
  };
}

export async function removePostSignDownloadFile(filename: string) {
  try {
    await unlink(getPostSignDownloadPath(filename));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  }
}

export function hasPostSignRevealContent(reveal: PostSignReveal | null | undefined): boolean {
  if (!reveal) return false;

  return (
    Boolean(normalizeOptionalText(reveal.summary)) ||
    (reveal.sections?.length ?? 0) > 0 ||
    (reveal.downloads?.length ?? 0) > 0 ||
    reveal.testbedAccess?.enabled === true
  );
}

export function normalizePostSignReveal(reveal: PostSignReveal | null | undefined): PostSignReveal {
  const normalizedSections = reveal?.sections
    ?.map(normalizeSection)
    .filter((section) => section.title.length > 0 && section.content.length > 0);

  const normalizedDownloads = reveal?.downloads?.map((download) => normalizePostSignDownload(download));
  const normalizedSummary = normalizeOptionalText(reveal?.summary);
  const normalizedDescription = normalizeOptionalText(reveal?.testbedAccess?.description);
  const normalizedProxyEndpoint = normalizeOptionalText(reveal?.testbedAccess?.proxyEndpoint);

  const next: PostSignReveal = {
    enabled: false,
    ...(normalizedSummary ? { summary: normalizedSummary } : {}),
    ...(normalizedSections && normalizedSections.length > 0 ? { sections: normalizedSections } : {}),
    ...(normalizedDownloads && normalizedDownloads.length > 0 ? { downloads: normalizedDownloads } : {}),
    ...(reveal?.testbedAccess?.enabled
      ? {
          testbedAccess: {
            enabled: true,
            ...(normalizedDescription ? { description: normalizedDescription } : {}),
            ...(normalizedProxyEndpoint ? { proxyEndpoint: normalizedProxyEndpoint } : {}),
          },
        }
      : {}),
  };

  next.enabled = hasPostSignRevealContent(next);
  return next;
}

export function normalizePostSignDownload(download: PostSignDownload, existing?: PostSignDownload): PostSignDownload {
  const label = normalizeOptionalText(download.label);
  if (!label) {
    throw new Error("A shared file label is required");
  }

  const filename = sanitizeDownloadName(download.filename);
  if (!filename || filename.includes("..")) {
    throw new Error("Invalid shared file name");
  }

  const description = normalizeOptionalText(download.description);
  const icon = normalizeOptionalText(download.icon) ?? existing?.icon;
  const uploadedByAddress = normalizeOptionalText(download.uploadedByAddress) ?? existing?.uploadedByAddress;
  const uploadedByLabel = normalizeOptionalText(download.uploadedByLabel) ?? existing?.uploadedByLabel;
  const uploadedAt = normalizeTimestamp(download.uploadedAt) ?? existing?.uploadedAt;

  return {
    label,
    filename,
    ...(description ? { description } : {}),
    ...(icon ? { icon } : {}),
    ...(uploadedByAddress ? { uploadedByAddress } : {}),
    ...(uploadedByLabel ? { uploadedByLabel } : {}),
    ...(uploadedAt ? { uploadedAt } : {}),
  };
}

export function upsertPostSignRevealDownload(
  reveal: PostSignReveal | null | undefined,
  params: {
    previousFilename?: string;
    nextDownload: PostSignDownload;
  },
): PostSignReveal {
  const normalizedReveal = normalizePostSignReveal(reveal);
  const previousFilename = params.previousFilename ? sanitizeDownloadName(params.previousFilename) : null;
  const currentDownloads = normalizedReveal.downloads ?? [];

  if (!previousFilename) {
    return normalizePostSignReveal({
      ...normalizedReveal,
      downloads: [...currentDownloads, normalizePostSignDownload(params.nextDownload)],
    });
  }

  let found = false;
  const nextDownloads = currentDownloads.map((download) => {
    if (download.filename !== previousFilename) return download;
    found = true;
    return normalizePostSignDownload(params.nextDownload, download);
  });

  if (!found) {
    throw new Error("Shared file not found on this contract");
  }

  return normalizePostSignReveal({
    ...normalizedReveal,
    downloads: nextDownloads,
  });
}

export function removePostSignRevealDownload(
  reveal: PostSignReveal | null | undefined,
  filename: string,
): PostSignReveal {
  const normalizedReveal = normalizePostSignReveal(reveal);
  const safeFilename = sanitizeDownloadName(filename);
  const currentDownloads = normalizedReveal.downloads ?? [];
  const nextDownloads = currentDownloads.filter((download) => download.filename !== safeFilename);

  if (nextDownloads.length === currentDownloads.length) {
    throw new Error("Shared file not found on this contract");
  }

  return normalizePostSignReveal({
    ...normalizedReveal,
    downloads: nextDownloads.length > 0 ? nextDownloads : undefined,
  });
}
