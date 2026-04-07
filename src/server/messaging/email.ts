import nodemailer from "nodemailer";
import { env } from "~/env";
import type { BrandingSettings, Signer, Document } from "~/server/db/schema";
import { logger } from "~/lib/utils/logger";
import { generateSignedPDF } from "~/server/crypto/rust-engine";

const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    })
  : null;

const BASE_BRAND = {
  name: "Proofmark",
  color: "#6366f1",
  accent: "#22c55e",
  bg: "#0a0a0f",
  cardBg: "#12121a",
  text: "#e2e2e2",
  muted: "#888888",
  border: "#2a2a3a",
};

function getBrand(branding?: BrandingSettings) {
  return {
    name: branding?.brandName || BASE_BRAND.name,
    color: branding?.primaryColor || BASE_BRAND.color,
    accent: branding?.accentColor || BASE_BRAND.accent,
    bg: BASE_BRAND.bg,
    cardBg: BASE_BRAND.cardBg,
    text: BASE_BRAND.text,
    muted: BASE_BRAND.muted,
    border: BASE_BRAND.border,
    logoUrl: branding?.logoUrl,
    footer: branding?.emailFooter,
  };
}

/* ── Table-based email layout with branded header, white body, footer ── */

function layout(content: string, branding?: BrandingSettings): string {
  const brand = getBrand(branding);
  const headerLogoHtml = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${brand.name}" style="height:32px;max-width:160px;object-fit:contain;" />`
    : `<span style="font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;font-family:Arial,Helvetica,sans-serif;">${brand.name}</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${brand.name}</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Arial,Helvetica,sans-serif;-webkit-font-smoothing:antialiased;">
  <!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;">
    <tr><td align="center" style="padding:32px 16px 0 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header: dark gradient -->
        <tr><td style="background:linear-gradient(180deg,#0a0a0f 0%,#12121a 100%);padding:28px 40px 24px 40px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="vertical-align:middle;">
                ${headerLogoHtml}
              </td>
              <td align="right" style="vertical-align:middle;font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:1.2px;font-family:Arial,Helvetica,sans-serif;">
                Secure Document Signing
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Accent line -->
        <tr><td style="background:${brand.color};height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>

        <!-- Body: white background -->
        <tr><td style="background-color:#ffffff;padding:36px 40px;">
          ${content}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background-color:#f9fafb;padding:24px 40px;border-top:1px solid #e5e7eb;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;">
                ${brand.footer ?? `Powered by <strong style="color:#374151;">${brand.name}</strong>`}
              </p>
              <p style="margin:0 0 12px 0;font-size:11px;color:#9ca3af;font-family:Arial,Helvetica,sans-serif;">
                Secured with blockchain verification
              </p>
              <p style="margin:0;font-size:11px;font-family:Arial,Helvetica,sans-serif;">
                <a href="#" style="color:#9ca3af;text-decoration:underline;">Help</a>
                <span style="color:#d1d5db;padding:0 6px;">|</span>
                <a href="#" style="color:#9ca3af;text-decoration:underline;">Privacy</a>
                <span style="color:#d1d5db;padding:0 6px;">|</span>
                <a href="#" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>
              </p>
            </td></tr>
          </table>
        </td></tr>

      </table>
    </td></tr>

    <!-- Below-card spacer -->
    <tr><td style="height:32px;font-size:0;line-height:0;">&nbsp;</td></tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</body>
</html>`;
}

function chainBadge(chain: string | null): string {
  if (!chain) return "";
  const colors: Record<string, string> = { BTC: "#f7931a", ETH: "#627eea", SOL: "#9945ff" };
  const icons: Record<string, string> = { BTC: "\u20bf", ETH: "\u039e", SOL: "\u25ce" };
  const c = colors[chain] ?? BASE_BRAND.color;
  return `<span style="display:inline-block;background:${c}18;color:${c};font-size:11px;font-weight:600;padding:3px 10px;border-radius:6px;font-family:Arial,Helvetica,sans-serif;">${icons[chain] ?? ""} ${chain}</span>`;
}

