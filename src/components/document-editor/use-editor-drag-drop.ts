"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InlineField } from "~/lib/document/document-tokens";
import { getField } from "../fields/field-registry";

type DropTarget = {
  tokenIdx: number;
  charOffset: number;
  x: number;
  y: number;
  h: number;
  vertical: boolean;
};

function findCaretDropTarget(e: React.DragEvent, container: HTMLElement, containerRect: DOMRect): DropTarget | null {
  const caretRange = "caretRangeFromPoint" in document ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
  if (!caretRange) return null;
  const node = caretRange.startContainer;
  const offset = caretRange.startOffset;
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node.parentElement;
  while (el && el !== container && !el.hasAttribute("data-token-idx")) el = el.parentElement;
  if (!el?.hasAttribute("data-token-idx")) return null;
  const tokenIdx = parseInt(el.getAttribute("data-token-idx") ?? "0");
  const rangeRect = caretRange.getBoundingClientRect();
  if (rangeRect.height <= 0) return null;
  return {
    tokenIdx,
    charOffset: offset,
    x: rangeRect.left - containerRect.left,
    y: rangeRect.top - containerRect.top,
    h: rangeRect.height,
    vertical: true,
  };
}

function findBlockDropTarget(e: React.DragEvent, container: HTMLElement, containerRect: DOMRect): DropTarget {
  const wrappers = container.querySelectorAll("[data-token-idx]");
  let closestIdx = 0,
    closestDist = Infinity,
    indicatorY = 0;
  wrappers.forEach((el) => {
    const rect = el.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    const dist = Math.abs(e.clientY - midpoint);
    if (dist < closestDist) {
      closestDist = dist;
      closestIdx = parseInt(el.getAttribute("data-token-idx") || "0");
      indicatorY = e.clientY < midpoint ? rect.top - containerRect.top : rect.bottom - containerRect.top;
    }
  });
  return {
    tokenIdx: closestIdx,
    charOffset: -1,
    x: 0,
    y: indicatorY,
    h: 0,
    vertical: false,
  };
}

export function useEditorDragDrop(
  fields: InlineField[],
  moveFieldInlineAt: (fid: string, tokenIdx: number, charOffset: number) => void,
  moveFieldToIdx: (fid: string, toIdx: number) => void,
  insertFieldAfterToken: (afterIdx: number, type: InlineField["type"], label: string) => void,
  insertFieldInlineAt: (tokenIdx: number, charOffset: number, type: InlineField["type"], label: string) => void,
) {
  const [dragFieldId, setDragFieldId] = useState<string | null>(null);
  const [dragNewType, setDragNewType] = useState<InlineField["type"] | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 });
  const isDragging = dragFieldId !== null || dragNewType !== null;
  const docContainerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isDragging) return;
    let lastX = 0,
      lastY = 0,
      scheduled = false;
    const handleDrag = (e: DragEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!scheduled) {
        scheduled = true;
        rafRef.current = requestAnimationFrame(() => {
          setGhostPos({ x: lastX, y: lastY });
          scheduled = false;
        });
      }
    };
    document.addEventListener("drag", handleDrag);
    document.addEventListener("dragover", handleDrag);
    return () => {
      document.removeEventListener("drag", handleDrag);
      document.removeEventListener("dragover", handleDrag);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isDragging]);

  const dragGhostLabel = useMemo(() => {
    if (dragNewType) {
      const f = getField(dragNewType);
      return f ? f.label : dragNewType;
    }
    if (dragFieldId) {
      const f = fields.find((ff) => ff.id === dragFieldId);
      return f ? f.label : "Field";
    }
    return "";
  }, [dragNewType, dragFieldId, fields]);

  const handleDocDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = dragFieldId ? "move" : "copy";
      const container = docContainerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const dt = findCaretDropTarget(e, container, containerRect) ?? findBlockDropTarget(e, container, containerRect);
      dropTargetRef.current = dt;
      setDropTarget(dt);
    },
    [dragFieldId],
  );

  const handleDocDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const dt = dropTargetRef.current;
      if (!dt) return;
      if (dt.charOffset >= 0) {
        if (dragFieldId) moveFieldInlineAt(dragFieldId, dt.tokenIdx, dt.charOffset);
        else if (dragNewType) insertFieldInlineAt(dt.tokenIdx, dt.charOffset, dragNewType, "");
      } else {
        if (dragFieldId) moveFieldToIdx(dragFieldId, dt.tokenIdx + 1);
        else if (dragNewType) insertFieldAfterToken(dt.tokenIdx, dragNewType, "");
      }
      setDragFieldId(null);
      setDragNewType(null);
      dropTargetRef.current = null;
      setDropTarget(null);
    },
    [dragFieldId, dragNewType, moveFieldToIdx, insertFieldAfterToken, moveFieldInlineAt, insertFieldInlineAt],
  );

  return {
    dragFieldId,
    setDragFieldId,
    dragNewType,
    setDragNewType,
    dropTarget,
    setDropTarget,
    ghostPos,
    isDragging,
    docContainerRef,
    dragGhostLabel,
    handleDocDragOver,
    handleDocDrop,
  };
}
