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
    return {
      count: 0,
      min: null,
      p10: null,
      median: null,
      p90: null,
      max: null,
      mean: null,
    };
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

type LabeledProfile = {
  id: string;
  label: Label;
  profile: ReturnType<typeof buildForensicSessionProfile>;
};

type ProfileGetter = (entry: LabeledProfile) => number | null | undefined;

function metricFor(entries: LabeledProfile[], getter: ProfileGetter) {
  return summarize(entries.map(getter).filter((v): v is number => typeof v === "number" && Number.isFinite(v)));
}

function computeSuggestions(humans: LabeledProfile[], agents: LabeledProfile[]) {
  const typingCvGetter: ProfileGetter = (e) => e.profile.typing.coefficientOfVariation;
  const gazeGetter: ProfileGetter = (e) => e.profile.gaze.features?.readingPatternScore ?? null;
  const livenessGetter: ProfileGetter = (e) => (e.profile.liveness.available ? e.profile.liveness.passRatio : null);
  const sigGetter: ProfileGetter = (e) => e.profile.signature?.motionComplexityScore ?? null;

  return {
    typingCvBoundary: midpoint(metricFor(agents, typingCvGetter).p90, metricFor(humans, typingCvGetter).p10),
    gazeReadingScoreBoundary: midpoint(metricFor(agents, gazeGetter).p90, metricFor(humans, gazeGetter).p10),
    livenessPassRatioBoundary: midpoint(metricFor(agents, livenessGetter).p90, metricFor(humans, livenessGetter).p10),
    signatureComplexityBoundary: midpoint(metricFor(agents, sigGetter).p90, metricFor(humans, sigGetter).p10),
  };
}

function computeAgreement(humans: LabeledProfile[], agents: LabeledProfile[]) {
  return {
    typing: {
      humanCorrect: humans.filter((e) => e.profile.typing.verdict !== "bot").length,
      agentCorrect: agents.filter((e) => e.profile.typing.verdict !== "human").length,
    },
    gaze: {
      humanCorrect: humans.filter((e) => e.profile.gaze.verdict !== "synthetic").length,
      agentCorrect: agents.filter((e) => e.profile.gaze.verdict !== "natural").length,
    },
    liveness: {
      humanCorrect: humans.filter((e) => !e.profile.liveness.available || e.profile.liveness.verdict !== "failed")
        .length,
      agentCorrect: agents.filter((e) => !e.profile.liveness.available || e.profile.liveness.verdict !== "passed")
        .length,
    },
  };
}

function buildMetricsForGroup(entries: LabeledProfile[]) {
  return {
    typingCv: metricFor(entries, (e) => e.profile.typing.coefficientOfVariation),
    gazeReadingScore: metricFor(entries, (e) => e.profile.gaze.features?.readingPatternScore ?? null),
    livenessPassRatio: metricFor(entries, (e) => (e.profile.liveness.available ? e.profile.liveness.passRatio : null)),
    signatureComplexity: metricFor(entries, (e) => e.profile.signature?.motionComplexityScore ?? null),
  };
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

  const labeledProfiles: LabeledProfile[] = samples
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

  const humans = labeledProfiles.filter((e) => e.label === "human");
  const agents = labeledProfiles.filter((e) => e.label === "agent");

  const output = {
    inputPath: absolutePath,
    sampleCount: labeledProfiles.length,
    labels: { human: humans.length, agent: agents.length },
    metrics: {
      human: buildMetricsForGroup(humans),
      agent: buildMetricsForGroup(agents),
    },
    agreement: computeAgreement(humans, agents),
    suggestedThresholds: computeSuggestions(humans, agents),
  };

  console.log(JSON.stringify(output, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
