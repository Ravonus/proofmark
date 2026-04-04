/**
 * Server-Side Forensic Evidence Collector
 *
 * Assembles a court-admissible evidence packet from:
 *  1. Client-side fingerprint + behavioral signals (sent with sign request)
 *  2. Server-side IP geolocation + VPN/proxy detection (pluggable providers)
 *  3. TLS fingerprint (from reverse proxy headers, if available)
 *  4. Reverse DNS, HTTP header fingerprint, forwarded chain
 *
 * FREE (no API key):
 *  - geoip-lite / MaxMind GeoLite2 local DB (DEFAULT, zero rate limits)
 *  - ip-api.com fallback (45 req/min)
 *  - Reverse DNS, HTTP header fingerprint (built-in)
 *
 * BYO API key:
 *  - IPinfo.io (50k/mo free) · IPQualityScore (5k/mo free) · AbstractAPI (20k/mo free)
 */

import { createHash } from "crypto";
import { promises as dns } from "dns";
import type {
  ClientFingerprint,
  BehavioralSignals,
  ForensicEvidence,
  ForensicFlag,
  GeoIntel,
  TlsFingerprint,
  ForensicProviderConfig,
  ForensicGeoProvider,
} from "~/lib/forensic/types";
import { logger } from "~/lib/logger";

/* ═══════════════════════════════════════════════════════════════
   Geo Providers
   ═══════════════════════════════════════════════════════════════ */

/** Helper: fetch JSON with a 5s timeout and map the response to GeoIntel. */
async function fetchGeo(
  url: string,
  provider: string,
  mapper: (data: Record<string, unknown>) => Omit<GeoIntel, "ip" | "provider">,
  ip: string,
): Promise<GeoIntel> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${provider} HTTP ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  return { ip, provider, ...mapper(data) };
}

/* ── ip-api.com (free, 45 req/min) ──────────────────────────── */

const ipApiProvider: ForensicGeoProvider = {
  name: "ip-api",
  lookupIp: (ip) =>
    fetchGeo(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,region,regionName,city,lat,lon,isp,org,as,proxy,hosting,mobile,query`,
      "ip-api",
      (d) => {
        if (d.status === "fail") throw new Error(`ip-api: ${d.message}`);
        return {
          city: (d.city as string) ?? null,
          region: (d.regionName as string) ?? null,
          country: (d.country as string) ?? null,
          countryCode: (d.countryCode as string) ?? null,
          latitude: (d.lat as number) ?? null,
          longitude: (d.lon as number) ?? null,
          isp: (d.isp as string) ?? null,
          org: (d.org as string) ?? null,
          asn: (d.as as string) ?? null,
          isVpn: null,
          isProxy: (d.proxy as boolean) ?? null,
          isTor: null,
          isDatacenter: (d.hosting as boolean) ?? null,
          isBot: null,
          fraudScore: null,
        };
      },
      ip,
    ),
};

/* ── IPinfo.io (BYO key, 50k/mo free) ──────────────────────── */

function createIpinfoProvider(apiKey: string): ForensicGeoProvider {
  return {
    name: "ipinfo",
    lookupIp: (ip) =>
      fetchGeo(
        `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${apiKey}`,
        "ipinfo",
        (d) => {
          const [lat, lon] = ((d.loc as string) ?? ",").split(",");
          const priv = (d.privacy as Record<string, boolean>) ?? {};
          return {
            city: (d.city as string) ?? null,
            region: (d.region as string) ?? null,
            country: (d.country as string) ?? null,
            countryCode: (d.country as string) ?? null,
            latitude: lat ? parseFloat(lat) : null,
            longitude: lon ? parseFloat(lon) : null,
            isp: (d.org as string) ?? null,
            org: (d.org as string) ?? null,
            asn: (d.asn as Record<string, string>)?.asn ?? null,
            isVpn: priv.vpn ?? null,
            isProxy: priv.proxy ?? null,
            isTor: priv.tor ?? null,
            isDatacenter: priv.hosting ?? null,
            isBot: null,
            fraudScore: null,
          };
        },
        ip,
      ),
  };
}

/* ── IPQualityScore (BYO key, 5k/mo free) ──────────────────── */

function createIpqsProvider(apiKey: string): ForensicGeoProvider {
  return {
    name: "ipqualityscore",
    lookupIp: (ip) =>
      fetchGeo(
        `https://ipqualityscore.com/api/json/ip/${apiKey}/${encodeURIComponent(ip)}?strictness=1&allow_public_access_points=true`,
        "ipqualityscore",
        (d) => ({
          city: (d.city as string) ?? null,
          region: (d.region as string) ?? null,
          country: (d.country_code as string) ?? null,
          countryCode: (d.country_code as string) ?? null,
          latitude: (d.latitude as number) ?? null,
          longitude: (d.longitude as number) ?? null,
          isp: (d.ISP as string) ?? null,
          org: (d.organization as string) ?? null,
          asn: (d.ASN as number)?.toString() ?? null,
          isVpn: (d.vpn as boolean) ?? null,
          isProxy: (d.proxy as boolean) ?? null,
          isTor: (d.tor as boolean) ?? null,
          isDatacenter: null,
          isBot: (d.bot_status as boolean) ?? null,
          fraudScore: (d.fraud_score as number) ?? null,
        }),
        ip,
      ),
  };
}

