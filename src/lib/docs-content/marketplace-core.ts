import type { DocEntry } from "./types";

export const MARKETPLACE_CORE_DOCS: DocEntry[] = [
  {
    slug: "marketplace-overview",
    category: "Marketplace",
    categorySlug: "marketplace",
    title: "Marketplace Overview",
    description:
      "How the decentralized marketplace works end-to-end. Listing creation, order lifecycle, settlement flows, fee distribution, and the role of every participant.",
    icon: "store",
    sortOrder: 70,
    content: `## Marketplace Overview

Agorix is a general-purpose decentralized marketplace for digital assets -- an eBay replacement where no single company controls listings, pricing, or settlement. Every operation is enforced by code running identically on every node in the network.

### Core Participants

| Role | Description |
|------|-------------|
| **Seller** | Lists assets for sale by signing chain-native authorization (PSBT, EIP-712, SPL) |
| **Buyer** | Submits purchase intent, receives a signed quote, and completes settlement |
| **Witness nodes** | Selected deterministically to validate and attest transactions |
| **PoW winner** | Earns the settlement fee through competitive sealed-bid auction |
| **Foundation** | Receives 50% of the marketplace fee for protocol development |
| **UI provider** | The node serving the buyer's frontend session |

### Listing Creation

Sellers create listings by signing a chain-native authorization that commits their asset to a specific price. The listing is published as a \`LISTING_CREATE\` protocol event gossiped to every node.

**Bitcoin (Ordinals):**
The seller signs a PSBT with \`SIGHASH_SINGLE|ANYONECANPAY\`. The signed PSBT is then encrypted with AES-GCM, split into Shamir 3-of-4 secret shares, and distributed to 4 independent shard-holder nodes. No single node can reconstruct the PSBT alone.

**Ethereum / EVM L2s:**
The seller signs an EIP-712 typed data order containing the asset contract, token ID, price, nonce, salt, expiration, and fee breakdown. The signature is verifiable on-chain by \`AgorixV1.sol\`.

**Solana:**
The seller creates an SPL token transfer authorization via the \`agorix_marketplace\` program, scoped to the specific asset and price.

### Listing State Machine

Every listing follows a simple three-state lifecycle:

\`\`\`
OPEN  -->  FILLED     (purchase completed, settlement confirmed)
  |
  +-->  CANCELLED   (seller delists or listing expires)
\`\`\`

- **OPEN**: Available for purchase, visible in search, accepting order intents
- **FILLED**: Successfully sold -- order completed and confirmed on-chain
- **CANCELLED**: Removed by seller action or expiration timestamp reached

Each listing tracks a \`revealNonce\` counter that increments after every PSBT share reveal attempt, preventing replay attacks on Bitcoin settlement.

### Order Lifecycle

1. **Intent** -- Buyer submits an \`ORDER_INTENT\` with their public key and the listing they want to purchase
2. **Quote** -- The serving node generates a signed quote containing the price, fees, PoW round ID, and expiration window. Quotes are stored in \`sessionQuotes\` with the serving node's Ed25519 signature
3. **PoW Competition** -- Nodes compete in a sealed-bid auction to determine who earns the settlement fee (8-phase commit-reveal protocol)
4. **Settlement** -- Chain-specific execution:
   - **BTC**: Buyer requests PSBT shard reveals, reconstructs the transaction, signs, and broadcasts
   - **EVM**: Smart contract verifies signatures, checks attestation quorum, executes atomic swap
   - **SOL**: Marketplace program executes SPL transfer with on-chain fee distribution
5. **Attestation** -- Witness nodes verify the on-chain transaction and sign attestations (2/3 supermajority required)
6. **Finalization** -- Once quorum is reached, the listing is marked FILLED and reward claims are generated

### Fee Structure

The marketplace charges a 2% (200 basis points) fee on every sale, computed using integer arithmetic with no floating point:

| Recipient | Share | Example on 100 USD sale |
|-----------|-------|------------------------|
| Foundation | 50% of fee (1% of sale) | 1.00 USD |
| PoW winner / agent | 50% of fee (1% of sale) | 1.00 USD |
| Creator royalties | Configurable per collection (0-100%) | Variable |
| Seller | Price minus fees minus royalties | 98.00 USD minus royalties |

All fee calculations use basis points (1 bps = 0.01%). The fee range is governance-configurable between 50-500 bps.

### Fee Address Routing

Listings specify a \`uiFeeAddress\` that determines where the non-foundation share of fees goes:

- **Dynamic winner**: Fees route to whichever node wins the PoW competition for that transaction
- **Direct node**: Fees route to a specific node address (used in development or curated marketplaces)

### Purchase Recording

When settlement completes, the system validates the full output breakdown:

1. Seller received: price minus marketplace fee minus royalties
2. Foundation received: exactly 50% of the marketplace fee
3. PoW winner received: exactly 50% of the marketplace fee
4. Creator received: the correct royalty percentage

A \`PURCHASE_RECORDED\` protocol event is published and gossiped to all nodes. Reward claims are generated for validating nodes, the PoW winner, and optionally the buyer.`,
  },

  {
    slug: "database-architecture",
    category: "Marketplace",
    categorySlug: "marketplace",
    title: "Database Architecture",
    description:
      "Complete database schema reference. Every table, its purpose, key columns, indexes, and relationships across marketplace, agent, governance, rewards, and realtime domains.",
    icon: "store",
    sortOrder: 71,
    content: `## Database Architecture

Every node runs its own isolated PostgreSQL 16 instance. There is no shared database anywhere in the system. Tables are organized into six domains.

### Marketplace Domain

**listings** -- Core asset records for sale

| Column | Type | Purpose |
|--------|------|---------|
| \`id\` | TEXT PK | Unique listing identifier |
| \`chain\` | ENUM (BTC, ETH, SOL) | Which blockchain the asset lives on |
| \`assetOutpoint\` | TEXT UNIQUE | On-chain asset identifier |
| \`sellerAddress\` | TEXT | Seller's wallet address |
| \`priceSats\` | BIGINT | Price in base units (satoshis for BTC, wei for ETH) |
| \`status\` | TEXT | OPEN, FILLED, or CANCELLED |
| \`btcSale\` / \`evmSale\` / \`solanaSale\` | JSONB | Chain-specific sale parameters |
| \`collectionId\` | TEXT FK | Parent collection (optional) |
| \`royaltyBpsOverride\` | INT (0-10000) | Override creator royalty percentage |
| \`revealNonce\` | INT | Incrementing counter for PSBT share reveals |
| \`expiresAt\` | TIMESTAMP | When listing automatically cancels |

Indexed by: chain, status, assetOutpoint, expiresAt, updatedAt.

**orderIntents** -- Purchase initialization

| Column | Type | Purpose |
|--------|------|---------|
| \`id\` | TEXT PK | Order identifier |
| \`listingOutpoint\` | TEXT FK | Which listing is being purchased |
| \`buyerPubkey\` | TEXT | Buyer's Ed25519 public key |
| \`chain\` | ENUM | Target chain |
| \`sessionId\` | TEXT | Buyer's active session |

**btcActiveOrders** -- Bitcoin-specific order state tracking

| Column | Type | Purpose |
|--------|------|---------|
| \`listingOutpoint\` | TEXT PK/FK | The listing being purchased |
| \`orderId\` | TEXT UNIQUE FK | Links to orderIntents |
| \`status\` | TEXT | Signing/confirmation progress |
| \`txid\` | TEXT | Final transaction hash (once broadcast) |
| \`lockedAt\` | TIMESTAMP | When this order locked the listing |
| \`expiresAt\` | TIMESTAMP | Order timeout |

**sessionQuotes** -- Pricing snapshots bound to orders

| Column | Type | Purpose |
|--------|------|---------|
| \`orderId\` + \`sessionId\` | Composite PK | Links quote to specific order and session |
| \`sessionCommitHash\` | TEXT | Hash of quote commitment |
| \`body\` | JSONB | Full quote details (price, fees, witnesses) |
| \`signature\` | TEXT | Serving node's Ed25519 signature on the quote |
| \`expiresAt\` | TIMESTAMP | Quote validity window |

**txSummaries** -- On-chain transaction records

| Column | Type | Purpose |
|--------|------|---------|
| \`txid\` | TEXT PK | On-chain transaction ID |
| \`orderId\` | TEXT FK | Which order this settles |
| \`chain\` | ENUM | Which blockchain |
| \`blockHeight\` | INT | Block where transaction landed |
| \`decodedSummary\` | JSONB | Parsed outputs and fee breakdown |

**txAttestations** -- Witness signatures on transactions

| Column | Type | Purpose |
|--------|------|---------|
| \`txid\` | TEXT FK | Which transaction |
| \`agentPubkey\` | TEXT | Which witness node signed |
| \`verdict\` | ENUM (VALID, INVALID) | Attestation result |
| \`reasons\` / \`breakdown\` | JSONB | Validation details and fee verification |
| \`validatorVersion\` | TEXT | Protocol version used for validation |

UNIQUE constraint on (txid, orderId, agentPubkey) -- one attestation per node per transaction.

### PSBT Custody Tables (Bitcoin-Specific)

**listingPsbtShards** -- Threshold encryption metadata per listing

| Column | Type | Purpose |
|--------|------|---------|
| \`listingOutpoint\` | TEXT PK/FK | Links to listing |
| \`threshold\` / \`totalShares\` | INT | M-of-N scheme (e.g. 3-of-4) |
| \`encryptedPsbt\` | JSONB | Threshold-encrypted PSBT data |
| \`participants\` | JSONB | Array of shard-holder node pubkeys |
| \`shareCommitments\` | JSONB | Verification hashes for each share |

**listingPsbtShares** -- Individual encrypted shares held by nodes

| Column | Type | Purpose |
|--------|------|---------|
| \`listingOutpoint\` | TEXT FK | Which listing |
| \`holderAgentPubkey\` | TEXT | Which node holds this share |
| \`shareIndex\` | INT | Position in threshold scheme |
| \`shareValue\` | TEXT | Encrypted share data |

UNIQUE on (listingOutpoint, holderAgentPubkey) -- one share per node per listing.

**listingPsbtRevealChallenges** -- Authorized share reveal requests

| Column | Type | Purpose |
|--------|------|---------|
| \`challengeId\` | TEXT PK | Unique challenge identifier |
| \`listingOutpoint\` | TEXT FK | Which listing |
| \`orderId\` | TEXT FK | Which order is requesting |
| \`listingRevealNonce\` | INT | Must match listing's current revealNonce |
| \`nonce\` / \`signature\` | TEXT | Challenge authentication |
| \`expiresAt\` | TIMESTAMP | Challenge timeout |

### Collection Domain

**collectionMetadata** -- Collection identity and display info

| Column | Type | Purpose |
|--------|------|---------|
| \`collectionId\` | TEXT PK | Unique collection ID |
| \`chain\` | ENUM | BTC, ETH, or SOL |
| \`collectionType\` | ENUM | EVM_CONTRACT, PARENT_CHILD, GALLERY, CURATED |
| \`name\` / \`description\` | TEXT | Display information |
| \`verified\` | ENUM | UNVERIFIED, PENDING, VERIFIED, REJECTED |
| \`contractAddress\` | TEXT | EVM contract (if applicable) |
| \`parentInscriptionId\` | TEXT | BTC parent inscription (if applicable) |
| \`creatorAddress\` | TEXT | Collection creator wallet |

**collectionRegistry** -- Royalty recipient configuration

| Column | Type | Purpose |
|--------|------|---------|
| \`collectionId\` | TEXT FK | Which collection |
| \`recipientAddress\` | TEXT | Where royalties are sent |
| \`bps\` | INT (0-10000) | Royalty percentage in basis points |

Multiple recipients per collection are supported (e.g. co-creators splitting royalties).

**collectionSubmissions** -- Community proposal and voting system

| Column | Type | Purpose |
|--------|------|---------|
| \`collectionId\` | TEXT | Proposed collection identifier |
| \`collectionType\` | ENUM | Type of collection being proposed |
| \`status\` | ENUM | UNVERIFIED, PENDING, VERIFIED, REJECTED |
| \`verifyVotes\` / \`rejectVotes\` | INT | Community vote tallies |
| \`autoVerified\` | BOOL | True if no conflicts detected (auto-approved) |
| \`hasConflict\` | BOOL | True if inscription range overlaps existing collection |
| \`votingDeadline\` | TIMESTAMP | 7-day deadline for conflicted proposals |

### Asset Ownership & Activity

**assetOwnershipCache** -- Who owns what (lazy-loaded, cursor-paginated)

| Column | Type | Purpose |
|--------|------|---------|
| \`assetKey\` | TEXT PK | Composite identifier (chain:contract:tokenId) |
| \`chain\` | ENUM | Which blockchain |
| \`ownerAddress\` | TEXT | Current owner |
| \`verifiedAtBlock\` | BIGINT | Last on-chain verification block |
| \`inscriptionId\` / \`contractAddress\` / \`mintAddress\` | TEXT | Denormalized for fast queries |

Indexed by (chain, ownerAddress, assetKey) for cursor pagination.

**assetActivity** -- Historical event log with keyset pagination

| Column | Type | Purpose |
|--------|------|---------|
| \`id\` | TEXT PK | Sortable "{epochMs}_{random}" format (IS the cursor) |
| \`activityType\` | ENUM | MINT, TRANSFER, LIST, DELIST, BUY, SELL, BURN, INSCRIBE |
| \`priceRaw\` | TEXT | Sale price in base units |
| \`txHash\` | TEXT | On-chain transaction |
| \`occurredAt\` | TIMESTAMP | When the activity happened on-chain |

UNIQUE on (txHash, assetKey) -- prevents double-logging the same event. All queries use keyset pagination: \`WHERE id < ?cursor ORDER BY id DESC\` (no OFFSET).

### Rewards Domain

**rewardClaims** -- Token entitlements (claims, not transfers)

| Column | Type | Purpose |
|--------|------|---------|
| \`id\` | TEXT PK | Claim identifier |
| \`reason\` | ENUM | NODE_FEE_REIMBURSEMENT, NODE_INCENTIVE, USER_PURCHASE_REWARD, MODERATION_REWARD, BURN_ALLOCATION, MEDIA_OPTIMIZATION |
| \`tokenAmountRaw\` | TEXT | Full precision token amount |
| \`status\` | ENUM | PENDING, SIGNED, CLAIMED, EXPIRED |
| \`stateEpoch\` | INT | Which weekly epoch this belongs to |
| \`signature\` | TEXT | MPC threshold signature for claiming |

**claimEpochs** -- Weekly reward batching windows

| Column | Type | Purpose |
|--------|------|---------|
| \`epochNumber\` | INT UNIQUE | Sequential epoch counter |
| \`status\` | ENUM | OPEN, CLOSING, FUNDING, SIGNING, BROADCASTING, CONFIRMED, FAILED |
| \`totalTokenAmountRaw\` | TEXT | Sum of all claims in this epoch |
| \`signingCeremonyId\` | TEXT FK | MPC ceremony for batch payout |
| \`payoutTxHash\` | TEXT | Final on-chain transaction |

### Realtime Domain

**chatThreads** / **chatMessages** -- Sharded via rendezvous hashing. Each thread is assigned to specific nodes based on the shard ring. Messages include sender, content, and thread reference.

**protocolEvents** -- The complete signed event log. Every Ed25519-signed event gossiped through the network is stored here for full auditability. This is the canonical record of all protocol activity.`,
  },

  {
    slug: "profile-system",
    category: "Marketplace",
    categorySlug: "marketplace",
    title: "Profiles & Authentication",
    description:
      "Wallet-based identity system. Challenge-response authentication, multi-chain wallet linking, session management, social verification, and multi-device approval flows.",
    icon: "store",
    sortOrder: 72,
    content: `## Profiles & Authentication

Agorix uses wallet-based authentication -- there are no usernames or passwords. Your identity is your wallet signature.

### Challenge-Response Authentication

Authentication follows a two-step challenge-response flow:

**Step 1: Issue Challenge**

The client calls \`issueChallenge\` with:
- \`chain\`: BTC, ETH, or SOL
- \`address\`: The wallet address to authenticate
- \`purpose\`: SESSION_BOOTSTRAP (new session) or LINK_WALLET (add wallet to existing profile)

The server generates a \`profileLinkChallenges\` record containing a random nonce and a human-readable message to sign. Challenges expire after 10-15 minutes.

**Step 2: Verify Signature**

The client signs the challenge message using the wallet's private key and submits:
- \`challengeId\`: Which challenge to verify
- \`signature\`: The wallet signature
- \`deviceLabel\`: Optional device identifier

The server verifies the signature against the wallet address using \`verifyProof\` (protocol-level verification). On success:

- **For SESSION_BOOTSTRAP**: Creates a new profile (if first wallet) and a new \`profileSessions\` record. Returns a session token.
- **For LINK_WALLET**: Creates a \`profileWalletLinks\` record connecting the wallet to the existing profile.

### Session Management

Sessions are stored in the \`profileSessions\` table:

| Field | Purpose |
|-------|---------|
| \`tokenHash\` | SHA-256 hash of the session token (token never stored in plaintext) |
| \`actingWalletChain\` / \`actingWalletAddress\` | Which wallet this session authenticated with |
| \`status\` | ACTIVE, REVOKED, or EXPIRED |
| \`deviceLabel\` / \`userAgent\` | Device metadata for session management |
| \`lastSeenAt\` | Updated on every authenticated request |
| \`expiresAt\` | Session expiration timestamp |

Protected API endpoints use a \`protectedProfileProcedure\` that validates the session token from request headers and injects \`profileId\`, \`sessionId\`, and \`db\` into the handler context.

### Multi-Chain Wallet Linking

A single profile can link wallets from multiple chains:

| Wallet Field | Purpose |
|-------------|---------|
| \`walletChain\` | BTC, ETH, or SOL |
| \`walletAddress\` | Actual wallet address |
| \`addressHash\` | Deterministic hash for lookups (prevents duplicates) |
| \`role\` | PRIMARY (first wallet), ADMIN (elevated), or MEMBER (read-only) |
| \`visibility\` | PUBLIC (discoverable by address) or PRIVATE (hidden) |
| \`proofSignature\` / \`proofMessage\` / \`proofScheme\` | Stored challenge proof for verification |

Each (walletChain, addressHash) pair is unique -- a wallet can only be linked to one profile. Wallets can be unlinked via soft-delete (\`removedAt\` timestamp).

### Social Verification

Profiles can verify ownership of social accounts across platforms:

| Platform | Verification Flow |
|----------|-------------------|
| X (Twitter) | Post challenge text, community votes to verify |
| Instagram | Post challenge text, community votes |
| GitHub | Create gist with challenge text |
| YouTube, TikTok, Facebook | Post challenge text |
| Website | Place challenge text at well-known URL |

The flow:
1. User calls \`createProfileSocialLink\` with platform and handle
2. System generates a \`verificationHash\` challenge text to post publicly
3. Community members vote (\`verifyVotes\` / \`rejectVotes\`) to confirm ownership
4. Once threshold reached: status moves from PENDING to VERIFIED

Each (profileId, platform, normalizedHandle) combination is unique.

### Multi-Device Approval

For linking new devices to an existing profile:

1. New device calls \`createDeviceLinkRequest\` -- generates a one-time \`requestTokenHash\`
2. Existing device approves via \`approveDeviceLinkRequest\` (requires active session)
3. System creates an encrypted session (\`issuedSessionEncrypted\`) for the new device
4. New device consumes the request via \`consumeDeviceLinkRequest\`

Requests expire and can be rejected. Status flow: PENDING -> APPROVED -> CONSUMED (or REJECTED / EXPIRED).

### Profile Discovery

- \`resolvePublicProfileByAddress\`: Look up a profile by chain + wallet address (only returns PUBLIC wallets)
- Returns: linked wallets, verified social links, display name
- Private wallets are never exposed through discovery endpoints

### Notification Settings

Each profile has a \`profileNotificationSettings\` record with a JSONB \`settings\` field for custom notification preferences. Changes are tracked by \`updatedBySessionId\` for audit purposes.`,
  },
];
