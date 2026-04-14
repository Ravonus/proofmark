import { describeReplayEvent, type PreparedReplayLane, type ReplayLaneSnapshot } from "./replay-runtime";

type ReplayMode = "sync" | "solo";

function trim(value: string | null | undefined, max = 52) {
  if (!value) return null;
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

type RectParams = {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
};

function drawRoundedRect({ ctx, x, y, width, height, radius }: RectParams) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

type OverlayParams = {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  width: number;
  height: number;
  snapshot: ReplayLaneSnapshot;
};

function drawGazeOverlay({ ctx, x, y, width, height, snapshot }: OverlayParams) {
  if (!snapshot.gazeActive || snapshot.gazeTrail.length === 0) return;

  ctx.save();

  const trail = snapshot.gazeTrail;
  for (let i = 0; i < trail.length; i += 1) {
    const point = trail[i]!;
    const age = i / trail.length;
    const alpha = age * 0.5 * (point.confidence / 255);
    const radius = 2 + age * 4;
    const px = x + (point.x / 1000) * width;
    const py = y + (point.y / 1000) * height;

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(59, 130, 246, ${alpha})`;
    ctx.fill();
  }

  if (snapshot.gazePosition && !snapshot.gazeTrackingLost) {
    const gx = x + (snapshot.gazePosition.x / 1000) * width;
    const gy = y + (snapshot.gazePosition.y / 1000) * height;
    const conf = snapshot.gazePosition.confidence / 255;

    const gradient = ctx.createRadialGradient(gx, gy, 0, gx, gy, 14);
    gradient.addColorStop(0, `rgba(59, 130, 246, ${0.6 * conf})`);
    gradient.addColorStop(1, "rgba(59, 130, 246, 0)");
    ctx.beginPath();
    ctx.arc(gx, gy, 14, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(gx, gy, 4, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(147, 197, 253, ${conf})`;
    ctx.fill();
  }

  if (snapshot.gazeFixation) {
    const fx = x + (snapshot.gazeFixation.x / 1000) * width;
    const fy = y + (snapshot.gazeFixation.y / 1000) * height;
    const ringRadius = 8 + Math.min(12, snapshot.gazeFixation.durationMs / 100);
    ctx.beginPath();
    ctx.arc(fx, fy, ringRadius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(251, 191, 36, 0.6)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (snapshot.gazeTrackingLost) {
    ctx.fillStyle = "rgba(239, 68, 68, 0.6)";
    ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("GAZE LOST", x + 8, y + 14);
  }

  ctx.restore();
}

function drawSignaturePreview({ ctx, x, y, width, height, snapshot }: OverlayParams) {
  const rs = getComputedStyle(document.documentElement);
  drawRoundedRect({ ctx, x, y, width, height, radius: 16 });
  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-sig-bg").trim() || "#0c121d";
  ctx.fill();
  ctx.strokeStyle = rs.getPropertyValue("--replay-canvas-border").trim() || "rgba(255,255,255,0.08)";
  ctx.stroke();

  const allPoints = snapshot.signatureStrokes.flat();
  if (allPoints.length === 0) {
    ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-faint").trim() || "rgba(255,255,255,0.28)";
    ctx.font = "500 16px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText("No signature motion yet", x + 20, y + height / 2);
    return;
  }

  let minX = allPoints[0]!.x;
  let maxX = allPoints[0]!.x;
  let minY = allPoints[0]!.y;
  let maxY = allPoints[0]!.y;
  for (const point of allPoints) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const padding = 18;
  const scale = Math.min((width - padding * 2) / contentWidth, (height - padding * 2) / contentHeight);
  const offsetX = x + padding + (width - padding * 2 - contentWidth * scale) / 2;
  const offsetY = y + padding + (height - padding * 2 - contentHeight * scale) / 2;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#8ed3ff";
  ctx.lineWidth = 3;
  for (const stroke of snapshot.signatureStrokes) {
    if (stroke.length === 0) continue;
    ctx.beginPath();
    ctx.moveTo(offsetX + (stroke[0]!.x - minX) * scale, offsetY + (stroke[0]!.y - minY) * scale);
    for (let index = 1; index < stroke.length; index += 1) {
      const point = stroke[index]!;
      ctx.lineTo(offsetX + (point.x - minX) * scale, offsetY + (point.y - minY) * scale);
    }
    ctx.stroke();
  }
  ctx.restore();
}

type LaneCardParams = {
  ctx: CanvasRenderingContext2D;
  rs: CSSStyleDeclaration;
  lane: PreparedReplayLane;
  snapshot: ReplayLaneSnapshot;
  cardX: number;
  cardWidth: number;
  cardHeight: number;
};

function drawLaneCardDetails(params: LaneCardParams) {
  const { ctx, rs, snapshot, cardX, cardWidth } = params;
  const cardY = 104;
  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-label").trim() || "rgba(255,255,255,0.78)";
  ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`Page ${snapshot.page}/${Math.max(1, snapshot.totalPages)}`, cardX + 18, cardY + 262);
  ctx.fillText(`Target: ${trim(snapshot.currentTarget, 32) ?? "None"}`, cardX + 18, cardY + 284, cardWidth - 36);
  ctx.fillText(`Focus: ${trim(snapshot.focusedTarget, 32) ?? "None"}`, cardX + 18, cardY + 306, cardWidth - 36);
  ctx.fillText(`Highlight: ${trim(snapshot.highlightedLabel, 32) ?? "None"}`, cardX + 18, cardY + 328, cardWidth - 36);

  const metrics = params.lane.signatureMotion;
  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-muted").trim() || "rgba(255,255,255,0.52)";
  ctx.font = "500 12px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(
    metrics
      ? `Signature: ${metrics.strokeCount} strokes, ${metrics.directionChangeCount} turns, uniformity ${(metrics.motionUniformityScore * 100).toFixed(0)}%`
      : "Signature: no motion analysis",
    cardX + 18,
    cardY + 358,
    cardWidth - 36,
  );
}

function drawLaneCard(params: LaneCardParams) {
  const { ctx, rs, lane, snapshot, cardX, cardWidth, cardHeight } = params;
  const cardY = 104;

  drawRoundedRect({
    ctx,
    x: cardX,
    y: cardY,
    width: cardWidth,
    height: cardHeight,
    radius: 20,
  });
  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-card").trim() || "rgba(8,10,16,0.62)";
  ctx.fill();
  ctx.strokeStyle = rs.getPropertyValue("--replay-canvas-border").trim() || "rgba(255,255,255,0.08)";
  ctx.stroke();

  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text").trim() || "rgba(255,255,255,0.92)";
  ctx.font = "700 18px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(lane.label, cardX + 18, cardY + 28);

  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle =
    lane.automationReview?.verdict === "agent"
      ? "#fca5a5"
      : lane.automationReview?.verdict === "human"
        ? "#86efac"
        : "#fcd34d";
  ctx.fillText((lane.automationReview?.verdict ?? "uncertain").toUpperCase(), cardX + cardWidth - 110, cardY + 28);

  ctx.font = "500 12px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-dim").trim() || "rgba(255,255,255,0.6)";
  ctx.fillText(describeReplayEvent(snapshot.currentEvent), cardX + 18, cardY + 50, cardWidth - 36);

  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-muted").trim() || "rgba(255,255,255,0.45)";
  ctx.fillText(`Events: ${snapshot.elapsedEventCount}/${lane.eventCount}`, cardX + 18, cardY + 74);
  ctx.fillText(`Scroll: ${Math.round(snapshot.scrollRatio * 100)}%`, cardX + cardWidth - 120, cardY + 74);

  drawRoundedRect({
    ctx,
    x: cardX + 18,
    y: cardY + 94,
    width: 18,
    height: cardHeight - 130,
    radius: 8,
  });
  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-track").trim() || "rgba(255,255,255,0.08)";
  ctx.fill();
  const scrollHeight = (cardHeight - 130) * Math.max(0.12, snapshot.scrollRatio || 0.12);
  drawRoundedRect({
    ctx,
    x: cardX + 18,
    y: cardY + 94 + (cardHeight - 130 - scrollHeight) * snapshot.scrollRatio,
    width: 18,
    height: scrollHeight,
    radius: 8,
  });
  ctx.fillStyle = "#93c5fd";
  ctx.fill();

  drawSignaturePreview({
    ctx,
    x: cardX + 50,
    y: cardY + 94,
    width: cardWidth - 68,
    height: 140,
    snapshot,
  });
  drawGazeOverlay({
    ctx,
    x: cardX + 50,
    y: cardY + 94,
    width: cardWidth - 68,
    height: 140,
    snapshot,
  });

  drawLaneCardDetails(params);
}

