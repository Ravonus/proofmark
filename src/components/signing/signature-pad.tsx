"use client";

import { useRef, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AnimatedButton } from "../ui/motion";
import { signatureStrokesToDataUrl, type SignatureStroke } from "~/lib/signature-svg";
import type { TimedSignatureStroke } from "~/lib/forensic";
import type { BehavioralTracker } from "~/lib/forensic";
import { getSavedSignature, saveSignature } from "~/lib/signature-store";

type Props = {
  onCapture: (dataUrl: string) => void;
  onClear: () => void;
  captured: boolean;
  forensicTracker?: BehavioralTracker | null;
  forensicSurfaceId?: string;
  /** "initials" = smaller canvas with different label */
  mode?: "signature" | "initials";
  /** Signer identity for reuse lookup (address or email) */
  signerIdentity?: string;
  /** Document ID for save context */
  documentId?: string;
};

export function SignaturePad({
  onCapture,
  onClear,
  captured,
  forensicTracker,
  forensicSurfaceId = "signature-pad",
  mode = "signature",
  signerIdentity,
  documentId,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<TimedSignatureStroke[]>([]);
  const activeStrokeRef = useRef<TimedSignatureStroke | null>(null);
  const activeReplayStrokeRef = useRef<number | null>(null);
  const drawOriginRef = useRef<number | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const setupCanvas = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return; // not laid out yet
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
      const styles = getComputedStyle(document.documentElement);
      ctx.strokeStyle = styles.getPropertyValue("--sig-stroke").trim() || "#e4e4e7";
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    };

    // Use ResizeObserver to init once canvas has real dimensions
    const ro = new ResizeObserver(() => {
      if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
        setupCanvas();
      }
    });
    ro.observe(canvas);
    // Also try immediately in case already laid out
    setupCanvas();

    return () => ro.disconnect();
  }, []);

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const drawOrigin = drawOriginRef.current ?? Date.now();
    drawOriginRef.current = drawOrigin;
    if ("touches" in e) {
      const touch = e.touches[0]!;
      const touchForce = (touch as Touch & { force?: number }).force;
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
        t: Date.now() - drawOrigin,
        force: typeof touchForce === "number" ? touchForce : null,
      };
    }
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      t: Date.now() - drawOrigin,
      force: null,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setDrawing(true);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    const stroke: TimedSignatureStroke = [pos];
    strokesRef.current.push(stroke);
    activeStrokeRef.current = stroke;
    activeReplayStrokeRef.current =
      forensicTracker?.startSignatureStroke(forensicSurfaceId, pos.x, pos.y, pos.force) ?? null;
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const pos = getPos(e);
    activeStrokeRef.current?.push(pos);
    if (activeReplayStrokeRef.current != null) {
      forensicTracker?.recordSignaturePoint(activeReplayStrokeRef.current, pos.x, pos.y, pos.force);
    }
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    setHasStrokes(true);
  };

  const endDraw = () => {
    setDrawing(false);
    if (activeReplayStrokeRef.current != null) {
      forensicTracker?.endSignatureStroke(activeReplayStrokeRef.current);
      activeReplayStrokeRef.current = null;
    }
    activeStrokeRef.current = null;
  };

  const handleCapture = () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;
    const rect = canvas.getBoundingClientRect();
    const styles = getComputedStyle(document.documentElement);
    const stroke = styles.getPropertyValue("--sig-stroke").trim();
    const bg = styles.getPropertyValue("--sig-bg").trim();
    const dark = !bg || bg.startsWith("#0") || bg.startsWith("#1") || bg.startsWith("#2");
    const sigStroke = stroke || (dark ? "#e4e4e7" : "#161616");
    const dataUrl = signatureStrokesToDataUrl(strokesRef.current as SignatureStroke[], rect.width, rect.height, {
      strokeColor: sigStroke,
    });
    forensicTracker?.commitSignature(forensicSurfaceId, strokesRef.current);
    if (signerIdentity) saveSignature(signerIdentity, mode, dataUrl, documentId);
    onCapture(dataUrl);
  };

  const handleReusePrevious = () => {
    if (!signerIdentity) return;
    const saved = getSavedSignature(signerIdentity, mode);
    if (!saved) return;
    saveSignature(signerIdentity, mode, saved.dataUrl, documentId);
    onCapture(saved.dataUrl);
  };

  const hasSavedSignature = signerIdentity ? !!getSavedSignature(signerIdentity, mode) : false;
  const isInitials = mode === "initials";
  const canvasHeight = isInitials ? "80px" : "150px";
  const label = isInitials ? "Draw Your Initials" : "Draw Your Signature";
  const placeholder = isInitials ? "Initial here" : "Sign here";

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    strokesRef.current = [];
    activeStrokeRef.current = null;
    activeReplayStrokeRef.current = null;
    drawOriginRef.current = null;
    setHasStrokes(false);
    forensicTracker?.clearSignature(forensicSurfaceId);
    onClear();
  };

  return (
    <motion.div
      className="space-y-3"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <label className="block text-xs text-muted">{label}</label>
      <motion.div
        className={`relative overflow-hidden rounded-xl border-2 border-dashed transition-colors ${
          captured ? "border-success/40 bg-success/5" : "bg-surface/50 border-border"
        }`}
        whileHover={!captured ? { borderColor: "var(--accent)" } : undefined}
        transition={{ duration: 0.2 }}
      >
        <canvas
          ref={canvasRef}
          className="w-full cursor-crosshair touch-none"
          style={{ height: canvasHeight, background: "var(--sig-bg)" }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        <AnimatePresence>
          {!hasStrokes && !captured && (
            <motion.div
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <p className="text-sm text-muted">{placeholder}</p>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {captured && (
            <motion.div
              className="absolute right-2 top-2"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
            >
              <span className="bg-success/20 border-success/20 rounded-full border px-2 py-0.5 text-[10px] font-medium text-success">
                &#10003; Captured
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <div className="flex gap-2">
        <AnimatePresence>
          {!captured && hasStrokes && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <AnimatedButton variant="primary" className="px-4 py-2 text-xs" onClick={handleCapture}>
                {isInitials ? "Confirm Initials" : "Confirm Signature"}
              </AnimatedButton>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {!captured && !hasStrokes && hasSavedSignature && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <AnimatedButton variant="secondary" className="px-4 py-2 text-xs" onClick={handleReusePrevious}>
                Reuse previous {isInitials ? "initials" : "signature"}
              </AnimatedButton>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {(hasStrokes || captured) && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <AnimatedButton variant="secondary" className="px-4 py-2 text-xs" onClick={handleClear}>
                Clear
              </AnimatedButton>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
