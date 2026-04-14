import { NextResponse } from "next/server";
import {
  PROGRAMMATIC_API_VERSION,
  PROGRAMMATIC_SCOPE_CATALOG,
  programmaticErrorResponse,
  requireProgrammaticToken,
} from "./_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROGRAMMATIC_ENDPOINTS = [
  {
    method: "GET",
    path: "/api/programmatic",
    scopes: [],
    description: "Discover the agent-facing API surface and the current token context.",
  },
  {
    method: "GET",
    path: "/api/programmatic/documents",
    scopes: ["documents:read"],
    description: "List documents owned by the authenticated token wallet.",
  },
  {
    method: "POST",
    path: "/api/programmatic/documents",
    scopes: ["documents:write"],
    description: "Create a document from structured JSON input.",
  },
  {
    method: "GET",
    path: "/api/programmatic/documents/:id",
    scopes: ["documents:read"],
    description: "Fetch a full creator view of a document, including decrypted content and signer links.",
  },
  {
    method: "PATCH",
    path: "/api/programmatic/documents/:id",
    scopes: ["documents:write", "documents:manage"],
    description: "Edit a pending document before any signer activity occurs.",
  },
  {
    method: "POST",
    path: "/api/programmatic/documents/analyze-pdf",
    scopes: ["documents:write", "files:write"],
    description: "Analyze an uploaded PDF and return extracted text and signer hints.",
  },
  {
    method: "GET",
    path: "/api/programmatic/documents/:id/proof",
    scopes: ["documents:read"],
    description: "Return the proof packet manifest plus the generated PDF as base64.",
  },
  {
    method: "GET",
    path: "/api/programmatic/documents/:id/audit",
    scopes: ["documents:read"],
    description: "Return the document audit trail and audit-chain validity.",
  },
  {
    method: "POST",
    path: "/api/programmatic/documents/:id/actions/void",
    scopes: ["documents:write", "documents:manage"],
    description: "Void a pending document owned by the authenticated workspace.",
  },
  {
    method: "POST",
    path: "/api/programmatic/documents/:id/signers/:signerId/resend",
    scopes: ["documents:write", "documents:manage"],
    description: "Resend a signing invite to a pending signer.",
  },
  {
    method: "GET",
    path: "/api/programmatic/documents/:id/shared-files",
    scopes: ["documents:read", "documents:manage"],
    description: "List post-sign shared files configured on a document.",
  },
  {
    method: "POST",
    path: "/api/programmatic/documents/:id/shared-files",
    scopes: ["documents:write", "documents:manage", "files:write"],
    description: "Upload or replace a post-sign shared file.",
  },
  {
    method: "GET",
    path: "/api/programmatic/documents/:id/shared-files/:filename",
    scopes: ["documents:read", "documents:manage"],
    description: "Download a shared file from a document.",
  },
  {
    method: "DELETE",
    path: "/api/programmatic/documents/:id/shared-files/:filename",
    scopes: ["documents:write", "documents:manage"],
    description: "Remove a shared file from a document.",
  },
  {
    method: "GET",
    path: "/api/programmatic/templates",
    scopes: ["documents:read", "documents:manage"],
    description: "List document templates for the authenticated workspace.",
  },
  {
    method: "POST",
    path: "/api/programmatic/templates",
    scopes: ["documents:write", "documents:manage"],
    description: "Create a document template.",
  },
  {
    method: "GET",
    path: "/api/programmatic/templates/:id",
    scopes: ["documents:read", "documents:manage"],
    description: "Fetch a single document template.",
  },
  {
    method: "PATCH",
    path: "/api/programmatic/templates/:id",
    scopes: ["documents:write", "documents:manage"],
    description: "Update a document template.",
  },
  {
    method: "DELETE",
    path: "/api/programmatic/templates/:id",
    scopes: ["documents:write", "documents:manage"],
    description: "Delete a document template.",
  },
  {
    method: "POST",
    path: "/api/programmatic/signing/field-values",
    scopes: ["documents:write", "documents:manage"],
    description: "Persist editable signer field values before signing.",
  },
  {
    method: "POST",
    path: "/api/programmatic/signing/get-message",
    scopes: ["documents:write", "documents:manage"],
    description: "Get the canonical wallet signing message and challenge bundle.",
  },
  {
    method: "POST",
    path: "/api/programmatic/signing/request-otp",
    scopes: ["documents:write", "documents:manage"],
    description: "Send a signing OTP for an email signer.",
  },
  {
    method: "POST",
    path: "/api/programmatic/signing/sign-wallet",
    scopes: ["documents:write", "documents:manage"],
    description: "Complete a wallet signing step.",
  },
  {
    method: "POST",
    path: "/api/programmatic/signing/sign-email",
    scopes: ["documents:write", "documents:manage"],
    description: "Complete an email OTP signing step.",
  },
  {
    method: "POST",
    path: "/api/programmatic/signing/attachments",
    scopes: ["documents:write", "documents:manage", "files:write"],
    description: "Upload a signer attachment for a file-attachment field.",
  },
] as const;

export async function GET(request: Request) {
  try {
    const token = await requireProgrammaticToken(request as never);
    return NextResponse.json({
      version: PROGRAMMATIC_API_VERSION,
      auth: {
        type: "bearer",
        tokenModel: "connectorAccessToken",
        ownerAddress: token.ownerAddress,
        label: token.label,
        scopes: token.scopes ?? [],
        expiresAt: token.expiresAt?.toISOString() ?? null,
      },
      scopes: PROGRAMMATIC_SCOPE_CATALOG,
      endpoints: PROGRAMMATIC_ENDPOINTS,
    });
  } catch (error) {
    return programmaticErrorResponse(error);
  }
}
