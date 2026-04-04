// @ts-nocheck -- premium escrow module types unresolvable in OSS build; all DB operations use dynamic proxy tables
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call -- premium module proxy tables cascade `any` throughout */
/**
 * Escrow tRPC router — full CRUD + lifecycle actions.
 *
 * Premium feature — checks for premium module before loading.
 */

import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { type createTRPCContext, createTRPCRouter, authedProcedure, publicProcedure } from "~/server/api/trpc";
// Dynamic premium imports — loaded once and cached.
// OSS builds without premium/ will throw FORBIDDEN on first use.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports, @typescript-eslint/no-redundant-type-constituents -- dynamic premium import type
let _escrowSchema: Awaited<typeof import("~/premium/escrow/schema")> | null = null;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports, @typescript-eslint/no-redundant-type-constituents -- dynamic premium import type
let _escrowEngine: Awaited<typeof import("~/premium/escrow/engine")> | null = null;

async function requireEscrow() {
  if (!_escrowSchema) {
    try {
      _escrowSchema = await import(/* webpackIgnore: true */ "~/premium/escrow/schema");
      _escrowEngine = await import(/* webpackIgnore: true */ "~/premium/escrow/engine");
    } catch {
      throw new TRPCError({ code: "FORBIDDEN", message: "Escrow is a premium feature — upgrade to enable" });
    }
  }
  return { schema: _escrowSchema!, engine: _escrowEngine! };
}

// Lazy accessors — these are only called inside procedures which call requireEscrow() first.
const esc = {
  get escrowContracts() {
    return _escrowSchema!.escrowContracts;
  },
  get escrowParticipants() {
    return _escrowSchema!.escrowParticipants;
  },
  get escrowSignatures() {
    return _escrowSchema!.escrowSignatures;
  },
  get escrowEvents() {
    return _escrowSchema!.escrowEvents;
  },
  get escrowRwaVerifications() {
    return _escrowSchema!.escrowRwaVerifications;
  },
  get escrowOracleDecisions() {
    return _escrowSchema!.escrowOracleDecisions;
  },
  get computeTermsHash() {
    return _escrowEngine!.computeTermsHash;
  },
};

// Re-export as module-level aliases for minimal code changes below
const escrowContracts = new Proxy({} as Record<string, unknown>, {
  get: (_, p) => esc.escrowContracts[p as keyof typeof esc.escrowContracts],
});
const escrowParticipants = new Proxy({} as Record<string, unknown>, {
  get: (_, p) => esc.escrowParticipants[p as keyof typeof esc.escrowParticipants],
});
const escrowSignatures = new Proxy({} as Record<string, unknown>, {
  get: (_, p) => esc.escrowSignatures[p as keyof typeof esc.escrowSignatures],
});
const escrowEvents = new Proxy({} as Record<string, unknown>, {
  get: (_, p) => esc.escrowEvents[p as keyof typeof esc.escrowEvents],
});
const escrowRwaVerifications = new Proxy({} as Record<string, unknown>, {
  get: (_, p) => esc.escrowRwaVerifications[p as keyof typeof esc.escrowRwaVerifications],
});
const escrowOracleDecisions = new Proxy({} as Record<string, unknown>, {
  get: (_, p) => esc.escrowOracleDecisions[p as keyof typeof esc.escrowOracleDecisions],
});
async function computeTermsHash(args: Record<string, unknown>) {
  return esc.computeTermsHash(args);
}

const escrowAssetChainSchema = z.enum(["ETH", "SOL", "BTC", "FIAT", "REAL_WORLD"]);
const escrowAssetKindSchema = z.enum([
  "NATIVE",
  "ERC20",
  "ERC721",
  "ERC1155",
  "SPL_TOKEN",
  "SPL_NFT",
  "BRC20",
  "ORDINAL",
  "USD",
  "FIAT_OTHER",
  "RWA_VEHICLE",
  "RWA_REAL_ESTATE",
  "RWA_WATCH",
  "RWA_JEWELRY",
  "RWA_COLLECTIBLE",
  "RWA_ELECTRONICS",
  "RWA_COMMODITY",
  "RWA_OTHER",
  "CUSTOM",
]);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

