/**
 * Rate limiting and usage tracking for AI features.
 *
 * Two modes (stored in aiRateLimits.mode):
 *   "platform" — simple monthly cap + hourly/weekly circuit breakers
 *   "admin"    — granular per-user limits set by enterprise admins
 *
 * Usage logs go to aiUsageLogs (append-only, used for analytics + billing).
 * Rate counters are rolling windows on aiRateLimits (reset on expiry).
 */

import { eq, and, gte, sql } from "drizzle-orm";
import { db } from "../../src/server/db";
import { aiRateLimits, aiUsageLogs } from "../../src/server/db/schema";
import type { AiFeature, AiRequestContext, AiRawResponse } from "./types";
import { estimateCostCents } from "./providers";

// ── Window durations (ms) ──

const HOUR = 3_600_000;
const DAY = 86_400_000;
const WEEK = 604_800_000;
const MONTH = 2_592_000_000; // ~30 days

// ── Rate Limit Enforcement ──

type LimitRow = typeof aiRateLimits.$inferSelect;

/** Find the best-matching limit row for this owner + feature. */
async function findLimit(ownerAddress: string, feature: AiFeature): Promise<LimitRow | null> {
  const rows = await db
    .select()
    .from(aiRateLimits)
    .where(eq(aiRateLimits.ownerAddress, ownerAddress))
    .limit(10);

  if (rows.length === 0) return null;

  // Prefer feature-specific → general (no feature) → first row
  return (
    rows.find((r) => r.feature === feature && r.userId === null) ??
    rows.find((r) => r.feature === null && r.userId === null) ??
    rows[0]!
  );
}

/** Reset any expired rolling windows. Returns true if anything was reset. */
async function resetExpiredWindows(limit: LimitRow): Promise<boolean> {
  const now = new Date();
  const resets: Record<string, unknown> = {};

  if (limit.hourWindowResetAt && limit.hourWindowResetAt < now) {
    resets.currentHourRequests = 0;
    resets.currentHourTokens = 0;
    resets.hourWindowResetAt = new Date(now.getTime() + HOUR);
  }
  if (limit.dayWindowResetAt && limit.dayWindowResetAt < now) {
    resets.currentDayRequests = 0;
    resets.currentDayTokens = 0;
    resets.dayWindowResetAt = new Date(now.getTime() + DAY);
  }
  if (limit.weekWindowResetAt && limit.weekWindowResetAt < now) {
    resets.currentWeekRequests = 0;
    resets.weekWindowResetAt = new Date(now.getTime() + WEEK);
  }
  if (limit.monthWindowResetAt && limit.monthWindowResetAt < now) {
    resets.currentMonthRequests = 0;
    resets.currentMonthTokens = 0;
    resets.monthWindowResetAt = new Date(now.getTime() + MONTH);
  }

  if (Object.keys(resets).length === 0) return false;
  await db.update(aiRateLimits).set(resets).where(eq(aiRateLimits.id, limit.id));

  // Apply resets to in-memory row so the caller sees fresh counters
  Object.assign(limit, resets);
  return true;
}

/** Seed window timestamps on a row that has never been used. */
async function initializeWindows(limit: LimitRow): Promise<void> {
  const now = Date.now();
  await db
    .update(aiRateLimits)
    .set({
      hourWindowResetAt: new Date(now + HOUR),
      dayWindowResetAt: new Date(now + DAY),
      weekWindowResetAt: new Date(now + WEEK),
      monthWindowResetAt: new Date(now + MONTH),
    })
    .where(eq(aiRateLimits.id, limit.id));
}

function checkPlatformLimits(limit: LimitRow): void {
  if (limit.currentMonthRequests >= limit.requestsPerMonth)
    throw new Error("Monthly AI request limit reached. Resets next month.");
  if (limit.currentMonthTokens >= limit.tokensPerMonth)
    throw new Error("Monthly AI token limit reached. Resets next month.");
  if (limit.currentHourRequests >= limit.maxRequestsPerHour)
    throw new Error("Hourly AI request limit reached. Try again in a few minutes.");
  if (limit.currentWeekRequests >= limit.maxRequestsPerWeek)
    throw new Error("Weekly AI request limit reached. Try again next week.");
  if (limit.requestsPerDay !== null && limit.currentDayRequests >= limit.requestsPerDay)
    throw new Error("Daily AI request limit reached. Try again tomorrow.");
}