function signerRow(s: {
  label: string;
  address: string | null;
  chain: string | null;
  status: string;
  signedAt?: Date | null;
  scheme?: string | null;
}): string {
  const isSigned = s.status === "SIGNED";
  const statusHtml = isSigned
    ? `<span style="color:#16a34a;font-size:12px;font-weight:600;font-family:Arial,Helvetica,sans-serif;">\u2713 Signed</span>`
    : `<span style="color:#d97706;font-size:12px;font-family:Arial,Helvetica,sans-serif;">\u23F3 Pending</span>`;

  const addr = s.address ?? "Email / OTP";
  const addrPreview = addr.length > 16 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr;

  return `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;">
        <div style="font-size:14px;font-weight:600;color:#111827;font-family:Arial,Helvetica,sans-serif;">${s.label}</div>
        <div style="font-size:11px;color:#6b7280;font-family:'Courier New',monospace;margin-top:3px;">
          ${s.chain ? `${chainBadge(s.chain)} ` : ""}${addrPreview}
        </div>
        ${isSigned && s.scheme ? `<div style="font-size:10px;color:#9ca3af;margin-top:3px;font-family:Arial,Helvetica,sans-serif;">Scheme: ${s.scheme}${s.signedAt ? ` &bull; ${new Date(s.signedAt).toLocaleString()}` : ""}</div>` : ""}
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #f3f4f6;text-align:right;vertical-align:middle;">
        ${statusHtml}
      </td>
    </tr>`;
}

/* ── CTA button helper ── */

function ctaButton(href: string, label: string, bgColor?: string): string {
  const bg = bgColor ?? BASE_BRAND.color;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
  <tr><td align="center" style="background-color:${bg};border-radius:8px;">
    <a href="${href}" target="_blank" style="display:inline-block;padding:16px 32px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;font-family:Arial,Helvetica,sans-serif;letter-spacing:0.2px;">
      ${label}
    </a>
  </td></tr>
</table>`;
}

/* ── Signing request email ── */

export async function sendSignatureRequest(params: {
  to: string;
  documentTitle: string;
  signerLabel: string;
  signUrl: string;
  branding?: BrandingSettings;
  replyTo?: string;
  isReminder?: boolean;
}) {
  if (!transporter) {
    logger.info("email", "SMTP not configured, skipping:", params.to);
    return;
  }

  const brand = getBrand(params.branding);
  const intro =
    params.branding?.emailIntro ||
    (params.isReminder
      ? "This is a friendly reminder that a document is still awaiting your signature."
      : "You've been invited to review and sign a document.");

  const heading = params.isReminder
    ? `Reminder: "${params.documentTitle}" awaits your signature`
    : `You've been invited to sign "${params.documentTitle}"`;

  const buttonLabel = params.isReminder ? "Sign Now" : "Sign Document";

  const html = layout(
    `
    <h1 style="margin:0 0 16px 0;font-size:22px;color:#111827;font-weight:700;font-family:Arial,Helvetica,sans-serif;">
      ${heading}
    </h1>
    <p style="margin:0 0 24px 0;font-size:15px;color:#4b5563;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
      Hi <strong style="color:#111827;">${params.signerLabel}</strong>, ${intro}
    </p>

    <!-- Document card -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;border:1px solid #e5e7eb;border-radius:8px;">
      <tr><td style="padding:16px 20px;background-color:#f9fafb;border-radius:8px;">
        <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-family:Arial,Helvetica,sans-serif;">Document</div>
        <div style="font-size:17px;font-weight:600;color:#111827;font-family:Arial,Helvetica,sans-serif;">${params.documentTitle}</div>
      </td></tr>
    </table>

    ${ctaButton(params.signUrl, buttonLabel)}

    <p style="margin:28px 0 0 0;font-size:12px;color:#9ca3af;line-height:1.6;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      You'll connect your wallet (BTC, ETH, or SOL) and sign a cryptographic message.<br>
      Your signature serves as verifiable proof of acknowledgment.
    </p>
  `,
    params.branding,
  );

  await transporter.sendMail({
    from: `"${brand.name}" <${env.SMTP_FROM}>`,
    to: params.to,
    replyTo: params.replyTo,
    subject: `${params.isReminder ? "Reminder: " : ""}Signature requested: ${params.documentTitle}`,
    html,
    text: `${heading}\n\nHi ${params.signerLabel}, ${intro}\n\nDocument: ${params.documentTitle}\n\nSign here: ${params.signUrl}\n\nPowered by ${brand.name} - Secured with blockchain verification`,
  });
}

/* ── Finalization email — sent to discloser when all other parties have signed ── */

