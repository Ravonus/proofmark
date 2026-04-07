/**
 * Premium AI module entry point.
 *
 * Exports the PremiumAiModule interface expected by src/server/api/routers/ai.ts.
 * This file is dynamically imported via loadPremiumAi() in src/lib/premium.ts.
 */

import { resolveKey, resolveKeyWithFallback, getPlatformProviders, isPlatformProviderAvailable } from "./key-resolver";
import { complete, getProviders } from "./provider-client";
import { loadConversation, saveConversation } from "./conversation-persistence";
import { enforceRateLimit, trackUsage, getUsageSummary, setAdminLimits, getLimitStatus } from "./rate-limiter";
import { reviewAutomationEvidence } from "./automation-review";
import { fixScraperOutput, chat, answerQuestion, generateSummary } from "./features";

export {
  // Key resolution
  resolveKey,
  resolveKeyWithFallback,

  // Provider info
  getProviders,
  getPlatformProviders,
  isPlatformProviderAvailable,

  // Completion
  complete,

  // Rate limiting & usage
  enforceRateLimit,
  trackUsage,
  getUsageSummary,
  setAdminLimits,
  getLimitStatus,

  // Conversation persistence
  loadConversation,
  saveConversation,

  // AI features
  fixScraperOutput,
  chat,
  answerQuestion,
  generateSummary,
  reviewAutomationEvidence,
};

// Re-export forensic queue for direct use
export { enqueueForensicReview, getJobStatus, getJobsForSigner } from "./forensic-queue";

// Re-export types for convenience
export type {
  AiProviderName,
  AiFeature,
  ResolvedKey,
  AiRequestContext,
  AiRawResponse,
  CompletionRequest,
  CompletionResponse,
  AiProviderInfo,
  AiPlatformProvider,
} from "./types";
