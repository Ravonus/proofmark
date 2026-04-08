/**
 * Better Auth configuration — core auth for ALL deployments.
 *
 * Supports out of the box:
 * - Email + password with email verification
 * - Magic link (passwordless)
 * - Two-factor authentication (TOTP)
 * - Generic OAuth / SSO (BYO API keys in OSS, managed in premium)
 *
 * Wallet-based signing auth is handled separately in the auth tRPC router
 * and can be linked to a Better Auth account.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth, magicLink, twoFactor } from "better-auth/plugins";
import { env } from "~/env";
import { logger } from "~/lib/utils/logger";
import { db } from "~/server/db";
import * as schema from "~/server/db/schema";

/**
 * Build SSO providers from env vars at startup.
 * OSS operators plug in their own keys; premium ships pre-configured.
 *
 * For each provider, set:
 *   AUTH_<PROVIDER>_CLIENT_ID
 *   AUTH_<PROVIDER>_CLIENT_SECRET
 *
 * e.g. AUTH_GOOGLE_CLIENT_ID, AUTH_GOOGLE_CLIENT_SECRET
 */
type OAuthProviderConfig = {
  id: string;
  name: string;
  discoveryUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  scopes?: string[];
};

const KNOWN_PROVIDERS: OAuthProviderConfig[] = [
  {
    id: "google",
    name: "Google",
    discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
    scopes: ["openid", "email", "profile"],
  },
  {
    id: "github",
    name: "GitHub",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userInfoUrl: "https://api.github.com/user",
    scopes: ["user:email"],
  },
  {
    id: "discord",
    name: "Discord",
    authorizationUrl: "https://discord.com/api/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userInfoUrl: "https://discord.com/api/users/@me",
    scopes: ["identify", "email"],
  },
  {
    id: "x",
    name: "X (Twitter)",
    authorizationUrl: "https://twitter.com/i/oauth2/authorize",
    tokenUrl: "https://api.twitter.com/2/oauth2/token",
    userInfoUrl: "https://api.twitter.com/2/users/me",
    scopes: ["users.read", "tweet.read"],
  },
  {
    id: "microsoft",
    name: "Microsoft",
    discoveryUrl: "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration",
    scopes: ["openid", "email", "profile"],
  },
  {
    id: "okta",
    name: "Okta",
    // Requires AUTH_OKTA_ISSUER env var for discovery
    scopes: ["openid", "email", "profile"],
  },
];

function buildOAuthProviders() {
  const configs: Array<{
    providerId: string;
    clientId: string;
    clientSecret: string;
    discoveryUrl?: string;
    authorizationUrl?: string;
    tokenUrl?: string;
    userInfoUrl?: string;
    scopes?: string[];
  }> = [];

  for (const provider of KNOWN_PROVIDERS) {
    const clientId = process.env[`AUTH_${provider.id.toUpperCase()}_CLIENT_ID`];
    const clientSecret = process.env[`AUTH_${provider.id.toUpperCase()}_CLIENT_SECRET`];
    if (!clientId || !clientSecret) continue;

    const issuer = process.env[`AUTH_${provider.id.toUpperCase()}_ISSUER`];
    const discoveryUrl = issuer ? `${issuer}/.well-known/openid-configuration` : provider.discoveryUrl;

    configs.push({
      providerId: provider.id,
      clientId,
      clientSecret,
      discoveryUrl,
      authorizationUrl: provider.authorizationUrl,
      tokenUrl: provider.tokenUrl,
      userInfoUrl: provider.userInfoUrl,
      scopes: provider.scopes,
    });
  }

  return configs;
}

const oauthProviders = buildOAuthProviders();
const authBaseUrlFallback = env.BETTER_AUTH_URL || process.env.NEXTAUTH_URL || "http://localhost:3100";
const authAllowedHosts = [
  "*.cloudfront.net",
  "docu.technomancy.it",
  "localhost:1337",
  "127.0.0.1:1337",
  "localhost:3100",
  "127.0.0.1:3100",
];
const buildTimeAuthSecret =
  process.env.NEXT_PHASE === "phase-production-build" || process.env.npm_lifecycle_event === "build"
    ? "build-only-better-auth-secret-0123456789"
    : undefined;

export const auth = betterAuth({
  baseURL: {
    allowedHosts: authAllowedHosts,
    fallback: authBaseUrlFallback,
    protocol: authBaseUrlFallback.startsWith("http://") ? "http" : "https",
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: schema.users,
      account: schema.accounts,
      verification: schema.verifications,
      session: schema.sessions,
    },
  }),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },

  secret: env.BETTER_AUTH_SECRET || buildTimeAuthSecret,

  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        if (!env.SMTP_HOST) {
          logger.info("auth", `Magic link for ${email}: ${url}`);
          return;
        }
        const { sendMagicLinkEmail } = await import("~/server/messaging/email");
        await sendMagicLinkEmail({ to: email, magicLinkUrl: url });
      },
    }),

    twoFactor({
      issuer: "Proofmark",
    }),

    // Add all configured OAuth providers as a single plugin
    ...(oauthProviders.length > 0 ? [genericOAuth({ config: oauthProviders })] : []),
  ],

  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      if (!env.SMTP_HOST) {
        logger.info("auth", `Verification email for ${user.email}: ${url}`);
        return;
      }
      const { sendVerificationEmail } = await import("~/server/messaging/email");
      await sendVerificationEmail({ to: user.email, verifyUrl: url });
    },
  },

  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60,
    },
  },
});

export type AuthSession = typeof auth.$Infer.Session;

/** Return the list of configured OAuth provider IDs for the login UI. */
export function getConfiguredProviders(): string[] {
  return oauthProviders.map((c) => c.providerId);
}