export async function sendFinalizationEmail(params: {
  to: string;
  documentTitle: string;
  signerLabel: string;
  signUrl: string;
  branding?: BrandingSettings;
  replyTo?: string;
}) {
  if (!transporter) {
    logger.info("email", "SMTP not configured, skipping finalization:", params.to);
    return;
  }

  const brand = getBrand(params.branding);

  const html = layout(
    `
    <h1 style="margin:0 0 16px 0;font-size:22px;color:#111827;font-weight:700;font-family:Arial,Helvetica,sans-serif;">
      All parties have signed — finalize "${params.documentTitle}"
    </h1>
    <p style="margin:0 0 24px 0;font-size:15px;color:#4b5563;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
      Hi <strong style="color:#111827;">${params.signerLabel}</strong>, all other parties have completed signing. Your final wallet signature is needed to close the contract. This signature covers the complete document with all parties' information included.
    </p>

    <!-- Document card -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;border:1px solid #e5e7eb;border-radius:8px;">
      <tr><td style="padding:16px 20px;background-color:#f9fafb;border-radius:8px;">
        <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;font-family:Arial,Helvetica,sans-serif;">Document</div>
        <div style="font-size:17px;font-weight:600;color:#111827;font-family:Arial,Helvetica,sans-serif;">${params.documentTitle}</div>
      </td></tr>
    </table>

    ${ctaButton(params.signUrl, "Finalize Contract")}

    <p style="margin:28px 0 0 0;font-size:12px;color:#9ca3af;line-height:1.6;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Connect your wallet and sign once more to seal the contract.<br>
      Your finalization signature cryptographically covers the entire completed document.
    </p>
  `,
    params.branding,
  );

  await transporter.sendMail({
    from: `"${brand.name}" <${env.SMTP_FROM}>`,
    to: params.to,
    replyTo: params.replyTo,
    subject: `Action required: Finalize "${params.documentTitle}"`,
    html,
    text: `All parties have signed — finalize "${params.documentTitle}"\n\nHi ${params.signerLabel}, all other parties have completed signing. Your final wallet signature is needed to close the contract.\n\nFinalize here: ${params.signUrl}\n\nPowered by ${brand.name}`,
  });
}

/* ── Reminder email (convenience wrapper) ── */

export async function sendReminderEmail(params: {
  to: string;
  documentTitle: string;
  signerLabel: string;
  signUrl: string;
  branding?: BrandingSettings;
  replyTo?: string;
}) {
  return sendSignatureRequest({ ...params, isReminder: true });
}

/* ── Completion notification ── */

