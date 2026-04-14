import { describe, expect, it } from "vitest";
import { resolveSigningAccess } from "../signing-access";

describe("resolveSigningAccess", () => {
  it("lets email claim signers work without a connected wallet", () => {
    const access = resolveSigningAccess({
      currentSigner: {
        status: "PENDING",
        signMethod: "EMAIL_OTP",
      },
      claimToken: "claim-123",
      isActionable: true,
      tokenGateEligible: true,
      walletReady: false,
    });

    expect(access.canInteract).toBe(true);
    expect(access.canSubmit).toBe(true);
    expect(access.isEmailOtpSigner).toBe(true);
    expect(access.requiresWalletConnection).toBe(false);
  });

  it("lets wallet claim signers fill fields before they connect, but not submit", () => {
    const access = resolveSigningAccess({
      currentSigner: {
        status: "PENDING",
        signMethod: "WALLET",
      },
      claimToken: "claim-123",
      isActionable: true,
      tokenGateEligible: true,
      walletReady: false,
    });

    expect(access.canInteract).toBe(true);
    expect(access.canSubmit).toBe(false);
    expect(access.isEmailOtpSigner).toBe(false);
    expect(access.requiresWalletConnection).toBe(true);
  });
});
