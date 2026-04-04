import type { DocEntry } from "./types";

export const DEVELOPER_API_DOCS: DocEntry[] = [
  {
    slug: "public-api",
    category: "Developer",
    categorySlug: "developer",
    title: "Public API",
    description:
      "REST API reference. Public marketplace endpoints, internal agent routes, gossip protocol, and node discovery via .well-known/agent.",
    icon: "code",
    sortOrder: 60,
    content: `## Public API

Every node serves a full REST API independently. The API is split into two tiers: the public marketplace API (read-only, open access) and the internal agent API (node-authenticated, protocol operations).

### Public Marketplace API

Base URL: \`/api/market/v1/{chain}\` where \`{chain}\` is \`BTC\`, \`ETH\`, or \`SOL\`.

#### Collections

\`\`\`
GET /api/market/v1/{chain}/collections
GET /api/market/v1/{chain}/collections/{id}
GET /api/market/v1/{chain}/collections/{id}/stats
\`\`\`

Browse collections with metadata, floor prices, and volume stats. Stats include 24h/7d/30d volume, floor price history, and unique holder count.

#### Listings (Asks)

\`\`\`
GET /api/market/v1/{chain}/asks
GET /api/market/v1/{chain}/asks?status=OPEN
GET /api/market/v1/{chain}/asks?collection={id}
GET /api/market/v1/{chain}/asks?seller={address}
GET /api/market/v1/{chain}/asks?minPrice={sats|wei|lamports}
GET /api/market/v1/{chain}/asks?maxPrice={sats|wei|lamports}
\`\`\`

Status-filtered listing queries with collection, seller, and price range filtering.

#### Offers (Bids)

\`\`\`
GET /api/market/v1/{chain}/bids
GET /api/market/v1/{chain}/bids?buyer={address}
GET /api/market/v1/{chain}/bids?listing={outpoint}
\`\`\`

Buyer and listing-scoped offer queries.

#### Activity

\`\`\`
GET /api/market/v1/{chain}/activity
GET /api/market/v1/{chain}/activity?kind=SALE
GET /api/market/v1/{chain}/activity?collection={id}
GET /api/market/v1/{chain}/activity?address={address}
\`\`\`

Transaction history filtered by event kind (SALE, LIST, DELIST, TRANSFER).

#### Token Markets

\`\`\`
GET /api/market/v1/{chain}/tokens
GET /api/market/v1/{chain}/tokens/{id}
GET /api/market/v1/{chain}/tokens/{id}/history
GET /api/market/v1/{chain}/tokens/{id}/holders
\`\`\`

Fungible token boards, price history, and holder distribution.

#### Wallets

\`\`\`
GET /api/market/v1/{chain}/wallets/{address}/listings
GET /api/market/v1/{chain}/wallets/{address}/activity
GET /api/market/v1/{chain}/wallets/{address}/balances
\`\`\`

Per-wallet marketplace data: active listings, trade history, token balances.

### Internal Agent API

These routes handle node-to-node protocol operations. All require node authentication (Ed25519 signed request headers).

#### Bitcoin Agent Routes

\`\`\`
POST /api/agent/btc/list          # Submit BTC listing
POST /api/agent/btc/delist        # Cancel BTC listing
POST /api/agent/btc/purchase      # Submit BTC purchase intent
POST /api/agent/btc/validate      # Validate BTC transaction
\`\`\`

#### EVM Agent Routes

\`\`\`
POST /api/agent/evm/list          # Submit EVM listing
POST /api/agent/evm/delist        # Cancel EVM listing
POST /api/agent/evm/purchase      # Submit EVM purchase intent
POST /api/agent/evm/validate      # Validate EVM transaction
\`\`\`

#### Solana Agent Routes

\`\`\`
POST /api/agent/sol/list          # Submit SOL listing
POST /api/agent/sol/delist        # Cancel SOL listing
POST /api/agent/sol/purchase      # Submit SOL purchase intent
POST /api/agent/sol/validate      # Validate SOL transaction
\`\`\`

#### PSBT Share Routes

\`\`\`
POST /api/agent/psbt-share/distribute    # Distribute PSBT shards to cohort
POST /api/agent/psbt-share/store         # Store a shard on this node
POST /api/agent/psbt-share/challenge     # Request reveal challenge
POST /api/agent/psbt-share/reveal        # Retrieve shard with valid challenge
POST /api/agent/psbt-share/coverage      # Query shard coverage status
POST /api/agent/psbt-share/rebalance     # Trigger shard rebalancing
\`\`\`

#### Proof-of-Work Routes

\`\`\`
POST /api/agent/pow/puzzle          # Request PoW puzzle for fee competition
POST /api/agent/pow/submit          # Submit PoW solution
POST /api/agent/pow/settlement      # Record settlement result
POST /api/agent/pow/settlement-record  # Query settlement records
\`\`\`

#### Gossip Protocol Routes

\`\`\`
POST /api/gossip/push               # Push protocol events to peer
POST /api/gossip/pull               # Pull events from peer
POST /api/gossip/heartbeat          # Heartbeat exchange
POST /api/gossip/membership         # Membership change notification
POST /api/gossip/sync               # Full state sync request
\`\`\`

#### Protocol Routes

\`\`\`
POST /api/protocol/events           # Submit signed protocol event
GET  /api/protocol/events/{id}      # Query event by ID
GET  /api/protocol/state            # Current protocol state snapshot
POST /api/protocol/validate         # Validate event without submitting
\`\`\`

#### Admin Routes

\`\`\`
POST /api/admin/governance/propose  # Submit governance proposal
POST /api/admin/governance/vote     # Vote on proposal
POST /api/admin/strikes/issue       # Issue misbehavior strike
GET  /api/admin/health              # Node health status
GET  /api/admin/metrics             # Prometheus-compatible metrics
\`\`\`

#### Media Routes

\`\`\`
GET  /api/media/{hash}              # Retrieve cached media by content hash
POST /api/media/upload              # Upload media (rate limited)
GET  /api/media/status/{hash}       # Check media availability across shards
\`\`\`

### Node Discovery

\`\`\`
GET /.well-known/agent
GET /.well-known/agent/fee-addresses?chain=BTC&context=<key>
\`\`\`

\`/.well-known/agent\` returns the node's public identity plus its advertised capabilities.
Fee address catalogs are fetched separately from \`/.well-known/agent/fee-addresses\` so discovery stays small.

\`\`\`json
{
  "nodeId": "node-abc123",
  "agentPubkey": "ed25519:...",
  "foundationFeeAddress": "bc1qfoundation...",
  "capabilities": ["protocol_validate", "ui_quote_service"],
  "protocolVersion": "mvp-1",
  "validatorVersion": "1.0.0"
}
\`\`\`

Other nodes use this endpoint during peer discovery and mesh formation.

### Response Format

All public endpoints return paginated responses:

\`\`\`json
{
  "data": [...],
  "pagination": {
    "offset": 0,
    "limit": 20,
    "total": 150
  }
}
\`\`\`

### Rate Limiting

| Tier | Limit | Escalation |
|------|-------|------------|
| Anonymous | 60 req/min | Standard |
| Authenticated | 300 req/min | Standard |
| Abusive (tier 1) | Blocked 5 min | After repeated violations |
| Abusive (tier 2) | Blocked 15 min | Continued abuse |
| Abusive (tier 3) | Blocked 60 min | Persistent abuse |
| Abusive (tier 4) | Blocked 24h + gossip ban | Ban propagated to all nodes |

Rate limit violations trigger escalating cooldowns. At tier 4, the ban is gossiped to all nodes in the network, effectively blocking the client from the entire mesh.

### Notes

- **Read-only public API.** No write operations via the public marketplace endpoints.
- **Marketplace state.** Returns protocol-computed state, not raw chain data.
- **No auth required** for public endpoints. Internal routes require Ed25519 node authentication.
- **Decentralized.** Every node serves the full API independently from its own database.`,
  },

  {
    slug: "smart-contracts",
    category: "Developer",
    categorySlug: "developer",
    title: "Smart Contracts",
    description:
      "EVM and Solana contract reference. DecenterlizeMarketV1, LocalTokenSwapRouter, AppOwnedUniswapV3SwapAdapter, staking programs, and deployment details.",
    icon: "file-code",
    sortOrder: 61,
    content: `## Smart Contracts

On-chain smart contracts handle settlement and staking. All contracts are open source and immutable after deployment. No proxy patterns, no admin keys, no upgrade paths.

### EVM Contracts

#### DecenterlizeMarketV1.sol

The core marketplace contract for EVM chains. Handles order execution with EIP-712 typed signature verification:

\`\`\`solidity
contract DecenterlizeMarketV1 {
    bytes32 public DOMAIN_SEPARATOR;
    uint256 public constant MARKETPLACE_FEE_BPS = 200; // 2%

    // Execute a seller-signed order
    function executeOrder(
        Order calldata order,
        bytes calldata sellerSignature,
        address feeRecipient
    ) external payable nonReentrant;

    // Cancel a specific order
    function cancelOrder(Order calldata order) external;

    // Cancel all orders (increments nonce)
    function cancelAllOrders() external;
}
\`\`\`

Features:

- **EIP-712 typed signatures.** Human-readable signing prompts in wallets.
- **ERC-721 support.** Single NFT transfers (1 token per ID).
- **ERC-1155 support.** Semi-fungible tokens (multiple tokens per ID).
- **Non-reentrant.** Lock variable protects all state-changing functions.
- **Immutable fees.** 200 bps hardcoded, 50% foundation / 50% PoW winner.
- **Order cancellation.** Individual cancel or bulk cancel via nonce increment.

#### LocalTokenSwapRouter.sol

Constant-product AMM for marketplace-native token markets:

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
) external returns (uint256 lpTokens);

function removeLiquidity(
    address tokenA,
    address tokenB,
    uint256 lpTokens
) external returns (uint256 amountA, uint256 amountB);
\`\`\`

- **Constant-product (x * y = k)** pricing model.
- **0.3% swap fee** accruing to liquidity providers.
- **200 bps marketplace fee** split 50/50 between foundation and PoW winner.
- **LP tokens** for tracking liquidity provider shares.
- **Governance-configurable** parameters for fee rates and pool permissions.

#### AppOwnedUniswapV3SwapAdapter.sol

External DEX integration wrapping Uniswap V3:

- Wraps the Uniswap V3 SwapRouter for access to deep external liquidity.
- Applies the marketplace fee layer on top of external swaps.
- Supports multi-hop routes (e.g., TOKEN \u2192 WETH \u2192 USDC).
- Slippage protection via \`minAmountOut\`.
- Path encoding for optimal route selection.

### Solana Programs

#### agorix_marketplace

Anchor program for SPL marketplace operations:

\`\`\`rust
#[program]
mod agorix_marketplace {
    pub fn record_sale(ctx: Context<RecordSale>, sale_id: [u8; 32], price_lamports: u64, seller: Pubkey, buyer: Pubkey) -> Result<()>;
    pub fn cancel_listing(ctx: Context<CancelListing>, sale_id: [u8; 32]) -> Result<()>;
}
\`\`\`

Handles SPL token transfers, fee distribution, and sale record creation.

#### agorix_staking

Anchor program for node operator staking:

- **USDC/USDT collateral vaults.** Operators deposit stablecoins as bond.
- **Governance-configurable cooldown.** Currently 7 days standard, escalating for delegates.
- **Lifecycle tracking.** Active \u2192 Exiting \u2192 Exited state machine.
- **Slashing support.** Provable misbehavior (double-signing, false attestation) triggers bond reduction.
- **Delegation integration.** Tracks delegated voting power per operator.

### Deployment

| Contract | Networks |
|----------|----------|
| DecenterlizeMarketV1 | Ethereum, Base, Arbitrum, Optimism |
| LocalTokenSwapRouter | Ethereum, Base, Arbitrum, Optimism |
| AppOwnedUniswapV3SwapAdapter | Ethereum, Base (where Uniswap V3 is deployed) |
| agorix_marketplace | Solana |
| agorix_staking | Solana |

Each EVM deployment uses the same bytecode. Chain-specific parameters (chain ID in the EIP-712 domain separator) are set at construction time.

### Verification

- **Source published.** Full contract source available in the repository under \`contracts/\` (Solidity) and \`programs/\` (Anchor).
- **Bytecode matching.** Deployed bytecode can be verified against compiled source.
- **No proxy.** What you see is what runs. No delegatecall, no upgradability.
- **Hardhat/Foundry.** EVM contracts tested with both frameworks.
- **Anchor test suite.** Solana programs tested with Anchor's built-in test runner.

### Security Properties

- **Immutable.** No proxy patterns, no upgrade paths, no admin keys.
- **Non-reentrant.** All state-changing functions protected.
- **Minimal surface.** Each contract does one thing well.
- **Deterministic fees.** No governance override on fee percentages.
- **Open source.** Every line of deployed code is auditable.`,
  },

  {
    slug: "security-model",
    category: "Developer",
    categorySlug: "developer",
    title: "Security Model",
    description:
      "Comprehensive security architecture. Cryptographic primitives, 8 defense layers, threat model, rate limiting escalation, and MPC treasury protection.",
    icon: "shield",
    sortOrder: 63,
    content: `## Security Model

Built on defense in depth. Multiple independent security layers make sure no single failure can compromise the system.

### Cryptographic Primitives

| Primitive | Library | Usage |
|-----------|---------|-------|
| Ed25519 | TweetNaCl | Event signatures, quote signing, release verification, node identity, reveal challenges |
| secp256k1 | @noble/secp256k1 | Bitcoin/Ethereum transaction signing, MPC key shares |
| SHA-256 | @noble/hashes | Content hashing, witness seed derivation, challenge derivation, event IDs |
| HMAC-SHA256 | @noble/hashes | Witness selection seeding, deterministic node assignment |
| AES-256-GCM | Node.js crypto | PSBT encryption (authenticated encryption with associated data) |
| Shamir's Secret Sharing | Custom GF(256) | PSBT key shard distribution (3-of-4 threshold) |
| Argon2id | hash-wasm | PoW puzzle memory-hard hashing (memory + CPU bound) |

Every cryptographic operation uses audited, well-tested libraries. No custom cryptography. Ed25519 via TweetNaCl (the original djb implementation), hashing via @noble/hashes (audited, zero-dependency), and Argon2id for memory-hard PoW puzzles.

### MPC Threshold Signatures

The protocol treasury uses multi-party computation (MPC) threshold signatures:

- **Key never reconstructed.** The private key is split across ALL active nodes. No single node (or minority of nodes) ever holds the complete key.
- **67% threshold (BFT standard).** Signing requires 2/3 of key share holders to participate. This matches the Byzantine fault tolerance threshold used throughout the protocol.
- **No hot wallet.** There is no server, vault, or HSM holding the treasury key. The key exists only as distributed shares.
- **Weekly epoch batching.** Treasury operations (reward distributions, fee payouts) are batched into weekly epochs to minimize signing ceremonies.
- **Auto-reshare on membership changes.** When nodes join or leave, key shares are redistributed without reconstructing the original key. Uses proactive secret sharing protocols.
- **Emergency health-based reshare.** If the network detects that too many share-holders are unhealthy (offline, slow, or failing PoA), an emergency reshare triggers with a 5-minute grace period.

### Threat Model

**What we protect against:**

1. **Single node compromise.** No single node can forge transactions, steal assets, or manipulate governance.
2. **Minority collusion.** Up to 1/3 of witnesses can be compromised without affecting consensus.
3. **Sybil attacks.** Bonding requirements and PoA challenges prevent fake nodes.
4. **Front-running.** Unpredictable witness selection (HMAC-SHA256 with blockchain beacon seeds) and sealed PoW prevent advance positioning.
5. **Replay attacks.** Nonces, salts, and per-order reveal tokens prevent reuse across orders and chains.
6. **Man-in-the-middle.** Ed25519 signatures on all protocol events. Nodes verify signatures before processing.
7. **Key compromise.** MPC treasury means there's no single key to steal. PSBT shards mean no single node holds a complete encrypted transaction.
8. **Rogue contracts.** TX-plan quorum verification and contract allowlisting prevent interaction with malicious smart contracts.

**What we rely on:**

1. **Blockchain security.** The underlying chains (BTC, ETH, SOL) provide settlement finality.
2. **Cryptographic hardness.** Standard assumptions (discrete log problem, hash collision resistance).
3. **Honest supermajority.** At least 2/3 of witnesses must be honest for correct attestation.

### 8 Defense Layers

**Layer 1: Protocol Determinism.** Every node computes the same truth independently from the same inputs. No coordinator to compromise, no leader to bribe, no authority to coerce. The protocol package has zero external dependencies and produces identical outputs on every node.

**Layer 2: Threshold Attestation.** Transactions require 2/3 supermajority witness agreement (\`TX_ATTESTATION\` events). Compromising a minority of witnesses achieves nothing. The attestation threshold matches the BFT standard used in the MPC treasury.

**Layer 3: Proof of Access.** Witnesses must prove real-time blockchain RPC access via chain-specific challenges (5 for BTC, 3 for ETH, 3 for SOL). Challenges query unpredictable historical state. Can't fake attestations by copying other nodes' responses.

**Layer 4: Sealed PoW.** Fee competition uses blockchain beacon seeds (block hashes), not coordinator-assigned puzzles. Argon2id memory-hard hashing prevents GPU/ASIC advantage. No node has advance knowledge of the puzzle parameters.

**Layer 5: MPC Treasury.** Treasury funds require 67% threshold multi-party signing. No hot wallet to hack, no single key to steal, no admin override. Weekly epoch batching reduces the signing ceremony attack surface.

**Layer 6: Release Verification.** Client-side hash verification ensures authentic code delivery. The verification path doesn't trust any single server. Manifest hashes are signed with the foundation's Ed25519 key and verifiable by any node.

**Layer 7: Rate Limiting with Gossip Propagation.** Multi-tier rate limiting with escalating cooldowns and network-wide ban propagation:

| Violation Level | Cooldown | Scope |
|----------------|----------|-------|
| First offense | 5 minutes | Local to the receiving node |
| Second offense | 15 minutes | Local to the receiving node |
| Third offense | 60 minutes | Local to the receiving node |
| Fourth offense | 24 hours + gossip ban | Propagated to ALL nodes in the mesh |

At tier 4, the offending client's identifier is gossiped as a ban event. Every node in the network blocks the client without requiring independent detection.

**Layer 8: Governance Safeguards.** Parameter changes require node consensus through the governance system. During the beta period, the foundation master node (Node-1) retains veto power to prevent premature or malicious parameter changes. All governance actions are signed protocol events visible in the explorer.

### Non-Custodial Design

The protocol never takes custody of user assets:

- **Bitcoin.** Seller holds private key. PSBT shards hold the encrypted transaction template, not the key. Reconstruction requires buyer action.
- **Ethereum.** Smart contract is the only escrow point. Release triggered by valid EIP-712 signature. No admin key on the contract.
- **Solana.** Program-verified transfers. No intermediate custody account.

### Incident Response

All security-relevant events follow the transparency protocol:

1. Signed by the originating node's Ed25519 key.
2. Gossiped to all nodes via the push/pull protocol.
3. Stored in the immutable event log.
4. Visible in the protocol explorer.
5. Subject to governance review if they involve parameter changes or strikes.

### Foundation Transparency

All foundation actions (veto, parameter changes, manual interventions) must be signed protocol events gossiped to all nodes and visible in the explorer. The foundation cannot act in secret. Every action is cryptographically attributable and permanently recorded.`,
  },
];
