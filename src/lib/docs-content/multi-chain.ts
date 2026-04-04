import type { DocEntry } from "./types";

export const MULTI_CHAIN_DOCS: DocEntry[] = [
  {
    slug: "bitcoin-ordinals",
    category: "Multi-Chain",
    categorySlug: "multi-chain",
    title: "Bitcoin & Ordinals",
    description:
      "Non-custodial ordinal trading via PSBT shard distribution. 3-of-4 threshold Shamir secret sharing over GF(256). No private key storage anywhere.",
    icon: "bitcoin",
    sortOrder: 20,
    content: `## Bitcoin & Ordinals

The Bitcoin marketplace enables non-custodial trading of ordinal inscriptions using PSBTs (Partially Signed Bitcoin Transactions) with threshold secret sharing. Nobody ever holds a seller's private key. Not us, not the nodes, nobody.

### PSBT Signing: SIGHASH_SINGLE|ANYONECANPAY

The seller signs the PSBT with \`SIGHASH_SINGLE|ANYONECANPAY\` (flag byte \`0x83\`). This signature type commits to exactly one input and one output, allowing the buyer to attach additional inputs (their payment UTXOs) and outputs (change) without invalidating the seller's signature. The \`ANYONECANPAY\` flag (\`0x80\`) is critical: it means the seller only signs their own input, giving the buyer permission to fund the transaction however they want.

PSBT validation enforces three hard rules:

1. **Exactly one ordinal input.** The PSBT must contain a single input referencing the ordinal UTXO.
2. **ANYONECANPAY flag.** The sighash byte must have bit 7 set (\`0x80\`).
3. **SIGHASH_SINGLE.** The sighash type must be \`0x03\`, binding one input to one output.

Any PSBT that fails these checks gets rejected at submission time. No exceptions.

### Shamir Secret Sharing over GF(256)

The encryption key protecting the PSBT is split using Shamir's Secret Sharing over the Galois Field GF(256). This means each byte of the key is independently split into shares using polynomial interpolation over a finite field of 256 elements:

1. **Random AES-256-GCM key.** A 32-byte cryptographically random key is generated.
2. **Encrypt PSBT.** The seller-signed PSBT template gets encrypted with AES-256-GCM (authenticated encryption, prevents tampering).
3. **Split key 3-of-4.** The 32-byte AES key is split into 4 shares with a threshold of 3 using degree-2 polynomials over GF(256). Each share is a 32-byte blob (one field element per key byte).
4. **Distribute shares.** Each of the 4 shares goes to a different node in the assigned cohort.

Reconstruction requires any 3 of the 4 shares. Lagrange interpolation over GF(256) recovers each byte of the original AES key. With only 2 shares, an attacker has zero information about the key (information-theoretic security).

### Distribution to Node Cohort

Shard distribution targets a cohort of 4 nodes selected deterministically from the active node set. The distribution process has single-retry resilience built in:

- **Primary attempt.** All 4 shards are sent to their target nodes in parallel.
- **Retry on failure.** If any shard placement fails, the system retries up to 5 times with exponential backoff.
- **Fallback node.** If a target node is persistently unreachable, the shard routes to a backup node from the standby pool.
- **Minimum coverage.** Distribution is only considered successful when at least 3 of 4 shards are confirmed placed.

Nodes store shards in their local database, encrypted at rest. Each shard is tagged with the listing ID, cohort assignment epoch, and a monotonic sequence number for rebalancing.

### Reveal Challenge Protocol

When a buyer wants to reconstruct the PSBT, they must complete a reveal challenge with each shard-holding node:

- **Ed25519 signed.** Every challenge request is signed with the buyer's Ed25519 keypair. The node verifies the signature before responding.
- **Unique nonce.** Each challenge includes a cryptographically random nonce tied to the specific order. This prevents replay across orders.
- **TTL 30 seconds.** Challenge responses expire after 30 seconds. If the buyer doesn't collect enough shards within the window, they must restart.
- **ID deduplication.** Each order ID can only trigger one active reveal session per shard node. Duplicate requests within the TTL window return the same challenge (idempotent), preventing race conditions where multiple reveal attempts could leak information.

The reveal flow:

1. Buyer sends a signed reveal request with order ID and nonce to each shard node.
2. Node verifies signature, checks order validity, and returns the shard (encrypted with the challenge nonce as additional authenticated data).
3. Buyer collects 3+ shards within the 30-second window.
4. Buyer reconstructs the AES key via Lagrange interpolation.
5. Buyer decrypts the PSBT, adds their payment inputs, and broadcasts.

### Rebalancing on Node Set Changes

When the active node set changes (nodes join, leave, or get evicted), shard coverage must be maintained:

- **Coverage check.** After every membership change, the protocol evaluates shard coverage for all active listings.
- **Redistribution.** If a listing drops below 3-of-4 coverage, the remaining shard holders collaborate to generate a replacement shard for a new node. This uses the existing shares to evaluate the polynomial at a new x-coordinate without ever reconstructing the secret.
- **Epoch tagging.** Redistributed shards carry the new epoch number, so stale shards from departed nodes cannot be mixed with current shards.

### Coverage Tracking

The network maintains a coverage map tracking which nodes hold shards for which listings:

- Each node reports its shard inventory during heartbeat.
- The coverage map is gossip-replicated across all nodes.
- Listings with coverage below the threshold trigger automatic rebalancing.
- The explorer UI shows real-time coverage status for every active listing.

### Proof-of-Access for Bitcoin

Bitcoin nodes get **5 PoA challenges** (the most of any chain) because they need to prove access to two separate systems:

**bitcoind challenges (3):**
1. Block header at a random height (100-1000 blocks back)
2. Transaction details for a random txid from a recent block
3. UTXO set membership query for a known unspent output

**ord indexer challenges (2):**
4. Inscription content lookup by inscription ID
5. Ordinal transfer history for a specific sat range

Challenges query historical state (100 to 1000 blocks back) to verify real-time RPC access. Canned responses won't work because the challenge heights are unpredictable.

### Race Condition Protection

We had a critical race condition bug early on with shard distribution. It's now locked down with four interlocking safeguards:

- **Atomic distribution.** All 4 shards must be confirmed distributed before checkout is enabled for the listing. The listing transitions from \`SHARD_DISTRIBUTING\` to \`ACTIVE\` only after confirmation.
- **Retry logic.** 5 attempts with exponential backoff (100ms, 200ms, 400ms, 800ms, 1600ms) for each shard placement.
- **Coverage validation.** Minimum 3-of-4 shard coverage is verified before reconstruction is allowed. The reveal endpoint checks the coverage map before issuing any challenge.
- **Per-order reveal nonce.** Each order gets a unique nonce that is committed at order creation time. This prevents cross-order exploitation where a reveal session for order A could be hijacked to reconstruct shards for order B.

### Listing Policy

Each Bitcoin listing includes cryptographically bound policy fields:

\`\`\`typescript
interface BtcSale {
  assetOutpoint: string;    // The ordinal UTXO (txid:vout)
  priceSats: number;        // Price in satoshis
  sellerAddress: string;    // Seller's receiving address
  royaltyBps: number;       // Creator royalty (basis points)
  expiresAt: number;        // Listing expiration (unix ms)
  collectionId?: string;    // Optional collection binding
}
\`\`\`

### Security Summary

- **Non-custodial.** No entity holds the complete asset at any point.
- **Threshold security.** Compromising 1 or 2 nodes reveals zero information about the key (information-theoretic, not just computational).
- **Forward secrecy.** Each order uses a unique reveal nonce with a 30-second TTL.
- **Byzantine tolerance.** Works as long as 3 of 4 shard holders are honest.
- **Rebalancing.** Node departures trigger automatic shard redistribution without key reconstruction.
- **Authenticated encryption.** AES-256-GCM prevents tampering with encrypted PSBTs.`,
  },

  {
    slug: "ethereum-l2s",
    category: "Multi-Chain",
    categorySlug: "multi-chain",
    title: "Ethereum & L2s",
    description:
      "EVM marketplace with EIP-712 signed orders, smart contract settlement, constant-product AMM, and Layer 2 support across Base, Arbitrum, and Optimism.",
    icon: "ethereum",
    sortOrder: 21,
    content: `## Ethereum & Layer 2s

The EVM marketplace supports Ethereum L1 and all major Layer 2 networks through a suite of smart contracts with EIP-712 typed signature verification, a constant-product AMM, and external DEX integration.

### Smart Contract: DecenterlizeMarketV1.sol

The core marketplace contract handles order settlement with multiple layers of protection:

\`\`\`solidity
contract DecenterlizeMarketV1 {
    // EIP-712 domain separator for typed signature verification
    bytes32 public DOMAIN_SEPARATOR;

    // Fee configuration (200 bps = 2%)
    uint256 public constant MARKETPLACE_FEE_BPS = 200;

    // Execute a signed order
    function executeOrder(
        Order calldata order,
        bytes calldata sellerSignature,
        address feeRecipient
    ) external payable nonReentrant {
        // 1. Verify EIP-712 typed signature
        // 2. Check order hasn't expired or been cancelled
        // 3. Transfer NFT (ERC-721 or ERC-1155)
        // 4. Split fees (50% foundation, 50% PoW winner)
        // 5. Pay seller
    }

    function cancelOrder(Order calldata order) external;
    function cancelAllOrders() external;
}
\`\`\`

Key features:

- **EIP-712 typed signatures.** Wallets display human-readable order details before signing. No blind hex signing.
- **ERC-721 and ERC-1155.** Both single NFTs and semi-fungible tokens in one contract.
- **Non-reentrant.** Reentrancy guard on all state-changing functions via a lock variable.
- **Immutable.** No proxy pattern, no upgrade path. The deployed bytecode is final.
- **Deterministic fees.** 200 bps hardcoded, split 50/50 between foundation and PoW winner. No governance override.

### EIP-712 Order Structure

\`\`\`typescript
interface EvmSale {
  seller: string;           // Seller address
  contractAddress: string;  // NFT contract
  tokenId: string;          // Token ID
  tokenStandard: "ERC721" | "ERC1155";
  amount: number;           // 1 for ERC-721, N for ERC-1155
  priceWei: string;         // Price in wei
  salt: string;             // Unique salt for replay protection
  expiry: number;           // Expiration timestamp
}
\`\`\`

### LocalTokenSwapRouter.sol

Constant-product AMM for marketplace token markets:

\`\`\`solidity
function swap(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 minAmountOut
) external returns (uint256 amountOut);

function addLiquidity(
    address tokenA,
    address tokenB,
    uint256 amountA,
    uint256 amountB
) external;

function removeLiquidity(
    address tokenA,
    address tokenB,
    uint256 lpTokens
) external;
\`\`\`

- **Constant-product pricing.** x * y = k invariant.
- **0.3% swap fee.** Accrues to liquidity providers.
- **200 bps marketplace fee.** Split 50/50 between foundation and PoW winner.
- **Governance-configurable parameters.** Fee rates and pool creation permissions adjustable through protocol governance.

### AppOwnedUniswapV3SwapAdapter.sol

External DEX integration for real token swaps against deep liquidity:

- Wraps the Uniswap V3 SwapRouter.
- Applies the marketplace fee layer on top of the external swap.
- Supports multi-hop routes (e.g., TOKEN_A -> WETH -> USDC).
- Slippage protection via \`minAmountOut\` parameter.

### L2 Support

The same contract deploys identically across all EVM-compatible chains:

| Network | Status | Notes |
|---------|--------|-------|
| Ethereum L1 | Supported | Full settlement |
| Base | Supported | Primary L2, lowest fees |
| Arbitrum | Supported | Nitro stack |
| Optimism | Supported | OP Stack |

Each L2 deployment uses the same bytecode and the same EIP-712 domain structure (chain ID varies). Cross-L2 listings are possible: a seller on Base can have their order filled by a buyer on Arbitrum through the protocol's cross-chain attestation flow.

### TX-Plan Quorum Verification

Before any EVM purchase executes, the transaction plan goes through quorum verification:

1. **Purchase plan submission.** The buyer's intended transaction (target contract, calldata, value) is submitted as a protocol event.
2. **Node verification.** Each witness node independently simulates the transaction against their local chain state.
3. **2/3 agreement required.** At least 2/3 of selected witnesses must agree the transaction is valid (correct contract, correct parameters, sufficient funds).
4. **Execution.** Only after quorum agreement does the buyer's transaction get broadcast.

This prevents scenarios where a compromised buyer client submits a malicious transaction that looks valid but interacts with a different contract.

### Rogue Node Detection

The protocol actively detects nodes that propose or attest to malicious contracts:

- **Contract allowlist.** Only verified marketplace contract addresses are valid settlement targets.
- **Bytecode verification.** Nodes can verify that the deployed bytecode at a contract address matches the expected hash.
- **Strike system.** Nodes that propose transactions targeting non-allowlisted contracts receive governance strikes.
- **Automatic eviction.** Accumulated strikes lead to bond slashing and network eviction.

### Fee Distribution

\`\`\`
Sale Price: 1 ETH
\u251c\u2500\u2500 Marketplace Fee (2%): 0.02 ETH
\u2502   \u251c\u2500\u2500 Foundation (50%): 0.01 ETH
\u2502   \u2514\u2500\u2500 PoW Winner (50%): 0.01 ETH
\u2514\u2500\u2500 Seller Receives: 0.98 ETH
\`\`\`

Royalties (if configured by the collection creator) are deducted before the marketplace fee calculation.

### Verification Flow

1. Seller signs EIP-712 order off-chain.
2. Order broadcasts as a signed protocol event to all nodes.
3. Buyer submits purchase intent, triggering TX-plan quorum verification.
4. After 2/3 quorum agreement, buyer submits the transaction to the smart contract.
5. Contract verifies the EIP-712 signature on-chain and executes the transfer.
6. Witness nodes observe the on-chain transaction (\`TX_OBSERVED\`).
7. Each witness submits a \`TX_ATTESTATION\` event.
8. At 2/3 supermajority attestation, the protocol emits \`TX_FINALIZED\`.

### Security

- **Reentrancy protection** via lock variable on all state-changing functions.
- **Signature replay protection** through nonce + salt uniqueness and per-chain domain separators.
- **No upgradability.** Contract is immutable once deployed. No proxy, no admin key.
- **Fee enforcement.** Fees are hardcoded and verified on-chain. No governance override.
- **TX-plan quorum.** Prevents malicious transaction submission.
- **Rogue node detection.** Automatic strike and eviction for misbehavior.`,
  },

  {
    slug: "solana",
    category: "Multi-Chain",
    categorySlug: "multi-chain",
    title: "Solana",
    description:
      "SPL marketplace via Anchor programs. Token transfers, staking contracts, and Solana ecosystem integration. Settlement program not yet fully wired.",
    icon: "solana",
    sortOrder: 22,
    content: `## Solana

The Solana marketplace handles SPL token and NFT trading through Anchor programs, with a separate staking program for node operator collateral.

### Current Status

Honest assessment: the Solana settlement program is not yet fully wired into the live protocol. The marketplace program exists, the staking program works, and PoA challenges run, but end-to-end purchase settlement through the on-chain program still has gaps. SPL token transfers and listing creation work. The final mile (atomic on-chain settlement with fee splitting and witness attestation) is in progress.

What works today:
- SPL token and NFT listing creation
- PoA challenges against Solana RPC
- Staking program for node operator bonds
- Transaction simulation and validation
- Witness attestation for manually settled trades

What's in progress:
- Fully automated on-chain settlement via the marketplace program
- Cross-program invocation for atomic fee splitting
- Integration with the TX-plan quorum flow

### Marketplace Program

The \`agorix_marketplace\` Anchor program records token sales:

\`\`\`rust
#[program]
mod agorix_marketplace {
    pub fn record_sale(
        ctx: Context<RecordSale>,
        sale_id: [u8; 32],
        price_lamports: u64,
        seller: Pubkey,
        buyer: Pubkey,
    ) -> Result<()> {
        // Record the sale event on-chain
        // Transfer SPL token from seller to buyer
        // Distribute fees to foundation + PoW winner
    }

    pub fn cancel_listing(
        ctx: Context<CancelListing>,
        sale_id: [u8; 32],
    ) -> Result<()> {
        // Verify seller authority
        // Mark listing as cancelled
    }
}
\`\`\`

### Staking Program

The \`agorix_staking\` Anchor program manages node operator bonds:

- **Collateral vault management** for USDC/USDT deposits.
- **Cooldown period enforcement** that's governance-configurable (currently 7 days for standard unstake, escalating for delegates).
- **Status tracking** through the Active \u2192 Exiting \u2192 Exited lifecycle.
- **Slashing support** for provable misbehavior (double-signing, false attestation).
- **Delegation tracking** for governance vote delegation.

### SPL Token Support

The marketplace supports all SPL token standards:

- **Metaplex standard NFTs.** Traditional Solana NFTs with metadata accounts.
- **Merkle tree compressed NFTs (cNFTs).** State-compressed NFTs for large collections.
- **Token-2022 fungibles.** New token standard with transfer hooks and confidential transfers.
- **Legacy SPL fungibles.** Original SPL token program.

### Proof-of-Access for Solana

Solana nodes get **3 PoA challenges** verifying RPC access:

1. **Recent block hash.** Query the blockhash at a random recent slot (within the last 150 slots). Verifies the node has a synced Solana RPC.
2. **Account balance lookup.** Check the SOL balance and token accounts for a known address. Verifies account state access.
3. **Transaction history.** Fetch transaction signatures for a specific account within a slot range. Verifies historical data access.

Challenges use slot numbers rather than block heights (Solana's slot-based consensus), and the queried slots are randomized to prevent caching.

### Transaction Flow

1. Seller creates an SPL transfer authorization and signs the listing.
2. Listing broadcasts as a signed protocol event to all nodes.
3. Buyer submits purchase intent.
4. Transaction is simulated against the current Solana state.
5. Marketplace program executes the transfer (when fully wired).
6. Witness nodes verify the on-chain transaction via their own RPC connections.
7. Attestation quorum finalizes the sale.

### Integration

The Solana runtime plugs into the broader protocol identically to other chains:

- Same validation engine (\`validateSaleTx()\`).
- Same witness selection algorithm (HMAC-SHA256 deterministic seeding).
- Same fee structure (2%, 50/50 split between foundation and PoW winner).
- Same event system (\`SOL_PURCHASE_SUBMITTED\` \u2192 \`TX_OBSERVED\` \u2192 \`TX_ATTESTATION\` \u2192 \`TX_FINALIZED\`).
- Same rate limiting and node authentication.`,
  },

  {
    slug: "settlement-flows",
    category: "Multi-Chain",
    categorySlug: "multi-chain",
    title: "Settlement Flows",
    description:
      "Cross-chain settlement comparison. How purchases finalize on BTC, EVM, and SOL, and the common attestation pipeline that unifies them.",
    icon: "git-merge",
    sortOrder: 23,
    content: `## Settlement Flows

Every chain settles differently, but all chains converge on the same attestation pipeline. This page compares the settlement mechanics across BTC, EVM, and SOL, and documents the common finalization flow.

### Bitcoin Settlement

BTC settlement is the most complex because it uses off-chain PSBT shard reconstruction instead of a smart contract:

\`\`\`
Buyer submits order intent
    \u2502
    \u25bc
Buyer sends signed reveal challenges to 3+ shard nodes
    \u2502
    \u25bc
Each node verifies Ed25519 signature + order validity
    \u2502
    \u25bc
Buyer collects 3 of 4 shards (within 30s TTL)
    \u2502
    \u25bc
Lagrange interpolation over GF(256) reconstructs AES key
    \u2502
    \u25bc
AES-256-GCM decrypts the seller-signed PSBT
    \u2502
    \u25bc
Buyer adds payment inputs + change output to PSBT
    \u2502
    \u25bc
Buyer finalizes and broadcasts transaction to Bitcoin network
    \u2502
    \u25bc
Witness nodes observe the transaction in mempool/block
    \u2502
    \u25bc
Attestation pipeline (TX_OBSERVED \u2192 TX_ATTESTATION \u2192 TX_FINALIZED)
\`\`\`

Key characteristic: the seller's private key never leaves their device. The PSBT template contains only the seller's signature over their input. The buyer completes the transaction independently.

### EVM Settlement

EVM settlement uses smart contract execution with quorum-verified transaction plans:

\`\`\`
Buyer submits purchase intent
    \u2502
    \u25bc
TX-plan quorum verification (2/3 nodes simulate + agree)
    \u2502
    \u25bc
Buyer submits transaction to DecenterlizeMarketV1 contract
    \u2502
    \u25bc
Contract verifies EIP-712 seller signature on-chain
    \u2502
    \u25bc
Contract transfers NFT (ERC-721/1155) from seller to buyer
    \u2502
    \u25bc
Contract splits fees (foundation + PoW winner) and pays seller
    \u2502
    \u25bc
Witness nodes observe the on-chain event logs
    \u2502
    \u25bc
Attestation pipeline (TX_OBSERVED \u2192 TX_ATTESTATION \u2192 TX_FINALIZED)
\`\`\`

Key characteristic: the smart contract enforces settlement atomically. Either the entire trade executes (NFT transfer + fee split + seller payment) or nothing happens. TX-plan quorum prevents submission of malicious transactions before they hit the chain.

### Solana Settlement

SOL settlement uses transaction simulation followed by on-chain execution:

\`\`\`
Buyer submits purchase intent
    \u2502
    \u25bc
Transaction is built and simulated against current Solana state
    \u2502
    \u25bc
Simulation verifies: correct accounts, sufficient balance, valid program
    \u2502
    \u25bc
Transaction broadcasts to Solana network
    \u2502
    \u25bc
Marketplace program executes SPL transfer + fee distribution
    \u2502
    \u25bc
Witness nodes verify the transaction via their own RPC
    \u2502
    \u25bc
Attestation pipeline (TX_OBSERVED \u2192 TX_ATTESTATION \u2192 TX_FINALIZED)
\`\`\`

Key characteristic: Solana's transaction simulation provides a dry-run before broadcast. The entire transaction is validated against the current cluster state before spending any SOL on fees.

### Common Attestation Pipeline

Regardless of chain, every settlement converges on the same three-phase attestation:

**Phase 1: TX_OBSERVED**

A witness node detects the settlement transaction on-chain (Bitcoin mempool/block, EVM event log, Solana transaction confirmation). The node emits a \`TX_OBSERVED\` protocol event signed with its Ed25519 key.

**Phase 2: TX_ATTESTATION**

Each selected witness independently verifies the on-chain transaction and emits a \`TX_ATTESTATION\` event. The attestation includes:

- Transaction hash
- Chain-specific confirmation data (block height, slot number, etc.)
- Whether the transaction matches the expected settlement parameters
- The witness node's Ed25519 signature

**2/3 supermajority required.** The protocol waits for at least 2/3 of the selected witness set to submit matching attestations. Minority disagreement (up to 1/3) is tolerated without affecting finalization.

**Phase 3: TX_FINALIZED**

Once the 2/3 attestation threshold is met, the protocol emits \`TX_FINALIZED\`. This is the point of no return:

- The listing is marked as sold.
- The seller's ask is closed.
- Fee distribution records are created.
- The PoW winner's fee share is allocated.
- The event is written to the immutable protocol log.

### Fee Distribution by Chain

| Chain | Marketplace Fee | Foundation | PoW Winner | Royalties |
|-------|----------------|------------|------------|-----------|
| BTC | 2% (200 bps) | 50% of fee | 50% of fee | Deducted pre-fee |
| EVM | 2% (200 bps) | 50% of fee | 50% of fee | Deducted pre-fee |
| SOL | 2% (200 bps) | 50% of fee | 50% of fee | Deducted pre-fee |

Fee structure is identical across all chains. Royalties (set by the collection creator) are deducted from the sale price before the marketplace fee calculation.

### Settlement Timing

| Chain | Typical Finalization | Confirmations |
|-------|---------------------|---------------|
| BTC | 10-60 minutes | 1 block (protocol observes mempool, finalizes after confirmation) |
| EVM L1 | 2-5 minutes | 12 blocks (Ethereum finality) |
| EVM L2 | 10-30 seconds | 1 block (L2 fast confirmations) |
| SOL | 5-15 seconds | 1 confirmation (Solana fast finality) |

The attestation pipeline runs in parallel with chain confirmations. Witnesses begin observing as soon as the transaction appears, and attestations accumulate as the transaction confirms.

### Cross-Chain Invariants

These properties hold regardless of which chain a trade settles on:

1. **No single point of failure.** Settlement requires both on-chain execution AND protocol attestation.
2. **Deterministic witness selection.** The same witness set is computed by every node for the same transaction.
3. **Atomic fee accounting.** Fee records are created at finalization, not before. No partial fee states.
4. **Immutable audit trail.** Every step (observation, attestation, finalization) is a signed protocol event in the log.`,
  },
];
