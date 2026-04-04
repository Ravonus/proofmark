import { decodeForensicReplay } from "./replay";
import type { ForensicReplayTape } from "./types";

export interface GazeBehaviorFeatures {
  active: boolean;
  pointCount: number;
  fixationCount: number;
  avgFixationMs: number;
  maxFixationMs: number;
  minFixationMs: number;
  fixationStdDev: number;
  fixationCoefficientOfVariation: number;
  saccadeCount: number;
  avgSaccadeVelocity: number;
  maxSaccadeVelocity: number;
  blinkCount: number;
  blinkRate: number;
  avgBlinkDurationMs: number;
  confidenceAvg: number;
  trackingCoverage: number;
  trackingLostCount: number;
  totalTrackingLostMs: number;
  calibrationAccuracy: number | null;
  gazeDispersion: number;
  contentFocusRatio: number;
  readingPatternScore: number;
  horizontalProgressionRatio: number;
  returnSweepCount: number;
  anchorHitRatio: number;
  uniqueAnchorCount: number;
  anchorTransitionCount: number;
}

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1));
}

export function extractGazeBehaviorFeatures(replay: ForensicReplayTape): GazeBehaviorFeatures | null {
  const events = decodeForensicReplay(replay);
  const gazeEvents = events.filter(
    (event) =>
      event.type === "gazePoint" ||
      event.type === "gazeFixation" ||
      event.type === "gazeSaccade" ||
      event.type === "gazeBlink" ||
      event.type === "gazeCalibration" ||
      event.type === "gazeLost",
  );

  if (gazeEvents.length === 0) return null;

  const fixationDurations: number[] = [];
  const saccadeVelocities: number[] = [];
  const blinkDurations: number[] = [];
  const gazeXCoords: number[] = [];
  const gazeYCoords: number[] = [];
  const gazeConfidences: number[] = [];

  let trackingLostCount = 0;
  let trackingLostMs = 0;
  let lastLostAt: number | null = null;
  let calibrationAccuracy: number | null = null;
  let horizontalProgressions = 0;
  let returnSweepCount = 0;
  let saccadeCount = 0;
  let anchorHits = 0;
  let anchorTransitionCount = 0;
  let gazePointIndex = 0;
  let lastAnchorId = 0;
  const uniqueAnchorIds = new Set<number>();

  for (const event of gazeEvents) {
    switch (event.type) {
      case "gazePoint": {
        gazeXCoords.push(event.x);
        gazeYCoords.push(event.y);
        gazeConfidences.push(clamp(event.confidence / 255));

        const sample = replay.gazeAnchors?.samples[gazePointIndex] ?? null;
        gazePointIndex += 1;
        if ((sample?.anchorId ?? 0) > 0) {
          anchorHits += 1;
          uniqueAnchorIds.add(sample!.anchorId);
          if (lastAnchorId > 0 && lastAnchorId !== sample!.anchorId) anchorTransitionCount += 1;
          lastAnchorId = sample!.anchorId;
        } else {
          lastAnchorId = 0;
        }

        if (lastLostAt !== null) {
          trackingLostMs += Math.max(0, event.at - lastLostAt);
          lastLostAt = null;
        }
        break;
      }
      case "gazeFixation":
        fixationDurations.push(event.durationMs);
        break;
      case "gazeSaccade": {
        saccadeCount += 1;
        saccadeVelocities.push(event.velocityDegPerS);
        const dx = event.toX - event.fromX;
        const dy = event.toY - event.fromY;
        if (dx > 20 && Math.abs(dy) < 75) horizontalProgressions += 1;
        if (dx < -180 && dy > 10) returnSweepCount += 1;
        break;
      }
      case "gazeBlink":
        blinkDurations.push(event.durationMs);
        break;
      case "gazeCalibration":
        calibrationAccuracy = clamp(event.accuracy / 255);
        break;
      case "gazeLost":
        trackingLostCount += 1;
        lastLostAt = event.at;
        break;
    }
  }

  const sessionMs = Math.max(1, replay.metrics.maxTimestampMs || 1);
  if (lastLostAt !== null) trackingLostMs += Math.max(0, sessionMs - lastLostAt);

  const fixationStdDeviation = stdDev(fixationDurations);
  const avgFixationMs = average(fixationDurations);
  const xStd = gazeXCoords.length > 1 ? stdDev(gazeXCoords) / 1000 : 0;
  const yStd = gazeYCoords.length > 1 ? stdDev(gazeYCoords) / 1000 : 0;
  const contentPoints = gazeXCoords.filter(
    (x, index) => x >= 100 && x <= 900 && (gazeYCoords[index] ?? 0) >= 50 && (gazeYCoords[index] ?? 0) <= 950,
  ).length;

  const directionalScore = saccadeCount > 0 ? (horizontalProgressions + returnSweepCount) / saccadeCount : 0;
  const anchorHitRatio = gazeXCoords.length > 0 ? anchorHits / gazeXCoords.length : 0;
  const contentFocusRatio = gazeXCoords.length > 0 ? contentPoints / gazeXCoords.length : 0;

  return {
    active: true,
    pointCount: gazeXCoords.length,
    fixationCount: fixationDurations.length,
    avgFixationMs,
    maxFixationMs: fixationDurations.length > 0 ? Math.max(...fixationDurations) : 0,
    minFixationMs: fixationDurations.length > 0 ? Math.min(...fixationDurations) : 0,
    fixationStdDev: fixationStdDeviation,
    fixationCoefficientOfVariation: avgFixationMs > 0 ? fixationStdDeviation / avgFixationMs : 0,
    saccadeCount,
    avgSaccadeVelocity: average(saccadeVelocities),
    maxSaccadeVelocity: saccadeVelocities.length > 0 ? Math.max(...saccadeVelocities) : 0,
    blinkCount: blinkDurations.length,
    blinkRate: sessionMs > 0 ? (blinkDurations.length / sessionMs) * 60000 : 0,
    avgBlinkDurationMs: average(blinkDurations),
    confidenceAvg: average(gazeConfidences),
    trackingCoverage: clamp((sessionMs - trackingLostMs) / sessionMs),
    trackingLostCount,
    totalTrackingLostMs: trackingLostMs,
    calibrationAccuracy,
    gazeDispersion: clamp(Math.sqrt(xStd ** 2 + yStd ** 2) * 2),
    contentFocusRatio,
    readingPatternScore: clamp(directionalScore * 0.7 + contentFocusRatio * 0.2 + anchorHitRatio * 0.1),
    horizontalProgressionRatio: saccadeCount > 0 ? horizontalProgressions / saccadeCount : 0,
    returnSweepCount,
    anchorHitRatio,
    uniqueAnchorCount: uniqueAnchorIds.size,
    anchorTransitionCount,
  };
}
