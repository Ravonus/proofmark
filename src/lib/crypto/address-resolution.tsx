"use client";

/**
 * Address resolution — ENS names for EVM, formatted display for all chains.
 * Uses viem's getEnsName with in-memory cache.
 */

import { useEffect, useState } from "react";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import type { WalletChain } from "./chains";

// ── ENS client (singleton) ──

const ensClient = createPublicClient({
	chain: mainnet,
	transport: http("https://ethereum-rpc.publicnode.com"),
});

const ensCache = new Map<string, string | null>();

export async function resolveEnsName(address: string): Promise<string | null> {
	const key = address.toLowerCase();
	if (ensCache.has(key)) return ensCache.get(key)!;

	try {
		const name = await ensClient.getEnsName({
			address: address as `0x${string}`,
		});
		ensCache.set(key, name);
		return name;
	} catch {
		ensCache.set(key, null);
		return null;
	}
}

// ── Format address for display ──

export function formatAddress(
	address: string,
	_chain?: WalletChain | string | null,
): string {
	if (!address) return "unknown";
	if (address.length > 16) {
		return `${address.slice(0, 6)}...${address.slice(-4)}`;
	}
	return address;
}

// ── React hook ──

export function useResolvedName(
	address: string | null | undefined,
	chain?: WalletChain | string | null,
): { name: string; loading: boolean; isEns: boolean } {
	const [resolved, setResolved] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		if (!address) return;

		// Only ENS for EVM addresses
		if (
			(chain === "ETH" || chain === "BASE" || !chain) &&
			address.startsWith("0x") &&
			address.length === 42
		) {
			// Check cache first (sync)
			const cached = ensCache.get(address.toLowerCase());
			if (cached !== undefined) {
				setResolved(cached);
				return;
			}

			setLoading(true);
			resolveEnsName(address).then((name) => {
				setResolved(name);
				setLoading(false);
			});
		}
	}, [address, chain]);

	if (!address) return { name: "unknown", loading: false, isEns: false };
	if (resolved) return { name: resolved, loading: false, isEns: true };
	if (loading)
		return { name: formatAddress(address, chain), loading: true, isEns: false };
	return { name: formatAddress(address, chain), loading: false, isEns: false };
}

// ── React component ──

export function ResolvedAddress({
	address,
	chain,
	className,
}: {
	address: string;
	chain?: WalletChain | string | null;
	className?: string;
}) {
	const { name, loading, isEns } = useResolvedName(address, chain);

	return (
		<span className={className} title={address}>
			{loading ? (
				<span className="inline-block h-3 w-16 animate-pulse rounded bg-surface/40" />
			) : (
				<>
					{name}
					{isEns && <span className="ml-1 text-[9px] text-accent/50">ENS</span>}
				</>
			)}
		</span>
	);
}
