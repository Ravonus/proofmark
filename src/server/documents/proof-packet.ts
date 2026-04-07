/**
 * Proof Packet generator.
 *
 * Exports a complete evidence bundle for a signed document:
 * - Final signed PDF
 * - Document hash
 * - All signatures (email + wallet)
 * - Full audit trail
 * - IP/device/session metadata
 * - Blockchain transaction references
 * - Signature verification instructions
 *
 * Output: JSON manifest + PDF, packaged as a downloadable bundle.
 */

import { createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { documents, signers } from "~/server/db/schema";
import {
  getAuditTrail,
  verifyAuditChainByDocId as verifyAuditChain,
  generateSignedPDF,
} from "~/server/crypto/rust-engine";
import { deriveSecurityMode } from "~/lib/signing/document-security";
import type { EnhancedForensicEvidence } from "~/lib/forensic/premium";
import type {
  ForensicSessionLivenessProfile,
  ForensicSessionProfile,
  PersistedForensicSessionCapture,
  SignerBaselineProfile,
} from "~/lib/forensic/session";

type EyeTrackingSessionSummary = {
  active?: boolean;
  pointCount?: number;
  fixationCount?: number;
  avgFixationMs?: number;
  blinkCount?: number;
  blinkRate?: number;
  trackingCoverage?: number;
  passedCoverageThreshold?: boolean;
  calibrationAccuracy?: number | null;
  livenessPassRatio?: number | null;
  livenessSuspicious?: boolean;
} & Record<string, unknown>;

/** Loose type for forensic evidence stored as jsonb — avoids strict coupling */
export type ProofPacketForensicEvidenceData = Partial<EnhancedForensicEvidence> & {
  eyeTracking?: EyeTrackingSessionSummary | null;
} & Record<string, unknown>;

export interface ProofPacket {
  version: number;
  generatedAt: string;
  document: {
    id: string;
    title: string;
    contentHash: string;
    ipfsCid: string | null;
    encryptedAtRest: boolean;
    securityMode: string;
    proofMode: string;
    status: string;
    createdBy: string;
    createdAt: string;
  };
  signatures: Array<{
    label: string;
    method: string;
    address: string | null;
    email: string | null;
    chain: string | null;
    scheme: string | null;
    signature: string | null;
    signedAt: string | null;
    identityLevel: string;
    handSignatureHash: string | null;
    fieldValues: Record<string, string> | null;
    metadata: {
      ipAddress: string | null;
      userAgent: string | null;
      consentText: string | null;
      consentAt: string | null;
    };
    forensic: {
      evidenceHash: string | null;
      visitorId: string | null;
      persistentId: string | null;
      geo: {
        city: string | null;
        region: string | null;
        country: string | null;
        latitude: number | null;
        longitude: number | null;
        isp: string | null;
        isVpn: boolean | null;
        isProxy: boolean | null;
        isTor: boolean | null;
        isDatacenter: boolean | null;
      } | null;
      flags: Array<{ code: string; severity: string; message: string }>;
      behavioral: {
        timeOnPage: number;
        scrolledToBottom: boolean;
        maxScrollDepth: number;
        pasteEvents?: number;
        copyEvents?: number;
        cutEvents?: number;
      } | null;
      replay: {
        encoding: string;
        tapeHash: string;
        eventCount: number;
        byteLength: number;
        targetCount: number;
        stringCount: number;
        signatureStrokeCount: number;
        signaturePointCount: number;
        clipboardEventCount: number;
        capabilities: string[];
      } | null;
      storage: {
        mode: string;
        objectCid: string | null;
        objectHash: string | null;
        byteLength: number;
        anchored: boolean;
        anchors: Array<{
          chain: string;
          status: string;
          txHash: string | null;
        }>;
      } | null;
      automationReview: {
        verdict: string;
        confidence: number;
        source: string;
        automationScore: number;
        recommendedAction: string;
      } | null;
      policyOutcome: {
        action: string;
        blocked: boolean;
        reason: string;
      } | null;
      pdfSummary: {
        mode: string;
        lines: string[];
      } | null;
      eyeTracking: EyeTrackingSessionSummary | null;
      sessionProfile: ForensicSessionProfile | null;
      liveness: ForensicSessionLivenessProfile | null;
      signerBaseline: SignerBaselineProfile | null;
      forensicSessions: PersistedForensicSessionCapture[];
      reverseDns: string | null;
      webRtcLocalIps: string[];
    } | null;
  }>;
  auditTrail: {
    events: Array<{
      eventType: string;
      actor: string;
      actorType: string;
      ipAddress: string | null;
      userAgent: string | null;
      metadata: Record<string, unknown> | null;
      eventHash: string;
      createdAt: string;
    }>;
    chainValid: boolean;
    trailHash: string;
  };
  blockchain: {
    anchored: boolean;
    references: Array<{
      chain: string;
      type: string;
      txHash: string | null;
      inscriptionId: string | null;
      confirmedAt: string | null;
    }>;
  };
  verification: {
    instructions: string[];
    contentHashAlgorithm: string;
    supportedChains: string[];
  };
  packetHash: string;
}

export type ProofPacketForensicSection = NonNullable<ProofPacket["signatures"][number]["forensic"]>;

function extractBlockchainRefsFromForensics(
  signerRows: Array<{ forensicEvidence: unknown }>,
): ProofPacket["blockchain"]["references"] {
  const refs: ProofPacket["blockchain"]["references"] = [];
  const seen = new Set<string>();

  for (const signer of signerRows) {
    const forensic = signer.forensicEvidence as ProofPacketForensicEvidenceData | null;
    const anchors = forensic?.storage?.anchors;
    if (!Array.isArray(anchors)) continue;

    for (const anchor of anchors) {
      if (anchor.status !== "anchored" && anchor.status !== "queued") continue;

      const key = `${anchor.chain}:${anchor.status}:${anchor.txHash ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      refs.push({
        chain: anchor.chain,
        type: "forensic_storage",
        txHash: anchor.txHash ?? null,
        inscriptionId: null,
        confirmedAt: null,
      });
    }
  }

  return refs;
}

export function buildProofPacketForensicSection(
  fe: ProofPacketForensicEvidenceData | null,
  forensicHash: string | null,
): ProofPacketForensicSection | null {
  if (!fe) return null;

  return {
    evidenceHash: forensicHash ?? fe.evidenceHash ?? null,
    visitorId: fe.fingerprint?.visitorId ?? null,
    persistentId: fe.fingerprint?.persistentId ?? null,
    geo: fe.geo
      ? {
          city: fe.geo.city,
          region: fe.geo.region,
          country: fe.geo.country,
          latitude: fe.geo.latitude,
          longitude: fe.geo.longitude,
          isp: fe.geo.isp,
          isVpn: fe.geo.isVpn,
          isProxy: fe.geo.isProxy,
          isTor: fe.geo.isTor,
          isDatacenter: fe.geo.isDatacenter,
        }
      : null,
    flags: fe.flags ?? [],
    behavioral: fe.behavioral
      ? {
          timeOnPage: fe.behavioral.timeOnPage,
          scrolledToBottom: fe.behavioral.scrolledToBottom,
          maxScrollDepth: fe.behavioral.maxScrollDepth,
          pasteEvents: fe.behavioral.pasteEvents,
          copyEvents: fe.behavioral.copyEvents,
          cutEvents: fe.behavioral.cutEvents,
        }
      : null,
    replay: fe.behavioral?.replay
      ? {
          encoding: fe.behavioral.replay.encoding,
          tapeHash: fe.behavioral.replay.tapeHash,
          eventCount: fe.behavioral.replay.metrics.eventCount,
          byteLength: fe.behavioral.replay.metrics.byteLength,
          targetCount: fe.behavioral.replay.metrics.targetCount,
          stringCount: fe.behavioral.replay.metrics.stringCount,
          signatureStrokeCount: fe.behavioral.replay.metrics.signatureStrokeCount,
          signaturePointCount: fe.behavioral.replay.metrics.signaturePointCount,
          clipboardEventCount: fe.behavioral.replay.metrics.clipboardEventCount,
          capabilities: fe.behavioral.replay.capabilities,
        }
      : null,
    storage: fe.storage
      ? {
          mode: fe.storage.mode,
          objectCid: fe.storage.objectCid ?? null,
          objectHash: fe.storage.objectHash ?? null,
          byteLength: fe.storage.byteLength,
          anchored: fe.storage.anchored,
          anchors: fe.storage.anchors.map((anchor) => ({
            chain: anchor.chain,
            status: anchor.status,
            txHash: anchor.txHash ?? null,
          })),
        }
      : null,
    automationReview: fe.automationReview
      ? {
          verdict: fe.automationReview.verdict,
          confidence: fe.automationReview.confidence,
          source: fe.automationReview.source,
          automationScore: fe.automationReview.automationScore,
          recommendedAction: fe.automationReview.recommendedAction,
        }
      : null,
    policyOutcome: fe.policyOutcome
      ? {
          action: fe.policyOutcome.action,
          blocked: fe.policyOutcome.blocked,
          reason: fe.policyOutcome.reason,
        }
      : null,
    pdfSummary: fe.pdfSummary
      ? {
          mode: fe.pdfSummary.mode,
          lines: fe.pdfSummary.lines,
        }
      : null,
    eyeTracking: fe.eyeTracking ?? null,
    sessionProfile: fe.sessionProfile ?? null,
    liveness: fe.sessionProfile?.liveness ?? null,
    signerBaseline: fe.signerBaseline ?? null,
    forensicSessions: Array.isArray(fe.forensicSessions) ? fe.forensicSessions : [],
    reverseDns: fe.reverseDns ?? null,
    webRtcLocalIps: fe.fingerprint?.webRtcLocalIps ?? [],
  };
}

/**
 * Generate a complete proof packet for a document.
 */
export async function generateProofPacket(documentId: string): Promise<{ manifest: ProofPacket; pdf: Buffer }> {
  // Load document
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);

  if (!doc) throw new Error("Document not found");

  // Load signers
  const allSigners = await db.select().from(signers).where(eq(signers.documentId, documentId));

  // Load audit trail
  const events = await getAuditTrail(documentId);
  const chainValidity = await verifyAuditChain(documentId);
  const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
  const trailHash = lastEvent?.eventHash ?? "empty";

  const blockchainRefs = extractBlockchainRefsFromForensics(allSigners);

  // Build the manifest
  const manifest: Omit<ProofPacket, "packetHash"> = {
    version: 1,
    generatedAt: new Date().toISOString(),
    document: {
      id: doc.id,
      title: doc.title,
      contentHash: doc.contentHash,
      ipfsCid: doc.ipfsCid,
      encryptedAtRest: doc.encryptedAtRest,
      securityMode: deriveSecurityMode(doc),
      proofMode: doc.proofMode,
      status: doc.status,
      createdBy: doc.createdBy,
      createdAt: doc.createdAt.toISOString(),
    },
    signatures: allSigners.map((s) => {
      const fe = s.forensicEvidence as ProofPacketForensicEvidenceData | null;
      return {
        label: s.label,
        method: s.signMethod,
        address: s.address,
        email: s.email,
        chain: s.chain,
        scheme: s.scheme,
        signature: s.signature,
        signedAt: s.signedAt?.toISOString() ?? null,
        identityLevel: s.identityLevel,
        handSignatureHash: s.handSignatureHash,
        fieldValues: s.fieldValues,
        metadata: {
          ipAddress: s.lastIp,
          userAgent: s.userAgent,
          consentText: s.consentText,
          consentAt: s.consentAt?.toISOString() ?? null,
        },
        forensic: buildProofPacketForensicSection(fe, s.forensicHash ?? null),
      };
    }),
    auditTrail: {
      events: events.map((e) => ({
        eventType: e.eventType,
        actor: e.actor,
        actorType: e.actorType,
        ipAddress: e.ipAddress,
        userAgent: e.userAgent,
        metadata: e.metadata,
        eventHash: e.eventHash,
        createdAt: e.createdAt.toISOString(),
      })),
      chainValid: chainValidity.valid,
      trailHash,
    },
    blockchain: {
      anchored: blockchainRefs.length > 0,
      references: blockchainRefs,
    },
    verification: {
      instructions: [
        "1. Verify the document content hash: SHA-256 of the original document text must match the contentHash field.",
        "2. For wallet signatures: verify each signature against the signing message format 'proofmark:{contentHash}:{address}:{label}'.",
        "3. For email signatures: verify the audit trail shows OTP verification events with matching IP/device data.",
        "4. Check the audit trail chain: each eventHash should equal SHA-256(prevHash + eventType + actor + timestamp + metadata).",
        "5. If blockchain-anchored: verify the contentHash exists on-chain at the referenced transaction hash.",
        ...(doc.encryptedAtRest && doc.ipfsCid
          ? [
              "6. If encrypted IPFS storage is enabled: the CID identifies the encrypted payload only. Verify the document itself against the SHA-256 content hash.",
            ]
          : []),
        "7. Forensic evidence: each signature includes a device fingerprint, geolocation, behavioral data, and flags. The evidenceHash is a SHA-256 of the full evidence packet for tamper detection.",
        "8. WebRTC local IPs may reveal the signer's real IP address even when using a VPN.",
      ],
      contentHashAlgorithm: "SHA-256",
      supportedChains: ["ETH", "SOL", "BTC"],
    },
  };

  // Compute a hash of the entire proof packet for integrity
  const packetHash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

  const fullManifest: ProofPacket = { ...manifest, packetHash };

  // Generate PDF
  const baseUrl = process.env.NEXTAUTH_URL ?? "https://docu.technomancy.it";
  const pdf = await generateSignedPDF({ doc, signers: allSigners, verifyUrl: `${baseUrl}/verify/${doc.contentHash}` });

  return { manifest: fullManifest, pdf: Buffer.from(pdf) };
}
