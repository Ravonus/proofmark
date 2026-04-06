"use client";

import { useState, useRef, useEffect, useCallback, memo, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";

export type DropdownItem = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  category?: string;
  keywords?: string;
};

type Props = {
  items: DropdownItem[];
  onSelect: (item: DropdownItem) => void;
  placeholder?: string;
  trigger?: ReactNode;
  value?: string;
  className?: string;
};

export const SearchDropdown = memo(function SearchDropdown({
  items,
  onSelect,
  placeholder = "Search...",
  trigger,
  value,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setSearch("");
      setHighlightIdx(0);
    }
  }, [open]);

  const filtered = search.trim()
    ? items.filter((item) => {
        const q = search.toLowerCase();
        const haystack =
          `${item.label} ${item.description ?? ""} ${item.keywords ?? ""} ${item.category ?? ""}`.toLowerCase();
        return q.split(/\s+/).every((word) => haystack.includes(word));
      })
    : items;

  const grouped = new Map<string, DropdownItem[]>();
  for (const item of filtered) {
    const cat = item.category || "";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(item);
  }

  const flatList = filtered;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIdx((prev) => Math.min(prev + 1, flatList.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIdx((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && flatList[highlightIdx]) {
        e.preventDefault();
        onSelect(flatList[highlightIdx]);
        setOpen(false);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    },
    [flatList, highlightIdx, onSelect],
  );

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${highlightIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  const selectedItem = value ? items.find((i) => i.id === value) : null;

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {trigger ? (
        <div onClick={() => setOpen(!open)}>{trigger}</div>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          className="flex w-full items-center gap-2 rounded-lg bg-[var(--bg-surface)] px-3 py-2 text-left text-sm outline-none ring-1 ring-[var(--border)] transition-all hover:ring-[var(--accent-40)]"
        >
          {selectedItem ? (
            <>
              {selectedItem.icon && <span>{selectedItem.icon}</span>}
              <span className="text-primary">{selectedItem.label}</span>
            </>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
          <span className="ml-auto text-xs text-muted">&#9662;</span>
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="absolute left-0 right-0 top-full z-50 mt-1.5 min-w-[280px] max-w-[360px] overflow-hidden rounded-xl border border-[var(--border)] shadow-2xl"
            style={{ background: "var(--bg-card)", backdropFilter: "blur(16px)" }}
          >
            <div className="border-b border-[var(--border)] p-2">
              <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-surface)] px-3 py-2">
                <span className="text-xs text-muted">&#128269;</span>
                <input
                  ref={inputRef}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setHighlightIdx(0);
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder={placeholder}
                  className="flex-1 bg-transparent text-sm text-primary outline-none placeholder:text-muted"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="text-xs text-muted transition-colors hover:text-secondary"
                  >
                    &times;
                  </button>
                )}
              </div>
            </div>

            <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1" style={{ scrollbarWidth: "thin" }}>
              {flatList.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-muted">No results for &ldquo;{search}&rdquo;</div>
              ) : (
                [...grouped.entries()].map(([category, catItems]) => (
                  <div key={category}>
                    {category && (
                      <div className="text-muted/60 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider">
                        {category}
                      </div>
                    )}
                    {catItems.map((item) => {
                      const idx = flatList.indexOf(item);
                      const isHighlighted = idx === highlightIdx;
                      return (
                        <button
                          key={item.id}
                          data-idx={idx}
                          onClick={() => {
                            onSelect(item);
                            setOpen(false);
                          }}
                          onMouseEnter={() => setHighlightIdx(idx)}
                          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-all ${
                            isHighlighted
                              ? "bg-[var(--accent-10)] text-primary"
                              : "text-secondary hover:bg-[var(--bg-hover)]"
                          }`}
                        >
                          {item.icon && <span className="w-5 shrink-0 text-center text-sm">{item.icon}</span>}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium">
                              {search ? highlightMatch(item.label, search) : item.label}
                            </p>
                            {item.description && <p className="truncate text-[10px] text-muted">{item.description}</p>}
                          </div>
                          {isHighlighted && (
                            <span className="shrink-0 text-[10px] text-[var(--accent-50)]">&#9166;</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="text-muted/50 flex items-center gap-3 border-t border-[var(--border)] px-3 py-1.5 text-[10px]">
              <span>&#8593;&#8595; navigate</span>
              <span>&#9166; select</span>
              <span>esc close</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

function highlightMatch(text: string, query: string): ReactNode {
  if (!query.trim()) return text;
  const words = query.toLowerCase().split(/\s+/);
  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  for (const word of words) {
    const idx = remaining.toLowerCase().indexOf(word);
    if (idx === -1) continue;
    if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
    parts.push(
      <span key={key++} className="font-semibold text-[var(--accent)]">
        {remaining.slice(idx, idx + word.length)}
      </span>,
    );
    remaining = remaining.slice(idx + word.length);
  }
  if (remaining) parts.push(<span key={key++}>{remaining}</span>);
  return parts.length > 0 ? <>{parts}</> : text;
}
