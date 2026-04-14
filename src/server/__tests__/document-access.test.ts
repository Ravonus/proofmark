import { describe, expect, it } from "vitest";
import type { UnifiedRequestIdentity } from "~/server/auth/auth-identity";
import { resolveDocumentViewerAccess, viewerMatchesSigner } from "~/server/documents/document-access";

function createIdentity(overrides: Partial<UnifiedRequestIdentity> = {}): UnifiedRequestIdentity {
  const wallets = overrides.wallets ?? [];

  return {
    authSession: null,
    walletSession: null,
    userId: null,
    email: null,
    wallets,
    walletAddressSet: new Set(wallets.map((wallet) => wallet.address.toLowerCase())),
    currentUser: null,
    ...overrides,
  };
}

describe("document access", () => {
  it("treats linked wallets as creator access", () => {
    const identity = createIdentity({
      wallets: [{ address: "0xabc123", chain: "ETH", isPrimary: true }],
      walletAddressSet: new Set(["0xabc123"]),
    });

    const access = resolveDocumentViewerAccess({
      document: { createdBy: "0xAbC123" },
      signers: [],
      identity,
    });

    expect(access.isCreator).toBe(true);
    expect(access.canAccessDocument).toBe(true);
  });

  it("matches an email-only signer without a wallet session", () => {
    const identity = createIdentity({
      email: "signer@example.com",
      currentUser: {
        id: "user_1",
        email: "signer@example.com",
        name: "Signer",
        emailVerified: true,
        image: null,
        walletCount: 0,
      },
    });

    const access = resolveDocumentViewerAccess({
      document: { createdBy: "0xcreator" },
      signers: [
        {
          email: "signer@example.com",
          address: null,
          chain: null,
          userId: null,
        },
      ],
      identity,
    });

    expect(access.isCreator).toBe(false);
    expect(access.hasSignedAccess).toBe(true);
    expect(access.canAccessDocument).toBe(true);
  });

  it("matches signers by linked user id before falling back to wallet comparison", () => {
    const identity = createIdentity({
      userId: "user_42",
      wallets: [{ address: "0xsecondary", chain: "ETH", isPrimary: false }],
      walletAddressSet: new Set(["0xsecondary"]),
    });

    expect(
      viewerMatchesSigner(
        {
          email: null,
          address: "0xnot-the-wallet",
          chain: "ETH",
          userId: "user_42",
        },
        identity,
      ),
    ).toBe(true);
  });

  it("does not match unrelated viewers", () => {
    const identity = createIdentity({
      email: "viewer@example.com",
      wallets: [{ address: "0xviewer", chain: "ETH", isPrimary: true }],
      walletAddressSet: new Set(["0xviewer"]),
    });

    expect(
      viewerMatchesSigner(
        {
          email: "someone-else@example.com",
          address: "0xother",
          chain: "ETH",
          userId: null,
        },
        identity,
      ),
    ).toBe(false);
  });

  it("treats a creator as the discloser when there is exactly one unclaimed discloser slot", () => {
    const identity = createIdentity({
      wallets: [{ address: "0xcreator", chain: "ETH", isPrimary: true }],
      walletAddressSet: new Set(["0xcreator"]),
    });

    const access = resolveDocumentViewerAccess({
      document: { createdBy: "0xcreator" },
      signers: [
        {
          email: "recipient@example.com",
          address: null,
          chain: null,
          userId: null,
          groupRole: "recipient",
          status: "PENDING",
        },
        {
          email: null,
          address: null,
          chain: null,
          userId: null,
          groupRole: "discloser",
          status: "PENDING",
        },
      ],
      identity,
    });

    expect(access.isCreator).toBe(true);
    expect(access.matchingSigner?.groupRole).toBe("discloser");
    expect(access.canAccessDocument).toBe(true);
  });

  it("does not infer a discloser slot when it is already claimed by another wallet", () => {
    const identity = createIdentity({
      wallets: [{ address: "0xcreator", chain: "ETH", isPrimary: true }],
      walletAddressSet: new Set(["0xcreator"]),
    });

    const access = resolveDocumentViewerAccess({
      document: { createdBy: "0xcreator" },
      signers: [
        {
          email: null,
          address: "0xsomeone-else",
          chain: "ETH",
          userId: null,
          groupRole: "discloser",
          status: "PENDING",
        },
      ],
      identity,
    });

    expect(access.matchingSigner).toBeNull();
    expect(access.canAccessDocument).toBe(true);
  });
});
