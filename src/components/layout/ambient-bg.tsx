"use client";

import { useRef, useEffect } from "react";

/**
 * Ambient mesh gradient background.
 * Renders soft, slowly-moving gradient blobs on a canvas.
 * Sharper, more restrained than before — subtle color pools.
 */
export function AmbientBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let w = 0;
    let h = 0;

    const blobs = [
      { x: 0.15, y: 0.2, r: 0.3, vx: 0.00006, vy: 0.00005, color: [124, 92, 252] }, // accent purple
      { x: 0.75, y: 0.15, r: 0.25, vx: -0.00005, vy: 0.00007, color: [0, 212, 255] }, // cyan accent-2
      { x: 0.5, y: 0.7, r: 0.28, vx: 0.00005, vy: -0.00004, color: [99, 70, 224] }, // deep violet
    ];

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.scale(dpr, dpr);
    };

    const isLight = () => document.documentElement.classList.contains("light");

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      const light = isLight();
      const opacity = light ? 0.025 : 0.045;

      for (const b of blobs) {
        b.x += b.vx;
        b.y += b.vy;

        if (b.x < -0.1 || b.x > 1.1) b.vx *= -1;
        if (b.y < -0.1 || b.y > 1.1) b.vy *= -1;

        const ox = Math.sin(t * 0.00025 + b.x * 8) * 0.015;
        const oy = Math.cos(t * 0.0002 + b.y * 8) * 0.015;

        const cx = (b.x + ox) * w;
        const cy = (b.y + oy) * h;
        const radius = b.r * Math.min(w, h);

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        const [r, g, bl] = b.color;
        grad.addColorStop(0, `rgba(${r}, ${g}, ${bl}, ${opacity})`);
        grad.addColorStop(0.6, `rgba(${r}, ${g}, ${bl}, ${opacity * 0.3})`);
        grad.addColorStop(1, `rgba(${r}, ${g}, ${bl}, 0)`);

        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
      }

      animId = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0" style={{ zIndex: 0 }} aria-hidden />;
}
