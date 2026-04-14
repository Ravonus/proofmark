import { type DecodedForensicReplayEvent, decodeForensicReplay } from "./replay";
import type { ForensicReplayTape, TimedSignaturePoint, TimedSignatureStroke } from "./types";

export interface SignatureMotionBoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  aspectRatio: number;
}

export interface SignatureMotionAnalysis {
  committed: boolean;
  strokeCount: number;
  pointCount: number;
  durationMs: number;
  penLiftCount: number;
  pathLengthPx: number;
  boundingBox: SignatureMotionBoundingBox;
  averageVelocityPxPerMs: number;
  velocityVariance: number;
  velocityCoefficientOfVariation: number;
  directionChangeCount: number;
  pauseCount: number;
  maxPauseMs: number;
  zeroDeltaSegmentCount: number;
  pressureAverage: number | null;
  pressureVariance: number | null;
  pressureRange: number | null;
  motionComplexityScore: number;
  motionUniformityScore: number;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
}

function distance(left: TimedSignaturePoint, right: TimedSignaturePoint) {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function normalizeAngle(delta: number) {
  let value = delta;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

function collectPressures(points: TimedSignaturePoint[]): number[] {
  const pressures: number[] = [];
  for (const point of points) {
    if (typeof point.force === "number") {
      pressures.push(point.force);
    }
  }
  return pressures;
}

function analyzeSegments(points: TimedSignaturePoint[]) {
  const velocities: number[] = [];
  let pathLength = 0;
  let pauseCount = 0;
  let maxPauseMs = 0;
  let zeroDeltaSegmentCount = 0;

  for (let index = 1; index < points.length; index += 1) {
    const left = points[index - 1]!;
    const right = points[index]!;
    const deltaT = right.t - left.t;
    const segmentLength = distance(left, right);
    pathLength += segmentLength;
    if (deltaT > 0) {
      velocities.push(segmentLength / deltaT);
      if (deltaT >= 48) {
        pauseCount += 1;
        maxPauseMs = Math.max(maxPauseMs, deltaT);
      }
    } else {
      zeroDeltaSegmentCount += 1;
      if (segmentLength > 0) velocities.push(segmentLength);
    }
  }

  return {
    velocities,
    pathLength,
    pauseCount,
    maxPauseMs,
    zeroDeltaSegmentCount,
  };
}

function countDirectionChanges(points: TimedSignaturePoint[]): number {
  let count = 0;
  for (let index = 2; index < points.length; index += 1) {
    const first = points[index - 2]!;
    const middle = points[index - 1]!;
    const last = points[index]!;
    const previousLength = Math.hypot(middle.x - first.x, middle.y - first.y);
    const nextLength = Math.hypot(last.x - middle.x, last.y - middle.y);
    if (previousLength === 0 || nextLength === 0) continue;
    const turn = Math.abs(
      normalizeAngle(
        Math.atan2(last.y - middle.y, last.x - middle.x) - Math.atan2(middle.y - first.y, middle.x - first.x),
      ),
    );
    if (turn >= Math.PI / 4) count += 1;
  }
  return count;
}

function summarizePressures(pressures: number[]) {
  if (pressures.length === 0) {
    return {
      pressureAverage: null,
      pressureVariance: null,
      pressureRange: null,
    };
  }
  return {
    pressureAverage: average(pressures),
    pressureVariance: variance(pressures),
    pressureRange: Math.max(...pressures) - Math.min(...pressures),
  };
}

function analyzeStroke(stroke: TimedSignatureStroke) {
  const points = [...stroke].sort((left, right) => left.t - right.t);
  const pressures = collectPressures(points);
  const segments = analyzeSegments(points);
  const directionChangeCount = countDirectionChanges(points);

  const durationMs = Math.max(0, (points.at(-1)?.t ?? 0) - (points[0]?.t ?? 0));
  const averageVelocityPxPerMs = durationMs > 0 ? segments.pathLength / durationMs : average(segments.velocities);
  const velocityVariance = variance(segments.velocities);
  const velocityStdDev = Math.sqrt(velocityVariance);
  const velocityCoefficientOfVariation = averageVelocityPxPerMs > 0 ? velocityStdDev / averageVelocityPxPerMs : 0;

  return {
    pointCount: points.length,
    durationMs,
    pathLengthPx: segments.pathLength,
    pauseCount: segments.pauseCount,
    maxPauseMs: segments.maxPauseMs,
    directionChangeCount,
    zeroDeltaSegmentCount: segments.zeroDeltaSegmentCount,
    averageVelocityPxPerMs,
    velocityVariance,
    velocityCoefficientOfVariation,
    ...summarizePressures(pressures),
  };
}

function buildBoundingBox(points: TimedSignaturePoint[]): SignatureMotionBoundingBox {
  if (points.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
      aspectRatio: 1,
    };
  }

  let minX = points[0]!.x;
  let maxX = points[0]!.x;
  let minY = points[0]!.y;
  let maxY = points[0]!.y;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
    aspectRatio: width / Math.max(1, height),
  };
}

