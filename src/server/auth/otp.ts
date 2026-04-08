/**
 * OTP-based email signing for Web2 mode.
 *
 * Generates a 6-digit OTP, sends it via email, and verifies it.
 * OTPs expire after 10 minutes. Used for PRIVATE and HYBRID proof
 * modes where signers don't have crypto wallets.
 */

import { randomInt } from "crypto";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { type BrandingSettings, signers } from "~/server/db/schema";

const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a cryptographically random OTP.
 */
function generateOtp(): string {
  const min = Math.pow(10, OTP_LENGTH - 1);
  const max = Math.pow(10, OTP_LENGTH) - 1;
  return randomInt(min, max + 1).toString();
}

/**
 * Create and send an OTP for a signer to verify their email.
 */
export async function sendSigningOtp(params: {
  signerId: string;
  email: string;
  documentTitle: string;
  signerLabel: string;
  branding?: BrandingSettings;
  replyTo?: string;
}): Promise<{ sent: boolean }> {
  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

  await db
    .update(signers)
    .set({
      otpCode: otp,
      otpExpiresAt: expiresAt,
      email: params.email,
    })
    .where(eq(signers.id, params.signerId));

  try {
    const { sendOtpEmail } = await import("~/server/messaging/email");
    await sendOtpEmail({
      to: params.email,
      otp,
      documentTitle: params.documentTitle,
      signerLabel: params.signerLabel,
      expiresInMinutes: 10,
      branding: params.branding,
      replyTo: params.replyTo,
    });
    return { sent: true };
  } catch (err) {
    console.error("[otp] Failed to send:", err);
    return { sent: false };
  }
}

/**
 * Verify an OTP code for a signer.
 */
export async function verifySigningOtp(params: {
  signerId: string;
  code: string;
}): Promise<{ valid: boolean; reason?: string }> {
  const [signer] = await db
    .select({
      otpCode: signers.otpCode,
      otpExpiresAt: signers.otpExpiresAt,
    })
    .from(signers)
    .where(eq(signers.id, params.signerId))
    .limit(1);

  if (!signer) return { valid: false, reason: "Signer not found" };
  if (!signer.otpCode) return { valid: false, reason: "No OTP pending" };
  if (!signer.otpExpiresAt || signer.otpExpiresAt < new Date()) {
    return { valid: false, reason: "OTP expired" };
  }

  // Constant-time comparison to prevent timing attacks
  const expected = signer.otpCode;
  const actual = params.code;
  if (expected.length !== actual.length) {
    return { valid: false, reason: "Invalid code" };
  }

  let match = true;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== actual[i]) match = false;
  }
  if (!match) return { valid: false, reason: "Invalid code" };

  // Mark OTP as verified
  await db
    .update(signers)
    .set({
      otpVerifiedAt: new Date(),
      otpCode: null,
      otpExpiresAt: null,
    })
    .where(eq(signers.id, params.signerId));

  return { valid: true };
}
