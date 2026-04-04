/**
 * Protocol documentation content.
 *
 * Each entry is a self-contained documentation page stored as structured
 * markdown. The content is seeded into PostgreSQL for full-text search
 * and cached in Redis for fast reads.
 */

export interface DocEntry {
  slug: string;
  category: string;
  categorySlug: string;
  title: string;
  description: string;
  icon: string;
  sortOrder: number;
  content: string;
}

export interface DocAnchor {
  id: string;
  text: string;
  level: number;
}

/** Extract heading anchors from markdown content. */
export function extractAnchors(content: string): DocAnchor[] {
  const anchors: DocAnchor[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const match = /^(#{2,4})\s+(.+)$/.exec(line);
    if (match) {
      const level = match[1]!.length;
      const text = match[2]!.replace(/[`*_~]/g, "").trim();
      const id = text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "");
      anchors.push({ id, text, level });
    }
  }
  return anchors;
}

/** Simple content hash for change detection. */
export function hashContent(content: string): string {
  let h = 0;
  for (let i = 0; i < content.length; i++) {
    h = ((h << 5) - h + content.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}