/* ── AbstractAPI (BYO key, 20k/mo free) ─────────────────────── */

function createAbstractProvider(apiKey: string): ForensicGeoProvider {
  return {
    name: "abstractapi",
    lookupIp: (ip) =>
      fetchGeo(
        `https://ipgeolocation.abstractapi.com/v1/?api_key=${apiKey}&ip_address=${encodeURIComponent(ip)}`,
        "abstractapi",
        (d) => {
          const sec = (d.security as Record<string, boolean>) ?? {};
          const conn = (d.connection as Record<string, string>) ?? {};
          return {
            city: (d.city as string) ?? null,
            region: (d.region as string) ?? null,
            country: (d.country as string) ?? null,
            countryCode: (d.country_code as string) ?? null,
            latitude: (d.latitude as number) ?? null,
            longitude: (d.longitude as number) ?? null,
            isp: conn.isp ?? null,
            org: conn.organization ?? null,
            asn: conn.autonomous_system_number?.toString() ?? null,
            isVpn: sec.is_vpn ?? null,
            isProxy: sec.is_proxy ?? null,
            isTor: sec.is_tor ?? null,
            isDatacenter: sec.is_datacenter ?? null,
            isBot: sec.is_known_attacker ?? null,
            fraudScore: null,
          };
        },
        ip,
      ),
  };
}

/* ── MaxMind GeoLite2 local DB (geoip-lite, zero API calls) ── */

function createMaxmindLiteProvider(): ForensicGeoProvider {
  return {
    name: "maxmind-geoip-lite",
    async lookupIp(ip: string): Promise<GeoIntel> {
      const geoip = await import("geoip-lite");
      const geo = geoip.default?.lookup?.(ip) ?? geoip.lookup?.(ip);
      if (!geo) throw new Error("No result");
      return {
        ip,
        provider: "maxmind-geoip-lite",
        city: geo.city ?? null,
        region: geo.region ?? null,
        country: geo.country ?? null,
        countryCode: geo.country ?? null,
        latitude: geo.ll?.[0] ?? null,
        longitude: geo.ll?.[1] ?? null,
        isp: null,
        org: null,
        asn: null,
        isVpn: null,
        isProxy: null,
        isTor: null,
        isDatacenter: null,
        isBot: null,
        fraudScore: null,
      };
    },
  };
}

/* ── Provider factory + cached default ──────────────────────── */

let cachedDefaultProvider: ForensicGeoProvider | null = null;

async function getDefaultGeoProvider(): Promise<ForensicGeoProvider> {
  if (cachedDefaultProvider) return cachedDefaultProvider;
  try {
    await import("geoip-lite");
    cachedDefaultProvider = createMaxmindLiteProvider();
  } catch {
    logger.info("forensic", "geoip-lite not installed, using ip-api.com fallback");
    cachedDefaultProvider = ipApiProvider;
  }
  return cachedDefaultProvider;
}

