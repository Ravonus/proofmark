/**
 * Social verification OAuth callback handler.
 *
 * Flow:
 * 1. Signer clicks "Verify with X/GitHub/Discord/Google" on the signing page
 * 2. Client opens a popup to /api/social-verify?provider=x&documentId=...&claimToken=...&fieldId=...
 * 3. This route redirects to the OAuth provider
 * 4. Provider redirects back here with ?code=...&state=...
 * 5. We exchange the code for user info, record the verification, and close the popup
 */

import { type NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "~/server/db";
import { signers } from "~/server/db/schema";
import { encodeStructuredFieldValue } from "~/lib/field-values";
import type { SocialVerificationFieldValue } from "~/lib/field-values";

export const dynamic = "force-dynamic";

const PROVIDERS: Record<
  string,
  {
    authorizeUrl: string;
    tokenUrl: string;
    userInfoUrl: string;
    scopes: string;
    clientIdEnv: string;
    clientSecretEnv: string;
    parseUser: (data: Record<string, unknown>) => { username: string; profileId: string };
  }
> = {
  x: {
    authorizeUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    userInfoUrl: "https://api.twitter.com/2/users/me",
    scopes: "users.read tweet.read",
    clientIdEnv: "AUTH_X_CLIENT_ID",
    clientSecretEnv: "AUTH_X_CLIENT_SECRET",
    parseUser: (data) => {
      const d = data.data as Record<string, string> | undefined;
      return { username: d?.username ?? "", profileId: d?.id ?? "" };
    },
  },
  github: {
    authorizeUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scopes: "user:email",
    clientIdEnv: "AUTH_GITHUB_CLIENT_ID",
    clientSecretEnv: "AUTH_GITHUB_CLIENT_SECRET",
    parseUser: (data) => ({
      username: (data.login as string) ?? "",
      profileId: String(data.id ?? ""),
    }),
  },
  discord: {
    authorizeUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userInfoUrl: "https://discord.com/api/users/@me",
    scopes: "identify",
    clientIdEnv: "AUTH_DISCORD_CLIENT_ID",
    clientSecretEnv: "AUTH_DISCORD_CLIENT_SECRET",
    parseUser: (data) => ({
      username: (data.username as string) ?? "",
      profileId: (data.id as string) ?? "",
    }),
  },
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
    scopes: "openid email profile",
    clientIdEnv: "AUTH_GOOGLE_CLIENT_ID",
    clientSecretEnv: "AUTH_GOOGLE_CLIENT_SECRET",
    parseUser: (data) => ({
      username: (data.email as string) ?? "",
      profileId: (data.id as string) ?? "",
    }),
  },
};

// In-memory state store (short-lived, TTL 10 min, max 10k entries)
const MAX_PENDING_STATES = 10_000;
const pendingStates = new Map<
  string,
  {
    provider: string;
    documentId: string;
    claimToken: string;
    fieldId: string;
    codeVerifier: string;
    origin: string;
    expiresAt: number;
  }
>();

function cleanupStates() {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (val.expiresAt < now) pendingStates.delete(key);
  }
  // Evict oldest if over limit
  if (pendingStates.size > MAX_PENDING_STATES) {
    const excess = pendingStates.size - MAX_PENDING_STATES;
    const keys = pendingStates.keys();
    for (let i = 0; i < excess; i++) {
      const k = keys.next().value;
      if (k) pendingStates.delete(k);
    }
  }
}

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Derive the public-facing origin. Behind reverse proxies (CloudFront, nginx,
 * etc.) the Host header is often rewritten to the internal origin (localhost).
 * The only source that *always* knows the real domain is the browser — so the
 * client passes `callbackOrigin=window.location.origin` as a query param and
 * we trust that first. Header-based detection remains as a fallback.
 */
