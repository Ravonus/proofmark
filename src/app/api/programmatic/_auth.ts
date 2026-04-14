import { type NextRequest, NextResponse } from "next/server";
import { ProgrammaticApiError, isProgrammaticApiError } from "~/server/programmatic/errors";
import { authenticateConnector } from "../connector/_auth";

export const PROGRAMMATIC_API_VERSION = "2026-04-10";

export const PROGRAMMATIC_SCOPE_CATALOG = [
  {
    scope: "documents:read",
    description: "List documents, fetch document details, and read audit/proof data.",
  },
  {
    scope: "documents:write",
    description: "Create documents, analyze PDFs, and update pending documents.",
  },
  {
    scope: "documents:manage",
    description: "Wildcard-style document access for future mutating operations.",
  },
  {
    scope: "files:write",
    description: "File ingestion and upload-style actions such as PDF analysis.",
  },
] as const;

export type ProgrammaticToken = NonNullable<Awaited<ReturnType<typeof authenticateConnector>>>;

const LEGACY_SCOPE_ALIASES: Record<string, string[]> = {
  "documents:read": ["ai:read", "ai:write"],
  "documents:write": ["ai:write"],
  "documents:manage": ["ai:write"],
  "files:write": ["ai:write"],
};

function scopeMatches(granted: string, expected: string): boolean {
  if (granted === "*" || granted === expected) return true;
  if (granted.endsWith(":*")) {
    const prefix = granted.slice(0, -2);
    return expected === prefix || expected.startsWith(`${prefix}:`);
  }
  return false;
}

function hasScope(tokenScopes: string[] | null | undefined, expected: string): boolean {
  const grantedScopes = tokenScopes ?? [];
  if (grantedScopes.length === 0) {
    return true;
  }

  if (grantedScopes.some((granted) => scopeMatches(granted, expected))) {
    return true;
  }

  const aliases = LEGACY_SCOPE_ALIASES[expected] ?? [];
  return aliases.some((alias) => grantedScopes.some((granted) => scopeMatches(granted, alias)));
}

export function hasAnyProgrammaticScope(tokenScopes: string[] | null | undefined, expectedScopes: string[]): boolean {
  if (expectedScopes.length === 0) return true;
  return expectedScopes.some((scope) => hasScope(tokenScopes, scope));
}

export async function requireProgrammaticToken(
  request: NextRequest,
  expectedScopes: string[] = [],
): Promise<ProgrammaticToken> {
  const token = await authenticateConnector(request);
  if (!token) {
    throw new ProgrammaticApiError(401, "Unauthorized");
  }

  if (!hasAnyProgrammaticScope(token.scopes, expectedScopes)) {
    throw new ProgrammaticApiError(403, "This token does not have the required scopes", {
      requiredScopes: expectedScopes,
      tokenScopes: token.scopes ?? [],
    });
  }

  return token;
}

export function getProgrammaticClientIp(request: NextRequest): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? null;
}

export function programmaticErrorResponse(error: unknown) {
  if (isProgrammaticApiError(error)) {
    return NextResponse.json(
      error.details === undefined ? { error: error.message } : { error: error.message, details: error.details },
      { status: error.status },
    );
  }

  console.error("[programmatic-api]", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
