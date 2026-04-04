import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildForensicSessionProfile } from "../src/lib/forensic/session";
import type { BehavioralSignals } from "../src/lib/forensic/types";

type Label = "human" | "agent";

type InputSample = {
  label: Label;
  behavioral?: BehavioralSignals;
  session?: {
    behavioral?: BehavioralSignals;
  };
  id?: string;
};

type MetricSummary = {
  count: number;
  min: number | null;
  p10: number | null;
  median: number | null;
  p90: number | null;
  max: number | null;
  mean: number | null;
};

function percentile(sorted: number[], ratio: number) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index] ?? null;
}

function summarize(values: number[]): MetricSummary {
  if (values.length === 0) {
    return { count: 0, min: null, p10: null, median: null, p90: null, max: null, mean: null };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    min: sorted[0] ?? null,
    p10: percentile(sorted, 0.1),
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1] ?? null,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

function midpoint(left: number | null, right: number | null) {
  if (left == null || right == null) return null;
  return (left + right) / 2;
}

function normalizeSamples(raw: unknown): InputSample[] {
  if (Array.isArray(raw)) return raw as InputSample[];
  if (raw && typeof raw === "object" && Array.isArray((raw as { samples?: unknown[] }).samples)) {
    return (raw as { samples: InputSample[] }).samples;
  }
  throw new Error("Expected a JSON array or an object with a samples array.");
}

function behavioralFromSample(sample: InputSample) {
  return sample.behavioral ?? sample.session?.behavioral ?? null;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: npm run forensic:thresholds -- <path-to-labeled-sessions.json>");
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  const content = await readFile(absolutePath, "utf8");
  const samples = normalizeSamples(JSON.parse(content));

  const labeledProfiles = samples
    .map((sample, index) => {
      const behavioral = behavioralFromSample(sample);
      if (!behavioral) return null;
      return {
        id: sample.id ?? `sample-${index + 1}`,
        label: sample.label,
        profile: buildForensicSessionProfile(behavioral),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry != null);

  const humans = labeledProfiles.filter((entry) => entry.label === "human");
  const agents = labeledProfiles.filter((entry) => entry.label === "agent");

  const metric = (
    entries: typeof labeledProfiles,
    getter: (entry: (typeof labeledProfiles)[number]) => number | null | undefined,
  ) =>
    summarize(
      entries.map(getter).filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    );

  const suggestions = {
    typingCvBoundary: midpoint(
      metric(agents, (entry) => entry.profile.typing.coefficientOfVariation).p90,
      metric(humans, (entry) => entry.profile.typing.coefficientOfVariation).p10,
    ),
    gazeReadingScoreBoundary: midpoint(
      metric(agents, (entry) => entry.profile.gaze.features?.readingPatternScore ?? null).p90,
      metric(humans, (entry) => entry.profile.gaze.features?.readingPatternScore ?? null).p10,
    ),
    livenessPassRatioBoundary: midpoint(
      metric(agents, (entry) => (entry.profile.liveness.available ? entry.profile.liveness.passRatio : null)).p90,
      metric(humans, (entry) => (entry.profile.liveness.available ? entry.profile.liveness.passRatio : null)).p10,
    ),
    signatureComplexityBoundary: midpoint(
      metric(agents, (entry) => entry.profile.signature?.motionComplexityScore ?? null).p90,
      metric(humans, (entry) => entry.profile.signature?.motionComplexityScore ?? null).p10,
    ),
  };

  const agreement = {
    typing: {
      humanCorrect: humans.filter((entry) => entry.profile.typing.verdict !== "bot").length,
      agentCorrect: agents.filter((entry) => entry.profile.typing.verdict !== "human").length,
    },
    gaze: {
      humanCorrect: humans.filter((entry) => entry.profile.gaze.verdict !== "synthetic").length,
      agentCorrect: agents.filter((entry) => entry.profile.gaze.verdict !== "natural").length,
    },
    liveness: {
      humanCorrect: humans.filter(
        (entry) => !entry.profile.liveness.available || entry.profile.liveness.verdict !== "failed",
      ).length,
      agentCorrect: agents.filter(
        (entry) => !entry.profile.liveness.available || entry.profile.liveness.verdict !== "passed",
      ).length,
    },
  };

  const output = {
    inputPath: absolutePath,
    sampleCount: labeledProfiles.length,
    labels: {
      human: humans.length,
      agent: agents.length,
    },
    metrics: {
      human: {
        typingCv: metric(humans, (entry) => entry.profile.typing.coefficientOfVariation),
        gazeReadingScore: metric(humans, (entry) => entry.profile.gaze.features?.readingPatternScore ?? null),
        livenessPassRatio: metric(humans, (entry) =>
          entry.profile.liveness.available ? entry.profile.liveness.passRatio : null,
        ),
        signatureComplexity: metric(humans, (entry) => entry.profile.signature?.motionComplexityScore ?? null),
      },
      agent: {
        typingCv: metric(agents, (entry) => entry.profile.typing.coefficientOfVariation),
        gazeReadingScore: metric(agents, (entry) => entry.profile.gaze.features?.readingPatternScore ?? null),
        livenessPassRatio: metric(agents, (entry) =>
          entry.profile.liveness.available ? entry.profile.liveness.passRatio : null,
        ),
        signatureComplexity: metric(agents, (entry) => entry.profile.signature?.motionComplexityScore ?? null),
      },
    },
    agreement,
    suggestedThresholds: suggestions,
  };

  console.log(JSON.stringify(output, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
