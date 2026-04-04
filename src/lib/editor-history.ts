/**
 * Undo/redo history stack for the document editor.
 *
 * Generic over the snapshot type. AI operations push a snapshot
 * before applying changes, making them undoable as a single unit.
 *
 * Note: The Zustand editor store (stores/editor.ts) has its own
 * undo/redo built in. This class is used by the legacy editor
 * component until it's fully migrated to the store.
 */

export type EditorSnapshot<T = unknown> = {
  title: string;
  tokens: T[];
  fields: T[];
  label?: string;
  timestamp: number;
};

const MAX_DEPTH = 50;

export class EditorHistory<T = unknown> {
  private past: EditorSnapshot<T>[] = [];
  private future: EditorSnapshot<T>[] = [];

  push(snapshot: EditorSnapshot<T>): void {
    this.past.push(snapshot);
    if (this.past.length > MAX_DEPTH) this.past.shift();
    this.future = [];
  }

  undo(current: EditorSnapshot<T>): EditorSnapshot<T> | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    return prev;
  }

  redo(current: EditorSnapshot<T>): EditorSnapshot<T> | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    return next;
  }

  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
  get undoLabel() { return this.past.at(-1)?.label; }
  get redoLabel() { return this.future.at(-1)?.label; }

  clear() { this.past = []; this.future = []; }
}