export function createGeoProvider(config: ForensicProviderConfig): ForensicGeoProvider {
  switch (config.provider) {
    case "maxmind-geoip-lite":
      return createMaxmindLiteProvider();
    case "ipinfo":
      if (!config.apiKey) throw new Error("IPinfo requires apiKey");
      return createIpinfoProvider(config.apiKey);
    case "ipqualityscore":
      if (!config.apiKey) throw new Error("IPQS requires apiKey");
      return createIpqsProvider(config.apiKey);
    case "abstractapi":
      if (!config.apiKey) throw new Error("AbstractAPI requires apiKey");
      return createAbstractProvider(config.apiKey);
    case "ipapi":
    default:
      return ipApiProvider;
  }
}

/* ═══════════════════════════════════════════════════════════════
   Server-Side Signal Extraction
   ═══════════════════════════════════════════════════════════════ */

async function reverseDnsLookup(ip: string): Promise<string | null> {
  try {
    return (await dns.reverse(ip))[0] ?? null;
  } catch {
    return null;
  }
}

function computeHeaderFingerprint(headers: Headers): string {
  const names: string[] = [];
  headers.forEach((_v, k) => names.push(k.toLowerCase()));
  return createHash("sha256").update(names.sort().join("|")).digest("hex");
}

function extractForwardedChain(headers: Headers): string[] | null {
  const hops: string[] = [];
  const xff = headers.get("x-forwarded-for");
  if (xff)
    hops.push(
      ...xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
  for (const [suffix, key] of [
    ["proto", "x-forwarded-proto"],
    ["host", "x-forwarded-host"],
    ["port", "x-forwarded-port"],
  ] as const) {
    const v = headers.get(key);
    if (v) hops.push(`${suffix}:${v}`);
  }
  return hops.length > 0 ? hops : null;
}

function extractTlsFingerprint(headers: Headers): TlsFingerprint | null {
  const ja4 = headers.get("x-ja4") ?? headers.get("x-tls-ja4");
  if (ja4) return { hash: ja4, type: "ja4" };
  const ja3 = headers.get("x-ja3") ?? headers.get("x-tls-ja3");
  if (ja3) return { hash: ja3, type: "ja3" };
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   Flag Analysis
   ═══════════════════════════════════════════════════════════════ */

function analyzeFlags(fp: ClientFingerprint, beh: BehavioralSignals, geo: GeoIntel | null): ForensicFlag[] {
  const flags: ForensicFlag[] = [];
  const flag = (code: string, severity: ForensicFlag["severity"], message: string) =>
    flags.push({ code, severity, message });

  // Network / identity hiding
  if (geo?.isVpn) flag("VPN_DETECTED", "warn", "Signer is using a VPN service");
  if (geo?.isProxy) flag("PROXY_DETECTED", "warn", "Signer is connecting through a proxy");
  if (geo?.isTor) flag("TOR_DETECTED", "critical", "Signer is using the Tor network");
  if (geo?.isDatacenter) flag("DATACENTER_IP", "warn", "IP belongs to a datacenter/cloud provider");
  if (geo?.isBot) flag("BOT_DETECTED", "critical", "IP flagged as a known bot or attacker");
  if (geo?.fraudScore != null && geo.fraudScore >= 75)
    flag("HIGH_FRAUD_SCORE", "critical", `IP fraud score is ${geo.fraudScore}/100`);

  // Automation
  if (fp.webdriver) flag("WEBDRIVER_DETECTED", "critical", "Browser controlled by automation (webdriver)");

  // Timezone vs geo mismatch
  if (geo?.countryCode && fp.timezone) {
    const tzContinent = fp.timezone.split("/")[0];
    const geoContinent = CONTINENT_MAP[geo.countryCode];
    if (tzContinent && geoContinent && tzContinent !== geoContinent)
      flag("TIMEZONE_GEO_MISMATCH", "warn", `Timezone ${fp.timezone} doesn't match IP location (${geo.country})`);
  }

  // Behavioral anomalies
  if (beh.timeOnPage < 3000)
    flag("RAPID_SIGNING", "warn", `Signed in ${Math.round(beh.timeOnPage / 1000)}s (suspiciously fast)`);
  if (beh.mouseMoveCount === 0 && fp.touchPoints === 0)
    flag("NO_MOUSE_MOVEMENT", "info", "No mouse/touch interaction during signing");
  if (!beh.scrolledToBottom) flag("DID_NOT_SCROLL_FULL", "info", `Only scrolled to ${beh.maxScrollDepth}% of document`);

  // Tracking resistance
  if (!fp.cookieEnabled) flag("COOKIES_DISABLED", "warn", "Cookies disabled (limits identity tracking)");
  if (fp.visitCount <= 1 && !fp.persistentId)
    flag("FIRST_VISIT_NO_PERSISTENCE", "info", "First visit with no prior tracking data");

  return flags;
}

const CONTINENT_MAP: Record<string, string> = {
  US: "America",
  CA: "America",
  MX: "America",
  BR: "America",
  AR: "America",
  CO: "America",
  CL: "America",
  GB: "Europe",
  DE: "Europe",
  FR: "Europe",
  IT: "Europe",
  ES: "Europe",
  NL: "Europe",
  SE: "Europe",
  NO: "Europe",
  FI: "Europe",
  DK: "Europe",
  PL: "Europe",
  RO: "Europe",
  CZ: "Europe",
  AT: "Europe",
  CH: "Europe",
  BE: "Europe",
  PT: "Europe",
  IE: "Europe",
  GR: "Europe",
  HU: "Europe",
  UA: "Europe",
  RU: "Europe",
  CN: "Asia",
  JP: "Asia",
  KR: "Asia",
  IN: "Asia",
  SG: "Asia",
  TH: "Asia",
  VN: "Asia",
  PH: "Asia",
  ID: "Asia",
  MY: "Asia",
  TW: "Asia",
  HK: "Asia",
  IL: "Asia",
  AE: "Asia",
  SA: "Asia",
  AU: "Australia",
  NZ: "Australia",
  ZA: "Africa",
  NG: "Africa",
  KE: "Africa",
  EG: "Africa",
  GH: "Africa",
  MA: "Africa",
};

/* ═══════════════════════════════════════════════════════════════
   Private IP Detection
   ═══════════════════════════════════════════════════════════════ */

function isPrivateIp(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") return true;
  if (ip.startsWith("10.") || ip.startsWith("192.168.")) return true;
  // 172.16.0.0 – 172.31.255.255
  if (ip.startsWith("172.")) {
    const second = parseInt(ip.split(".")[1]!, 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/* ═══════════════════════════════════════════════════════════════
   Main: Assemble Forensic Evidence Packet
   ═══════════════════════════════════════════════════════════════ */

export interface AssembleForensicInput {
  fingerprint: ClientFingerprint;
  behavioral: BehavioralSignals;
  ip: string | null;
  userAgent: string | null;
  headers: Headers;
  providerConfig?: ForensicProviderConfig;
}

export async function assembleForensicEvidence(input: AssembleForensicInput): Promise<ForensicEvidence> {
  const { fingerprint, behavioral, ip, userAgent, headers } = input;

  // 1. Geo + reverse DNS in parallel
  let geo: GeoIntel | null = null;
  let reverseDns: string | null = null;
  if (ip && !isPrivateIp(ip)) {
    const geoPromise = (async () => {
      try {
        const provider = input.providerConfig ? createGeoProvider(input.providerConfig) : await getDefaultGeoProvider();
        return await provider.lookupIp(ip);
      } catch (err) {
        logger.warn("forensic", `Geo lookup failed: ${err}`);
        return null;
      }
    })();
    [geo, reverseDns] = await Promise.all([geoPromise, reverseDnsLookup(ip)]);
  }

  // 2. Extract server-side signals
  const tls = extractTlsFingerprint(headers);
  const headerFingerprint = computeHeaderFingerprint(headers);
  const acceptLanguage = headers.get("accept-language") ?? null;
  const forwardedChain = extractForwardedChain(headers);

  // 3. Flag analysis
  const flags = analyzeFlags(fingerprint, behavioral, geo);

  // 4. Build + hash evidence packet
  const evidence: ForensicEvidence = {
    version: 1,
    collectedAt: new Date().toISOString(),
    fingerprint,
    behavioral,
    geo,
    tls,
    userAgent,
    ip,
    evidenceHash: "",
    flags,
    reverseDns,
    headerFingerprint,
    acceptLanguage,
    forwardedChain,
  };

  evidence.evidenceHash = createHash("sha256")
    .update(JSON.stringify({ ...evidence, evidenceHash: undefined }))
    .digest("hex");

  return evidence;
}

export function hashForensicEvidence(evidence: ForensicEvidence): string {
  return createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
}
