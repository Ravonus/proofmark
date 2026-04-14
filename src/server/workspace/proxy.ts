/**
 * Proxy Admin API client.
 *
 * Controls IP whitelisting on the reverse proxy for gated docs access.
 * After signing an NDA, the signer's IP gets whitelisted on the
 * restricted-access docs domain.
 */

import { env } from "~/env";

const PROXY_API = env.PROXY_API_URL;

async function proxyRequest(path: string, body: unknown): Promise<boolean> {
  try {
    const resp = await fetch(`${PROXY_API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      console.error(`[proxy] ${path} failed:`, resp.status, await resp.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[proxy] ${path} error:`, e);
    return false;
  }
}

/**
 * Ensure a restricted HTTP proxy entry exists for the given domain.
 * Idempotent — safe to call repeatedly.
 */
export async function ensureProxyEntry(params: { domain: string; backend: string }): Promise<boolean> {
  return proxyRequest("/api/save", {
    kind: "http",
    domain: params.domain,
    backend: params.backend,
    access_mode: "restricted",
  });
}

/**
 * Add an IP/CIDR to the allowlist for an HTTP proxy entry.
 */
export async function addProxyIp(params: { domain: string; ip: string }): Promise<boolean> {
  // The proxy identifies HTTP entries by domain
  return proxyRequest("/api/access/http", {
    entry_id: params.domain,
    action: "add",
    cidr: params.ip.includes("/") ? params.ip : `${params.ip}/32`,
  });
}

/**
 * Remove an IP/CIDR from the allowlist for an HTTP proxy entry.
 */
export async function removeProxyIp(params: { domain: string; ip: string }): Promise<boolean> {
  return proxyRequest("/api/access/http", {
    entry_id: params.domain,
    action: "remove",
    cidr: params.ip.includes("/") ? params.ip : `${params.ip}/32`,
  });
}
