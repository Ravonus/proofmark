/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Collaboration router — OSS stub.
 * Full implementation: premium/server/routers/collab.ts
 */

import { z } from "zod";
import { collabRouter as premiumRouter } from "~/generated/premium/server/routers/collab";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

const stubRouter = createTRPCRouter({
  capabilities: publicProcedure.query(() => ({
    available: false,
    collaboration: false,
  })),
  create: publicProcedure.input(z.any()).mutation((): any => ({
    sessionId: "",
    joinToken: "",
    session: null,
    participants: [],
  })),
  join: publicProcedure.input(z.any()).mutation((): any => ({
    sessionId: "",
    session: null,
    participants: [],
  })),
  leave: publicProcedure.input(z.any()).mutation((): any => ({ ok: true })),
  close: publicProcedure.input(z.any()).mutation((): any => ({ ok: true })),
  togglePause: publicProcedure.input(z.any()).mutation((): any => ({ status: "paused" })),
  saveToDocument: publicProcedure.input(z.any()).mutation((): any => ({ ok: true })),
  getOrCreateForDocument: publicProcedure.input(z.any()).mutation((): any => ({
    sessionId: "",
    created: false,
  })),
  createInviteLink: publicProcedure.input(z.any()).mutation((): any => ({
    inviteToken: "",
    url: "",
    role: "viewer",
    expiresAt: null,
  })),
  joinViaInvite: publicProcedure.input(z.any()).mutation((): any => ({
    sessionId: "",
    session: null,
    participants: [],
  })),
  get: publicProcedure.input(z.any()).query((): any => ({
    session: null,
    participants: [],
    myRole: null,
    permissions: {},
  })),
  list: publicProcedure.input(z.any().optional()).query((): any => []),
  updateRole: publicProcedure.input(z.any()).mutation((): any => ({ ok: true })),
  removeParticipant: publicProcedure.input(z.any()).mutation((): any => ({ ok: true })),
  createAnnotation: publicProcedure.input(z.any()).mutation((): any => ({ annotation: null })),
  getAnnotations: publicProcedure.input(z.any()).query((): any => []),
  resolveAnnotation: publicProcedure.input(z.any()).mutation((): any => ({ ok: true })),
  deleteAnnotation: publicProcedure.input(z.any()).mutation((): any => ({ ok: true })),
  annotationCounts: publicProcedure.input(z.any()).query((): any => ({
    total: 0,
    open: 0,
    resolved: 0,
    byType: {},
  })),
  getSharedThreads: publicProcedure.input(z.any()).query((): any => []),
  sendSharedAiMessage: publicProcedure.input(z.any()).mutation((): any => ({
    threadId: "",
    message: null,
    response: { content: "Premium feature unavailable" },
  })),
  getPrivateThreads: publicProcedure.input(z.any()).query((): any => []),
  sendPrivateAiMessage: publicProcedure.input(z.any()).mutation((): any => ({
    threadId: "",
    message: null,
    response: { content: "Premium feature unavailable" },
  })),
  createLink: publicProcedure.input(z.any()).mutation((): any => ({
    token: "",
    url: "",
    breakdown: null,
    expiresAt: null,
  })),
  resolveLink: publicProcedure.input(z.any()).query((): any => ({
    valid: false,
    sessionId: null,
    anchor: null,
    breakdown: null,
    expiresAt: null,
  })),
  sessionLinks: publicProcedure.input(z.any()).query((): any => []),
  importPdf: publicProcedure.input(z.any()).mutation((): any => ({ ok: false })),
});

export const collabRouter = (premiumRouter ?? stubRouter) as typeof stubRouter;