function checkAdminLimits(limit: LimitRow): void {
  const checks: Array<[number | null, number, string]> = [
    [limit.adminRequestsPerHour, limit.currentHourRequests, "Hourly AI request limit reached (admin-set)."],
    [limit.adminRequestsPerDay, limit.currentDayRequests, "Daily AI request limit reached (admin-set)."],
    [limit.adminRequestsPerMonth, limit.currentMonthRequests, "Monthly AI request limit reached (admin-set)."],
    [limit.adminTokensPerHour, limit.currentHourTokens, "Hourly AI token limit reached (admin-set)."],
    [limit.adminTokensPerDay, limit.currentDayTokens, "Daily AI token limit reached (admin-set)."],
    [limit.adminTokensPerMonth, limit.currentMonthTokens, "Monthly AI token limit reached (admin-set)."],
  ];
  for (const [cap, current, msg] of checks) {
    if (cap !== null && current >= cap) throw new Error(msg);
  }
}

/** Enforce rate limits for an AI request. Throws if over limit. */
export async function enforceRateLimit(ownerAddress: string, feature: AiFeature): Promise<void> {
  let limit = await findLimit(ownerAddress, feature);

  // First-ever request — create default platform limits
  if (!limit) {
    await db.insert(aiRateLimits).values({
      ownerAddress,
      mode: "platform",
      requestsPerMonth: 500,
      tokensPerMonth: 1_000_000,
      maxRequestsPerHour: 30,
      maxRequestsPerWeek: 200,
    });
    return;
  }

  // Initialize windows if this row has never been used
  if (!limit.hourWindowResetAt) {
    await initializeWindows(limit);
    return;
  }

  // Reset any expired windows (mutates limit in-place with fresh counters)
  await resetExpiredWindows(limit);

  // Check limits with fresh counters
  if (limit.mode === "platform") {
    checkPlatformLimits(limit);
  } else {
    checkAdminLimits(limit);
  }
}

// ── Usage Tracking ──

/** Log usage to aiUsageLogs and bump rate-limit counters. */
export async function trackUsage(
  rCtx: AiRequestContext,
  feature: AiFeature,
  raw: AiRawResponse,
  meta?: Record<string, unknown>,
): Promise<void> {
  const inputTokens = raw.usage?.inputTokens ?? 0;
  const outputTokens = raw.usage?.outputTokens ?? 0;
  const totalTokens = inputTokens + outputTokens;

  // Append usage log
  await db.insert(aiUsageLogs).values({
    ownerAddress: rCtx.ownerAddress,
    userId: rCtx.userId ?? null,
    provider: rCtx.provider,
    model: rCtx.model,
    feature,
    documentId: rCtx.documentId ?? null,
    inputTokens,
    outputTokens,
    latencyMs: raw.latencyMs ?? 0,
    costCents: estimateCostCents(rCtx.model, inputTokens, outputTokens),
    keySource: rCtx.key.source as "byok" | "platform",
    metadata: { ...meta, execution: raw.execution },
  });

  // Bump rolling counters
  await db
    .update(aiRateLimits)
    .set({
      currentHourRequests: sql`${aiRateLimits.currentHourRequests} + 1`,
      currentHourTokens: sql`${aiRateLimits.currentHourTokens} + ${totalTokens}`,
      currentDayRequests: sql`${aiRateLimits.currentDayRequests} + 1`,
      currentDayTokens: sql`${aiRateLimits.currentDayTokens} + ${totalTokens}`,
      currentWeekRequests: sql`${aiRateLimits.currentWeekRequests} + 1`,
      currentMonthRequests: sql`${aiRateLimits.currentMonthRequests} + 1`,
      currentMonthTokens: sql`${aiRateLimits.currentMonthTokens} + ${totalTokens}`,
      updatedAt: new Date(),
    })
    .where(eq(aiRateLimits.ownerAddress, rCtx.ownerAddress));
}

// ── Usage Summary ──

export async function getUsageSummary(
  ownerAddress: string,
  from: Date,
  to: Date,
  userId?: string,
) {
  const conditions = [
    eq(aiUsageLogs.ownerAddress, ownerAddress),
    gte(aiUsageLogs.createdAt, from),
  ];
  if (userId) conditions.push(eq(aiUsageLogs.userId, userId));

  const logs = (await db.select().from(aiUsageLogs).where(and(...conditions)))
    .filter((l) => l.createdAt <= to);

  // Aggregate by feature and provider in a single pass
  const byFeature: Record<string, { requests: number; tokens: number; costCents: number }> = {};
  const byProvider: Record<string, { requests: number; tokens: number; costCents: number }> = {};
  let totalRequests = 0, totalInputTokens = 0, totalOutputTokens = 0, totalCostCents = 0;

  for (const log of logs) {
    totalRequests++;
    totalInputTokens += log.inputTokens;
    totalOutputTokens += log.outputTokens;
    totalCostCents += log.costCents;
    const tokens = log.inputTokens + log.outputTokens;

    const fb = (byFeature[log.feature] ??= { requests: 0, tokens: 0, costCents: 0 });
    fb.requests++; fb.tokens += tokens; fb.costCents += log.costCents;

    const pb = (byProvider[log.provider] ??= { requests: 0, tokens: 0, costCents: 0 });
    pb.requests++; pb.tokens += tokens; pb.costCents += log.costCents;
  }

  return { totalRequests, totalInputTokens, totalOutputTokens, totalCostCents, byFeature, byProvider };
}