function scoreMotionComplexity(metrics: {
  pointCount: number;
  strokeCount: number;
  velocityCoefficientOfVariation: number;
  directionChangeCount: number;
  pauseCount: number;
  zeroDeltaSegmentCount: number;
  pressureVariance: number | null;
}) {
  const segmentScale = Math.max(1, metrics.pointCount - metrics.strokeCount);
  const velocityFactor = clamp(metrics.velocityCoefficientOfVariation / 0.6);
  const directionFactor = clamp(metrics.directionChangeCount / segmentScale);
  const pauseFactor = clamp(metrics.pauseCount / segmentScale);
  const zeroDeltaFactor = clamp(metrics.zeroDeltaSegmentCount / segmentScale);
  const pressureFactor = metrics.pressureVariance == null ? 0.25 : clamp(metrics.pressureVariance * 10);

  return clamp(
    0.42 * velocityFactor +
      0.24 * directionFactor +
      0.16 * pauseFactor +
      0.12 * zeroDeltaFactor +
      0.06 * pressureFactor,
  );
}

export function analyzeTimedSignature(strokes: TimedSignatureStroke[]): SignatureMotionAnalysis | null {
  const normalizedStrokes = strokes
    .map((stroke) => [...stroke].sort((left, right) => left.t - right.t))
    .filter((stroke) => stroke.length > 0);

  if (normalizedStrokes.length === 0) return null;

  const strokeSummaries = normalizedStrokes.map((stroke) => analyzeStroke(stroke));
  const allPoints = normalizedStrokes.flat();
  const strokeCount = normalizedStrokes.length;
  const pointCount = strokeSummaries.reduce((sum, stroke) => sum + stroke.pointCount, 0);
  const durationMs = strokeSummaries.reduce((sum, stroke) => sum + stroke.durationMs, 0);
  const penLiftCount = Math.max(0, strokeCount - 1);
  const pathLengthPx = strokeSummaries.reduce((sum, stroke) => sum + stroke.pathLengthPx, 0);
  const averageVelocityPxPerMs =
    durationMs > 0
      ? pathLengthPx / durationMs
      : average(strokeSummaries.map((stroke) => stroke.averageVelocityPxPerMs));
  const velocityVariance = average(strokeSummaries.map((stroke) => stroke.velocityVariance));
  const velocityCoefficientOfVariation = average(
    strokeSummaries.map((stroke) => stroke.velocityCoefficientOfVariation),
  );
  const directionChangeCount = strokeSummaries.reduce((sum, stroke) => sum + stroke.directionChangeCount, 0);
  const pauseCount = strokeSummaries.reduce((sum, stroke) => sum + stroke.pauseCount, 0);
  const maxPauseMs = strokeSummaries.reduce((max, stroke) => Math.max(max, stroke.maxPauseMs), 0);
  const zeroDeltaSegmentCount = strokeSummaries.reduce((sum, stroke) => sum + stroke.zeroDeltaSegmentCount, 0);
  const pressureValues = allPoints.flatMap((point) => (typeof point.force === "number" ? [point.force] : []));
  const pressureAverage = pressureValues.length > 0 ? average(pressureValues) : null;
  const pressureVariance = pressureValues.length > 0 ? variance(pressureValues) : null;
  const pressureRange = pressureValues.length > 0 ? Math.max(...pressureValues) - Math.min(...pressureValues) : null;
  const boundingBox = buildBoundingBox(allPoints);
  const motionComplexityScore = scoreMotionComplexity({
    pointCount,
    strokeCount,
    velocityCoefficientOfVariation,
    directionChangeCount,
    pauseCount,
    zeroDeltaSegmentCount,
    pressureVariance,
  });

  return {
    committed: true,
    strokeCount,
    pointCount,
    durationMs,
    penLiftCount,
    pathLengthPx,
    boundingBox,
    averageVelocityPxPerMs,
    velocityVariance,
    velocityCoefficientOfVariation,
    directionChangeCount,
    pauseCount,
    maxPauseMs,
    zeroDeltaSegmentCount,
    pressureAverage,
    pressureVariance,
    pressureRange,
    motionComplexityScore,
    motionUniformityScore: 1 - motionComplexityScore,
  };
}

