import Link from "next/link";
import { DOC_SECTIONS } from "~/lib/docs-content";

export const dynamic = "force-dynamic";

export default function DocsHome() {
  const categories = new Map<string, typeof DOC_SECTIONS>();
  for (const doc of DOC_SECTIONS) {
    const list = categories.get(doc.category) ?? [];
    list.push(doc);
    categories.set(doc.category, list);
  }

  return (
    <main className="min-h-screen bg-surface">
      <nav className="border-b border-border px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-lg font-bold tracking-tight transition hover:opacity-80">
              Proofmark
            </Link>
            <span className="text-muted">/</span>
            <span className="text-sm font-medium">Protocol Docs</span>
          </div>
          <span className="text-xs text-muted">CONFIDENTIAL</span>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="mb-10 text-center">
          <h2 className="text-3xl font-bold">Protocol Documentation</h2>
          <p className="mt-2 text-sm text-muted">
            Complete technical documentation for the Agorix decentralized marketplace
          </p>
        </div>

        <div className="space-y-10">
          {Array.from(categories.entries()).map(([category, docs]) => (
            <div key={category}>
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted">{category}</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {docs
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((doc) => (
                    <a
                      key={doc.slug}
                      href={`/docs/${doc.slug}`}
                      className="group rounded-xl border border-border bg-surface-card p-5 transition hover:bg-surface-hover"
                    >
                      <div className="mb-2 flex items-center gap-3">
                        <span className="text-xl">{iconMap[doc.icon] ?? "\ud83d\udcc4"}</span>
                        <h4 className="text-sm font-semibold transition group-hover:text-accent">{doc.title}</h4>
                      </div>
                      <p className="line-clamp-2 text-xs text-muted">{doc.description}</p>
                    </a>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

const iconMap: Record<string, string> = {
  globe: "\ud83c\udf0d",
  shield: "\ud83d\udee1\ufe0f",
  lock: "\ud83d\udd12",
  key: "\ud83d\udd11",
  network: "\ud83c\udf10",
  server: "\ud83d\udda5\ufe0f",
  code: "\ud83d\udcbb",
  book: "\ud83d\udcd6",
  chart: "\ud83d\udcca",
  coins: "\ud83e\ude99",
  wallet: "\ud83d\udc5b",
  marketplace: "\ud83c\udfea",
  governance: "\ud83c\udfdb\ufe0f",
  lightning: "\u26a1",
  puzzle: "\ud83e\udde9",
  gear: "\u2699\ufe0f",
  users: "\ud83d\udc65",
  eye: "\ud83d\udc41\ufe0f",
  flag: "\ud83d\udea9",
  layers: "\ud83d\udcda",
  cpu: "\ud83d\udd27",
  zap: "\u26a1",
  terminal: "\ud83d\udda5\ufe0f",
  database: "\ud83d\uddc4\ufe0f",
  link: "\ud83d\udd17",
  package: "\ud83d\udce6",
  search: "\ud83d\udd0d",
  alert: "\u26a0\ufe0f",
  check: "\u2705",
  settings: "\u2699\ufe0f",
  star: "\u2b50",
  target: "\ud83c\udfaf",
  tool: "\ud83d\udee0\ufe0f",
  box: "\ud83d\udce6",
  refresh: "\ud83d\udd04",
  filter: "\ud83d\udd0d",
};
