/**
 * Dashboard store — document list filtering, search, and pagination.
 *
 * Replaces 5 useState + 3 useEffect in dashboard.tsx.
 * All filtering is derived state (computed from the filter + data).
 */

import { create } from "zustand";

type StatusFilter = "ALL" | "PENDING" | "COMPLETED" | "EXPIRED" | "VOIDED";

type DashboardState = {
  // Filters
  statusFilter: StatusFilter;
  searchQuery: string;
  page: number;
  pageSize: number;

  // View
  showOnboarding: boolean;
};

type DashboardActions = {
  setStatusFilter: (filter: StatusFilter) => void;
  setSearchQuery: (query: string) => void;
  setPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  toggleOnboarding: () => void;
  reset: () => void;
};

const INITIAL: DashboardState = {
  statusFilter: "ALL",
  searchQuery: "",
  page: 0,
  pageSize: 10,
  showOnboarding: true,
};

export const useDashboardStore = create<DashboardState & DashboardActions>()((set) => ({
  ...INITIAL,

  setStatusFilter: (filter) => set({ statusFilter: filter, page: 0 }),
  setSearchQuery: (query) => set({ searchQuery: query, page: 0 }),
  setPage: (page) => set({ page }),
  nextPage: () => set((s) => ({ page: s.page + 1 })),
  prevPage: () => set((s) => ({ page: Math.max(0, s.page - 1) })),
  toggleOnboarding: () => set((s) => ({ showOnboarding: !s.showOnboarding })),
  reset: () => set(INITIAL),
}));

// ── Derived selectors (pure functions, not hooks) ────────────────────────────

/** Filter + search + paginate documents. Pure recursive filter. */
export function filterDocuments<T extends { title: string; status: string; contentHash: string }>(
  docs: T[],
  filter: StatusFilter,
  query: string,
  page: number,
  pageSize: number,
): { items: T[]; total: number; totalPages: number } {
  const filtered = filterRecursive(docs, 0, filter, query.toLowerCase());
  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize);
  const start = page * pageSize;
  const items = filtered.slice(start, start + pageSize);
  return { items, total, totalPages };
}

/** Recursive filter — processes array without mutation. */
function filterRecursive<T extends { title: string; status: string; contentHash: string }>(
  docs: T[],
  index: number,
  filter: StatusFilter,
  query: string,
  acc: T[] = [],
): T[] {
  if (index >= docs.length) return acc;
  const doc = docs[index]!;
  const matchesStatus = filter === "ALL" || doc.status === filter;
  const matchesQuery =
    !query || doc.title.toLowerCase().includes(query) || doc.contentHash.toLowerCase().includes(query);

  if (matchesStatus && matchesQuery) {
    acc.push(doc);
  }
  return filterRecursive(docs, index + 1, filter, query, acc);
}
