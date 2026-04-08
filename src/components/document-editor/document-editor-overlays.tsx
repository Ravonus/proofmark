"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "lucide-react";
import type { InlineField } from "~/lib/document/document-tokens";
import { FieldPicker } from "../fields";
import { W3SButton } from "../ui/motion";

// ── Mobile bottom sheet for field picker ──

export function MobileFieldPanel({
  mobilePanel,
  addMode,
  activeSigner,
  signerCount,
  signerLabels,
  setAddMode,
  setDragNewType,
  setDropTarget,
  setMobilePanel,
  setActiveSigner,
}: {
  mobilePanel: boolean;
  addMode: InlineField["type"] | null;
  activeSigner: number;
  signerCount: number;
  signerLabels: string[];
  setAddMode: (v: InlineField["type"] | null) => void;
  setDragNewType: (v: InlineField["type"] | null) => void;
  setDropTarget: (v: null) => void;
  setMobilePanel: (v: boolean) => void;
  setActiveSigner: (v: number) => void;
}) {
  return (
    <AnimatePresence>
      {mobilePanel && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/40 sm:hidden"
            onClick={() => setMobilePanel(false)}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl border-t border-[var(--border)] bg-[var(--bg-card)] shadow-2xl sm:hidden"
            style={{ maxHeight: "70vh" }}
          >
            <div className="flex items-center justify-center py-2">
              <div className="h-1 w-10 rounded-full bg-[var(--border)]" />
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: "calc(70vh - 40px)" }}>
              <FieldPicker
                onSelect={(id) => {
                  setAddMode(id as InlineField["type"]);
                  setMobilePanel(false);
                }}
                activeType={addMode}
                onClearActive={() => setAddMode(null)}
                onDragNewField={(id) => {
                  setDragNewType(id as InlineField["type"]);
                  setAddMode(null);
                  setMobilePanel(false);
                }}
                onDragEnd={() => {
                  setDragNewType(null);
                  setDropTarget(null);
                }}
                activeSigner={activeSigner}
                signerCount={signerCount}
                signerLabels={signerLabels}
                onSignerChange={setActiveSigner}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ── Add Section Modal ──

export function AddSectionModal({
  show,
  sectionTitle,
  sectionContent,
  onTitleChange,
  onContentChange,
  onAdd,
  onClose,
}: {
  show: boolean;
  sectionTitle: string;
  sectionContent: string;
  onTitleChange: (v: string) => void;
  onContentChange: (v: string) => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            className="w-full max-w-md space-y-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-6 shadow-2xl"
          >
            <h3 className="text-lg font-semibold">Add Section</h3>
            <input
              value={sectionTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="Section title"
              className="w-full rounded-lg bg-[var(--bg-surface)] px-4 py-2.5 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
            />
            <textarea
              value={sectionContent}
              onChange={(e) => onContentChange(e.target.value)}
              placeholder="Content (optional)"
              rows={4}
              className="w-full resize-none rounded-lg bg-[var(--bg-surface)] px-4 py-2.5 text-sm outline-none ring-1 ring-[var(--border)] focus:ring-[var(--accent)]"
            />
            <div className="flex gap-2">
              <W3SButton variant="primary" size="md" onClick={onAdd} disabled={!sectionTitle.trim()} className="flex-1">
                Add
              </W3SButton>
              <W3SButton variant="secondary" size="md" onClick={onClose}>
                Cancel
              </W3SButton>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Drag ghost ──

export function DragGhost({
  isDragging,
  ghostPos,
  label,
}: {
  isDragging: boolean;
  ghostPos: { x: number; y: number };
  label: string;
}) {
  if (!isDragging || ghostPos.x <= 0) return null;
  return (
    <div
      className="pointer-events-none fixed z-[999]"
      style={{ left: `${ghostPos.x + 16}px`, top: `${ghostPos.y - 16}px` }}
    >
      <div className="whitespace-nowrap rounded-lg border border-[var(--accent-40)] bg-[var(--accent-10)] px-3 py-1.5 text-xs font-medium text-[var(--accent)] backdrop-blur-sm">
        {label}
      </div>
    </div>
  );
}

// ── Floating add-field indicator ──

export function AddFieldIndicator({ addMode, onClear }: { addMode: string | null; onClear: () => void }) {
  if (!addMode) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-30 -translate-x-1/2">
      <div className="flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2.5 text-xs font-medium text-white shadow-lg">
        <Plus className="h-3.5 w-3.5" />
        <span>
          Tap a <span className="font-bold">+</span> in the text to place field
        </span>
        <button onClick={onClear} className="ml-1 rounded-full bg-white/20 p-1 transition-colors hover:bg-white/30">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
