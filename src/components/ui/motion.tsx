"use client";

import { motion, AnimatePresence, type Variants } from "framer-motion";
import { type ReactNode, type ComponentProps, useRef, useCallback } from "react";
import { CheckCircle, FileSignature, Send, Lock, Plus } from "lucide-react";

// ── Fade + slide in from bottom ─────────────────────────────────────────────

export function FadeIn({
  children,
  delay = 0,
  duration = 0.4,
  y = 10,
  className,
}: {
  children: ReactNode;
  delay?: number;
  duration?: number;
  y?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: y / 2 }}
      transition={{ duration, delay, ease: [0.23, 1, 0.32, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── Stagger children ────────────────────────────────────────────────────────

const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.06, delayChildren: 0.08 },
  },
};

const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8, filter: "blur(2px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.35, ease: [0.23, 1, 0.32, 1] },
  },
};

export function StaggerContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className={className}>
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  );
}

// ── Scale in ────────────────────────────────────────────────────────────────

export function ScaleIn({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.3, delay, ease: [0.23, 1, 0.32, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── Glass card — sharp, minimal ─────────────────────────────────────────────

export function GlassCard({
  children,
  className = "",
  hover = true,
  ...props
}: { children: ReactNode; hover?: boolean } & Omit<ComponentProps<typeof motion.div>, "children">) {
  return (
    <motion.div
      className={`glass-card edge-highlight rounded-lg p-4 sm:p-5 ${className}`}
      whileHover={hover ? { y: -1, transition: { duration: 0.2 } } : undefined}
      {...props}
    >
      {children}
    </motion.div>
  );
}

// ── W3S Button System ───────────────────────────────────────────────────────

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "accent-outline";
type BtnSize = "xs" | "sm" | "md";

const BTN_VARIANTS: Record<BtnVariant, string> = {
  primary: "w3s-btn-primary",
  secondary: "w3s-btn-secondary",
  ghost: "w3s-btn-ghost",
  danger: "w3s-btn-danger",
  "accent-outline": "w3s-btn-accent-outline",
};

const BTN_SIZES: Record<BtnSize, string> = {
  xs: "h-6 px-2 text-[10px] gap-1",
  sm: "h-7 px-2.5 text-[11px] gap-1.5",
  md: "h-8 px-3.5 text-xs gap-1.5",
};

export function W3SButton({
  children,
  className = "",
  variant = "primary",
  size = "sm",
  disabled,
  onClick,
  loading,
  ...props
}: {
  children: ReactNode;
  variant?: BtnVariant;
  size?: BtnSize;
  disabled?: boolean;
  loading?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
} & Omit<ComponentProps<"button">, "onClick">) {
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (disabled || loading) return;
      const btn = e.currentTarget;
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      const pulse = document.createElement("span");
      pulse.className = "w3s-btn-pulse";
      pulse.style.left = `${x}px`;
      pulse.style.top = `${y}px`;
      btn.appendChild(pulse);
      setTimeout(() => pulse.remove(), 400);

      onClick?.(e);
    },
    [disabled, loading, onClick],
  );

  return (
    <button
      ref={btnRef}
      className={`w3s-btn ${BTN_VARIANTS[variant]} ${BTN_SIZES[size]} ${disabled ? "pointer-events-none opacity-40" : ""} ${loading ? "w3s-btn-loading" : ""} ${className}`}
      disabled={disabled}
      onClick={handleClick}
      {...props}
    >
      {loading && <span className="w3s-btn-spinner" />}
      {children}
    </button>
  );
}

export function W3SLink({
  children,
  className = "",
  href,
  variant = "primary",
  size = "sm",
}: {
  children: ReactNode;
  className?: string;
  href: string;
  variant?: BtnVariant;
  size?: BtnSize;
}) {
  return (
    <a href={href} className={`w3s-btn ${BTN_VARIANTS[variant]} ${BTN_SIZES[size]} inline-flex ${className}`}>
      {children}
    </a>
  );
}

// ── Icon Button ─────────────────────────────────────────────────────────────

export function W3SIconButton({
  children,
  className = "",
  active,
  onClick,
  title,
  ...props
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  title?: string;
} & Omit<ComponentProps<"button">, "onClick">) {
  return (
    <button
      className={`w3s-icon-btn ${active ? "w3s-icon-btn-active" : ""} ${className}`}
      onClick={onClick}
      title={title}
      {...props}
    >
      {children}
    </button>
  );
}

// ── Legacy compat ───────────────────────────────────────────────────────────

export function AnimatedButton({
  children,
  className = "",
  variant = "primary",
  disabled,
  onClick,
  ...props
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
} & Omit<ComponentProps<"button">, "onClick">) {
  return (
    <W3SButton variant={variant} className={className} disabled={disabled} onClick={onClick} {...props}>
      {children}
    </W3SButton>
  );
}

export function AnimatedLink({
  children,
  className = "",
  href,
  variant = "primary",
}: {
  children: ReactNode;
  className?: string;
  href: string;
  variant?: "primary" | "secondary" | "ghost";
}) {
  return (
    <W3SLink href={href} variant={variant} className={className}>
      {children}
    </W3SLink>
  );
}

// ── Page transition ─────────────────────────────────────────────────────────

export function PageTransition({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────────────

export function Skeleton({ className }: { className?: string }) {
  return <div className={`shimmer-skeleton rounded-xs ${className ?? ""}`} />;
}

export function SkeletonCard() {
  return (
    <div className="glass-card-flat space-y-3 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
        <Skeleton className="h-4 w-14 rounded-xs" />
      </div>
      <Skeleton className="h-1 w-full" />
      <div className="flex gap-1.5">
        <Skeleton className="h-4 w-16 rounded-xs" />
        <Skeleton className="h-4 w-16 rounded-xs" />
        <Skeleton className="h-4 w-16 rounded-xs" />
      </div>
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

// ── Onboarding checklist ────────────────────────────────────────────────────

interface OnboardingStep {
  label: string;
  description: string;
  icon: ReactNode;
  state: "completed" | "current" | "locked";
  action?: ReactNode;
}

export function OnboardingChecklist({
  walletConnected,
  onCreateDocument,
}: {
  walletConnected: boolean;
  onCreateDocument: () => void;
}) {
  const steps: OnboardingStep[] = [
    {
      label: "Connect Wallet",
      description: walletConnected ? "Wallet connected" : "Link your crypto wallet to get started",
      icon: <CheckCircle className="h-4 w-4" />,
      state: walletConnected ? "completed" : "current",
    },
    {
      label: "Create Your First Document",
      description: "Draft a document and add signature fields",
      icon: <FileSignature className="h-4 w-4" />,
      state: walletConnected ? "current" : "locked",
      action: walletConnected ? (
        <W3SButton variant="primary" size="xs" onClick={onCreateDocument} className="mt-2">
          <Plus className="h-3 w-3" /> Create Document
        </W3SButton>
      ) : undefined,
    },
    {
      label: "Send for Signature",
      description: "Share your document with signers",
      icon: walletConnected ? <Send className="h-4 w-4" /> : <Lock className="h-4 w-4" />,
      state: "locked",
    },
  ];

  return (
    <FadeIn className="w-full">
      <div className="glass-card rounded-lg border border-[var(--border)] p-5">
        <h3 className="mb-4 text-xs font-semibold uppercase tracking-[0.1em] text-muted">Getting Started</h3>
        <div className="space-y-0">
          {steps.map((step, i) => {
            const isCompleted = step.state === "completed";
            const isCurrent = step.state === "current";
            const isLocked = step.state === "locked";
            const isLast = i === steps.length - 1;

            return (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <motion.div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border transition-colors ${
                      isCompleted
                        ? "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]"
                        : isCurrent
                          ? "border-[var(--border-accent)] bg-[var(--accent-subtle)] text-[var(--accent)]"
                          : "border-[var(--border)] bg-[var(--bg-inset)] text-muted"
                    }`}
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: i * 0.1, duration: 0.25, ease: "easeOut" }}
                  >
                    {step.icon}
                  </motion.div>
                  {!isLast && (
                    <div
                      className={`min-h-[20px] w-px flex-1 transition-colors ${isCompleted ? "bg-[var(--success)]/30" : "bg-[var(--border)]"}`}
                    />
                  )}
                </div>
                <motion.div
                  className={`pb-4 ${isLast ? "pb-0" : ""}`}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 + 0.05, duration: 0.3 }}
                >
                  <p
                    className={`text-[13px] font-medium ${isCompleted ? "text-[var(--success)]" : isCurrent ? "text-primary" : "text-muted"}`}
                  >
                    {step.label}
                  </p>
                  <p className={`mt-0.5 text-[11px] ${isLocked ? "text-faint" : "text-muted"}`}>{step.description}</p>
                  {step.action}
                </motion.div>
              </div>
            );
          })}
        </div>
      </div>
    </FadeIn>
  );
}

export { AnimatePresence };
