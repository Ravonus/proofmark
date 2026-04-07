import { beforeEach, describe, expect, it, vi } from "vitest";
import { enrichForensicEvidence } from "~/server/forensic/forensic-proof";
import { loadPremiumChains } from "~/lib/platform/premium";
import type { ForensicEvidence } from "~/lib/forensic/types";

vi.mock("~/lib/platform/premium", () => ({
  loadPremiumChains: vi.fn(async () => null),
}));

function buildEvidence(overrides: Partial<ForensicEvidence> = {}): ForensicEvidence {
  return {
    version: 1,
    collectedAt: "2026-03-28T00:00:00.000Z",
    fingerprint: {
      visitorId: "visitor-1",
      canvasHash: "canvas",
      webglHash: "webgl",
      audioHash: "audio",
      screen: "1920x1080x24@2",
      timezone: "America/Denver",
      languages: ["en-US"],
      cpuCores: 8,
      deviceMemory: 16,
      platform: "MacIntel",
      touchPoints: 0,
      webdriver: false,
      fontsHash: "fonts",
      pluginsHash: "plugins",
      doNotTrack: null,
      cookieEnabled: true,
      persistentId: "persist-1",
      firstSeen: "2026-03-28T00:00:00.000Z",
      visitCount: 4,
      batteryLevel: null,
      batteryCharging: null,
      connectionType: "4g",
      connectionDownlink: 10,
      colorGamut: "p3",
      hdr: false,
      reducedMotion: false,
      darkMode: false,
      devicePixelRatio: 2,
      gpuVendor: "Apple",
      gpuRenderer: "Apple GPU",
      browserMajor: "Chrome/136",
      mathFingerprint: "math",
      webRtcLocalIps: [],
    },
    behavioral: {
      timeOnPage: 24_000,
      scrolledToBottom: true,
      maxScrollDepth: 100,
      mouseMoveCount: 24,
      clickCount: 6,
      keyPressCount: 14,
      pageWasHidden: false,
      hiddenDuration: 0,
      interactionTimeline: [],
      typingCadence: [110, 180, 140, 220, 150],
      mouseVelocityAvg: 0.4,
      mouseAccelerationPattern: "pattern",
      touchPressureAvg: null,
      scrollPattern: [0.2, 0.18, 0.25],
      focusChanges: 5,
      pasteEvents: 0,
      copyEvents: 0,
      cutEvents: 0,
      rightClicks: 0,
      gazeTrackingActive: false,
      gazePointCount: 0,
      gazeFixationCount: 0,
      gazeFixationAvgMs: 0,
      gazeBlinkCount: 0,
      gazeBlinkRate: 0,
      gazeTrackingCoverage: 0,
      replay: {
        version: 1,
        encoding: "pm-replay-v1",
        timeQuantumMs: 8,
        viewport: {
          width: 1440,
          height: 900,
          devicePixelRatio: 2,
          scrollWidth: 1440,
          scrollHeight: 3200,
        },
        targets: [],
        strings: [],
        tapeBase64: "ZmFrZQ==",
        tapeHash: "abc123",
        capabilities: ["scroll", "click", "field", "signature"],
        metrics: {
          eventCount: 18,
          byteLength: 280,
          targetCount: 4,
          stringCount: 3,
          signatureStrokeCount: 2,
          signaturePointCount: 18,
          clipboardEventCount: 0,
          maxTimestampMs: 24000,
          gazePointCount: 0,
          gazeFixationCount: 0,
          gazeBlinkCount: 0,
        },
      },
    },
    geo: {
      ip: "8.8.8.8",
      city: "Denver",
      region: "CO",
      country: "United States",
      countryCode: "US",
      latitude: 39.7,
      longitude: -104.9,
      isp: "Example ISP",
      org: "Example Org",
      asn: "AS15169",
      isVpn: false,
      isProxy: false,
      isTor: false,
      isDatacenter: false,
      isBot: false,
      fraudScore: 2,
      provider: "test",
    },
    tls: null,
    userAgent: "Mozilla/5.0",
    ip: "8.8.8.8",
    evidenceHash: "",
    flags: [],
    reverseDns: null,
    headerFingerprint: "headers",
    acceptLanguage: "en-US",
    forwardedChain: null,
    ...overrides,
  };
}

describe("forensic proof enrichment", () => {
  beforeEach(() => {
    vi.mocked(loadPremiumChains).mockResolvedValue(null);
  });

  it("builds embedded PDF summaries for standard/private mode", async () => {
    const result = await enrichForensicEvidence({
      evidence: buildEvidence(),
      proofMode: "PRIVATE",
      reviewContext: { signMethod: "WALLET", hasHandSignature: true },
    });

    expect(result.hash).toHaveLength(64);
    expect(result.evidence.storage?.mode).toBe("embedded_pdf");
    expect(result.evidence.pdfSummary?.lines.some((line) => line.startsWith("Evidence SHA-256:"))).toBe(true);
    expect(result.evidence.policyOutcome?.action).toBe("ALLOW");
  });

  it("builds external CID and anchor summaries for premium/hybrid mode", async () => {
    vi.mocked(loadPremiumChains).mockResolvedValue({
      autoAnchorToAllChains: vi.fn(async () => ({
        base: { txHash: "0xbasehash1234567890", blockNumber: 123 },
        sol: { txHash: "solhash1234567890", slot: 456 },
        btc: "queued" as const,
      })),
    } as unknown as Awaited<ReturnType<typeof loadPremiumChains>>);

    const result = await enrichForensicEvidence({
      evidence: buildEvidence(),
      proofMode: "HYBRID",
      reviewContext: { signMethod: "WALLET", hasHandSignature: true },
    });

    expect(result.evidence.storage?.mode).toBe("external_cid");
    expect(result.evidence.storage?.objectCid).toMatch(/^baf/i);
    expect(result.evidence.storage?.anchors.some((anchor) => anchor.status === "anchored")).toBe(true);
    expect(result.evidence.pdfSummary?.lines[0]).toBe("Forensic mode: external object");
  });

  it("blocks critical automation when the policy is deny", async () => {
    const result = await enrichForensicEvidence({
      evidence: buildEvidence({
        fingerprint: {
          ...buildEvidence().fingerprint,
          webdriver: true,
        },
        behavioral: {
          ...buildEvidence().behavioral,
          timeOnPage: 1200,
          mouseMoveCount: 0,
          clickCount: 0,
          keyPressCount: 0,
          pasteEvents: 2,
          replay: null,
        },
        flags: [{ code: "WEBDRIVER_DETECTED", severity: "critical", message: "webdriver" }],
      }),
      proofMode: "HYBRID",
      automationPolicy: {
        enabled: true,
        onPreparationAutomation: "FLAG",
        onCriticalAutomation: "DENY",
        notifyCreator: true,
        requireHumanSteps: ["signature", "consent", "final_submit", "wallet_auth"],
      },
      reviewContext: { signMethod: "EMAIL_OTP", hasHandSignature: true },
    });

    expect(result.evidence.automationReview?.verdict).toBe("agent");
    expect(result.evidence.policyOutcome?.action).toBe("DENY");
    expect(result.evidence.policyOutcome?.blocked).toBe(true);
  });
});
