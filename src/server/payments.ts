import type { InlineField } from "~/lib/document/document-tokens";
import type { IntegrationConfig } from "~/server/db/schema";
import type { PaymentFieldValue } from "~/lib/document/field-values";

export type PaymentFieldSettings = {
  amount?: number;
  currency?: string;
  description?: string;
};

function getPayPalBaseUrl(config: IntegrationConfig) {
  return config.endpoint || "https://api-m.sandbox.paypal.com";
}

function normalizeAmount(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Payment field requires a positive amount");
  }
  return Math.round(amount * 100) / 100;
}

export function getPaymentFieldSettings(field: InlineField): Required<PaymentFieldSettings> {
  const settings = (field.settings ?? {}) as PaymentFieldSettings;
  return {
    amount: normalizeAmount(settings.amount ?? 0),
    currency: String(settings.currency || "usd").toLowerCase(),
    description: String(settings.description || field.label || "Proofmark payment"),
  };
}

async function createStripeCheckout(
  config: IntegrationConfig,
  params: {
    amount: number;
    currency: string;
    description: string;
    successUrl: string;
    cancelUrl: string;
    metadata: Record<string, string>;
  },
) {
  if (!config.apiKey) {
    throw new Error("Stripe payment provider requires an API key");
  }

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      mode: "payment",
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": params.currency,
      "line_items[0][price_data][unit_amount]": String(Math.round(params.amount * 100)),
      "line_items[0][price_data][product_data][name]": params.description,
      ...Object.fromEntries(Object.entries(params.metadata).map(([key, value]) => [`metadata[${key}]`, value])),
    }),
  });

  if (!response.ok) {
    throw new Error(`Stripe checkout failed with ${response.status}`);
  }

  const data = (await response.json()) as { url?: string; id?: string };
  if (!data.url || !data.id) {
    throw new Error("Stripe checkout did not return a redirect URL");
  }

  return { checkoutUrl: data.url, reference: data.id };
}

async function verifyStripeCheckout(config: IntegrationConfig, sessionId: string) {
  if (!config.apiKey) {
    throw new Error("Stripe payment provider requires an API key");
  }

  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Stripe payment verification failed with ${response.status}`);
  }

  const data = (await response.json()) as { payment_status?: string; id?: string };
  if (data.payment_status !== "paid" || !data.id) {
    throw new Error("Stripe checkout is not marked as paid");
  }

  return data.id;
}

async function getPayPalAccessToken(config: IntegrationConfig) {
  if (!config.apiKey || !config.apiSecret) {
    throw new Error("PayPal payment provider requires client id and secret");
  }

  const response = await fetch(`${getPayPalBaseUrl(config)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!response.ok) {
    throw new Error(`PayPal token request failed with ${response.status}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("PayPal token response was missing an access token");
  }

  return data.access_token;
}

async function createPayPalCheckout(
  config: IntegrationConfig,
  params: {
    amount: number;
    currency: string;
    description: string;
    successUrl: string;
    cancelUrl: string;
  },
) {
  const accessToken = await getPayPalAccessToken(config);
  const response = await fetch(`${getPayPalBaseUrl(config)}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          description: params.description,
          amount: {
            currency_code: params.currency.toUpperCase(),
            value: params.amount.toFixed(2),
          },
        },
      ],
      application_context: {
        return_url: params.successUrl,
        cancel_url: params.cancelUrl,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`PayPal checkout failed with ${response.status}`);
  }

  const data = (await response.json()) as {
    id?: string;
    links?: Array<{ rel?: string; href?: string }>;
  };
  const approval = data.links?.find((link) => link.rel === "approve")?.href;
  if (!approval || !data.id) {
    throw new Error("PayPal checkout did not return an approval URL");
  }

  return { checkoutUrl: approval, reference: data.id };
}

async function capturePayPalOrder(config: IntegrationConfig, orderId: string) {
  const accessToken = await getPayPalAccessToken(config);
  const response = await fetch(`${getPayPalBaseUrl(config)}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`PayPal capture failed with ${response.status}`);
  }

  const data = (await response.json()) as { status?: string; id?: string };
  if (data.status !== "COMPLETED" || !data.id) {
    throw new Error("PayPal order was not completed");
  }

  return data.id;
}

export async function createPaymentCheckout(params: {
  config: IntegrationConfig;
  field: InlineField;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}) {
  const settings = getPaymentFieldSettings(params.field);
  const provider = params.config.provider.toUpperCase();

  switch (provider) {
    case "STRIPE":
      return createStripeCheckout(params.config, {
        ...settings,
        successUrl: params.successUrl,
        cancelUrl: params.cancelUrl,
        metadata: params.metadata,
      });
    case "PAYPAL":
      return createPayPalCheckout(params.config, {
        ...settings,
        successUrl: params.successUrl,
        cancelUrl: params.cancelUrl,
      });
    default:
      throw new Error(`Unsupported payment provider "${params.config.provider}"`);
  }
}

export async function verifyPaymentCheckout(params: {
  config: IntegrationConfig;
  field: InlineField;
  reference: string;
}) {
  const settings = getPaymentFieldSettings(params.field);
  const provider = params.config.provider.toUpperCase();

  const resolvedReference =
    provider === "STRIPE"
      ? await verifyStripeCheckout(params.config, params.reference)
      : await capturePayPalOrder(params.config, params.reference);

  const result: PaymentFieldValue = {
    kind: "payment",
    provider,
    amount: settings.amount,
    currency: settings.currency,
    status: "paid",
    reference: resolvedReference,
    paidAt: new Date().toISOString(),
  };

  return result;
}
