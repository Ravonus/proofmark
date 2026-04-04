import type { DocEntry } from "./types";

export const GETTING_STARTED_DOCS: DocEntry[] = [
  {
    slug: "overview",
    category: "Getting Started",
    categorySlug: "getting-started",
    title: "Overview",
    description:
      "What Agorix is and why it exists. A chain-agnostic, agent-run decentralized marketplace where distributed nodes enforce transparent, deterministic rules across Bitcoin, Ethereum, Solana, and beyond.",
    icon: "globe",
    sortOrder: 0,
    content: `## What is Agorix?

Agorix is a **decentralized, agent-run, multi-chain marketplace protocol** -- an eBay replacement for digital assets. Instead of one company running your trades, a network of independently operated nodes enforces the rules. The rules are code. Every node can verify them. Nobody can change them unilaterally.

The protocol works natively across Bitcoin, Ethereum (plus L2s like Base, Arbitrum, and Optimism), Solana, and additional chains on day one. Every transaction is validated by a quorum of witnesses selected through a deterministic process that nobody can predict or game ahead of time.

### The Problem

Right now, digital asset marketplaces are centralized chokepoints.

- **Platform risk.** OpenSea, Magic Eden, Blur -- they all make unilateral decisions about listings, fees, and policies. Your assets, their rules.
- **Opaque economics.** Hidden incentives, wash trading rewards, fee structures nobody can audit.
- **Chain fragmentation.** Every blockchain needs its own platform. Liquidity gets split across all of them.
- **Centralized settlement.** One server processes your transactions. One server goes down, everything stops. One company gets compromised, everyone loses.

### The Solution

We replace centralized trust with cryptographic verification.

1. **Chain-Agnostic Protocol Truth.** The same transparent, cryptographically verifiable rules run identically on every supported chain. The protocol package has zero framework dependencies -- it is pure Zod schemas and deterministic logic.
2. **Distributed Threshold Attestation.** Independent bonded nodes must reach supermajority agreement (2/3 threshold) before any settlement happens. Witnesses are selected deterministically using unpredictable seeds derived from block hashes.
3. **Native Multi-Chain Settlement.** Bitcoin PSBTs with Shamir 3-of-4 share distribution, EVM EIP-712 signed orders via \`AgorixV1.sol\`, Solana SPL transfers via the \`agorix_marketplace\` program. No bridges, no wrapping, no synthetic assets. Your tokens stay native.
4. **1-Node-1-Vote Governance.** Stake gets you in the door, but every node gets exactly one vote. No plutocratic capture. Token weighting is explicitly rejected.

### Supported Chains and Standards

| Chain | Standards | Settlement Mechanism |
|-------|-----------|---------------------|
| Bitcoin | Ordinals, PSBTs | PSBT reconstruction from Shamir shards |
| Ethereum | ERC-721, ERC-1155, ERC-20 | \`AgorixV1.sol\` smart contract |
| Base | ERC-721, ERC-1155, ERC-20 | EVM smart contract (L2) |
| Arbitrum | ERC-721, ERC-1155, ERC-20 | EVM smart contract (L2) |
| Optimism | ERC-721, ERC-1155, ERC-20 | EVM smart contract (L2) |
| Solana | SPL tokens | \`agorix_marketplace\` program |

### Key Metrics

| Metric | Value |
|--------|-------|
| Supported chains | 10+ (day one) |
| Consensus threshold | Supermajority (2/3 witnesses) |
| Protocol event types | 46 |
| Centralized chokepoints | 0 |
| Marketplace fee | 2% (50/50 foundation/nodes) |
| Event signing | Ed25519 |

### Technology Stack

The system is built on a modern, high-performance stack:

- **Frontend**: Next.js 15 with React 19
- **Backend**: TypeScript (Next.js API routes + tRPC) and Rust (Axum-based node-core)
- **ORM**: Drizzle ORM with strict schema typing
- **Database**: PostgreSQL 16 (isolated per node)
- **Cache**: Redis 7 (rate limiting, real-time state, caching)
- **Protocol**: Pure TypeScript with Zod validation, zero framework dependencies
- **Cryptography**: Ed25519 signing for all events, AES-GCM for PSBT encryption, Shamir secret sharing

### Monorepo Structure

The codebase is organized into 8 packages and 2 services:

**Packages:**

| Package | Purpose |
|---------|---------|
| \`protocol\` | Zero-dependency consensus schemas, event types, and deterministic logic |
| \`db\` | Drizzle ORM schemas, migrations, and query helpers |
| \`agent\` | Gossip mesh networking, peer discovery, and event propagation |
| \`server\` | Business logic, tRPC routers, and API handlers |
| \`cache\` | Redis client, rate limiting, and caching strategies |
| \`config\` | Environment validation, feature flags, and node configuration |
| \`cli\` | Command-line tooling for node operators |
| \`front-door-gateway\` | Stateless edge proxy depending only on cache |

**Services:**

| Service | Purpose |
|---------|---------|
| \`node-core\` | Rust (Axum) microservice with 60+ endpoints for PSBT validation, Ed25519 signing, AES-GCM encryption, and scanner loops |
| \`benchmark-dashboard\` | Development performance dashboard with live streaming |

### Architecture at a Glance

The packages follow strict dependency rules. An arrow means "depends on":

\`\`\`
protocol  (zero framework deps, pure Zod schemas + deterministic logic)
    |
    v
   db      (protocol + Drizzle ORM + PostgreSQL 16)
   / \\
  v   v
agent  server  (protocol + db + cache + config)
  |      |
  v      v
cache   (ioredis, standalone)
  |
  v
front-door-gateway  (cache only, stateless edge proxy)
\`\`\`

Every node runs its own isolated PostgreSQL database. There is no shared database anywhere in the system. Protocol data (events, attestations, governance votes) gets fully replicated through the gossip protocol so every node has the same view of protocol truth. Chat data gets sharded across nodes via rendezvous hashing with configurable replica counts.

### 46 Protocol Event Types

All protocol events are Ed25519-signed and gossiped to the entire network. They cover:

- **Listings**: creation, updates, cancellation, expiration
- **Orders**: intent, confirmation, cancellation
- **Transactions**: observation, attestation, finalization, disputes
- **Governance**: proposals, votes, delegation, parameter changes
- **Node lifecycle**: announcements, staking, unstaking, capability updates
- **PoW fee competition**: prepare, acknowledge, lock, start, work, commit, reveal, finalize
- **Moderation**: reports, reviews, strikes
- **Foundation**: treasury actions, emergency operations (all transparent, all signed)

### The Core Idea

> What if marketplace rules were code that every node can verify, not policies that one company can change? And what if that worked on every chain?

We don't replace the marketplace. We replace the trust model.`,
  },

  {
    slug: "how-it-works",
    category: "Getting Started",
    categorySlug: "getting-started",
    title: "How It Works",
    description:
      "The 4-step transaction lifecycle: List, Validate, Attest, Settle. How every trade flows through the protocol regardless of chain, including PoW fee competition, witness selection, and Proof-of-Access challenges.",
    icon: "workflow",
    sortOrder: 1,
    content: `## How It Works

Every trade follows a deterministic 4-step lifecycle. This is identical whether you are trading Bitcoin ordinals, Ethereum NFTs, or Solana tokens. Same engine, every chain.

### Step 1: List

Sellers create chain-native listing signatures. The protocol emits a \`LISTING_CREATE\` event that gets gossiped to every node in the network.

**Bitcoin (Ordinals / PSBTs):**

The seller signs a PSBT with \`SIGHASH_SINGLE|ANYONECANPAY\`. This signature commits the seller's ordinal input to a specific output amount but allows the buyer to add their own inputs and outputs later. The signed PSBT is then:

1. Encrypted using AES-GCM with a random session key
2. Split into Shamir 3-of-4 secret shares
3. Distributed to 4 independent shard-holder nodes
4. Each shard is stored encrypted at rest on its holder node

This means no single node ever has enough information to reconstruct the PSBT. At least 3 of the 4 shard holders must cooperate during settlement. This is critical for preventing theft -- even a compromised node cannot steal the seller's signature.

**Ethereum / Base / Arbitrum / Optimism (EIP-712):**

The seller signs an EIP-712 typed data order containing:

- Asset contract address and token ID
- Sale price and currency
- Unique nonce and salt (replay protection)
- Expiration timestamp
- Fee breakdown (foundation, UI provider, witnesses)

The order is verifiable on-chain by \`AgorixV1.sol\` without any off-chain coordinator.

**Solana (SPL):**

The seller creates an SPL token transfer authorization via the \`agorix_marketplace\` program. The authorization is scoped to the specific asset and price, with built-in expiration.

### Step 2: Validate

Every node independently runs \`validateSaleTx()\` against the transaction. This is pure computation -- same inputs always produce the same outputs. No coordinator is needed.

The validation checks, in order:

\`\`\`
validateSaleTx():
  1. Protocol version matches node's accepted versions
  2. Validator version matches (prevents stale logic)
  3. Quote signature is valid Ed25519 over the quoted price
  4. Quote has not expired (timestamps are checked)
  5. Release hash matches the consensus-approved code release
  6. Listing status is ACTIVE (not cancelled, expired, or already sold)
  7. Listing has not passed its expiration timestamp
  8. Asset outpoint appears in the transaction inputs (BTC)
     or asset contract+tokenId matches (EVM)
     or SPL token account matches (SOL)
  9. Witness selection is verified against the deterministic algorithm
  10. Paid witness count matches the protocol-required count
  11. Fee distribution is correct:
      - Foundation fee (1%)
      - UI provider fee (configurable)
      - Witness fees (split among selected witnesses)
      - Royalty fees (if applicable, per creator settings)
  12. Seller payout equals sale price minus all fees
  13. All outputs match expected addresses and amounts
\`\`\`

**Protocol Truth** is computed locally by each node. Because the validation is deterministic, honest nodes always agree. If a node produces a different result, it is provably wrong and can be slashed.

### Step 3: Attest

A quorum of witnesses independently verifies the transaction on-chain and signs attestations.

**Witness Selection:**

Witnesses are selected deterministically using a seeded ranking algorithm:

\`\`\`
For each eligible node:
  score = SHA256(sessionCommitHash + nextBlockHash + nodePubkey)
  rank nodes by score ascending
  top K nodes become witnesses
\`\`\`

The \`sessionCommitHash\` is committed before the block is known, and \`nextBlockHash\` is unpredictable until the block is mined. This makes witness selection unbiasable -- nobody can know who will be selected until the block is finalized.

**Proof-of-Access (PoA) Challenges:**

Before a witness can attest, it must prove real-time access to the relevant blockchain's RPC infrastructure. The challenge system verifies that the witness can actually read chain state, not just claim it can.

| Chain | Required Challenges | What is Verified |
|-------|-------------------|-----------------|
| Bitcoin (Ordinals) | 5 | BTC chain state (3 challenges) + ordinal indexer state (2 challenges) |
| Ethereum / EVM | 3 | Block headers, transaction receipts, contract state |
| Solana | 3 | Slot data, account state, transaction confirmations |

Challenges query historical state at specific block heights to prevent caching tricks. Each challenge has a tight time window -- if the witness cannot respond quickly enough, the challenge fails.

**Attestation Threshold:**

Witnesses sign their verdict (approve or reject) using Ed25519. Settlement requires a **supermajority of 2/3** (ceiling) of witnesses to agree. For example, with 6 witnesses you need at least 4 approvals. This is the standard Byzantine Fault Tolerance threshold -- the system tolerates up to 1/3 malicious or offline witnesses.

### Step 4: Settle

Once the attestation threshold is met, native chain settlement proceeds:

**Bitcoin:** The 3-of-4 Shamir shards are requested from shard-holder nodes. At least 3 shards must be recovered to reconstruct the seller's signed PSBT. The buyer's inputs and outputs are added, and the final transaction is broadcast to the Bitcoin network. A critical race condition guard ensures that shard distribution is atomic -- if any shard holder fails to deliver, the entire reconstruction is rolled back to prevent partial reveals that could leak the seller's signature.

**Ethereum / EVM:** The \`AgorixV1.sol\` smart contract verifies the EIP-712 signatures, checks the attestation quorum, and executes the atomic swap of asset for payment. Fee splits happen on-chain in a single transaction.

**Solana:** The \`agorix_marketplace\` program executes the SPL token transfer with on-chain fee distribution. The authorization is consumed atomically.

**Fee Distribution:**

| Recipient | Share | Notes |
|-----------|-------|-------|
| Foundation | 1% (50% of 2% fee) | Funds protocol development and operations |
| PoW Winner | 1% (50% of 2% fee) | Awarded through competitive fee auction |
| Witnesses | Included in PoW share | Attest as part of node duties |

### PoW Fee Competition

The "PoW" (Proof of Work) in Agorix is not mining -- it is a competitive fee auction that determines which node earns the settlement fee for a given transaction. The system runs through 8 phases:

\`\`\`
Phase 1: PREPARE    - Session parameters are published
Phase 2: ACK        - Eligible nodes acknowledge participation
Phase 3: LOCK       - Participants commit to competing
Phase 4: START      - Competition window opens
Phase 5: WORK       - Nodes compute and submit their fee bids
Phase 6: COMMIT     - Bids are committed (hash only, sealed)
Phase 7: REVEAL     - Bid values are revealed and verified against commits
Phase 8: FINALIZE   - Winner is determined, settlement proceeds
\`\`\`

The commit-reveal scheme prevents front-running. Nodes commit a hash of their bid before revealing the actual value, ensuring nobody can see others' bids and undercut them.

### Complete Event Lifecycle

Every step generates signed protocol events gossiped to all nodes:

\`\`\`
LISTING_CREATE         Seller publishes the listing
       |
       v
ORDER_INTENT           Buyer signals intent to purchase
       |
       v
[PoW Competition]      PREPARE -> ACK -> LOCK -> START ->
                       WORK -> COMMIT -> REVEAL -> FINALIZE
       |
       v
TX_OBSERVED            Transaction detected on-chain (or constructed)
       |
       v
TX_ATTESTATION         Each witness signs their verdict
  (per witness)
       |
       v
TX_FINALIZED           Supermajority reached, settlement confirmed
\`\`\`

These events form a complete, auditable, cryptographically signed history that is visible in the protocol explorer. Every node stores every event. Nothing is hidden.`,
  },

  {
    slug: "running-a-node",
    category: "Getting Started",
    categorySlug: "getting-started",
    title: "Running a Node",
    description:
      "Complete guide for node operators. System requirements, chain infrastructure, staking economics, environment configuration, capabilities, full-node mode, Docker deployment, and dev commands.",
    icon: "server",
    sortOrder: 2,
    content: `## Running a Node

Every node in the network is a full marketplace operator. You earn fees by processing transactions, validating protocol truth, and participating in governance.

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| Storage | 100 GB SSD | 500 GB NVMe |
| Network | 100 Mbps | 1 Gbps |
| Node.js | 20+ | Latest LTS |
| Rust toolchain | stable | Latest stable |
| PostgreSQL | 16+ | 16+ |
| Redis | 7+ | 7+ |

### Chain Infrastructure Requirements

You need RPC access to the chains you want to support. The Proof-of-Access challenge system continuously verifies that your access is real and responsive:

**Bitcoin:**
- \`bitcoind\` full node (pruned is acceptable for basic operations, full is recommended)
- \`ord\` indexer (required for ordinal support -- this is mandatory for BTC capability)
- Both are needed because PoA challenges test both BTC chain state and ordinal indexer state separately (5 challenges total)

**Ethereum / EVM:**
- RPC endpoint for each supported chain (Ethereum, Base, Arbitrum, Optimism)
- Options: Alchemy, Infura, QuickNode, or self-hosted Geth/Erigon/Reth
- Archive node access recommended for historical PoA challenges

**Solana:**
- RPC endpoint with full account and transaction history
- Options: Helius, QuickNode, Triton, or self-hosted validator

### Environment Configuration

Key environment variables for node operation:

\`\`\`
# Node identity
NODE_ID=1                              # Unique integer node identifier
AGENT_SECRET_KEY_B64=<base64>          # Ed25519 secret key for signing all events

# Database and cache
DATABASE_URL=postgres://user:pass@localhost:5432/agorix
REDIS_URL=redis://localhost:6379

# Rust node-core
RUST_NODE_CORE_URL=http://localhost:9100  # The Rust microservice endpoint

# Network
GOSSIP_PEERS=wss://node2.example.com/gossip,wss://node3.example.com/gossip

# Bitcoin
BTC_NETWORK=mainnet                    # or testnet, signet, regtest
BTC_RPC_URL=http://localhost:8332
ORD_RPC_URL=http://localhost:8080

# Ethereum / EVM
EVM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/<key>
BASE_RPC_URL=https://base-mainnet.g.alchemy.com/v2/<key>
ARB_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/<key>
OP_RPC_URL=https://opt-mainnet.g.alchemy.com/v2/<key>

# Solana
SOL_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<key>

# Full-node mode (optional)
FULL_NODE_CHAT=0                       # Set to 1 to store all chat threads
FULL_NODE_MEDIA=0                      # Set to 1 to cache all media entries
\`\`\`

### What Runs on Each Node

When you start a node, the following components run:

1. **Next.js application** -- UI, API routes, tRPC server, and WebSocket connections for real-time quote serving and updates
2. **Rust node-core microservice** (port 9100) -- 60+ endpoints handling PSBT validation, Ed25519 signing, AES-GCM encryption/decryption, Shamir secret sharing, scanner loops for mempool and block watching
3. **PostgreSQL 16 database** -- completely isolated per node. No shared database exists anywhere in the system. Protocol data is replicated via gossip, not database replication.
4. **Redis 7 instance** -- caching, rate limiting, real-time state, and pubsub for internal coordination
5. **WebSocket server** -- gossip mesh connections to peers, plus client-facing sockets for live price quotes

### Staking Economics

To join the network, you must bond a stake. The minimum stake follows a dynamic curve that increases as the network grows:

\`\`\`
minimumStake = minStakeUsd + (increment * nodeCount^0.75)
\`\`\`

This sub-linear curve means the cost of joining grows more slowly than the network itself. Early operators get in cheaply; later operators pay more but join a more valuable network.

| Parameter | Value |
|-----------|-------|
| Admission fee | 5% of stake (non-refundable, burned) |
| Cooldown period | 24 to 168 hours (governance-configurable) |
| Slashing | Bond at risk for provable misbehavior |
| Delegation | Delegates forfeit fees, accrue escalating cooldowns |

Delegates who exercise votes on behalf of delegators forfeit their own fee earnings and accumulate longer unstake cooldowns. This ensures delegation is a public service, not a profit center.

### Node Capabilities

Each node advertises its capabilities via \`/.well-known/agent\`. The protocol uses these to determine which nodes are eligible for specific roles:

| Capability | Description |
|------------|-------------|
| \`btc_mempool_watch\` | Monitors Bitcoin mempool for relevant transactions |
| \`btc_block_watch\` | Watches new Bitcoin blocks for confirmations |
| \`ord_index_read\` | Reads ordinal inscription and transfer data from \`ord\` |
| \`btc_psbt_share_store\` | Stores encrypted Shamir PSBT shards |
| \`btc_psbt_share_reveal\` | Reveals PSBT shards during settlement |
| \`protocol_validate\` | Runs \`validateSaleTx()\` and other protocol checks |
| \`protocol_attest\` | Signs witness attestations for transactions |
| \`gossip_relay\` | Relays protocol events to mesh peers |
| \`ui_quote_service\` | Serves real-time price quotes to frontend clients |

A node that lacks \`ord_index_read\` will never be selected as a witness for Bitcoin ordinal transactions. Capabilities are verified through PoA challenges -- you cannot fake them.

### Full-Node Mode

By default, nodes only store data they are responsible for via the shard ring. You can opt into storing everything:

- **\`FULL_NODE_CHAT=1\`** -- Store all chat threads instead of only your assigned shards
- **\`FULL_NODE_MEDIA=1\`** -- Cache all media entries instead of only your assigned shards

Full-node mode does NOT affect PSBT shard distribution. PSBT shards are always distributed via the Shamir 3-of-4 scheme to specific shard-holder nodes regardless of full-node settings.

Full-node mode increases storage requirements significantly but improves data availability and query performance for your node's users.

### Docker Deployment

The repository includes Docker Compose profiles for different deployment scenarios:

| Profile | What it starts |
|---------|---------------|
| \`infra\` | PostgreSQL + Redis only (for local development against existing code) |
| \`full\` | PostgreSQL + Redis + Node app + Rust node-core (complete node) |
| \`gateway\` | Front-door-gateway (stateless edge proxy, depends on cache only) |

### Development Commands

For local development and testing:

\`\`\`
# Start the full development environment
pnpm dev

# Start a local multi-node cluster (simulates network locally)
pnpm dev:cluster

# Chain-specific development modes
pnpm dev:btc     # Bitcoin-focused development with regtest
pnpm dev:evm     # EVM-focused development with local Hardhat/Anvil
pnpm dev:sol     # Solana-focused development with local validator
\`\`\`

### Joining the Network

1. Deploy the node software (all code is open source)
2. Configure your chain RPC endpoints and environment variables
3. Start the node and Rust node-core service
4. Submit a staking transaction (minimum bond + 5% admission fee)
5. Register via the \`NODE_ANNOUNCE\` protocol event (Ed25519 signed)
6. Pass Proof-of-Access challenges for each claimed capability
7. Begin receiving transaction assignments and gossip events
8. Participate in governance (1-Node-1-Vote on all proposals)

### Open Source

The node software is fully open source. You can inspect every line of code, verify every protocol rule, and propose improvements through governance. There is nothing proprietary. The entire marketplace runs on transparent, auditable code. All foundation actions are signed protocol events gossiped to every node and visible in the explorer.`,
  },

  {
    slug: "architecture",
    category: "Getting Started",
    categorySlug: "getting-started",
    title: "Architecture",
    description:
      "Deep dive into the system architecture: monorepo packages, dependency flow, node isolation, gossip mesh protocol, shard ring, binary wire format, neighbor selection, and Rust node-core internals.",
    icon: "layers",
    sortOrder: 3,
    content: `## Architecture

This page covers the full system architecture: how the monorepo is organized, how nodes communicate, how data is replicated and sharded, and what the Rust microservice does.

### Monorepo Structure

The codebase is organized into 8 packages and 2 services with strict dependency rules. No package may import from a package that depends on it (no circular dependencies).

**Packages:**

| Package | Dependencies | Purpose |
|---------|-------------|---------|
| \`protocol\` | None (zero framework deps) | Pure Zod schemas, 46 event types, deterministic validation logic, consensus rules |
| \`db\` | \`protocol\` | Drizzle ORM schemas, PostgreSQL 16 migrations, typed query helpers |
| \`agent\` | \`protocol\`, \`db\` | Gossip mesh networking, peer discovery, event propagation, WebSocket management |
| \`server\` | \`protocol\`, \`db\`, \`cache\`, \`config\` | Business logic, tRPC routers, API handlers, settlement orchestration |
| \`cache\` | None (standalone) | ioredis client, rate limiting, caching strategies, pubsub |
| \`config\` | None (standalone) | Environment validation, feature flags, node configuration schemas |
| \`cli\` | \`protocol\`, \`config\` | Command-line tooling for node operators |
| \`front-door-gateway\` | \`cache\` only | Stateless edge proxy, rate limiting, request routing |

**Services:**

| Service | Stack | Purpose |
|---------|-------|---------|
| \`node-core\` | Rust (Axum) | 60+ HTTP endpoints for PSBT operations, Ed25519 signing, AES-GCM encryption, Shamir splitting, scanner loops |
| \`benchmark-dashboard\` | TypeScript | Development performance dashboard with live JSON Lines streaming |

### Dependency Flow

The dependency graph is strictly acyclic:

\`\`\`
                    protocol
                   (zero deps)
                   /         \\
                  v           v
                db          config
              /    \\          |
             v      v         v
          agent   server <----+
            |       |
            v       v
               cache
                 |
                 v
        front-door-gateway
           (cache only)
\`\`\`

The \`protocol\` package sits at the root. It contains all 46 event type definitions, Zod schemas for validation, and deterministic logic (witness selection, fee calculation, threshold checks). Because it has zero dependencies, it can be used by any other package safely. It is also the package that gets version-locked for consensus -- all nodes must agree on the protocol version.

### Node Isolation

**There is no shared database.** This is a fundamental design constraint.

Each node runs its own PostgreSQL 16 instance with its own schemas and data. Nodes do not connect to each other's databases. There is no central database, no database replication, no read replicas shared between nodes.

How data consistency works without a shared database:

| Data Type | Replication Strategy |
|-----------|---------------------|
| Protocol events (listings, orders, attestations, votes) | Fully replicated via gossip -- every node stores every event |
| Chat messages | Sharded via rendezvous hashing -- each thread assigned to specific nodes |
| Media cache | Sharded via rendezvous hashing -- each entry assigned to specific nodes |
| PSBT shards | Shamir 3-of-4 distribution to specific shard-holder nodes |
| Node state (local) | Not replicated -- internal bookkeeping per node |

This isolation means a compromised node cannot tamper with another node's data. It also means the network has no single point of failure for storage.

### Binary Wire Protocol

Node-to-node communication uses a compact binary wire protocol with minimal overhead. Every message starts with a 1-byte type tag followed by the payload.

| Byte | Message Type | Direction | Purpose |
|------|-------------|-----------|---------|
| 0x01 | HELLO | Bidirectional | Initial handshake with Ed25519 pubkey and protocol version |
| 0x02 | HELLO_ACK | Response | Handshake acknowledgement with challenge nonce |
| 0x03 | AUTH_CHALLENGE | Request | Ed25519 signature challenge |
| 0x04 | AUTH_RESPONSE | Response | Signed challenge response |
| 0x05 | EVENT_NOTIFY | Push | Notify peer of a new event (hash + metadata) |
| 0x06 | EVENT_REQUEST | Pull | Request full event payload by hash |
| 0x07 | EVENT_PAYLOAD | Response | Full event data |
| 0x08 | HEARTBEAT | Bidirectional | Liveness and state vector exchange |
| 0x09 | PEER_LIST | Push | Share known peers for discovery |
| 0x0A | SHARD_STORE | Push | Store an encrypted PSBT shard |
| 0x0B | SHARD_REQUEST | Pull | Request a stored shard for reconstruction |
| 0x0C | SHARD_PAYLOAD | Response | Encrypted shard data |
| 0x0D | CHALLENGE_REQ | Request | PoA challenge for capability verification |
| 0x0E | CHALLENGE_RES | Response | PoA challenge answer |
| 0x0F | COHORT_JOIN | Push | Join a temporary session cohort |
| 0x10 | COHORT_MSG | Push | Message within a session cohort |
| 0x11 | COHORT_LEAVE | Push | Leave a session cohort |
| 0x12 | PING | Bidirectional | Keepalive |

The 18 message types (0x01 through 0x12) cover the full range of node interactions. The binary format avoids JSON parsing overhead for high-frequency messages like heartbeats and event notifications.

### Gossip Mesh

Nodes connect to each other over WebSocket at the \`/gossip\` endpoint. Every connection begins with Ed25519 authentication -- a node must prove it owns the private key corresponding to its announced public key.

**Event Propagation:**

The gossip protocol uses a push-pull model:

1. **Push (EVENT_NOTIFY):** When a node receives or creates a new event, it sends the event hash and metadata to its neighbors.
2. **Pull (EVENT_REQUEST):** A neighbor that does not have the event requests the full payload.
3. **Payload (EVENT_PAYLOAD):** The originating node sends the complete event.

This is more efficient than broadcasting full events because most neighbors already have most events. The push notification is small (just a hash), and the pull only happens when needed.

### K=6 Neighbor Selection

Each node maintains connections to exactly 6 neighbors, selected to balance network locality with resilience:

| Slot | Selection Strategy | Purpose |
|------|-------------------|---------|
| 3 close neighbors | Lowest latency from recent measurements | Fast propagation to nearby nodes |
| 2 mid-range neighbors | Moderate distance in the ID space | Bridge between clusters |
| 1 random neighbor | Uniformly random from all known nodes | Prevent network partitions |

This K=6 strategy ensures that the gossip mesh does not form disconnected clusters. The 3 close neighbors provide fast local propagation, the 2 mid-range neighbors bridge regions, and the 1 random neighbor provides a probabilistic guarantee against partitions.

Neighbors are periodically re-evaluated based on measured latency and liveness.

### Epidemic Heartbeats

Nodes exchange heartbeats to track liveness and synchronize state vectors. The heartbeat protocol uses epidemic (gossip-style) propagation:

\`\`\`
Convergence: O(log N) rounds for N nodes
TTL per heartbeat: max(4, ceil(ln(N)))
\`\`\`

Each heartbeat contains:
- The sending node's current state vector (which events it has seen)
- Timestamps for liveness tracking
- A TTL counter that decrements at each hop

With O(log N) convergence, a network of 1,000 nodes converges in roughly 7 rounds. The TTL formula \`max(4, ceil(ln(N)))\` ensures heartbeats propagate far enough to reach all nodes without flooding the network -- at 1,000 nodes the TTL is 7, at 10,000 nodes the TTL is 10.

### Shard Ring

Non-protocol data (chat threads, media cache) is distributed across nodes using rendezvous hashing (highest random weight):

\`\`\`
For a given data key and set of N nodes:
  For each node:
    weight = hash(key + nodeId)
  Sort nodes by weight descending
  Assign data to the top R nodes
\`\`\`

The replica count R is calculated as:

\`\`\`
R = min(3, ceil(N / 3))
\`\`\`

For a 9-node network, R = 3 (each chat thread is stored on 3 nodes). For a 4-node network, R = 2. This scales the redundancy with network size.

Rendezvous hashing has a key advantage over consistent hashing: when a node joins or leaves, only the data that hashes to that node needs to move. There is no cascading redistribution.

Operators can override the shard ring by enabling full-node mode (\`FULL_NODE_CHAT=1\`, \`FULL_NODE_MEDIA=1\`), which stores all data locally regardless of shard assignment. This does not affect PSBT shard distribution, which always uses the Shamir 3-of-4 scheme.

### Cohort Mesh

For time-sensitive session consensus (like PoW competition and attestation rounds), the protocol creates temporary direct WebSocket connections between participants:

1. When a session starts, the selected witnesses and PoW competitors establish direct connections to each other (COHORT_JOIN)
2. Session messages are exchanged directly within the cohort (COHORT_MSG), bypassing the gossip mesh for lower latency
3. When the session concludes, the cohort is dissolved (COHORT_LEAVE) and the results are propagated via the normal gossip mesh

This two-tier approach means the gossip mesh handles bulk event propagation (where O(log N) convergence is fine), while the cohort mesh handles time-critical consensus (where direct connections provide sub-second latency).

### Rust Node-Core

The \`node-core\` service is a Rust binary built on the Axum web framework. It runs on port 9100 by default and exposes 60+ HTTP endpoints consumed by the TypeScript layer.

**Why Rust?**

The operations handled by node-core are performance-critical and security-sensitive:

- **PSBT construction and validation** -- parsing and manipulating Bitcoin transactions requires exact byte-level correctness
- **Ed25519 signing and verification** -- all 46 event types must be signed, and signature verification is on the hot path for every incoming gossip message
- **AES-GCM encryption/decryption** -- PSBT shards are encrypted before distribution
- **Shamir secret sharing** -- splitting and reconstructing PSBT data requires modular arithmetic over finite fields
- **Scanner loops** -- mempool watching and block scanning run continuously and must be efficient

**Key Endpoint Categories:**

| Category | Examples | Count |
|----------|---------|-------|
| PSBT operations | Create, validate, split, reconstruct, sign | ~15 |
| Cryptography | Ed25519 sign/verify, AES-GCM encrypt/decrypt, Shamir split/combine | ~10 |
| Chain scanning | Mempool watch, block scan, confirmation tracking | ~8 |
| Protocol evaluation | Validate sale, compute fees, check thresholds | ~12 |
| Node management | Health checks, capability probes, metrics | ~8 |
| PoA challenges | Generate challenge, verify response | ~5 |

The TypeScript layer calls node-core via HTTP (\`RUST_NODE_CORE_URL\`). This clean separation means the Rust code handles cryptography and chain interaction while TypeScript handles business logic, API routing, and database operations.

### MPC Treasury Wallet

The network maintains a threshold wallet where the private key is split across ALL participating nodes using multi-party computation (MPC):

- **Threshold**: 67% of nodes (BFT standard, lowered from the original 80%)
- **No hot wallet**: The complete key never exists in one place
- **Weekly epoch batching**: Treasury operations are batched into weekly epochs to reduce coordination overhead
- **Auto-reshare on membership changes**: When nodes join or leave, the key shares are automatically redistributed without reconstructing the key
- **Emergency health-based reshare**: If too many nodes go offline, an emergency reshare is triggered with a 5-minute grace period
- **Sweep loop**: Runs every 15-30 seconds checking for pending treasury operations

In production, the foundation master node (Node-1) manually activates MPC keygen and the reward token. Full key distribution waits until sufficient decentralization is achieved.

### Foundation Transparency

Node-1 is the foundation master node with beta-phase veto and admin powers. However, all foundation actions are subject to full transparency:

- Every foundation action is a signed protocol event
- Events are gossiped to all nodes (same as any other event)
- All actions are visible in the protocol explorer
- No hidden operations are possible

A separate rewards MPC wallet at the same 67% BFT threshold handles automated claim payouts for node operator rewards. Claims are signature-based, not transfer-based -- the foundation treasury is auditable at all times.`,
  },
];