async function appendEscrowEvent(
  db: Awaited<ReturnType<typeof createTRPCContext>>["db"],
  escrowId: string,
  eventType: string,
  actor: string,
  data?: Record<string, unknown>,
) {
  await requireEscrow();
  // Get the last event hash for chaining
  const [lastEvent] = await db
    .select({ eventHash: escrowEvents.eventHash })
    .from(escrowEvents)
    .where(eq(escrowEvents.escrowId, escrowId))
    .orderBy(desc(escrowEvents.createdAt))
    .limit(1);

  const prevHash = lastEvent?.eventHash ?? null;
  const payload = JSON.stringify({ escrowId, eventType, actor, data, prevHash, ts: Date.now() });
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const eventHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await db.insert(escrowEvents).values({
    escrowId,
    eventType,
    actor,
    data,
    eventHash,
    prevEventHash: prevHash,
  });
}

/* ------------------------------------------------------------------ */
/*  Zod schemas                                                        */
/* ------------------------------------------------------------------ */

const assetSchema = z.object({
  id: z.string(),
  chain: escrowAssetChainSchema,
  kind: escrowAssetKindSchema,
  contractAddress: z.string().optional(),
  tokenId: z.string().optional(),
  amount: z.string(),
  displayAmount: z.string(),
  symbol: z.string(),
  decimals: z.number(),
  fromParticipantId: z.string().optional(),
  rwaDescription: z.string().optional(),
  rwaEstimatedValueUsd: z.string().optional(),
  rwaIdentifier: z.string().optional(),
});

const participantSchema = z.object({
  label: z.string().min(1),
  address: z.string().optional(),
  chain: z.enum(["ETH", "SOL", "BTC", "FIAT"]).optional(),
  role: z.enum(["PARTY", "ESCROW_AGENT", "DESIGNATED_ORACLE", "COMMUNITY_VOTER", "OBSERVER"]),
  email: z.string().email().optional(),
  phone: z.string().optional(),
});

const outcomeSchema = z.object({
  index: z.number(),
  description: z.string().min(1),
  payouts: z.record(z.object({ amount: z.string(), toAddress: z.string().optional() })),
});

/* ------------------------------------------------------------------ */
/*  Router                                                             */
/* ------------------------------------------------------------------ */

