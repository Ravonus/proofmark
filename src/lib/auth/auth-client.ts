"use client";

import { genericOAuthClient, magicLinkClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "http://localhost:3100",
  plugins: [twoFactorClient({ twoFactorPage: "/login?step=two-factor" }), genericOAuthClient(), magicLinkClient()],
});

export const { signIn, signUp, signOut, useSession, twoFactor, getSession } = authClient;
