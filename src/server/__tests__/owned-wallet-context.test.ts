import { describe, expect, it, vi } from "vitest";
import type { UnifiedRequestIdentity } from "~/server/auth-identity";
import { buildOwnedWalletContext, requireOwnedWalletActor } from "~/server/owned-wallet-context";

vi.mock("~/server/auth-identity", () => ({
  resolveUnifiedRequestIdentity: vi.fn(),
}));

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

describe("owned wallet context", () => {
  it("prefers the active wallet session and dedupes linked wallets", () => {
    const identity = createIdentity({
      walletSession: {
        id: "session_1",
        address: "0x1111111111111111111111111111111111111111",
        chain: "ETH",
        token: "token_1",
        expiresAt: new Date(),
        userId: "user_1",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as NonNullable<UnifiedRequestIdentity["walletSession"]>,
      wallets: [
        { address: "0x1111111111111111111111111111111111111111", chain: "ETH", isPrimary: true },
        { address: "0x2222222222222222222222222222222222222222", chain: "ETH", isPrimary: false },
      ],
    });

    const context = buildOwnedWalletContext(identity);

    expect(context.activeWallet).toEqual({
      address: "0x1111111111111111111111111111111111111111",
      chain: "ETH",
    });
    expect(context.wallets).toEqual([
      { address: "0x1111111111111111111111111111111111111111", chain: "ETH" },
      { address: "0x2222222222222222222222222222222222222222", chain: "ETH" },
    ]);
    expect(context.ownedAddresses).toEqual([
      "0x1111111111111111111111111111111111111111",
      "0x2222222222222222222222222222222222222222",
    ]);
  });

  it("throws when no linked or active wallet is available", () => {
    const context = buildOwnedWalletContext(createIdentity());

    expect(() => requireOwnedWalletActor(context)).toThrow(/link a wallet/i);
  });
});
