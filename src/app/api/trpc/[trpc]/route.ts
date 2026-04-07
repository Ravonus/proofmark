import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { logger } from "~/lib/utils/logger";

export const dynamic = "force-dynamic";

// Hand signature PNGs can be 200KB+ as base64 — raise the body limit
export const maxDuration = 30;

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ req }),
    onError: ({ error, path }) => {
      logger.error("trpc", `Error on ${path}:`, error.message);
    },
  });

export { handler as GET, handler as POST };