export function drawReplayOverview(
  canvas: HTMLCanvasElement,
  params: {
    title: string;
    mode: ReplayMode;
    source: "wasm" | "ts";
    durationMs: number;
    currentMs: number;
    lanes: Array<{ lane: PreparedReplayLane; snapshot: ReplayLaneSnapshot }>;
  },
) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(960, Math.round(rect.width || 960));
  const height = Math.max(420, Math.round(rect.height || 420));
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const rs = getComputedStyle(document.documentElement);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, rs.getPropertyValue("--replay-canvas-bg").trim() || "#091018");
  gradient.addColorStop(1, rs.getPropertyValue("--replay-canvas-bg2").trim() || "#101a28");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text").trim() || "rgba(255,255,255,0.92)";
  ctx.font = "700 24px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(params.title, 28, 36);

  ctx.font = "500 13px ui-sans-serif, system-ui, sans-serif";
  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-dim").trim() || "rgba(255,255,255,0.54)";
  ctx.fillText(
    `Mode: ${params.mode === "sync" ? "Dual signer sync" : "Solo replay"}  |  Core: ${params.source === "wasm" ? "Rust/WASM" : "TypeScript fallback"}`,
    28,
    58,
  );

  const progress = params.durationMs > 0 ? Math.min(1, params.currentMs / params.durationMs) : 0;
  drawRoundedRect({
    ctx,
    x: 28,
    y: 74,
    width: width - 56,
    height: 12,
    radius: 6,
  });
  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-track").trim() || "rgba(255,255,255,0.08)";
  ctx.fill();
  drawRoundedRect({
    ctx,
    x: 28,
    y: 74,
    width: (width - 56) * progress,
    height: 12,
    radius: 6,
  });
  ctx.fillStyle = "#5ac8fa";
  ctx.fill();

  ctx.fillStyle = rs.getPropertyValue("--replay-canvas-text-label").trim() || "rgba(255,255,255,0.8)";
  ctx.font = "600 14px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`${formatDuration(params.currentMs)} / ${formatDuration(params.durationMs)}`, width - 200, 58);

  const cards = params.lanes.length === 0 ? 1 : params.lanes.length;
  const gutter = 20;
  const cardWidth = (width - 56 - gutter * (cards - 1)) / cards;
  const cardHeight = height - 126;

  for (let index = 0; index < params.lanes.length; index += 1) {
    const { lane, snapshot } = params.lanes[index]!;
    drawLaneCard({
      ctx,
      rs,
      lane,
      snapshot,
      cardX: 28 + index * (cardWidth + gutter),
      cardWidth,
      cardHeight,
    });
  }
}
