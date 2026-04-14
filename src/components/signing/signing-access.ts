export type ClaimSigner = {
  status: string;
  canSign?: boolean;
  signMethod?: string | null;
};

export function resolveSigningAccess(params: {
  currentSigner: ClaimSigner | null;
  claimToken: string | null;
  isActionable: boolean;
  tokenGateEligible: boolean;
  walletReady: boolean;
}) {
  const canInteract =
    !!params.currentSigner &&
    params.currentSigner.status === "PENDING" &&
    params.currentSigner.canSign !== false &&
    params.isActionable &&
    !!params.claimToken &&
    params.tokenGateEligible;

  const isEmailOtpSigner = params.currentSigner?.signMethod === "EMAIL_OTP";
  const requiresWalletConnection = canInteract && !isEmailOtpSigner;
  const canSubmit = canInteract && (isEmailOtpSigner || params.walletReady);

  return {
    canInteract,
    canSubmit,
    isEmailOtpSigner,
    requiresWalletConnection,
  };
}
