"use client";

/**
 * Collaboration annotation sidebar — highlights, comments, bookmarks, suggestions.
 *
 * Shows a list of all annotations in the session, filterable by type.
 * Users can create new annotations, resolve/unresolve, and navigate
 * to the anchored position in the document.
 */

import { useState } from "react";
import { Highlighter, MessageSquare, Bookmark, Lightbulb, Check, RotateCcw, Trash2, X } from "lucide-react";
import { trpc } from "~/lib/platform/trpc";

type AnnotationType = "highlight" | "comment" | "bookmark" | "suggestion";

type AnnotationAnchor = {
  kind: "doc" | "pdf";
  tokenIndex?: number;
  charOffset?: number;
  length?: number;
  page?: number;
  rect?: { x: number; y: number; width: number; height: number };
};

type Annotation = {
  id: string;
  type: AnnotationType;
  content: string | null;
  anchor: AnnotationAnchor;
  resolved: boolean;
  authorUserId: string;
  createdAt: string | number | Date;
};

type Props = {
  sessionId: string;
  isOpen: boolean;
  onClose: () => void;
  /** Called when user clicks an annotation to navigate to its anchor */
  onNavigate: (anchor: AnnotationAnchor) => void;
  /** Current user address for author check */
  currentUserId: string;
  isHost: boolean;
};

const TYPE_CONFIG: Record<AnnotationType, { icon: typeof Highlighter; label: string; color: string }> = {
  highlight: { icon: Highlighter, label: "Highlights", color: "text-yellow-400" },
  comment: { icon: MessageSquare, label: "Comments", color: "text-blue-400" },
  bookmark: { icon: Bookmark, label: "Bookmarks", color: "text-emerald-400" },
  suggestion: { icon: Lightbulb, label: "Suggestions", color: "text-purple-400" },
};

export function CollabAnnotationSidebar({ sessionId, isOpen, onClose, onNavigate, currentUserId, isHost }: Props) {
  const [filter, setFilter] = useState<AnnotationType | "all">("all");
  const [showResolved, setShowResolved] = useState(false);

  const annotations = trpc.collab.getAnnotations.useQuery({
    sessionId,
    type: filter === "all" ? undefined : filter,
    resolved: showResolved ? undefined : false,
  });

  const counts = trpc.collab.annotationCounts.useQuery({ sessionId });
  const resolve = trpc.collab.resolveAnnotation.useMutation({
    onSuccess: () => void annotations.refetch(),
  });
  const deleteAnno = trpc.collab.deleteAnnotation.useMutation({
    onSuccess: () => {
      void annotations.refetch();
      void counts.refetch();
    },
  });

  if (!isOpen) return null;

  return (
    <div className="flex h-full w-80 flex-col border-l border-white/10 bg-zinc-900/95">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h3 className="text-sm font-semibold text-white">Annotations</h3>
        <button onClick={onClose} className="text-zinc-400 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Type filter tabs */}
      <div className="flex gap-1 border-b border-white/10 px-3 py-2">
        <FilterButton
          active={filter === "all"}
          onClick={() => setFilter("all")}
          label="All"
          count={
            counts.data
              ? Object.values(counts.data as Record<string, number>).reduce((a: number, b: number) => a + b, 0)
              : 0
          }
        />
        {(Object.keys(TYPE_CONFIG) as AnnotationType[]).map((type) => {
          const { icon: Icon, color } = TYPE_CONFIG[type];
          return (
            <FilterButton
              key={type}
              active={filter === type}
              onClick={() => setFilter(type)}
              label={
                <span className="flex items-center gap-1">
                  <Icon className={`h-3 w-3 ${color}`} />
                </span>
              }
              count={(counts.data as Record<string, number> | undefined)?.[type] ?? 0}
            />
          );
        })}
      </div>

      {/* Resolved toggle */}
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
        <label className="flex items-center gap-1.5 text-xs text-zinc-400">
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            className="rounded border-zinc-600 bg-zinc-800"
          />
          Show resolved
        </label>
      </div>

      {/* Annotations list */}
      <div className="flex-1 overflow-y-auto">
        {(annotations.data as Annotation[] | undefined)?.length === 0 && (
          <p className="px-4 py-8 text-center text-xs text-zinc-500">
            No annotations yet. Highlight text or add comments to start.
          </p>
        )}
        {(annotations.data as Annotation[] | undefined)?.map((anno) => {
          const config = TYPE_CONFIG[anno.type];
          const Icon = config?.icon ?? MessageSquare;

          return (
            <div
              key={anno.id}
              className={`cursor-pointer border-b border-white/5 px-4 py-3 transition-colors hover:bg-zinc-800/50 ${
                anno.resolved ? "opacity-60" : ""
              }`}
              onClick={() => onNavigate(anno.anchor)}
            >
              <div className="mb-1 flex items-center gap-2">
                <Icon className={`h-3.5 w-3.5 ${config?.color ?? "text-zinc-400"}`} />
                <span className="text-xs font-medium text-zinc-300">{anno.type}</span>
                {anno.resolved && (
                  <span className="rounded bg-emerald-500/20 px-1 py-0.5 text-[10px] text-emerald-400">Resolved</span>
                )}
                <span className="ml-auto text-[10px] text-zinc-600">
                  {new Date(anno.createdAt).toLocaleTimeString()}
                </span>
              </div>
              {anno.content && <p className="mb-2 text-xs leading-relaxed text-zinc-400">{anno.content}</p>}
              <div className="flex items-center gap-1">
                {!anno.resolved && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      resolve.mutate({ annotationId: anno.id });
                    }}
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-emerald-400"
                    title="Resolve"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                )}
                {anno.resolved && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      /* Unresolve - use resolve mutation with different endpoint */
                    }}
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-amber-400"
                    title="Reopen"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                )}
                {(anno.authorUserId === currentUserId || isHost) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAnno.mutate({ annotationId: anno.id, sessionId });
                    }}
                    className="rounded p-1 text-zinc-500 hover:bg-zinc-700 hover:text-red-400"
                    title="Delete"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: React.ReactNode;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
        active ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300"
      }`}
    >
      {label}
      {count > 0 && <span className="text-[10px] text-zinc-500">{count}</span>}
    </button>
  );
}
