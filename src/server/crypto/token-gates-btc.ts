/**
 * BTC / Ordinals / Rune lookup helpers extracted from token-gates.ts
 * to reduce file length below the 650-line Biome threshold.
 */

// ── Types ──────────────────────────────────────────────────────────────────

type HttpError = Error & {
  status?: number;
};

type OrdConfig = {
  baseUrl: string;
};

type OrdInscriptionResponse = {
  id: string;
  address?: string | null;
};

type OrdAddressResponse = {
  runes_balances?: Array<[string, string, string?]>;
};

type OrdRuneResponse = {
  entry?: {
    divisibility?: number;
    spaced_rune?: string;
    symbol?: string | null;
  };
};

export type RuneBalance = {
  amount: string;
  amountKind: "display" | "raw";
  name: string;
  symbol?: string | null;
};

export type RuneMetadata = {
  divisibility: number;
  name: string;
  symbol?: string | null;
};

// ── HTTP helpers ───────────────────────────────────────────────────────────

function createHttpError(status: number, message: string): HttpError {
  const error = new Error(message) as HttpError;
  error.status = status;
  return error;
}

function isHttpErrorStatus(error: unknown, status: number): boolean {
  return !!error && typeof error === "object" && "status" in error && error.status === status;
}

function buildUrl(baseUrl: string, path: string): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), normalizedBase);
}

async function fetchResponse(url: URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonFromUrl<T>(url: URL, init?: RequestInit): Promise<T> {
  const response = await fetchResponse(url, init);
  if (!response.ok) {
    throw createHttpError(response.status, `Request to ${url.origin}${url.pathname} failed (${response.status}).`);
  }

  return (await response.json()) as T;
}

async function fetchTextFromUrl(url: URL, init?: RequestInit): Promise<string> {
  const response = await fetchResponse(url, init);
  if (!response.ok) {
    throw createHttpError(response.status, `Request to ${url.origin}${url.pathname} failed (${response.status}).`);
  }

  return await response.text();
}

// ── Ord server / ordinals.com config ───────────────────────────────────────

function getOrdConfig(): OrdConfig | null {
  const baseUrl =
    process.env.ORD_RPC_URL?.trim() || process.env.ORD_SERVER_URL?.trim() || process.env.BTC_ORD_RPC_URL?.trim();
  return baseUrl ? { baseUrl } : null;
}

function getOrdinalsBaseUrl(): string {
  return process.env.ORDINALS_BASE_URL?.trim() || "https://ordinals.com";
}

async function fetchOrdServerJson<T>(path: string): Promise<T> {
  const cfg = getOrdConfig();
  if (!cfg) {
    throw new Error("BTC token-gate verification needs ORD_RPC_URL or a public ordinals.com fallback.");
  }

  return await fetchJsonFromUrl<T>(buildUrl(cfg.baseUrl, path), {
    headers: {
      accept: "application/json",
    },
  });
}

// ── HTML parsers ───────────────────────────────────────────────────────────

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseOrdinalsInscriptionAddressFromHtml(html: string): string | null {
  const match = /<dt>address<\/dt>\s*<dd><a[^>]*>([^<]+)<\/a><\/dd>/i.exec(html);
  return match ? decodeHtmlEntities(match[1] ?? "").trim() : null;
}

function parseOrdinalsAddressRuneBalances(html: string): RuneBalance[] {
  return Array.from(
    html.matchAll(
      /<dd><a[^>]*href=(?:"|')?\/rune\/[^"' >]+(?:"|')?[^>]*>([^<]+)<\/a>:\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*[^<]*<\/dd>/gi,
    ),
    (match) => ({
      amount: (match[2] ?? "0").replace(/,/g, ""),
      amountKind: "display" as const,
      name: decodeHtmlEntities(match[1] ?? "").trim(),
    }),
  );
}

function parseOrdinalsRuneMetadataFromHtml(html: string): RuneMetadata | null {
  const nameMatch = /<h1>([^<]+)<\/h1>/i.exec(html);
  const divisibilityMatch = /<dt>divisibility<\/dt>\s*<dd>(\d+)<\/dd>/i.exec(html);
  const symbolMatch = /<dt>symbol<\/dt>\s*<dd>([^<]*)<\/dd>/i.exec(html);

  if (!nameMatch || !divisibilityMatch) return null;

  return {
    divisibility: Number.parseInt(divisibilityMatch[1] ?? "0", 10),
    name: decodeHtmlEntities(nameMatch[1] ?? "").trim(),
    symbol: symbolMatch ? decodeHtmlEntities(symbolMatch[1] ?? "").trim() || null : null,
  };
}

function getRuneLookupCandidates(identifier: string): string[] {
  const trimmed = identifier.trim();
  const collapsed = trimmed.replace(/[.\s•]/g, "");
  return Array.from(new Set([trimmed, collapsed].filter(Boolean)));
}

// ── Lookup functions ───────────────────────────────────────────────────────

async function lookupInscriptionFromOrd(id: string): Promise<{
  result: OrdInscriptionResponse | null;
  notFound: boolean;
  failure: string | null;
}> {
  if (!getOrdConfig()) return { result: null, notFound: false, failure: null };

  try {
    const result = await fetchOrdServerJson<OrdInscriptionResponse>(`/inscription/${encodeURIComponent(id)}`);
    return { result, notFound: false, failure: null };
  } catch (error) {
    if (isHttpErrorStatus(error, 404)) {
      return { result: null, notFound: true, failure: null };
    }
    return {
      result: null,
      notFound: false,
      failure: error instanceof Error ? error.message : "Unknown ord server error",
    };
  }
}

async function lookupInscriptionFromWeb(id: string): Promise<{
  result: OrdInscriptionResponse | null;
  notFound: boolean;
  failure: string | null;
}> {
  try {
    const html = await fetchTextFromUrl(buildUrl(getOrdinalsBaseUrl(), `/inscription/${encodeURIComponent(id)}`));
    const address = parseOrdinalsInscriptionAddressFromHtml(html);
    if (address) {
      return { result: { id, address }, notFound: false, failure: null };
    }
    return {
      result: null,
      notFound: false,
      failure: "Could not parse the owner address from ordinals.com.",
    };
  } catch (error) {
    if (isHttpErrorStatus(error, 404)) {
      return { result: null, notFound: true, failure: null };
    }
    return {
      result: null,
      notFound: false,
      failure: error instanceof Error ? error.message : "Unknown ordinals.com scrape error",
    };
  }
}

export async function lookupInscription(id: string): Promise<OrdInscriptionResponse | null> {
  const ord = await lookupInscriptionFromOrd(id);
  if (ord.result) return ord.result;

  const web = await lookupInscriptionFromWeb(id);
  if (web.result) return web.result;

  if (ord.notFound || web.notFound) return null;

  const firstFailure = ord.failure ?? web.failure;
  throw new Error(firstFailure ?? "Ordinal ownership lookup failed.");
}

export async function lookupAddressRunes(address: string): Promise<RuneBalance[]> {
  const failures: string[] = [];

  if (getOrdConfig()) {
    try {
      const response = await fetchOrdServerJson<OrdAddressResponse>(`/address/${encodeURIComponent(address)}`);
      return (response.runes_balances ?? []).map(([name, amount, symbol]) => ({
        amount,
        amountKind: "raw" as const,
        name,
        symbol,
      }));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "Unknown ord server address lookup error");
    }
  }

  try {
    const html = await fetchTextFromUrl(buildUrl(getOrdinalsBaseUrl(), `/address/${encodeURIComponent(address)}`));
    return parseOrdinalsAddressRuneBalances(html);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "Unknown ordinals.com address scrape error");
  }

  throw new Error(failures[0] ?? "Rune balance lookup failed.");
}

