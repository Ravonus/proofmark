"use client";

/**
 * useEditorFlow — thin action layer over the editor Zustand store.
 *
 * Provides snapshot-aware token/field/section operations (each mutation
 * pushes an undo snapshot first) plus convenience helpers for the
 * document-editor component. All state lives in useEditorStore.
 */

import { useCallback } from "react";
import { useEditorStore } from "~/stores/editor";
import type { DocToken, InlineField } from "~/lib/document/document-tokens";

export function useEditorFlow() {
  const store = useEditorStore();

  // ── Snapshot-aware token operations ────────────────────────────────────────

  const updateTokenText = useCallback(
    (index: number, text: string) => {
      store.pushSnapshot();
      store.setTokens(store.tokens.map((t, i) => (i === index ? { ...t, text } : t)));
    },
    [store],
  );

  const removeToken = useCallback(
    (index: number) => {
      store.pushSnapshot();
      store.setTokens(store.tokens.filter((_, i) => i !== index));
    },
    [store],
  );

  const insertTokenAfter = useCallback(
    (index: number, token: DocToken) => {
      store.pushSnapshot();
      const next = [...store.tokens];
      next.splice(index + 1, 0, token);
      store.setTokens(next);
    },
    [store],
  );

  // ── Snapshot-aware field operations ────────────────────────────────────────

  const insertFieldAfterToken = useCallback(
    (tokenIndex: number, field: InlineField) => {
      store.pushSnapshot();
      const fieldToken: DocToken = { kind: "field", field };
      const next = [...store.tokens];
      next.splice(tokenIndex + 1, 0, fieldToken);
      store.setTokens(next);
      store.setFields([...store.fields, field]);
      store.setActiveFieldId(field.id);
    },
    [store],
  );

  const removeField = useCallback(
    (fieldId: string) => {
      store.pushSnapshot();
      store.setTokens(store.tokens.filter((t) => !(t.kind === "field" && t.field?.id === fieldId)));
      store.setFields(store.fields.filter((f) => f.id !== fieldId));
      if (store.activeFieldId === fieldId) store.setActiveFieldId(null);
    },
    [store],
  );

  const updateField = useCallback(
    (fieldId: string, patch: Partial<InlineField>) => {
      store.setFields(store.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)));
    },
    [store],
  );

  // ── Snapshot-aware section operations ──────────────────────────────────────

  const addSection = useCallback(
    (title: string, content: string) => {
      store.pushSnapshot();
      const sectionNum = store.tokens.filter((t) => t.kind === "heading").length + 1;
      const newTokens: DocToken[] = [
        { kind: "heading", text: title, sectionNum },
        ...content.split("\n").map((line) => ({ kind: "text" as const, text: line })),
      ];
      store.setTokens([...store.tokens, ...newTokens]);
    },
    [store],
  );

  const removeSection = useCallback(
    (headingIndex: number) => {
      store.pushSnapshot();
      const tokens = [...store.tokens];
      let end = headingIndex + 1;
      while (end < tokens.length && tokens[end]!.kind !== "heading") end++;
      tokens.splice(headingIndex, end - headingIndex);
      store.setTokens(tokens);
    },
    [store],
  );

  // ── Signer helpers ─────────────────────────────────────────────────────────

  /** Auto-label empty signer names on blur. */
  const handleSignerBlur = useCallback(
    (index: number) => {
      const signer = store.signers[index];
      if (signer && !signer.label.trim()) {
        store.updateSigner(index, { label: `Signer ${index + 1}` });
      }
    },
    [store],
  );

  /** Snapshot current editor state for submission. */
  const buildResult = useCallback(
    () => ({
      title: store.title,
      tokens: store.tokens,
      fields: store.fields,
      signers: store.signers,
      previewValues: store.previewValues,
    }),
    [store],
  );

  return {
    ...store,

    // Token ops
    updateTokenText,
    removeToken,
    insertTokenAfter,

    // Field ops
    insertFieldAfterToken,
    removeField,
    updateField,

    // Section ops
    addSection,
    removeSection,

    // Signer ops
    handleSignerBlur,

    // Build
    buildResult,
  };
}
