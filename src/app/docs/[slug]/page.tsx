import Link from "next/link";
import { notFound } from "next/navigation";
import { DOC_SECTIONS } from "~/lib/docs-content";
import { markdownToHtml } from "~/lib/markdown";
import { extractAnchors } from "~/lib/docs-content/types";

export const dynamic = "force-dynamic";

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = DOC_SECTIONS.find((d) => d.slug === slug);
  if (!doc) notFound();

  const html = markdownToHtml(doc.content);
  const anchors = extractAnchors(doc.content);

  const categoryDocs = DOC_SECTIONS.filter((d) => d.categorySlug === doc.categorySlug).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const idx = categoryDocs.findIndex((d) => d.slug === slug);
  const prev = idx > 0 ? categoryDocs[idx - 1] : null;
  const next = idx < categoryDocs.length - 1 ? categoryDocs[idx + 1] : null;

  return (
    <main className="min-h-screen bg-surface">
      <nav className="border-b border-border px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-lg font-bold tracking-tight transition hover:opacity-80">
              Proofmark
            </Link>
            <span className="text-muted">/</span>
            <Link href="/docs" className="text-sm text-muted transition hover:text-secondary">
              Docs
            </Link>
            <span className="text-muted">/</span>
            <span className="text-sm text-secondary">{doc.category}</span>
          </div>
          <span className="text-xs text-muted">CONFIDENTIAL</span>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <div className="flex gap-8">
          <aside className="hidden w-56 shrink-0 lg:block">
            <div className="sticky top-8 space-y-1">
              <p className="mb-3 text-[10px] uppercase tracking-wider text-muted">On this page</p>
              {anchors.map((a) => (
                <a
                  key={a.id}
                  href={`#${a.id}`}
                  className={`block truncate text-xs transition hover:text-accent ${
                    a.level === 2 ? "font-medium text-secondary" : a.level === 3 ? "pl-3 text-muted" : "pl-6 text-muted"
                  }`}
                >
                  {a.text}
                </a>
              ))}
            </div>
          </aside>

          <article className="min-w-0 flex-1">
            <div className="mb-6">
              <p className="mb-1 text-xs font-medium text-accent">{doc.category}</p>
              <h1 className="text-2xl font-bold sm:text-3xl">{doc.title}</h1>
              <p className="mt-2 text-sm text-muted">{doc.description}</p>
            </div>

            <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />

            <div className="mt-12 flex justify-between border-t border-border pt-6">
              {prev ? (
                <a href={`/docs/${prev.slug}`} className="text-sm text-muted transition hover:text-accent">
                  &larr; {prev.title}
                </a>
              ) : (
                <span />
              )}
              {next ? (
                <a href={`/docs/${next.slug}`} className="text-sm text-muted transition hover:text-accent">
                  {next.title} &rarr;
                </a>
              ) : (
                <Link href="/docs" className="text-sm text-muted transition hover:text-accent">
                  Back to Index
                </Link>
              )}
            </div>
          </article>
        </div>
      </div>
    </main>
  );
}
