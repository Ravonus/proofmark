import { describe, expect, it } from "vitest";

type MappedForensicSection = {
  evidenceHash: string | null;
  sessionProfile: {
    liveness: {
      verdict: string;
    } | null;
  } | null;
  liveness: {
    passRatio: number;
  } | null;
  eyeTracking: {
    livenessPassRatio?: number | null;
  } | null;
  signerBaseline: {
    verdict: string;
  } | null;
  forensicSessions: Array<{
    sessionId: string;
  }>;
};

describe("proof packet forensic mapping", () => {
  it("surfaces session profile, explicit liveness, signer baseline, and session history", async () => {
    const { buildProofPacketForensicSection } = (await import("~/server/proof-packet")) as {
      buildProofPacketForensicSection: (
        fe: Record<string, unknown>,
        forensicHash: string | null,
      ) => MappedForensicSection | null;
    };

    const forensicEvidence = {
      evidenceHash: "evidence-hash",
      fingerprint: {
        visitorId: "visitor-1",
        persistentId: "persist-1",
        webRtcLocalIps: ["10.0.0.2"],
      },
      behavioral: {
        timeOnPage: 18000,
        scrolledToBottom: true,
        maxScrollDepth: 100,
        pasteEvents: 1,
        copyEvents: 0,
        cutEvents: 0,
        replay: {
          encoding: "pm-replay-v1",
          tapeHash: "tape-hash",
          capabilities: ["field", "signature"],
          metrics: {
            eventCount: 22,
            byteLength: 420,
            targetCount: 4,
            stringCount: 3,
            signatureStrokeCount: 2,
            signaturePointCount: 17,
            clipboardEventCount: 1,
          },
        },
      },
      eyeTracking: {
        active: true,
        pointCount: 42,
        fixationCount: 8,
        avgFixationMs: 210,
        blinkCount: 3,
        blinkRate: 7,
        trackingCoverage: 0.92,
        passedCoverageThreshold: true,
        calibrationAccuracy: 0.88,
        livenessPassRatio: 1,
        livenessSuspicious: false,
      },
      sessionProfile: {
        typing: {
          sampleCount: 5,
          averageDelayMs: 140,
          stdDevMs: 30,
          coefficientOfVariation: 0.21,
          lagOneAutocorrelation: 0.12,
          verdict: "human",
          reason: "Typing cadence varies naturally.",
        },
        pointer: {
          mouseMoveCount: 18,
          clickCount: 4,
          focusChanges: 3,
          clickWithoutMovement: false,
        },
        timing: {
          durationMs: 18000,
          hiddenRatio: 0,
          firstReplayEventMs: 120,
          firstKeyMs: 400,
          firstSignatureMs: 14000,
        },
        replay: {
          eventCount: 22,
          scrollCount: 2,
          fieldCommitCount: 4,
          clipboardCount: 1,
          keyEventCount: 9,
          signatureEventCount: 5,
        },
        signature: {
          verdict: "human",
          reason: "Signature motion looks manual.",
          strokeCount: 2,
          pointCount: 17,
          durationMs: 980,
          motionComplexityScore: 0.62,
          motionUniformityScore: 0.24,
        },
        gaze: {
          active: true,
          verdict: "natural",
          reasons: ["Gaze follows the document."],
          features: {
            pointCount: 42,
            fixationCount: 8,
            blinkCount: 3,
            saccadeCount: 7,
            averageFixationMs: 210,
            fixationCoefficientOfVariation: 0.16,
            averageSaccadeVelocity: 120,
            horizontalTraversalRatio: 0.58,
            verticalTraversalRatio: 0.23,
            readingPatternScore: 0.69,
            revisitRatio: 0.11,
            anchorHitRatio: 0.2,
            coverageScore: 0.9,
            syntheticLikelihood: 0.08,
          },
        },
        liveness: {
          available: true,
          verdict: "passed",
          passRatio: 1,
          averageReactionMs: 640,
          suspicious: false,
          reasons: ["Completed all liveness checks."],
        },
        signals: [
          {
            code: "NATURAL_GAZE",
            source: "human",
            weight: 0.22,
            message: "Gaze pattern matches active reading.",
          },
        ],
        humanEvidenceScore: 0.64,
        automationEvidenceScore: 0.09,
      },
      signerBaseline: {
        sampleCount: 3,
        verdict: "consistent",
        deviationScore: 0.14,
        indicators: ["Current signing behavior matches prior sessions."],
        comparisons: [
          {
            metric: "typing.averageDelayMs",
            stage: "preparation",
            current: 140,
            baselineMean: 150,
            baselineStdDev: 20,
            zScore: -0.5,
            relativeDeviation: 0.07,
            deviates: false,
            message: "Typing timing matches signer baseline.",
          },
        ],
      },
      forensicSessions: [
        {
          sessionId: "session-1",
          visitIndex: 0,
          startedAt: "2026-03-28T00:00:00.000Z",
          endedAt: "2026-03-28T00:00:18.000Z",
          durationMs: 18000,
          behavioral: {
            timeOnPage: 18000,
            mouseMoveCount: 18,
            clickCount: 4,
            keyPressCount: 9,
          },
          replay: null,
        },
      ],
      flags: [],
      reverseDns: "host.example.com",
    };

    const section = buildProofPacketForensicSection(forensicEvidence, "stored-forensic-hash");

    expect(section?.evidenceHash).toBe("stored-forensic-hash");
    expect(section?.sessionProfile?.liveness).not.toBeNull();
    expect(section?.sessionProfile?.liveness?.verdict).toBe("passed");
    expect(section?.liveness?.passRatio).toBe(1);
    expect(section?.eyeTracking?.livenessPassRatio).toBe(1);
    expect(section?.signerBaseline?.verdict).toBe("consistent");
    expect(section?.forensicSessions).toHaveLength(1);
    expect(section?.forensicSessions[0]?.sessionId).toBe("session-1");
  });
});
