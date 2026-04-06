"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "~/lib/trpc";
import { collectFingerprintBestEffort } from "~/lib/forensic";
import { SignaturePad } from "~/components/signing/signature-pad";

export function MobileSignClient({ token, mode = "signature" }: { token: string; mode?: "signature" | "initials" }) {
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [rotationPromptDismissed, setRotationPromptDismissed] = useState(false);
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const sessionStartRef = useRef(Date.now());

  const submitMut = trpc.document.submitMobileSignature.useMutation();
  const sessionQuery = trpc.document.pollMobileSign.useQuery(
    { token },
    {
      enabled: !submitMut.isPending && !submitMut.isSuccess && !submitMut.isError,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  const queryErrorMessage = sessionQuery.error
    ? "Invalid signing link."
    : sessionQuery.data?.status === "expired"
      ? "This signing link has expired."
      : null;
  const errorMessage = submitMut.error?.message ?? queryErrorMessage;
  const status: "loading" | "ready" | "signing" | "done" | "error" = submitMut.isPending
    ? "signing"
    : submitMut.isSuccess
      ? "done"
      : submitMut.isError
        ? "error"
        : sessionQuery.error
          ? "error"
          : sessionQuery.data?.status === "expired"
            ? "error"
            : sessionQuery.data?.status === "signed"
              ? "done"
              : sessionQuery.data
                ? "ready"
                : "loading";

  // Track orientation
  useEffect(() => {
    const check = () => {
      const isLandscape = window.innerWidth > window.innerHeight;
      if (isLandscape) setRotationPromptDismissed(false);
      setOrientation(isLandscape ? "landscape" : "portrait");
    };
    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  // Try to lock landscape via Screen Orientation API (signature only)
  useEffect(() => {
    if (status !== "ready" || mode === "initials") return;
    try {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (type: string) => Promise<void>;
        unlock?: () => void;
      };
      if (orientation.lock) {
        orientation.lock("landscape").catch(() => {
          /* best-effort orientation lock */
        });
      }
    } catch {
      /* orientation API not supported */
    }
    return () => {
      try {
        const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
        orientation.unlock?.();
      } catch {
        /* best-effort unlock */
      }
    };
  }, [status, mode]);

  const handleCapture = useCallback((dataUrl: string) => {
    setSignatureData(dataUrl);
  }, []);

  const handleClear = useCallback(() => {
    setSignatureData(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!signatureData) return;

    let fingerprint: Record<string, unknown> = {};
    try {
      fingerprint = (await collectFingerprintBestEffort()) as unknown as Record<string, unknown>;
    } catch {
      /* best-effort fingerprint collection */
    }

    const mobileForensic = {
      sessionDurationMs: Date.now() - sessionStartRef.current,
      device: {
        screenWidth: screen.width,
        screenHeight: screen.height,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        orientation,
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
        connectionType:
          (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType ?? null,
      },
      fingerprint,
    };

    submitMut.mutate({
      token,
      signatureData,
      mobileForensic: mobileForensic as unknown as Record<string, unknown>,
    });
  }, [token, submitMut, signatureData, orientation]);

  // ── Portrait overlay: prompt to rotate (signature only) ──
  if (status === "ready" && orientation === "portrait" && mode === "signature" && !rotationPromptDismissed) {
    return (
      <MobileShell>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="text-5xl">📱↔️</div>
          <p className="text-center text-lg font-semibold text-white/80">Rotate Your Device</p>
          <p className="text-center text-sm text-white/40">
            Please turn your phone sideways (landscape mode) for the best signing experience.
          </p>
          <div className="mt-4 flex h-16 w-28 items-center justify-center rounded-xl border-2 border-dashed border-white/20">
            <div className="flex h-8 w-20 items-center justify-center rounded-lg border border-white/30 text-[10px] text-white/30">
              landscape
            </div>
          </div>
          <button
            onClick={() => setRotationPromptDismissed(true)}
            className="mt-6 rounded-lg bg-white/5 px-4 py-2 text-xs text-white/40 hover:bg-white/10"
          >
            Continue anyway →
          </button>
        </div>
      </MobileShell>
    );
  }

  if (status === "error") {
    return (
      <MobileShell>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="space-y-3 text-center">
            <div className="text-4xl">⚠️</div>
            <p className="font-medium text-red-400">{errorMessage ?? "Something went wrong."}</p>
          </div>
        </div>
      </MobileShell>
    );
  }

  if (status === "done") {
    return (
      <MobileShell>
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="space-y-3 text-center">
            <div className="text-5xl text-emerald-400">✓</div>
            <p className="text-lg font-semibold text-emerald-400">
              {mode === "initials" ? "Initials Sent!" : "Signature Sent!"}
            </p>
            <p className="text-sm text-white/50">Return to your computer to continue.</p>
          </div>
        </div>
      </MobileShell>
    );
  }

  if (status === "loading") {
    return (
      <MobileShell>
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      </MobileShell>
    );
  }

  return (
    <MobileShell>
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.06] px-4 py-2">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/30">
            {mode === "initials" ? "Initial Document" : "Sign Document"}
          </p>
          <p className="text-sm font-medium text-white/80">
            {mode === "initials" ? "Draw your initials below" : "Draw your signature below"}
          </p>
        </div>
      </div>

      {/* Signature pad — reuses the proven desktop component */}
      <div className="min-h-0 flex-1 overflow-hidden px-3 py-2 [--sig-bg:#0a0a0e] [--sig-stroke:#ffffff]">
        <style>{`
          .mobile-sign-pad canvas { height: 100% !important; }
          .mobile-sign-pad .space-y-3 { height: 100%; display: flex; flex-direction: column; gap: 0.5rem; }
          .mobile-sign-pad .space-y-3 > label { display: none; }
          .mobile-sign-pad .space-y-3 > div:first-of-type { flex: 1; min-height: 0; }
          .mobile-sign-pad .space-y-3 > div:last-of-type { flex-shrink: 0; }
        `}</style>
        <div className="mobile-sign-pad h-full">
          <SignaturePad onCapture={handleCapture} onClear={handleClear} captured={!!signatureData} mode={mode} />
        </div>
      </div>

      {/* Submit */}
      <div className="shrink-0 px-3 pb-2 pt-1">
        <button
          onClick={handleSubmit}
          disabled={status === "signing" || !signatureData}
          className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50"
        >
          {status === "signing"
            ? "Sending..."
            : signatureData
              ? "Submit"
              : mode === "initials"
                ? "Draw initials first"
                : "Draw signature first"}
        </button>
      </div>
    </MobileShell>
  );
}

function MobileShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover"
      />
      <div
        className="fixed inset-0 flex flex-col"
        style={{
          background: "linear-gradient(180deg, #0f0f14 0%, #0a0a0e 100%)",
          touchAction: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
      >
        {children}
      </div>
    </>
  );
}
