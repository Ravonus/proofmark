import type { AddressSuggestion } from "~/lib/address-autocomplete";
import type { IntegrationConfig } from "~/server/db/schema";

type SearchParams = {
  config: IntegrationConfig;
  query: string;
  limit?: number;
  countryCodes?: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeCountryCodes(explicit?: string[], config?: IntegrationConfig): string[] {
  if (explicit?.length) return explicit.map((entry) => entry.toLowerCase());
  const raw = config?.metadata?.countryCodes;
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function createSuggestion(
  payload: Partial<AddressSuggestion> & Pick<AddressSuggestion, "id" | "label">,
): AddressSuggestion {
  const formatted = payload.formatted || payload.label;
  const primaryLine = payload.primaryLine || payload.addressLine1 || payload.label;
  return {
    id: payload.id,
    label: payload.label,
    primaryLine,
    secondaryLine: payload.secondaryLine,
    formatted,
    addressLine1: payload.addressLine1,
    addressLine2: payload.addressLine2,
    city: payload.city,
    county: payload.county,
    state: payload.state,
    postalCode: payload.postalCode,
    country: payload.country,
    countryCode: payload.countryCode,
  };
}

function getMapboxContextValue(feature: Record<string, unknown>, prefix: string): string | undefined {
  const context = readArray(feature.context);
  const entry = context.find((candidate) => isRecord(candidate) && readString(candidate.id)?.startsWith(prefix));
  if (!isRecord(entry)) return undefined;
  return readString(entry.text) || readString(entry.short_code);
}

async function searchMapbox(params: SearchParams): Promise<AddressSuggestion[]> {
  if (!params.config.apiKey) throw new Error("Mapbox address provider requires an API key");
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(params.query)}.json`);
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("limit", String(params.limit ?? 5));
  url.searchParams.set("types", "address,place,postcode,locality,neighborhood");
  url.searchParams.set("access_token", params.config.apiKey);

  const countryCodes = normalizeCountryCodes(params.countryCodes, params.config);
  if (countryCodes.length > 0) {
    url.searchParams.set("country", countryCodes.join(","));
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Mapbox address lookup failed (${response.status})`);
  }

  const payload = (await response.json()) as { features?: unknown[] };
  return readArray(payload.features).flatMap((item) => {
    if (!isRecord(item)) return [];
    const featureText = readString(item.text);
    const featureAddress = readString(item.address);
    const addressLine1 = [featureAddress, featureText].filter(Boolean).join(" ").trim() || featureText;
    const label = readString(item.place_name) || addressLine1 || readString(item.id);
    if (!label) return [];
    const city = getMapboxContextValue(item, "place.") || getMapboxContextValue(item, "locality.");
    const state = getMapboxContextValue(item, "region.");
    const postalCode = getMapboxContextValue(item, "postcode.");
    const country = getMapboxContextValue(item, "country.");
    const countryCode = getMapboxContextValue(item, "country.")?.slice(0, 2)?.toUpperCase();
    const secondaryLine = [city, state, postalCode].filter(Boolean).join(", ") || country;
    return [
      createSuggestion({
        id: readString(item.id) || label,
        label,
        formatted: label,
        primaryLine: addressLine1 || label,
        secondaryLine,
        addressLine1: addressLine1 || undefined,
        city,
        state,
        postalCode,
        country,
        countryCode,
      }),
    ];
  });
}

async function searchGeoapify(params: SearchParams): Promise<AddressSuggestion[]> {
  if (!params.config.apiKey) throw new Error("Geoapify address provider requires an API key");
  const url = new URL("https://api.geoapify.com/v1/geocode/autocomplete");
  url.searchParams.set("text", params.query);
  url.searchParams.set("limit", String(params.limit ?? 5));
  url.searchParams.set("format", "json");
  url.searchParams.set("apiKey", params.config.apiKey);

  const countryCodes = normalizeCountryCodes(params.countryCodes, params.config);
  if (countryCodes.length > 0) {
    url.searchParams.set("filter", `countrycode:${countryCodes.join(",")}`);
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Geoapify address lookup failed (${response.status})`);
  }

  const payload = (await response.json()) as { results?: unknown[] };
  return readArray(payload.results).flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = readString(item.formatted);
    if (!label) return [];
    const primaryLine = readString(item.address_line1) || label;
    const city = readString(item.city);
    const state = readString(item.state);
    const postalCode = readString(item.postcode);
    const country = readString(item.country);
    return [
      createSuggestion({
        id: readString(item.place_id) || label,
        label,
        formatted: label,
        primaryLine,
        secondaryLine: [city, state, postalCode].filter(Boolean).join(", ") || country,
        addressLine1: readString(item.address_line1),
        addressLine2: readString(item.address_line2),
        city,
        county: readString(item.county),
        state,
        postalCode,
        country,
        countryCode: readString(item.country_code)?.toUpperCase(),
      }),
    ];
  });
}

function parseCustomSuggestion(item: unknown): AddressSuggestion | null {
  if (!isRecord(item)) return null;
  const label =
    readString(item.label) || readString(item.formatted) || readString(item.address) || readString(item.primaryLine);
  if (!label) return null;
  return createSuggestion({
    id: readString(item.id) || label,
    label,
    formatted: readString(item.formatted) || label,
    primaryLine: readString(item.primaryLine) || readString(item.addressLine1) || readString(item.address) || label,
    secondaryLine: readString(item.secondaryLine),
    addressLine1: readString(item.addressLine1),
    addressLine2: readString(item.addressLine2),
    city: readString(item.city),
    county: readString(item.county),
    state: readString(item.state),
    postalCode: readString(item.postalCode),
    country: readString(item.country),
    countryCode: readString(item.countryCode)?.toUpperCase(),
  });
}

async function searchCustom(params: SearchParams): Promise<AddressSuggestion[]> {
  if (!params.config.endpoint) throw new Error("Custom address provider requires an endpoint");
  const url = new URL(params.config.endpoint);
  url.searchParams.set("q", params.query);
  url.searchParams.set("limit", String(params.limit ?? 5));

  const countryCodes = normalizeCountryCodes(params.countryCodes, params.config);
  if (countryCodes.length > 0) {
    url.searchParams.set("countryCodes", countryCodes.join(","));
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      ...(params.config.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Custom address lookup failed (${response.status})`);
  }

  const payload = (await response.json()) as unknown;
  const items = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.suggestions)
      ? payload.suggestions
      : isRecord(payload) && Array.isArray(payload.results)
        ? payload.results
        : [];

  return items.flatMap((item) => {
    const suggestion = parseCustomSuggestion(item);
    return suggestion ? [suggestion] : [];
  });
}

export async function searchAddressSuggestions(params: SearchParams): Promise<AddressSuggestion[]> {
  const provider = params.config.provider.trim().toUpperCase();
  if (params.config.enabled === false) return [];
  if (params.query.trim().length < 3) return [];

  switch (provider) {
    case "MAPBOX":
      return searchMapbox(params);
    case "GEOAPIFY":
      return searchGeoapify(params);
    case "CUSTOM":
      return searchCustom(params);
    default:
      throw new Error(`Unsupported address provider "${params.config.provider}"`);
  }
}
