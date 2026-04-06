"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Check } from "lucide-react";

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
  variant?: "default" | "glass";
};

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select...",
  label,
  className = "",
  size = "md",
  variant = "default",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = options.find((o) => o.value === value);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const dropdownHeight = Math.min(options.length * 36 + 8, 260);

    const shouldDropUp = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
    setDropUp(shouldDropUp);

    const dropdownWidth = Math.max(rect.width, 180);
    setPosition({
      top: shouldDropUp ? rect.top - dropdownHeight - 4 : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - dropdownWidth - 8)),
      width: dropdownWidth,
    });
  }, [options.length]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node) || dropdownRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const [highlightedIdx, setHighlightedIdx] = useState(-1);

  useEffect(() => {
    if (open) {
      const enabledOpts = options.filter((o) => !o.disabled);
      const idx = enabledOpts.findIndex((o) => o.value === value);
      setHighlightedIdx(idx >= 0 ? idx : 0);
    }
  }, [open, value, options]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      const enabledOpts = options.filter((o) => !o.disabled);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIdx((prev) => (prev + 1) % enabledOpts.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIdx((prev) => (prev - 1 + enabledOpts.length) % enabledOpts.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const enabledOpt = enabledOpts[highlightedIdx];
        if (enabledOpt) onChange(enabledOpt.value);
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, options, onChange, highlightedIdx]);

  const sizeClasses = size === "sm" ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[12px]";

  const variantClasses =
    variant === "glass"
      ? "bg-white/5 border-white/8 hover:border-white/15"
      : "bg-[var(--bg-inset)] border-[var(--border)] hover:border-[var(--border-accent)]";

  return (
    <div className={className}>
      {label && (
        <span className="mb-1 block text-[10px] font-medium uppercase tracking-[0.1em] text-muted">{label}</span>
      )}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (!open) {
            updatePosition();
          }
          setOpen(!open);
        }}
        className={`flex w-full items-center justify-between rounded-sm border transition-colors ${sizeClasses} ${variantClasses} outline-none focus:border-[var(--accent)]`}
      >
        <span className={selected ? "text-primary" : "text-muted"}>
          {selected?.icon && <span className="mr-1.5 inline-flex">{selected.icon}</span>}
          {selected?.label ?? placeholder}
        </span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.12 }} className="ml-1.5 text-muted">
          <ChevronDown className="h-3 w-3" />
        </motion.span>
      </button>

      {open &&
        position &&
        createPortal(
          <AnimatePresence>
            <div className="fixed inset-0 z-[9998]" onClick={() => setOpen(false)} />

            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: dropUp ? 4 : -4, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: dropUp ? 4 : -4, scale: 0.98 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
              className="fixed z-[9999] overflow-hidden rounded-md border border-[var(--glass-border)] bg-[var(--bg-card)] shadow-lg backdrop-blur-xl"
              style={{
                top: position.top,
                left: position.left,
                width: position.width,
                minWidth: 180,
                maxHeight: 260,
              }}
            >
              <div className="overflow-y-auto p-0.5" style={{ maxHeight: 252 }}>
                {(() => {
                  const enabledOpts = options.filter((o) => !o.disabled);
                  return options.map((opt) => {
                    const isSelected = opt.value === value;
                    const enabledIdx = enabledOpts.indexOf(opt);
                    const isHighlighted = !opt.disabled && enabledIdx === highlightedIdx;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        disabled={opt.disabled}
                        onMouseEnter={() => {
                          if (!opt.disabled && enabledIdx >= 0) setHighlightedIdx(enabledIdx);
                        }}
                        onClick={() => {
                          onChange(opt.value);
                          setOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-[11px] transition-colors ${
                          isSelected
                            ? "bg-[var(--accent-subtle)] text-accent"
                            : opt.disabled
                              ? "cursor-not-allowed opacity-40"
                              : isHighlighted
                                ? "bg-[var(--bg-hover)] text-primary"
                                : "text-primary hover:bg-[var(--bg-hover)]"
                        }`}
                      >
                        {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                        <div className="min-w-0 flex-1">
                          <div className="truncate">{opt.label}</div>
                          {opt.description && <div className="truncate text-[9px] text-muted">{opt.description}</div>}
                        </div>
                        {isSelected && <Check className="h-3 w-3 shrink-0 text-accent" />}
                      </button>
                    );
                  });
                })()}
              </div>
            </motion.div>
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