export async function sendCompletionEmail(params: {
  doc: Document;
  allSigners: Signer[];
  verifyUrl: string;
  branding?: BrandingSettings;
  replyTo?: string;
}) {
  if (!transporter) {
    logger.info("email", "SMTP not configured, skipping completion email");
    return;
  }

  const brand = getBrand(params.branding);

  // Generate PDF attachment
  let pdfBuffer: Buffer | null = null;
  try {
    const pdfBytes = await generateSignedPDF({
      doc: params.doc,
      signers: params.allSigners,
      verifyUrl: params.verifyUrl,
    });
    pdfBuffer = Buffer.from(pdfBytes);
  } catch (e) {
    console.error("[email] PDF generation failed:", e);
  }

  const signerRowsHtml = params.allSigners.map((s) => signerRow(s)).join("");

  const signedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const html = layout(
    `
    <!-- Success icon -->
    <div style="text-align:center;margin-bottom:20px;">
      <div style="display:inline-block;width:56px;height:56px;line-height:56px;border-radius:50%;background-color:#dcfce7;color:#16a34a;font-size:28px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">
        \u2713
      </div>
    </div>
    <h1 style="margin:0 0 4px 0;font-size:22px;color:#111827;font-weight:700;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      All Signatures Collected
    </h1>
    <p style="margin:0 0 28px 0;font-size:13px;color:#9ca3af;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      ${signedDate}
    </p>

    <!-- Document details -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:20px;">
      <tr><td style="padding:20px;background-color:#f9fafb;border-radius:8px;">
        <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-family:Arial,Helvetica,sans-serif;">Document</div>
        <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:14px;font-family:Arial,Helvetica,sans-serif;">${params.doc.title}</div>
        <div style="font-size:11px;color:#9ca3af;margin-bottom:4px;font-family:Arial,Helvetica,sans-serif;">SHA-256 Content Hash</div>
        <div style="font-size:11px;color:#374151;font-family:'Courier New',monospace;word-break:break-all;background-color:#ffffff;padding:8px 12px;border-radius:6px;border:1px solid #e5e7eb;">
          ${params.doc.contentHash}
        </div>
      </td></tr>
    </table>

    <!-- Signer table -->
    <div style="font-size:11px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;font-family:Arial,Helvetica,sans-serif;">
      Signatures (${params.allSigners.length})
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:28px;background-color:#ffffff;">
      ${signerRowsHtml}
    </table>

    ${ctaButton(params.verifyUrl, "View Document")}

    <p style="margin:28px 0 0 0;font-size:12px;color:#9ca3af;line-height:1.6;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      ${pdfBuffer ? "A signed PDF copy is attached to this email.<br>" : ""}
      Each signature is cryptographically bound to the document's SHA-256 hash.<br>
      Verification is independently reproducible by any party at any time.
    </p>
  `,
    params.branding,
  );

  const plainText = `All Signatures Collected - ${signedDate}\n\nDocument: ${params.doc.title}\nContent Hash: ${params.doc.contentHash}\n\nView: ${params.verifyUrl}\n\nPowered by ${brand.name} - Secured with blockchain verification`;

  // Collect all emails: signers + admin
  const recipients = new Set<string>();
  for (const s of params.allSigners) {
    if (s.email) recipients.add(s.email);
  }
  if (params.doc.createdByEmail) recipients.add(params.doc.createdByEmail);
  if (env.ADMIN_EMAIL) recipients.add(env.ADMIN_EMAIL);

  const pdfFilename = params.doc.title
    .replace(/[^a-zA-Z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase();

  for (const to of recipients) {
    await transporter.sendMail({
      from: `"${brand.name}" <${env.SMTP_FROM}>`,
      to,
      replyTo: params.replyTo,
      subject: `\u2713 Fully Signed: ${params.doc.title}`,
      html,
      text: plainText,
      attachments: pdfBuffer
        ? [
            {
              filename: `${pdfFilename}-signed.pdf`,
              content: pdfBuffer,
              contentType: "application/pdf",
            },
          ]
        : undefined,
    });
  }
}

/* ── Signer confirmation email ── */

export async function sendSignerConfirmation(params: {
  to: string;
  signerLabel: string;
  documentTitle: string;
  contentHash: string;
  chain: string;
  scheme: string;
  branding?: BrandingSettings;
  replyTo?: string;
}) {
  if (!transporter) return;

  const brand = getBrand(params.branding);

  const html = layout(
    `
    <!-- Success icon -->
    <div style="text-align:center;margin-bottom:20px;">
      <div style="display:inline-block;width:48px;height:48px;line-height:48px;border-radius:50%;background-color:#dcfce7;color:#16a34a;font-size:24px;font-weight:700;font-family:Arial,Helvetica,sans-serif;">
        \u2713
      </div>
    </div>
    <h1 style="margin:0 0 8px 0;font-size:22px;color:#111827;font-weight:700;text-align:center;font-family:Arial,Helvetica,sans-serif;">Signature Confirmed</h1>
    <p style="margin:0 0 24px 0;font-size:15px;color:#4b5563;line-height:1.6;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Hi <strong style="color:#111827;">${params.signerLabel}</strong>, your signature has been recorded.
    </p>

    <!-- Details card -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
      <tr><td style="padding:20px;background-color:#f9fafb;border-radius:8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="padding-bottom:14px;">
            <div style="font-size:11px;color:#9ca3af;margin-bottom:3px;font-family:Arial,Helvetica,sans-serif;">Document</div>
            <div style="font-size:15px;font-weight:600;color:#111827;font-family:Arial,Helvetica,sans-serif;">${params.documentTitle}</div>
          </td></tr>
          <tr><td style="padding-bottom:14px;">
            <div style="font-size:11px;color:#9ca3af;margin-bottom:3px;font-family:Arial,Helvetica,sans-serif;">Chain</div>
            <div>${chainBadge(params.chain)}</div>
          </td></tr>
          <tr><td>
            <div style="font-size:11px;color:#9ca3af;margin-bottom:3px;font-family:Arial,Helvetica,sans-serif;">Signature Scheme</div>
            <div style="font-size:13px;color:#374151;font-family:Arial,Helvetica,sans-serif;">${params.scheme}</div>
          </td></tr>
        </table>
      </td></tr>
    </table>

    <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      You'll receive another email when all parties have signed.
    </p>
  `,
    params.branding,
  );

  await transporter.sendMail({
    from: `"${brand.name}" <${env.SMTP_FROM}>`,
    to: params.to,
    replyTo: params.replyTo,
    subject: `Signature confirmed: ${params.documentTitle}`,
    html,
    text: `Signature Confirmed\n\nHi ${params.signerLabel}, your signature for "${params.documentTitle}" has been recorded.\n\nChain: ${params.chain}\nScheme: ${params.scheme}\n\nYou'll receive another email when all parties have signed.\n\nPowered by ${brand.name}`,
  });
}

/* ── Creator alert: automation review ── */

export async function sendAutomationAlertEmail(params: {
  to: string;
  documentTitle: string;
  signerLabel: string;
  verdict: string;
  confidence: number;
  action: "ALLOW" | "FLAG" | "DENY";
  reason: string;
  branding?: BrandingSettings;
  replyTo?: string;
}) {
  if (!transporter) {
    logger.info(
      "email",
      `Automation alert for ${params.to}: ${params.documentTitle} / ${params.signerLabel} / ${params.action}`,
    );
    return;
  }

  const brand = getBrand(params.branding);
  const confidencePct = Math.round(params.confidence * 100);
  const tone = params.action === "DENY" ? "#dc2626" : params.action === "FLAG" ? "#d97706" : "#2563eb";

  const html = layout(
    `
    <h1 style="margin:0 0 8px 0;font-size:22px;color:#111827;font-weight:700;font-family:Arial,Helvetica,sans-serif;">
      Signing Automation Alert
    </h1>
    <p style="margin:0 0 24px 0;font-size:15px;color:#4b5563;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
      Proofmark detected automation risk while <strong style="color:#111827;">${params.signerLabel}</strong> was signing <strong style="color:#111827;">${params.documentTitle}</strong>.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:24px;">
      <tr><td style="padding:20px;background-color:#f9fafb;border-radius:8px;">
        <div style="font-size:11px;color:#9ca3af;margin-bottom:3px;font-family:Arial,Helvetica,sans-serif;">Action</div>
        <div style="font-size:18px;font-weight:700;color:${tone};font-family:Arial,Helvetica,sans-serif;">${params.action}</div>
        <div style="height:14px;"></div>
        <div style="font-size:11px;color:#9ca3af;margin-bottom:3px;font-family:Arial,Helvetica,sans-serif;">Verdict</div>
        <div style="font-size:14px;color:#111827;font-family:Arial,Helvetica,sans-serif;">${params.verdict.toUpperCase()} at ${confidencePct}% confidence</div>
        <div style="height:14px;"></div>
        <div style="font-size:11px;color:#9ca3af;margin-bottom:3px;font-family:Arial,Helvetica,sans-serif;">Reason</div>
        <div style="font-size:14px;color:#374151;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">${params.reason}</div>
      </td></tr>
    </table>
  `,
    params.branding,
  );

  await transporter.sendMail({
    from: `"${brand.name}" <${env.SMTP_FROM}>`,
    to: params.to,
    replyTo: params.replyTo,
    subject: `Automation alert: ${params.documentTitle}`,
    html,
    text: `Signing Automation Alert\n\nDocument: ${params.documentTitle}\nSigner: ${params.signerLabel}\nAction: ${params.action}\nVerdict: ${params.verdict.toUpperCase()} (${confidencePct}%)\nReason: ${params.reason}\n\nPowered by ${brand.name}`,
  });
}

/* ── OTP email for Web2 email signing ── */

export async function sendOtpEmail(params: {
  to: string;
  otp: string;
  documentTitle: string;
  signerLabel: string;
  expiresInMinutes: number;
  branding?: BrandingSettings;
  replyTo?: string;
}) {
  if (!transporter) {
    logger.info("email", `OTP for ${params.to}: ${params.otp}`);
    return;
  }

  const brand = getBrand(params.branding);

  // Split OTP into individual characters for styled display
  const otpDigits = params.otp
    .split("")
    .map(
      (ch) =>
        `<td style="width:44px;height:52px;text-align:center;vertical-align:middle;font-size:28px;font-weight:700;color:#111827;font-family:'Courier New',monospace;background-color:#f9fafb;border:2px solid #e5e7eb;border-radius:8px;">${ch}</td>`,
    )
    .join('<td style="width:8px;"></td>');

  const html = layout(
    `
    <h1 style="margin:0 0 8px 0;font-size:22px;color:#111827;font-weight:700;font-family:Arial,Helvetica,sans-serif;">
      Your Verification Code
    </h1>
    <p style="margin:0 0 24px 0;font-size:15px;color:#4b5563;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
      Use this code to sign <strong style="color:#111827;">${params.documentTitle}</strong> as <strong style="color:#111827;">${params.signerLabel}</strong>.
    </p>

    <!-- OTP code display -->
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 28px auto;">
      <tr>
        ${otpDigits}
      </tr>
    </table>

    <p style="margin:0 0 4px 0;font-size:13px;color:#6b7280;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      This code expires in <strong style="color:#111827;">${params.expiresInMinutes} minutes</strong>.
    </p>
    <p style="margin:0 0 0 0;font-size:12px;color:#9ca3af;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      Do not share this code. If you did not request it, please ignore this email.
    </p>
  `,
    params.branding,
  );

  await transporter.sendMail({
    from: `"${brand.name}" <${env.SMTP_FROM}>`,
    to: params.to,
    replyTo: params.replyTo,
    subject: `Your signing code: ${params.otp}`,
    html,
    text: `Your Verification Code: ${params.otp}\n\nUse this code to sign "${params.documentTitle}" as ${params.signerLabel}.\n\nThis code expires in ${params.expiresInMinutes} minutes. Do not share it.\n\nPowered by ${brand.name}`,
  });
}

/* ── Magic link email for Better Auth ── */

export async function sendMagicLinkEmail(params: { to: string; magicLinkUrl: string }) {
  if (!transporter) {
    logger.info("email", `Magic link for ${params.to}: ${params.magicLinkUrl}`);
    return;
  }

  const brand = getBrand();
  const html = layout(`
    <h1 style="margin:0 0 8px 0;font-size:22px;color:#111827;font-weight:700;font-family:Arial,Helvetica,sans-serif;">
      Sign In to ${brand.name}
    </h1>
    <p style="margin:0 0 28px 0;font-size:15px;color:#4b5563;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
      Click the button below to sign in. This link expires in 10 minutes.
    </p>

    ${ctaButton(params.magicLinkUrl, "Sign In")}

    <p style="margin:28px 0 0 0;font-size:12px;color:#9ca3af;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      If you didn't request this, you can safely ignore this email.
    </p>
  `);

  await transporter.sendMail({
    from: `"${brand.name}" <${env.SMTP_FROM}>`,
    to: params.to,
    subject: `Sign in to ${brand.name}`,
    html,
    text: `Sign In to ${brand.name}\n\nClick the link below to sign in (expires in 10 minutes):\n${params.magicLinkUrl}\n\nIf you didn't request this, you can safely ignore this email.\n\nPowered by ${brand.name}`,
  });
}

/* ── Email verification for Better Auth ── */

export async function sendVerificationEmail(params: { to: string; verifyUrl: string }) {
  if (!transporter) {
    logger.info("email", `Verify email for ${params.to}: ${params.verifyUrl}`);
    return;
  }

  const brand = getBrand();
  const html = layout(`
    <h1 style="margin:0 0 8px 0;font-size:22px;color:#111827;font-weight:700;font-family:Arial,Helvetica,sans-serif;">
      Verify Your Email
    </h1>
    <p style="margin:0 0 28px 0;font-size:15px;color:#4b5563;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
      Click the button below to verify your email address for ${brand.name}.
    </p>

    ${ctaButton(params.verifyUrl, "Verify Email")}

    <p style="margin:28px 0 0 0;font-size:12px;color:#9ca3af;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      If you didn't create an account, you can safely ignore this email.
    </p>
  `);

  await transporter.sendMail({
    from: `"${brand.name}" <${env.SMTP_FROM}>`,
    to: params.to,
    subject: `Verify your email for ${brand.name}`,
    html,
    text: `Verify Your Email\n\nClick the link below to verify your email for ${brand.name}:\n${params.verifyUrl}\n\nIf you didn't create an account, you can safely ignore this email.\n\nPowered by ${brand.name}`,
  });
}
