"use client";

import { useCallback, useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  opacity: number;
  baseOpacity: number;
};

const INTERACT_RADIUS = 150;
const LINK_RADIUS = 120;

function updateAndDrawParticles(opts: {
  ctx: CanvasRenderingContext2D;
  particles: Particle[];
  mx: number;
  my: number;
  accent: string;
  w: number;
  h: number;
}) {
  const { ctx, particles, mx, my, accent, w, h } = opts;
  for (const p of particles) {
    const dx = p.x - mx;
    const dy = p.y - my;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < INTERACT_RADIUS) {
      const force = (1 - dist / INTERACT_RADIUS) * 0.8;
      p.vx += (dx / dist) * force * 0.15;
      p.vy += (dy / dist) * force * 0.15;
      p.opacity = p.baseOpacity + force * 0.5;
    } else {
      p.opacity += (p.baseOpacity - p.opacity) * 0.02;
    }
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.99;
    p.vy *= 0.99;
    if (p.x < -10) p.x = w + 10;
    if (p.x > w + 10) p.x = -10;
    if (p.y < -10) p.y = h + 10;
    if (p.y > h + 10) p.y = -10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.globalAlpha = p.opacity;
    ctx.fill();
  }
}

function drawParticleLinks(ctx: CanvasRenderingContext2D, particles: Particle[], accent: string) {
  ctx.globalAlpha = 1;
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i]!;
      const b = particles[j]!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < LINK_RADIUS) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = (1 - dist / LINK_RADIUS) * 0.12;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }
}

function drawMouseLinks(ctx: CanvasRenderingContext2D, particles: Particle[], mx: number, my: number, accent: string) {
  for (const p of particles) {
    const dx = p.x - mx;
    const dy = p.y - my;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < INTERACT_RADIUS) {
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(p.x, p.y);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = (1 - dist / INTERACT_RADIUS) * 0.2;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }
}

export function ParticleBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -1000, y: -1000 });
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);

  const initParticles = useCallback((w: number, h: number) => {
    const count = Math.min(Math.floor((w * h) / 18000), 80);
    const particles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const baseOpacity = 0.15 + Math.random() * 0.25;
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        radius: 1 + Math.random() * 1.5,
        opacity: baseOpacity,
        baseOpacity,
      });
    }
    return particles;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.scale(dpr, dpr);
      particlesRef.current = initParticles(window.innerWidth, window.innerHeight);
    };
    resize();
    window.addEventListener("resize", resize);

    const handleMouse = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("mousemove", handleMouse);

    const getAccentColor = () => {
      const style = getComputedStyle(document.documentElement);
      return style.getPropertyValue("--accent").trim() || "#6366f1";
    };

    const draw = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);
      const accent = getAccentColor();
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      const particles = particlesRef.current;
      updateAndDrawParticles({ ctx, particles, mx, my, accent, w, h });
      drawParticleLinks(ctx, particles, accent);
      drawMouseLinks(ctx, particles, mx, my, accent);
      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", handleMouse);
    };
  }, [initParticles]);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-0" aria-hidden="true" />;
}
