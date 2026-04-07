/**
 * Async forensic review queue.
 *
 * Queues automation review jobs to run in the background after signing.
 * Simple in-memory queue — processes one job at a time to avoid
 * overwhelming AI providers with concurrent requests.
 */

import type { AiProviderName } from "./types";

interface ForensicQueueJob {
  id: string;
  ownerAddress: string;
  documentId: string;
  signerId: string;
  documentTitle: string;
  signerLabel: string;
  evidence: Record<string, unknown>;
  policy?: Record<string, unknown>;
  provider?: string;
  model?: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

const jobs: ForensicQueueJob[] = [];
let processing = false;

const MAX_COMPLETED = 100;

/** Enqueue a forensic review job. Returns the job ID. */
export function enqueueForensicReview(params: {
  ownerAddress: string;
  documentId: string;
  signerId: string;
  documentTitle: string;
  signerLabel: string;
  evidence: Record<string, unknown>;
  policy?: Record<string, unknown>;
  provider?: string;
  model?: string;
}): string {
  const id = `fq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  jobs.push({ id, ...params, status: "pending", createdAt: new Date() });
  drain().catch(console.error);
  return id;
}

export function getJobStatus(jobId: string): ForensicQueueJob | undefined {
  return jobs.find((j) => j.id === jobId);
}

export function getJobsForSigner(documentId: string, signerId: string): ForensicQueueJob[] {
  return jobs.filter((j) => j.documentId === documentId && j.signerId === signerId);
}

/** Process pending jobs sequentially. */
async function drain(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    let job: ForensicQueueJob | undefined;
    while ((job = jobs.find((j) => j.status === "pending"))) {
      job.status = "running";
      try {
        // Dynamic imports avoid circular dependency with key-resolver → providers → ...
        const { reviewAutomationEvidence } = await import("./automation-review");
        const { resolveKeyWithFallback } = await import("./key-resolver");

        const resolved = await resolveKeyWithFallback(
          job.ownerAddress,
          (job.provider ?? "anthropic") as AiProviderName,
        );

        if (!resolved) {
          job.status = "failed";
          job.error = "No AI provider configured";
        } else {
          job.result = await reviewAutomationEvidence({
            ownerAddress: job.ownerAddress,
            provider: resolved.key.provider,
            model: job.model ?? resolved.model,
            key: resolved.key,
            documentId: job.documentId,
            documentTitle: job.documentTitle,
            signerLabel: job.signerLabel,
            evidence: job.evidence,
            policy: job.policy,
          });
          job.status = "completed";
        }
      } catch (err) {
        job.status = "failed";
        job.error = err instanceof Error ? err.message : String(err);
      }
      job.completedAt = new Date();
    }
  } finally {
    processing = false;
  }

  // Evict oldest completed jobs beyond the cap
  const done = jobs.filter((j) => j.status === "completed" || j.status === "failed");
  if (done.length > MAX_COMPLETED) {
    for (const old of done.slice(0, done.length - MAX_COMPLETED)) {
      const idx = jobs.indexOf(old);
      if (idx !== -1) jobs.splice(idx, 1);
    }
  }
}
