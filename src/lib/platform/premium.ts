// @ts-nocheck -- dynamic premium module loading; modules may not exist in OSS builds
/**
 * Premium module loader.
 *
 * Premium modules live in proofmark/premium/ (gitignored).
 * Free/OSS builds don't have that directory — everything degrades gracefully.
 *
 * Toggle premium off even when modules are present:
 *   PROOFMARK_PREMIUM=0 npm run dev
 */

import { existsSync } from "fs";
import { join } from "path";

let _premiumAvailable: boolean | null = null;

export function isPremiumAvailable(): boolean {
  if (_premiumAvailable !== null) return _premiumAvailable;
  try {
    if (process.env.PROOFMARK_PREMIUM === "0") {
      _premiumAvailable = false;
      return false;
    }
    const premiumPath = join(process.cwd(), "premium", "index.ts");
    _premiumAvailable = existsSync(premiumPath);
  } catch {
    _premiumAvailable = false;
  }
  return _premiumAvailable;
}

export function getPremiumFeatures() {
  const available = isPremiumAvailable();
  return {
    available,
    blockchainAnchoring: available,
    onChainStorage: available,
    vault: false,
    htmlInscriptions: available,
    ai: available,
    collaboration: available,
  };
}

/**
 * Load the premium chains module. Returns null if premium not available.
 * Uses a non-analyzable dynamic import so webpack doesn't try to bundle it.
 */
export async function loadPremiumChains() {
  if (!isPremiumAvailable()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return await import(/* webpackIgnore: true */ "../../premium/chains/index");
  } catch (e) {
    console.warn("[premium] chains not available:", (e as Error).message);
    return null;
  }
}

/**
 * Load the premium lib module. Returns null if premium not available.
 */
export async function loadPremiumLib() {
  if (!isPremiumAvailable()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return await import(/* webpackIgnore: true */ "../../premium/lib/index");
  } catch (e) {
    console.warn("[premium] lib not available:", (e as Error).message);
    return null;
  }
}

/**
 * Load the premium AI module. Returns null if premium not available.
 */
export async function loadPremiumAi() {
  if (!isPremiumAvailable()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return await import(/* webpackIgnore: true */ "../../premium/ai/index");
  } catch (e) {
    console.warn("[premium] ai not available:", (e as Error).message);
    return null;
  }
}

/**
 * Load the premium collaboration module. Returns null if premium not available.
 */
export async function loadPremiumCollab() {
  if (!isPremiumAvailable()) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return await import(/* webpackIgnore: true */ "../../premium/collaboration/index");
  } catch (e) {
    console.warn("[premium] collaboration not available:", (e as Error).message);
    return null;
  }
}