function detectOrigin(req: NextRequest, callbackOrigin: string | null): string {
  // 1. Explicit origin from the client — always correct
  if (callbackOrigin) {
    return callbackOrigin.replace(/\/+$/, "");
  }

  // 2. x-forwarded-host — set by well-configured reverse proxies
  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${forwardedHost}`;
  }

  // 3. host header — correct in dev, unreliable behind proxies
  const host = req.headers.get("host");
  if (host) {
    const proto = host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https";
    return `${proto}://${host}`;
  }

  return new URL(req.url).origin;
}

export async function GET(req: NextRequest) {
  cleanupStates();
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  // ── Step 1: Initiate OAuth ──
  if (!code) {
    const provider = url.searchParams.get("provider");
    const documentId = url.searchParams.get("documentId");
    const claimToken = url.searchParams.get("claimToken");
    const fieldId = url.searchParams.get("fieldId");

    if (!provider || !documentId || !claimToken || !fieldId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 });
    }

    const config = PROVIDERS[provider];
    if (!config) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }

    const clientId = process.env[config.clientIdEnv];
    if (!clientId) {
      return NextResponse.json({ error: `${provider} OAuth not configured` }, { status: 400 });
    }

    // Prefix state with "sv:" so the auth catch-all can distinguish
    // social-verify callbacks from regular Better Auth login callbacks.
    const state = `sv:${randomBytes(24).toString("hex")}`;
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    // The client passes window.location.origin so we always know the real
    // public domain, regardless of what the reverse proxy does to headers.
    const callbackOrigin = url.searchParams.get("callbackOrigin");
    const origin = detectOrigin(req, callbackOrigin);

    pendingStates.set(state, {
      provider,
      documentId,
      claimToken,
      fieldId,
      codeVerifier,
      origin,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    // Use the same callback URL as Better Auth so only one redirect_uri
    // needs to be registered per provider (e.g. on X's developer portal).
    const redirectUri = `${origin}/api/auth/callback/${provider}`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: config.scopes,
      state,
      ...(provider === "x" ? { code_challenge: codeChallenge, code_challenge_method: "S256" } : {}),
    });

    const authUrl = `${config.authorizeUrl}?${params.toString()}`;
    console.log(`[social-verify] Detected origin: ${origin}`);
    console.log(`[social-verify] Redirecting to ${provider}:`, authUrl);
    console.log(`[social-verify] redirect_uri:`, redirectUri);
    return NextResponse.redirect(authUrl);
  }

  // ── Step 2: Handle OAuth callback ──
  if (!stateParam || !pendingStates.has(stateParam)) {
    return closePopup("Verification failed: invalid or expired state");
  }

  const pending = pendingStates.get(stateParam)!;
  pendingStates.delete(stateParam);

  if (pending.expiresAt < Date.now()) {
    return closePopup("Verification failed: session expired");
  }

  const config = PROVIDERS[pending.provider];
  if (!config) {
    return closePopup("Verification failed: unknown provider");
  }

  const clientId = process.env[config.clientIdEnv];
  const clientSecret = process.env[config.clientSecretEnv];
  if (!clientId || !clientSecret) {
    return closePopup("Verification failed: provider not configured");
  }

  // Must match the redirect_uri used in the authorization request — use the
  // origin we captured in step 1, not the current request headers (which may
  // differ after the redirect chain through X → auth catch-all → here).
  const redirectUri = `${pending.origin}/api/auth/callback/${pending.provider}`;

  try {
    // Exchange code for token
    const tokenBody: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    };

    // X/Twitter uses PKCE
    if (pending.provider === "x") {
      tokenBody.code_verifier = pending.codeVerifier;
    }

    const tokenRes = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": pending.provider === "github" ? "application/json" : "application/x-www-form-urlencoded",
        Accept: "application/json",
        ...(pending.provider === "x"
          ? { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}` }
          : {}),
      },
      body: pending.provider === "github" ? JSON.stringify(tokenBody) : new URLSearchParams(tokenBody).toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error(`[social-verify] Token exchange failed for ${pending.provider}:`, errText);
      return closePopup("Verification failed: could not authenticate with provider");
    }

    const tokenData = (await tokenRes.json()) as Record<string, string>;
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      return closePopup("Verification failed: no access token received");
    }

    // Fetch user info
    const userRes = await fetch(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userRes.ok) {
      const errBody = await userRes.text();
      console.error(`[social-verify] User info fetch failed (${userRes.status}):`, errBody);
      return closePopup(`Verification failed: could not fetch user info (${userRes.status})`);
    }

    const userData = (await userRes.json()) as Record<string, unknown>;
    const { username, profileId } = config.parseUser(userData);

    if (!username || !profileId) {
      return closePopup("Verification failed: could not determine username");
    }

    // Record verification on the signer
    const [signer] = await db
      .select()
      .from(signers)
      .where(and(eq(signers.documentId, pending.documentId), eq(signers.claimToken, pending.claimToken)))
      .limit(1);

    if (!signer) {
      return closePopup("Verification failed: signer not found");
    }

    // Enforce requiredUsername if set on the field
    const signerFields = (signer.fields as Array<{ id?: string; settings?: Record<string, unknown> }> | null) ?? [];
    const fieldDef = signerFields.find((f) => f.id === pending.fieldId);
    const requiredUsername = fieldDef?.settings?.requiredUsername as string | undefined;
    if (requiredUsername) {
      const normalizedRequired = requiredUsername.replace(/^@/, "").toLowerCase();
      const normalizedActual = username.toLowerCase();
      if (normalizedActual !== normalizedRequired) {
        return closePopup(
          `Verification failed: this field requires the account @${normalizedRequired}, but you authenticated as @${username}`,
        );
      }
    }

    const verification = {
      provider: pending.provider as "x" | "github" | "discord" | "google",
      username,
      profileId,
      verifiedAt: new Date().toISOString(),
      fieldId: pending.fieldId,
    };

    const existing = (signer.socialVerifications as (typeof verification)[] | null) ?? [];
    // Replace any previous verification for the same field
    const updated = [...existing.filter((v) => v.fieldId !== pending.fieldId), verification];

    // Also update field values with the structured value
    const fieldValue: SocialVerificationFieldValue = {
      kind: "social-verification",
      provider: verification.provider,
      status: "verified",
      username,
      profileId,
      verifiedAt: verification.verifiedAt,
    };

    const currentFieldValues = (signer.fieldValues) ?? {};
    const updatedFieldValues = {
      ...currentFieldValues,
      [pending.fieldId]: encodeStructuredFieldValue(fieldValue),
    };

    console.log(
      `[social-verify] Saving verification for signer ${signer.id}, field ${pending.fieldId}, username: ${username}`,
    );
    console.log(`[social-verify] fieldValues being saved:`, JSON.stringify(updatedFieldValues));

    await db
      .update(signers)
      .set({
        socialVerifications: updated,
        fieldValues: updatedFieldValues,
      })
      .where(eq(signers.id, signer.id));

    console.log(`[social-verify] DB update complete for signer ${signer.id}`);

    // Store verification session for reuse across contracts
    try {
      const { storeVerificationSession } = await import("~/server/verification-sessions");
      await storeVerificationSession({
        identifier: username,
        provider: pending.provider as "x" | "github" | "discord" | "google",
        profileId,
        displayName: username,
      });
    } catch (e) {
      console.warn("[social-verify] Failed to store verification session:", (e as Error).message);
    }

    return closePopup(null);
  } catch (err) {
    console.error("[social-verify] Error:", err);
    return closePopup("Verification failed: unexpected error");
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function closePopup(error: string | null) {
  const safeError = error ? escapeHtml(error) : null;
  const html = `<!DOCTYPE html>
<html>
<head><title>Social Verification</title></head>
<body>
<script>window.close();</script>
${safeError ? `<p>${safeError}</p><p><a href="#" onclick="window.close()">Close this window</a></p>` : ""}
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html" },
  });
}
