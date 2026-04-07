/**
 * Client-side premium detection.
 *
 * Uses a build-time env var to determine if this is a premium build.
 * Set NEXT_PUBLIC_PROOFMARK_PREMIUM=1 in the premium deployment.
 * OSS builds leave it unset or "0".
 */

export const isPremiumBuild = process.env.NEXT_PUBLIC_PROOFMARK_PREMIUM === "1";
