"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient, genericOAuthClient, magicLinkClient } from "better-auth/client/plugins";

export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : "http://localhost:3100",
  plugins: [twoFactorClient(), genericOAuthClient(), magicLinkClient()],
});

export const { signIn, signUp, signOut, useSession, twoFactor, getSession } = authClient;
