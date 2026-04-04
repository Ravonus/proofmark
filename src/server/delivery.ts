import type { BrandingSettings, Document, IntegrationConfig, Signer } from "~/server/db/schema";
import { sendSignatureRequest } from "~/server/email";
import { getBrandingProfile, getDefaultIntegration } from "~/server/workspace";

type InviteReason = "invite" | "reminder";

function buildSmsMessage(params: { brandName: string; documentTitle: string; signUrl: string; reason: InviteReason }) {
  const prefix = params.reason === "reminder" ? "Reminder" : "Signature request";
  return `${prefix} from ${params.brandName}: ${params.documentTitle}. Review and sign: ${params.signUrl}`;
}

async function sendViaTwilio(config: IntegrationConfig, to: string, body: string) {
  if (!config.accountSid || !config.authToken || !config.from) {
    throw new Error("Twilio config requires accountSid, authToken, and from");
  }

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: to,
      From: config.from,
      Body: body,
    }),
  });

  if (!response.ok) {
    throw new Error(`Twilio failed with ${response.status}`);
  }
}

async function sendViaVonage(config: IntegrationConfig, to: string, body: string) {
  if (!config.apiKey || !config.apiSecret || !config.from) {
    throw new Error("Vonage config requires apiKey, apiSecret, and from");
  }

  const response = await fetch("https://rest.nexmo.com/sms/json", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      to,
      from: config.from,
      text: body,
    }),
  });

  if (!response.ok) {
    throw new Error(`Vonage failed with ${response.status}`);
  }
}

async function sendViaTelnyx(config: IntegrationConfig, to: string, body: string) {
  if (!config.apiKey || !config.from) {
    throw new Error("Telnyx config requires apiKey and from");
  }

  const response = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.from,
      to,
      text: body,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telnyx failed with ${response.status}`);
  }
}

export async function sendSms(config: IntegrationConfig, to: string, body: string) {
  const provider = config.provider.toUpperCase();
  switch (provider) {
    case "TWILIO":
      return sendViaTwilio(config, to, body);
    case "VONAGE":
      return sendViaVonage(config, to, body);
    case "TELNYX":
      return sendViaTelnyx(config, to, body);
    default:
      throw new Error(`Unsupported SMS provider "${config.provider}"`);
  }
}

export async function sendSignerInvite(params: {
  ownerAddress: string;
  brandingProfileId?: string | null;
  document: Pick<Document, "title">;
  signer: Pick<Signer, "label" | "email" | "phone"> & {
    deliveryMethods?: ("EMAIL" | "SMS")[] | null;
  };
  signUrl: string;
  reason?: InviteReason;
}) {
  const branding = await getBrandingProfile(params.ownerAddress, params.brandingProfileId);
  const channels = params.signer.deliveryMethods ?? [];
  const reason = params.reason ?? "invite";
  const shouldEmail = params.signer.email && (channels.length === 0 || channels.includes("EMAIL"));
  const shouldSms = params.signer.phone && channels.includes("SMS");

  if (shouldEmail && params.signer.email) {
    await sendSignatureRequest({
      to: params.signer.email,
      documentTitle: params.document.title,
      signerLabel: params.signer.label,
      signUrl: params.signUrl,
      branding,
      replyTo: branding.emailReplyTo,
      isReminder: reason === "reminder",
    });
  }

  if (shouldSms && params.signer.phone) {
    const smsConfig = await getDefaultIntegration(params.ownerAddress, "SMS");
    if (!smsConfig?.enabled) {
      console.warn("[delivery] SMS requested but no SMS integration is configured");
      return;
    }

    await sendSms(
      smsConfig,
      params.signer.phone,
      buildSmsMessage({
        brandName: branding.brandName || "Proofmark",
        documentTitle: params.document.title,
        signUrl: params.signUrl,
        reason,
      }),
    );
  }
}

export async function resolveDocumentBranding(
  ownerAddress: string,
  brandingProfileId?: string | null,
): Promise<BrandingSettings> {
  return getBrandingProfile(ownerAddress, brandingProfileId);
}