async function lookupRuneFromOrd(candidates: string[]): Promise<{
  result: RuneMetadata | null;
  notFound: boolean;
  failure: string | null;
}> {
  if (!getOrdConfig()) return { result: null, notFound: false, failure: null };

  for (const candidate of candidates) {
    try {
      const response = await fetchOrdServerJson<OrdRuneResponse>(`/rune/${encodeURIComponent(candidate)}`);
      return {
        result: {
          divisibility: Number(response.entry?.divisibility ?? 0),
          name: response.entry?.spaced_rune ?? candidate,
          symbol: response.entry?.symbol ?? null,
        },
        notFound: false,
        failure: null,
      };
    } catch (error) {
      if (isHttpErrorStatus(error, 404)) {
        continue;
      }
      return {
        result: null,
        notFound: false,
        failure: error instanceof Error ? error.message : "Unknown ord server rune lookup error",
      };
    }
  }
  return { result: null, notFound: true, failure: null };
}

async function lookupRuneFromWeb(candidates: string[]): Promise<{
  result: RuneMetadata | null;
  notFound: boolean;
  failure: string | null;
}> {
  for (const candidate of candidates) {
    try {
      const html = await fetchTextFromUrl(buildUrl(getOrdinalsBaseUrl(), `/rune/${encodeURIComponent(candidate)}`));
      const metadata = parseOrdinalsRuneMetadataFromHtml(html);
      if (metadata) return { result: metadata, notFound: false, failure: null };
      return {
        result: null,
        notFound: false,
        failure: `Could not parse rune metadata for ${candidate}.`,
      };
    } catch (error) {
      if (isHttpErrorStatus(error, 404)) {
        continue;
      }
      return {
        result: null,
        notFound: false,
        failure: error instanceof Error ? error.message : "Unknown ordinals.com rune lookup error",
      };
    }
  }
  return { result: null, notFound: true, failure: null };
}

export async function lookupRuneMetadata(identifier: string): Promise<RuneMetadata | null> {
  const candidates = getRuneLookupCandidates(identifier);

  const ord = await lookupRuneFromOrd(candidates);
  if (ord.result) return ord.result;

  const web = await lookupRuneFromWeb(candidates);
  if (web.result) return web.result;

  if (ord.notFound || web.notFound) return null;

  const firstFailure = ord.failure ?? web.failure;
  throw new Error(firstFailure ?? `Rune metadata lookup failed for ${identifier}.`);
}