export const escrowRouter = createTRPCRouter({
  /**
   * Create a new escrow.
   */
  create: authedProcedure
    .input(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        mode: z.enum([
          "FULL_ESCROW",
          "MULTI_ESCROW",
          "COMMUNITY_ESCROW",
          "SELF_CUSTODY",
          "LOCKED_CANCELLABLE",
          "LOCKED_PERMANENT",
          "HONOR_SYSTEM",
          "CASUAL",
          "PLATFORM_ESCROW",
          "DESIGNATED_ORACLE",
        ]),
        resolutionMethod: z.enum([
          "ESCROW_DECISION",
          "MULTI_SIG",
          "COMMUNITY_VOTE",
          "MUTUAL_AGREEMENT",
          "ORACLE",
          "PLATFORM_ORACLE",
          "TIMEOUT",
          "NONE",
        ]),
        assets: z.array(assetSchema),
        participants: z.array(participantSchema).min(2),
        outcomes: z.array(outcomeSchema).min(2),
        expiresAt: z.string().datetime().optional(),
        multiEscrowConfig: z.any().optional(),
        communityVoteConfig: z.any().optional(),
        monitoringConfig: z.any().optional(),
        psbtConfig: z.any().optional(),
        oracleConfig: z.any().optional(),
        feeConfig: z.any().optional(),
        designatedOracleConfig: z.any().optional(),
        acknowledgedWarnings: z.array(z.string()).default([]),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEscrow();
      const { session } = ctx;

      // Compute terms hash
      const termsHash = await computeTermsHash({
        title: input.title,
        description: input.description,
        mode: input.mode,
        assets: input.assets,
        outcomes: input.outcomes,
        participants: input.participants.map((p) => ({ address: p.address, role: p.role })),
      });

      // Insert escrow contract
      const [escrow] = await ctx.db
        .insert(escrowContracts)
        .values({
          title: input.title,
          description: input.description,
          mode: input.mode,
          status: "AWAITING_SIGNATURES",
          resolutionMethod: input.resolutionMethod,
          termsHash,
          termsContent: input.description,
          assets: input.assets,
          outcomes: input.outcomes,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
          multiEscrowConfig: input.multiEscrowConfig,
          communityVoteConfig: input.communityVoteConfig,
          monitoringConfig: input.monitoringConfig,
          psbtConfig: input.psbtConfig,
          oracleConfig: input.oracleConfig,
          feeConfig: input.feeConfig,
          designatedOracleConfig: input.designatedOracleConfig,
          acknowledgedWarnings: input.acknowledgedWarnings,
          createdBy: session.address,
          metadata: input.metadata,
        })
        .returning();

      // Insert participants
      const participantRecords = [];
      for (const p of input.participants) {
        const [record] = await ctx.db
          .insert(escrowParticipants)
          .values({
            escrowId: escrow!.id,
            label: p.label,
            address: p.address,
            chain: p.chain as "ETH" | "SOL" | "BTC" | undefined,
            role: p.role,
            email: p.email,
            phone: p.phone,
          })
          .returning();
        participantRecords.push(record);
      }

      await appendEscrowEvent(ctx.db, escrow!.id, "CREATED", session.address, {
        termsHash,
        mode: input.mode,
        participantCount: input.participants.length,
        assetCount: input.assets.length,
      });

      return { escrow: escrow!, participants: participantRecords };
    }),

  /**
   * Get escrow by ID with all related data.
   */
  get: publicProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    await requireEscrow();
    const [escrow] = await ctx.db.select().from(escrowContracts).where(eq(escrowContracts.id, input.id)).limit(1);

    if (!escrow) throw new TRPCError({ code: "NOT_FOUND", message: "Escrow not found" });

    const participants = await ctx.db
      .select()
      .from(escrowParticipants)
      .where(eq(escrowParticipants.escrowId, input.id));

    const signatures = await ctx.db.select().from(escrowSignatures).where(eq(escrowSignatures.escrowId, input.id));

    const events = await ctx.db
      .select()
      .from(escrowEvents)
      .where(eq(escrowEvents.escrowId, input.id))
      .orderBy(desc(escrowEvents.createdAt));

    const rwaVerifications = await ctx.db
      .select()
      .from(escrowRwaVerifications)
      .where(eq(escrowRwaVerifications.escrowId, input.id));

    const oracleDecisions = await ctx.db
      .select()
      .from(escrowOracleDecisions)
      .where(eq(escrowOracleDecisions.escrowId, input.id));

    return { escrow, participants, signatures, events, rwaVerifications, oracleDecisions };
  }),

  /**
   * List escrows for the current user.
   */
  list: authedProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          mode: z.string().optional(),
          limit: z.number().min(1).max(100).default(50),
          offset: z.number().min(0).default(0),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      await requireEscrow();
      const { session } = ctx;
      const filters = {
        status: input?.status,
        mode: input?.mode,
        limit: input?.limit ?? 50,
        offset: input?.offset ?? 0,
      };

      // Get escrows where user is creator or participant
      const participantEscrowIds = await ctx.db
        .select({ escrowId: escrowParticipants.escrowId })
        .from(escrowParticipants)
        .where(eq(escrowParticipants.address, session.address));

      const escrowIds = new Set([...participantEscrowIds.map((r) => r.escrowId)]);

      // Also get escrows they created
      const createdEscrows = await ctx.db
        .select()
        .from(escrowContracts)
        .where(eq(escrowContracts.createdBy, session.address))
        .orderBy(desc(escrowContracts.createdAt))
        .limit(filters.limit);

      for (const e of createdEscrows) escrowIds.add(e.id);

      // Fetch all relevant escrows
      const allEscrows = [];
      for (const id of escrowIds) {
        const [escrow] = await ctx.db.select().from(escrowContracts).where(eq(escrowContracts.id, id)).limit(1);
        if (escrow) allEscrows.push(escrow);
      }

      // Apply filters
      let filtered = allEscrows;
      if (filters.status) filtered = filtered.filter((e) => e.status === filters.status);
      if (filters.mode) filtered = filtered.filter((e) => e.mode === filters.mode);

      // Sort by creation date
      filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return {
        escrows: filtered.slice(filters.offset, filters.offset + filters.limit),
        total: filtered.length,
      };
    }),

  /**
   * Sign/accept the escrow terms.
   */
  accept: authedProcedure
    .input(
      z.object({
        escrowId: z.string(),
        participantId: z.string(),
        signature: z.string(),
        signedMessage: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEscrow();
      const { session } = ctx;

      // Verify participant exists and belongs to caller
      const [participant] = await ctx.db
        .select()
        .from(escrowParticipants)
        .where(and(eq(escrowParticipants.id, input.participantId), eq(escrowParticipants.escrowId, input.escrowId)))
        .limit(1);

      if (!participant) throw new TRPCError({ code: "NOT_FOUND" });
      if (participant.address && participant.address !== session.address) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your participant slot" });
      }
      if (participant.accepted) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Already accepted" });
      }

      // Update participant
      await ctx.db
        .update(escrowParticipants)
        .set({ accepted: true, signature: input.signature, acceptedAt: new Date(), address: session.address })
        .where(eq(escrowParticipants.id, input.participantId));

      // Store signature
      const signatureChain = (session.chain === "BASE" ? "ETH" : session.chain) as "ETH" | "SOL" | "BTC";
      await ctx.db.insert(escrowSignatures).values({
        escrowId: input.escrowId,
        participantId: input.participantId,
        address: session.address,
        chain: signatureChain,
        signature: input.signature,
        signedMessage: input.signedMessage,
      });

      // Check if all required participants have accepted
      const allParticipants = await ctx.db
        .select()
        .from(escrowParticipants)
        .where(eq(escrowParticipants.escrowId, input.escrowId));

      const required = allParticipants.filter(
        (p) => p.role === "PARTY" || p.role === "ESCROW_AGENT" || p.role === "DESIGNATED_ORACLE",
      );
      const allAccepted = required.every((p) => p.accepted || p.id === input.participantId);

      if (allAccepted) {
        const [escrow] = await ctx.db
          .select()
          .from(escrowContracts)
          .where(eq(escrowContracts.id, input.escrowId))
          .limit(1);

        let nextStatus: string = "AWAITING_DEPOSITS";
        if (escrow?.mode === "HONOR_SYSTEM" || escrow?.mode === "CASUAL") nextStatus = "ACTIVE";
        if (escrow?.mode === "SELF_CUSTODY") nextStatus = "MONITORING";

        await ctx.db
          .update(escrowContracts)
          .set({ status: nextStatus as "AWAITING_DEPOSITS", updatedAt: new Date() })
          .where(eq(escrowContracts.id, input.escrowId));
      }

      await appendEscrowEvent(ctx.db, input.escrowId, "PARTICIPANT_ACCEPTED", session.address);

      return { success: true, allAccepted };
    }),

  /**
   * Record a deposit.
   */
  deposit: authedProcedure
    .input(
      z.object({
        escrowId: z.string(),
        participantId: z.string(),
        txHash: z.string(),
        amount: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEscrow();
      await ctx.db
        .update(escrowParticipants)
        .set({ deposited: true, depositTxHash: input.txHash, depositAmount: input.amount })
        .where(eq(escrowParticipants.id, input.participantId));

      // Check if all parties deposited
      const allParticipants = await ctx.db
        .select()
        .from(escrowParticipants)
        .where(eq(escrowParticipants.escrowId, input.escrowId));

      const parties = allParticipants.filter((p) => p.role === "PARTY");
      const allDeposited = parties.every((p) => p.deposited || p.id === input.participantId);

      if (allDeposited) {
        await ctx.db
          .update(escrowContracts)
          .set({ status: "ACTIVE", updatedAt: new Date() })
          .where(eq(escrowContracts.id, input.escrowId));
      }

      await appendEscrowEvent(ctx.db, input.escrowId, "DEPOSIT_RECEIVED", ctx.session.address, {
        txHash: input.txHash,
        amount: input.amount,
      });

      return { success: true, allDeposited };
    }),

  /**
   * Designated oracle / escrow agent submits a resolution decision.
   */
  submitDecision: authedProcedure
    .input(
      z.object({
        escrowId: z.string(),
        participantId: z.string(),
        outcomeIndex: z.number(),
        signature: z.string(),
        rationale: z.string().optional(),
        customSplit: z.record(z.string()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEscrow();
      const [participant] = await ctx.db
        .select()
        .from(escrowParticipants)
        .where(and(eq(escrowParticipants.id, input.participantId), eq(escrowParticipants.escrowId, input.escrowId)))
        .limit(1);

      if (!participant) throw new TRPCError({ code: "NOT_FOUND" });
      if (participant.address !== ctx.session.address) throw new TRPCError({ code: "FORBIDDEN" });
      if (!["ESCROW_AGENT", "DESIGNATED_ORACLE"].includes(participant.role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not an oracle/agent" });
      }

      // Record the decision
      await ctx.db.insert(escrowOracleDecisions).values({
        escrowId: input.escrowId,
        oracleParticipantId: input.participantId,
        outcomeIndex: input.outcomeIndex,
        rationale: input.rationale,
        customSplit: input.customSplit,
        signature: input.signature,
      });

      // Update participant
      await ctx.db
        .update(escrowParticipants)
        .set({
          voteOutcomeIndex: input.outcomeIndex,
          voteSignature: input.signature,
          votedAt: new Date(),
          resolutionRationale: input.rationale,
          customPayoutSplit: input.customSplit,
        })
        .where(eq(escrowParticipants.id, input.participantId));

      // Check if enough decisions to resolve
      const [escrow] = await ctx.db
        .select()
        .from(escrowContracts)
        .where(eq(escrowContracts.id, input.escrowId))
        .limit(1);

      const allDecisions = await ctx.db
        .select()
        .from(escrowOracleDecisions)
        .where(eq(escrowOracleDecisions.escrowId, input.escrowId));

      const requiredAgreement =
        escrow?.designatedOracleConfig?.requiredAgreement ?? escrow?.multiEscrowConfig?.requiredSigners ?? 1;

      // Count votes per outcome
      const voteCounts: Record<number, number> = {};
      for (const d of allDecisions) {
        voteCounts[d.outcomeIndex] = (voteCounts[d.outcomeIndex] ?? 0) + 1;
      }

      let resolved = false;
      for (const [oi, count] of Object.entries(voteCounts)) {
        if (count >= requiredAgreement) {
          await ctx.db
            .update(escrowContracts)
            .set({
              status: "RESOLVED",
              resolvedOutcomeIndex: Number(oi),
              updatedAt: new Date(),
            })
            .where(eq(escrowContracts.id, input.escrowId));
          resolved = true;

          await appendEscrowEvent(ctx.db, input.escrowId, "RESOLVED", ctx.session.address, {
            outcomeIndex: Number(oi),
            decisionCount: allDecisions.length,
          });
          break;
        }
      }

      if (!resolved) {
        await ctx.db
          .update(escrowContracts)
          .set({ status: "RESOLVING", updatedAt: new Date() })
          .where(eq(escrowContracts.id, input.escrowId));
      }

      await appendEscrowEvent(ctx.db, input.escrowId, "RESOLUTION_VOTE", ctx.session.address, {
        outcomeIndex: input.outcomeIndex,
        rationale: input.rationale,
      });

      return { success: true, resolved };
    }),

  /**
   * Raise a dispute.
   */
  dispute: authedProcedure
    .input(z.object({ escrowId: z.string(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireEscrow();
      await ctx.db
        .update(escrowContracts)
        .set({ status: "DISPUTED", updatedAt: new Date() })
        .where(eq(escrowContracts.id, input.escrowId));

      await appendEscrowEvent(ctx.db, input.escrowId, "DISPUTE_RAISED", ctx.session.address, {
        reason: input.reason,
      });

      return { success: true };
    }),

  /**
   * Request cancellation.
   */
  cancel: authedProcedure
    .input(z.object({ escrowId: z.string(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      await requireEscrow();
      const [escrow] = await ctx.db
        .select()
        .from(escrowContracts)
        .where(eq(escrowContracts.id, input.escrowId))
        .limit(1);

      if (!escrow) throw new TRPCError({ code: "NOT_FOUND" });
      if (escrow.mode === "LOCKED_PERMANENT") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Permanent escrow cannot be cancelled" });
      }

      await ctx.db
        .update(escrowContracts)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(eq(escrowContracts.id, input.escrowId));

      await appendEscrowEvent(ctx.db, input.escrowId, "CANCELLED", ctx.session.address, {
        reason: input.reason,
      });

      return { success: true };
    }),

  /**
   * Add RWA verification.
   */
  addRwaVerification: authedProcedure
    .input(
      z.object({
        escrowId: z.string(),
        assetId: z.string(),
        method: z.string(),
        details: z.record(z.unknown()).default({}),
        documents: z
          .array(
            z.object({
              type: z.string(),
              label: z.string(),
              reference: z.string(),
              contentHash: z.string().optional(),
            }),
          )
          .default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireEscrow();
      const now = new Date().toISOString();
      const [verification] = await ctx.db
        .insert(escrowRwaVerifications)
        .values({
          escrowId: input.escrowId,
          assetId: input.assetId,
          method: input.method,
          verifiedBy: ctx.session.address,
          details: input.details,
          documents: input.documents.map((d) => ({
            ...d,
            uploadedAt: now,
            uploadedBy: ctx.session.address,
          })),
        })
        .returning();

      await appendEscrowEvent(ctx.db, input.escrowId, "RWA_VERIFIED", ctx.session.address, {
        assetId: input.assetId,
        method: input.method,
      });

      return verification;
    }),

  /**
   * Get escrow event history.
   */
  events: publicProcedure.input(z.object({ escrowId: z.string() })).query(async ({ ctx, input }) => {
    await requireEscrow();
    return ctx.db
      .select()
      .from(escrowEvents)
      .where(eq(escrowEvents.escrowId, input.escrowId))
      .orderBy(desc(escrowEvents.createdAt));
  }),
});