function collectSignatureStrokes(events: DecodedForensicReplayEvent[]) {
  let activeStrokeStarts = new Map<number, number>();
  let activeStrokes = new Map<number, TimedSignatureStroke>();
  let lastCommittedStrokes: TimedSignatureStroke[] | null = null;
  let committed = false;

  const commitSession = () => {
    if (activeStrokes.size === 0) return;
    committed = true;
    lastCommittedStrokes = [...activeStrokes.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, stroke]) => stroke);
    activeStrokeStarts = new Map();
    activeStrokes = new Map();
  };

  for (const event of events) {
    switch (event.type) {
      case "signatureStart": {
        activeStrokeStarts.set(event.strokeId, event.at);
        activeStrokes.set(event.strokeId, [
          {
            x: event.x,
            y: event.y,
            t: 0,
            force: event.pressure,
          },
        ]);
        break;
      }
      case "signaturePoint": {
        const startAt = activeStrokeStarts.get(event.strokeId);
        const stroke = activeStrokes.get(event.strokeId);
        if (startAt == null || !stroke) break;
        stroke.push({
          x: event.x,
          y: event.y,
          t: Math.max(0, event.at - startAt),
          force: event.pressure,
        });
        break;
      }
      case "signatureEnd":
        break;
      case "signatureCommit":
        commitSession();
        break;
      case "signatureClear":
        activeStrokeStarts.clear();
        activeStrokes.clear();
        break;
      default:
        break;
    }
  }

  const activeSnapshot = [...activeStrokes.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, stroke]) => stroke)
    .filter((stroke) => stroke.length > 0);

  return {
    committed,
    strokes: activeSnapshot.length > 0 ? activeSnapshot : (lastCommittedStrokes ?? []),
  };
}

export function extractReplaySignatureAnalysis(replay: ForensicReplayTape | null | undefined) {
  if (!replay) return null;
  const signatureEvents = decodeForensicReplay(replay).filter(
    (event) =>
      event.type === "signatureStart" ||
      event.type === "signaturePoint" ||
      event.type === "signatureEnd" ||
      event.type === "signatureCommit" ||
      event.type === "signatureClear",
  );
  const collected = collectSignatureStrokes(signatureEvents);
  if (collected.strokes.length === 0) return null;
  const analysis = analyzeTimedSignature(collected.strokes);
  if (!analysis) return null;
  return {
    ...analysis,
    committed: collected.committed,
  };
}