// ── Admin Limits ──

export async function setAdminLimits(params: Record<string, unknown>): Promise<void> {
  const ownerAddress = params.ownerAddress as string;
  const userId = (params.userId as string) ?? null;
  const feature = (params.feature as AiFeature) ?? null;

  const [existing] = await db
    .select()
    .from(aiRateLimits)
    .where(
      userId
        ? and(eq(aiRateLimits.ownerAddress, ownerAddress), eq(aiRateLimits.userId, userId))
        : and(eq(aiRateLimits.ownerAddress, ownerAddress), sql`${aiRateLimits.userId} IS NULL`),
    )
    .limit(1);

  // Build update object from provided params
  const fields: Record<string, unknown> = { updatedAt: new Date() };
  const mapping: Record<string, string> = {
    requestsPerMonth: "requestsPerMonth",
    tokensPerMonth: "tokensPerMonth",
    requestsPerHour: "maxRequestsPerHour",
    requestsPerDay: "requestsPerDay",
    adminRequestsPerHour: "adminRequestsPerHour",
    adminRequestsPerDay: "adminRequestsPerDay",
    adminRequestsPerMonth: "adminRequestsPerMonth",
    adminTokensPerHour: "adminTokensPerHour",
    adminTokensPerDay: "adminTokensPerDay",
    adminTokensPerMonth: "adminTokensPerMonth",
  };
  for (const [paramKey, dbKey] of Object.entries(mapping)) {
    if (params[paramKey] !== undefined) fields[dbKey] = params[paramKey];
  }

  if (existing) {
    await db.update(aiRateLimits).set(fields).where(eq(aiRateLimits.id, existing.id));
  } else {
    await db.insert(aiRateLimits).values({
      ownerAddress,
      userId,
      feature,
      mode: userId === "__default__" ? "platform" : "admin",
      requestsPerMonth: (params.requestsPerMonth as number) ?? 500,
      tokensPerMonth: (params.tokensPerMonth as number) ?? 1_000_000,
      maxRequestsPerHour: (params.requestsPerHour as number) ?? 30,
      maxRequestsPerWeek: 200,
      ...fields,
    });
  }
}

export async function getLimitStatus(ownerAddress: string, feature: AiFeature, userId?: string) {
  const limit = await findLimit(ownerAddress, feature);

  if (!limit) {
    return {
      mode: "platform",
      limits: { requestsPerMonth: 500, tokensPerMonth: 1_000_000, maxRequestsPerHour: 30, maxRequestsPerWeek: 200 },
      current: { hourRequests: 0, dayRequests: 0, weekRequests: 0, monthRequests: 0, monthTokens: 0 },
      resets: { hour: null, day: null, week: null, month: null },
    };
  }

  return {
    mode: limit.mode,
    limits: {
      requestsPerMonth: limit.requestsPerMonth,
      tokensPerMonth: limit.tokensPerMonth,
      requestsPerDay: limit.requestsPerDay,
      maxRequestsPerHour: limit.maxRequestsPerHour,
      maxRequestsPerWeek: limit.maxRequestsPerWeek,
      adminRequestsPerHour: limit.adminRequestsPerHour,
      adminRequestsPerDay: limit.adminRequestsPerDay,
      adminRequestsPerMonth: limit.adminRequestsPerMonth,
      adminTokensPerHour: limit.adminTokensPerHour,
      adminTokensPerDay: limit.adminTokensPerDay,
      adminTokensPerMonth: limit.adminTokensPerMonth,
    },
    current: {
      hourRequests: limit.currentHourRequests,
      hourTokens: limit.currentHourTokens,
      dayRequests: limit.currentDayRequests,
      dayTokens: limit.currentDayTokens,
      weekRequests: limit.currentWeekRequests,
      monthRequests: limit.currentMonthRequests,
      monthTokens: limit.currentMonthTokens,
    },
    resets: {
      hour: limit.hourWindowResetAt?.toISOString() ?? null,
      day: limit.dayWindowResetAt?.toISOString() ?? null,
      week: limit.weekWindowResetAt?.toISOString() ?? null,
      month: limit.monthWindowResetAt?.toISOString() ?? null,
    },
  };
}
