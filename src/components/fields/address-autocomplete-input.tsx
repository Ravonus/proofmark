"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, MapPin } from "lucide-react";
import type { AddressSuggestion } from "~/lib/address-autocomplete";

type Props = {
  value: string;
  placeholder: string;
  autoComplete?: string;
  disabled?: boolean;
  minChars?: number;
  inputClassName?: string;
  wrapperClassName?: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSuggestionSelect: (suggestion: AddressSuggestion) => void;
  loadSuggestions: (query: string) => Promise<AddressSuggestion[]>;
};

export function AddressAutocompleteInput({
  value,
  placeholder,
  autoComplete,
  disabled = false,
  minChars = 3,
  inputClassName,
  wrapperClassName,
  onChange,
  onFocus,
  onBlur,
  onSuggestionSelect,
  loadSuggestions,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const requestIdRef = useRef(0);
  const blurTimeoutRef = useRef<number | null>(null);

  const shouldQuery = focused && value.trim().length >= minChars && !disabled;
  const open = focused && !disabled && (loading || suggestions.length > 0);

  useEffect(() => {
    if (!shouldQuery) {
      setSuggestions([]);
      setLoading(false);
      setHighlightedIndex(0);
      return;
    }

    const currentRequestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      void loadSuggestions(value.trim())
        .then((nextSuggestions) => {
          if (requestIdRef.current !== currentRequestId) return;
          setSuggestions(nextSuggestions);
          setHighlightedIndex(0);
        })
        .catch(() => {
          if (requestIdRef.current !== currentRequestId) return;
          setSuggestions([]);
        })
        .finally(() => {
          if (requestIdRef.current === currentRequestId) {
            setLoading(false);
          }
        });
    }, 220);

    return () => window.clearTimeout(timer);
  }, [loadSuggestions, shouldQuery, value]);

  useEffect(
    () => () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    },
    [],
  );

  const activeSuggestion = useMemo(() => suggestions[highlightedIndex] ?? null, [highlightedIndex, suggestions]);

  const commitSuggestion = (suggestion: AddressSuggestion) => {
    onSuggestionSelect(suggestion);
    setSuggestions([]);
    setHighlightedIndex(0);
    setFocused(false);
  };

  return (
    <div className={wrapperClassName ?? "relative min-w-[220px] flex-1"}>
      <input
        value={value}
        type="text"
        disabled={disabled}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          if (blurTimeoutRef.current !== null) {
            window.clearTimeout(blurTimeoutRef.current);
            blurTimeoutRef.current = null;
          }
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          blurTimeoutRef.current = window.setTimeout(() => {
            setFocused(false);
            setSuggestions([]);
            onBlur?.();
          }, 120);
        }}
        onKeyDown={(event) => {
          if (!open || suggestions.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlightedIndex((current) => Math.min(current + 1, suggestions.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlightedIndex((current) => Math.max(current - 1, 0));
          } else if (event.key === "Enter" && activeSuggestion) {
            event.preventDefault();
            commitSuggestion(activeSuggestion);
          } else if (event.key === "Escape") {
            setSuggestions([]);
            setFocused(false);
          }
        }}
        className={inputClassName}
      />

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 right-0 top-full z-[90] mt-2 overflow-hidden rounded-2xl border border-white/10 bg-[rgba(15,23,42,0.96)] shadow-2xl backdrop-blur-xl"
          >
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-white/55">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Looking up addresses...
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto py-1">
                {suggestions.map((suggestion, index) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      commitSuggestion(suggestion);
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors ${
                      index === highlightedIndex ? "bg-white/10 text-white" : "text-white/80 hover:bg-white/5"
                    }`}
                  >
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{suggestion.primaryLine}</span>
                      {(suggestion.secondaryLine || suggestion.formatted) && (
                        <span className="mt-0.5 block truncate text-[11px] text-white/45">
                          {suggestion.secondaryLine || suggestion.formatted}
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
