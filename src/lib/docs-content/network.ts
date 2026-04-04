import type { DocEntry } from "./types";

export const NETWORK_DOCS: DocEntry[] = [
  {
    slug: "node-architecture",
    category: "Network",
    categorySlug: "network",
    title: "Node Architecture",
    description:
      "Isolated databases, mesh networking, consistent hash rings, and the 3-layer presence system. How nodes form a decentralized backend.",
    icon: "network",
    sortOrder: 40,
    content: `## Node Architecture

Every node is a complete, self-contained marketplace backend. There is no shared database -- ever. Each node maintains its own isolated PostgreSQL instance and its own Redis. Protocol data replicates via gossip; chat data is sharded via rendezvous hashing. This isolation model is the foundation of the network's decentralization guarantees.

### Complete Isolation Model

| Data Type | Replication Strategy |
|-----------|---------------------|
| Protocol events | Fully replicated via gossip to every node |
| Listings, orders, collections | Fully replicated via gossip |
| Profiles and reputation | Fully replicated via gossip |
| Governance state (proposals, votes, delegations) | Fully replicated via gossip |
| Chat messages and threads | Sharded via rendezvous hashing |
| Presence data | 3-layer priority system (local socket > remote broadcast > gateway hint) |
| Media cache entries | Sharded via separate media shard assignment |
| PSBT shares | Independent threshold scheme -- NOT affected by chat/media sharding |

Each node's PostgreSQL and Redis are entirely private. Nodes never connect to another node's database. All cross-node communication flows through the gossip mesh and WebSocket connections.

### Shard Ring

Chat data ownership is determined by rendezvous hashing:

\`\`\`
score = SHA256(nodeId + ":" + threadId)
topN  = sort all nodes by score descending
replicas = min(3, ceil(nodeCount / 3))
\`\`\`

- 1-3 nodes in the network: 1 replica (every node stores everything)
- 4-6 nodes: 2 replicas per thread
- 7+ nodes: 3 replicas per thread

The shard ring refreshes from the heartbeat table. Only nodes with a heartbeat within the last 5 minutes are included. The ring is cached for 30 seconds.

### Full-Node Mode

Operators can opt into storing all data locally instead of only their assigned shards:

| Environment Variable | Effect |
|---------------------|--------|
| \`FULL_NODE_CHAT=1\` | Node stores ALL chat threads regardless of shard assignment |
| \`FULL_NODE_MEDIA=1\` | Node stores ALL media cache entries regardless of shard assignment |

When full-node mode is active, \`isShardOwner\` returns true for the local node unconditionally. This is useful for archive nodes or operators who want local search across all conversations.

**Critical:** Full-node mode does NOT affect PSBT shard distribution. PSBT shares are controlled by the separate MPC threshold scheme and are never influenced by chat/media shard settings.

### What Runs on Each Node

Every node runs six processes:

1. **Next.js Application** -- UI serving, API routes, tRPC server, SSR
2. **Rust Node-Core** (port 9100) -- protocol evaluation, PSBT operations, scanner loops, gossip wire protocol
3. **PostgreSQL 16** -- isolated database, auto-migrated on startup
4. **Redis 7** -- caching, rate limiting, real-time state, pub/sub
5. **WebSocket Server** -- quote serving, real-time updates, gossip mesh endpoint
6. **Gossip Worker** -- event relay, peer exchange, heartbeat propagation, shard sync

### Database Schema Overview

Each node's PostgreSQL instance contains tables organized into six domains:

**Marketplace tables:** \`listings\`, \`orders\`, \`profiles\`, \`collections\`, \`media_cache\` -- all product and transaction data for the decentralized marketplace.

**Agent tables:** \`node_registry\`, \`agent_mesh\`, \`mesh_latency\`, \`agent_pools\` -- node identity, mesh topology measurements, and agent pool assignments.

**Governance tables:** \`proposals\`, \`votes\`, \`delegations\`, \`governance_config\` -- on-chain governance state including vote delegation relationships and proposal lifecycle.

**Realtime tables:** \`chat_threads\`, \`chat_messages\`, \`presence\`, \`typing_indicators\` -- sharded chat data and presence state.

**Rewards tables:** \`reward_claims\`, \`mpc_ceremonies\`, \`treasury_operations\`, \`epoch_snapshots\` -- signature-based reward distribution, MPC ceremony logs, and treasury audit trail.

**Protocol events:** \`protocol_events\` -- the complete event log. Every signed event gossiped through the network is stored here for full auditability.

### Startup Sequence

When a node boots, it follows this sequence:

1. **Runtime detection** -- detect environment (cluster vs single-node), configure connection pools
2. **Full-node setup** -- check \`FULL_NODE_CHAT\` and \`FULL_NODE_MEDIA\` env vars, configure shard ownership overrides
3. **Auto DB migration** -- run pending PostgreSQL migrations, create tables if missing
4. **Identity registration** -- register node in the local registry, announce to mesh
5. **MPC sweep loop** -- start the sweep loop (runs every 15-30 seconds) for pending PSBT operations
6. **Rate limit bridge** -- initialize Redis-backed rate limiting with token bucket algorithm
7. **Gossip worker start** -- connect to peers, begin heartbeat propagation

### Database Connection Pool

| Mode | Max Connections | Idle Timeout |
|------|----------------|--------------|
| Cluster mode | 4 connections | 5 seconds |
| Single-node mode | 10 connections | default |

Cluster mode uses a smaller pool because multiple replicas share the same PostgreSQL host. Single-node mode gets a larger pool since it has exclusive access.

### Scanner Loops

The Rust node-core runs continuous scanner loops to monitor on-chain activity:

- **Bitcoin mempool watch** -- detect relevant unconfirmed transactions
- **Bitcoin block watch** -- track confirmations and detect finality
- **EVM tx watch** -- monitor smart contract events on supported EVM chains
- **Finalization scanner** -- detect and record final settlement

### 3-Layer Presence System

User presence resolves through a priority system:

1. **Local socket** -- user is connected to this node directly (highest priority)
2. **Remote broadcast** -- another node reported the user online via gossip
3. **Gateway Redis hints** -- gateway-level presence cache (lowest priority, used as fallback)`,
  },

  {
    slug: "gateway",
    category: "Network",
    categorySlug: "network",
    title: "Gateway Front Door",
    description:
      "Stateless region-aware routing. How the gateway routes users to the fastest, closest nodes with health-aware cohort selection.",
    icon: "door-open",
    sortOrder: 41,
    content: `## Gateway Front Door

The Gateway is the entry point for users connecting to the marketplace. It is a stateless, region-aware, health-aware routing layer that directs users to the fastest, closest nodes without introducing a centralized dependency.

### Design Principles

- **Stateless.** The gateway holds no protocol state. It only routes.
- **Region-aware.** Prefers geographically closer nodes based on multiple geo signals.
- **Health-aware.** Continuously probes nodes and quarantines unhealthy ones.
- **Randomized.** Includes random slots to prevent concentration on a few nodes.
- **Redundant.** Multiple gateways can run independently with zero shared state.

### Routing Signals

The gateway considers seven signals when scoring nodes for cohort assignment, in descending priority:

| Signal | Description |
|--------|-------------|
| Region match | Same cloud region or data center as the user |
| Country match | Same country, determined by IP geolocation |
| Continent match | Same continent when country data is unavailable |
| Coordinates | Geographic distance calculation using lat/lng when available |
| Health probes | Node response time and availability from recent probes |
| Client hints | Browser-reported RTT and connection quality (\`Sec-CH-RTT\`, \`Sec-CH-Downlink\`) |
| Random jitter | Small random factor to prevent hot-spotting on a single "best" node |

Signals are combined into a weighted score. The gateway picks the highest-scoring nodes for the cohort, subject to the size constraints below.

### Cohort Selection

Users get assigned to a cohort of nodes that will serve their requests:

| Parameter | Value |
|-----------|-------|
| Minimum cohort size | 3 nodes |
| Target cohort size | ceil(N / 3) where N = total healthy nodes |
| Maximum cohort size | 8 nodes |
| Random slots | 1 (always included for diversity and partition resistance) |

The target of N/3 means roughly one-third of the network serves any given user. The random slot ensures no node is permanently excluded from any user's view.

### Node Health Probes

| Parameter | Value |
|-----------|-------|
| Probe interval | Every 15 seconds |
| Probe timeout | 1.5 seconds |
| Result cache TTL | 10 seconds |

Probes hit each node's health endpoint and record response time. Nodes that fail probes or exceed the timeout are marked unhealthy.

### Quarantine System

Unhealthy nodes enter quarantine with a TTL. While quarantined, a node is excluded from all cohort assignments. The quarantine TTL increases with repeated failures and resets after a node passes consecutive health checks. This prevents flapping nodes from degrading user experience.

### Capability Filtering

The gateway routes based on what capabilities are needed for the user's current transaction. If a user wants to buy a Bitcoin ordinal, the gateway filters for nodes with all required capabilities:

- \`btc_mempool_watch\` -- monitor mempool for the transaction
- \`btc_block_watch\` -- track confirmations
- \`ord_index_read\` -- verify ordinal inscription data
- \`btc_psbt_share_store\` -- hold PSBT shares during signing
- \`protocol_validate\` -- validate protocol events
- \`protocol_attest\` -- sign attestations as a witness

Only nodes advertising all required capabilities for the transaction type are included in the cohort.

### Hash Attestation

The gateway verifies that all nodes in a cohort serve the same release hash. On each probe, the node reports its build hash. If a node is serving a different version from the majority of the cohort, it gets excluded. This ensures users always get a consistent marketplace experience -- no mixed-version rendering or API mismatches.

### Rotation Strategy

- **Navigation rotation** -- the active node rotates within the cohort on page navigation, distributing load
- **Pending cohort** -- smooth transition when a new cohort is being computed; old cohort remains active until the new one is ready
- **Failover** -- automatic fallback to the next node in the cohort if the active node becomes unhealthy
- **Cache TTL** -- cohort assignments are cached with configurable TTL to avoid recomputation on every request

### Multiple Gateways

Any number of gateways can run independently:

- They share no state by default
- Optional shared Redis for cross-gateway probe caching (reduces redundant probes)
- No single point of failure -- if one gateway goes down, DNS or load balancer routes to another
- Geographic distribution reduces latency for users in different regions
- Each gateway makes independent routing decisions based on its own probes

### Network Discovery

The gateway exposes a \`/network/discover\` endpoint that returns the current list of known healthy nodes. This endpoint is used by:

- New nodes joining the network for initial peer discovery
- Existing nodes refreshing their peer list as a fallback
- External monitoring tools

The discovery response includes a genesis block hash for network identity verification. Nodes reject peers that report a different genesis hash, preventing cross-network contamination.`,
  },

  {
    slug: "explorer",
    category: "Network",
    categorySlug: "network",
    title: "Protocol Explorer",
    description:
      "Full protocol transparency. Every transaction, attestation, governance vote, and treasury action is visible in the public explorer.",
    icon: "telescope",
    sortOrder: 42,
    content: `## Protocol Explorer

The Protocol Explorer gives you full transparency into everything happening on the network. Every transaction, attestation, governance vote, and treasury action is recorded as a signed protocol event and displayed here.

### Explorer Sections

**Network Overview:**
Supported chains and their status, open/filled/cancelled listing counts, network fill rate, and active node count. Includes real-time metrics on gossip propagation latency and mesh health.

**Listings:**
All active and historical listings with collection filtering, status tracking (OPEN -> FILLED / CANCELLED), price history, and seller reputation scores.

**Transactions:**
Every purchase record with full details including settlement status, confirmation depth, witness attestations, fee distribution breakdown, and links to on-chain transactions.

**Nodes:**
Complete node registry with stake positions, bond amounts, benchmark scores (CPU, bandwidth, latency, disk), reputation, uptime metrics, and current shard assignments.

**Proof of Work:**
Round history with all participants, winner selection with work scores, challenge and solution details, fee distribution records, and round timing analysis.

**Sessions:**
Attestation records with witness quorum details, session lifecycle tracking, PoA challenge results per node, and challenge-response timing.

**Treasury:**
MPC wallet overview (treasury + rewards), threshold configuration, epoch frequency, batch timing, active spend proposals with vote tallies, and full withdrawal history.

**Governance:**
All proposals (past and present), voting power distribution, proposal status tracking (PROPOSED -> READY -> APPLIED), delegation relationships, burn voting results, and delegate activity history.

**Mesh:**
Network topology visualization, peer connections and latency measurements, shard ring assignments, message delivery metrics, and partition detection status.

### Search

The explorer has a global search that can query:

- Transaction hashes (BTC, EVM)
- Node public keys
- Listing outpoints
- Event IDs (protocol event log)
- Wallet addresses

### Event Detail View

Every protocol event can be expanded to show its full signed payload, the originating node's public key, the signature, propagation path through the mesh, and timestamp with receipt confirmations from other nodes.

### Audit Trail

Every foundation action shows up in the explorer. Treasury withdrawals, governance overrides, admin operations, beta veto exercises -- all of it. The foundation master node (Node-1) signs every action as a protocol event that is gossiped to all nodes and permanently recorded.

This is a complete, immutable audit trail. Anyone can verify that the foundation is acting within its stated powers. No action can be taken in secret.`,
  },

  {
    slug: "mesh-networking",
    category: "Network",
    categorySlug: "network",
    title: "Mesh Networking",
    description:
      "WebSocket gossip mesh with K=6 neighbor selection, peer discovery, routing tables, partition healing, and self-healing topology.",
    icon: "share-2",
    sortOrder: 43,
    content: `## Mesh Networking

The gossip mesh is the communication backbone of the network. Every node maintains WebSocket connections to a carefully selected set of neighbors, forming an overlay network optimized for low-latency message propagation and partition resistance.

### WebSocket Mesh

All mesh communication flows over WebSocket connections at the \`/gossip\` endpoint. The protocol is binary-framed with typed message envelopes.

### Authentication

Every gossip connection is authenticated on handshake:

1. The connecting node sends a signature of \`"gossip-auth:{timestamp}"\` using its Ed25519 private key
2. The receiving node verifies the signature against the sender's known public key
3. The timestamp must be within a 30-second window to prevent replay attacks
4. If verification fails, the connection is rejected immediately

### Ping / Pong

Active connections send a Ping frame every 20 seconds. The round-trip time (RTT) from each Pong response is recorded and used for:

- Neighbor selection scoring
- Routing table RTT fields
- Mesh rebalancing decisions
- Heartbeat \`avgRtt\` field propagation

### K=6 Neighbor Selection

Each node maintains exactly 6 neighbor connections, selected across three tiers to balance latency, reach, and resilience:

| Tier | Count | Selection Criteria |
|------|-------|--------------------|
| Close | 3 | Lowest effective RTT, scored as \`measuredRtt + hopCount * 50ms\` |
| Mid-range | 2 | Bridge nodes that connect different clusters in the topology |
| Random | 1 | Random selection from all known peers, rotated periodically |

The 3 close neighbors optimize for speed. The 2 mid-range neighbors ensure messages can cross cluster boundaries efficiently. The 1 random neighbor provides partition healing -- if the network splits, random connections are most likely to bridge the gap.

### Peer Discovery (4 Layers)

Nodes discover peers through four mechanisms, tried in order:

1. **Explicit peers** -- the \`GOSSIP_PEERS\` environment variable, a comma-separated list of WebSocket URLs. Used for bootstrapping known networks.
2. **Gateway discovery** -- query the gateway's \`/network/discover\` endpoint for the current list of healthy nodes.
3. **Cached DB peers** -- the local database stores previously seen peers from past sessions. Useful when the gateway is temporarily unreachable.
4. **Foundation fallbacks** -- hardcoded foundation node addresses. Last resort to ensure a node can always find at least one peer.

Each layer is tried only if the previous layer yielded insufficient peers.

### Peer Exchange

Every 60 seconds, each node sends a peer exchange message to its neighbors containing 20 peers selected as:

- 50% top peers (highest uptime, lowest latency)
- 50% random peers (from the full routing table)

This mix ensures high-quality peers propagate quickly while random selection prevents the network from converging on a small set of "popular" nodes.

### Routing Table

Every node maintains a routing table with an entry for each known peer:

| Field | Description |
|-------|-------------|
| \`nodeId\` | 16-byte unique node identifier |
| \`pubkey\` | Ed25519 public key for signature verification |
| \`wsUrl\` | WebSocket URL for direct connection |
| \`lastSeenAt\` | Timestamp of last heartbeat or direct message |
| \`measuredRtt\` | Directly measured round-trip time (from Ping/Pong) |
| \`reportedRtt\` | RTT reported by the peer in its heartbeat |
| \`hopCount\` | Number of hops from this node to the peer |
| \`isNeighbor\` | Whether this peer is one of the 6 active neighbors |

### Alive Threshold and Pruning

- A peer is considered alive if \`lastSeenAt\` is within the last **10 minutes**
- The routing table prune cycle runs every **60 seconds**
- Pruned peers are removed from the routing table but retained in the database for future peer exchange
- Nodes that reappear after pruning are re-added on their next heartbeat

### Mesh Rebalancer

The rebalancer runs every **5 minutes** by default, with adaptive timing between 2-10 minutes based on network stability:

1. Evaluate all current neighbors and candidate replacements
2. For each candidate, compute the effective RTT improvement over the worst current neighbor
3. Swap only if the improvement exceeds **10ms** (prevents oscillation)
4. Run BFS from the local node across the routing table to detect partitions
5. If a partition is detected, prioritize connections to nodes on the other side

The adaptive interval shortens to 2 minutes when the network is unstable (frequent node departures) and extends to 10 minutes when the topology is stable.

### Self-Healing

When a neighbor goes offline, the self-healing protocol activates:

1. **Adopt orphaned peers** -- take 1-2 of the dead node's known neighbors as new connections, preventing their isolation
2. **Broadcast NODE_OFFLINE** -- send a typed message to all remaining neighbors so they can update their routing tables
3. **Cooldown** -- wait 30 seconds before making further topology changes (prevents cascading reactions)
4. **Full rebalance** -- after 5 minutes, run a complete rebalance cycle to optimize the new topology

If multiple neighbors go offline simultaneously, the node processes them sequentially with the 30-second cooldown between each, then triggers a single full rebalance at the end.`,
  },

  {
    slug: "heartbeat-system",
    category: "Network",
    categorySlug: "network",
    title: "Heartbeat System",
    description:
      "25-byte heartbeat propagation with epidemic routing, adaptive TTL, and O(log N) convergence for network-wide liveness detection.",
    icon: "activity",
    sortOrder: 44,
    content: `## Heartbeat System

The heartbeat system is how nodes detect each other's liveness across the entire network. Each node periodically broadcasts a compact heartbeat message that propagates epidemically through the mesh, reaching all nodes in O(log N) rounds.

### Wire Format

Each heartbeat is exactly 25 bytes on the wire:

| Offset | Size | Field |
|--------|------|-------|
| 0 | 16 bytes | \`nodeId\` -- originator's unique identifier |
| 16 | 4 bytes | \`timestamp\` -- uint32 Unix epoch seconds |
| 20 | 1 byte | \`ttl\` -- remaining hop budget |
| 21 | 1 byte | \`hopCount\` -- hops from originator so far |
| 22 | 3 bytes | \`avgRtt\` -- originator's average RTT to neighbors (uint24, microseconds) |

The message type is \`0x10\` (\`HEARTBEAT_PROPAGATE\`).

### Origination

Each node originates a heartbeat every **30 seconds**. The heartbeat contains the node's own \`nodeId\`, the current timestamp, and the node's average measured RTT to its K=6 neighbors.

### TTL Calculation

The initial TTL is calculated adaptively based on network size:

\`\`\`
TTL = max(4, ceil(ln(N)))
\`\`\`

Where N is the number of nodes in the routing table. This ensures:

- Small networks (< 55 nodes): TTL = 4 (the minimum)
- Medium networks (55-400 nodes): TTL = 5-6
- Large networks (400+ nodes): TTL scales logarithmically

The logarithmic scaling means heartbeats reach the entire network without flooding it.

### Epidemic Propagation

Heartbeats propagate using epidemic (gossip) routing:

1. The originator sends the heartbeat to all K=6 neighbors
2. Each recipient decrements the TTL, increments the hopCount, and forwards to its own neighbors
3. This continues until TTL reaches 0
4. With K=6 and TTL=ceil(ln(N)), full convergence occurs in O(log N) rounds

Each round takes approximately one network hop (the RTT between neighbors). A heartbeat from any node reaches every other node in the network within a few hundred milliseconds for typical network sizes.

### Deduplication

To prevent heartbeat storms, each node maintains a deduplication map keyed by \`{originatorId}:{timestamp}\`:

- When a heartbeat arrives, its key is checked against the map
- If the key exists, the heartbeat is dropped (already processed)
- If the key is new, the heartbeat is processed and the key is added to the map
- The map has a maximum capacity of **10,000 entries**
- Entries are evicted oldest-first when the capacity is reached

At 30-second intervals with typical network sizes, the map stays well within capacity.

### Heartbeat Flush

Rather than writing every heartbeat to the database individually, nodes batch updates:

- Incoming heartbeat data is accumulated in memory
- Every **60 seconds**, all accumulated heartbeat data is flushed to PostgreSQL in a single batch operation
- This reduces database write load from potentially thousands of individual INSERTs to one bulk operation per minute

### Shard Ring Refresh

The heartbeat table directly drives the shard ring:

- Only nodes with a heartbeat timestamp within the last **5 minutes** are included in the shard ring
- The shard ring is cached with a **30-second TTL**
- When the cache expires, the ring is rebuilt from the heartbeat table
- Nodes that stop heartbeating are automatically excluded from shard ownership after 5 minutes

This creates a self-healing property: if a node goes offline, its shard responsibilities are automatically redistributed within 5 minutes without any manual intervention.`,
  },

  {
    slug: "data-sharding",
    category: "Network",
    categorySlug: "network",
    title: "Data Sharding",
    description:
      "Rendezvous hashing for chat threads, replica count scaling, media cache lifecycle, and the critical independence of PSBT shards.",
    icon: "layers",
    sortOrder: 45,
    content: `## Data Sharding

Not all data is replicated to every node. Chat messages and media cache entries are sharded across the network using rendezvous hashing to distribute storage and query load. Protocol data (listings, orders, governance) remains fully replicated.

### Chat Shard Ring

Chat threads are assigned to nodes using rendezvous hashing (also called highest random weight hashing):

\`\`\`
For each node in the ring:
  score = SHA256(nodeId + ":" + threadId)

Sort all nodes by score descending.
The top R nodes are shard owners for this thread.
\`\`\`

This approach has a critical advantage over consistent hashing: when a node joins or leaves, only the minimum number of threads need to be reassigned. There is no "virtual node" complexity.

### Replica Count

The number of replicas per thread scales with network size:

| Network Size | Replica Count | Formula |
|-------------|---------------|---------|
| 1-3 nodes | 1 | Every node stores everything |
| 4-6 nodes | 2 | \`ceil(4/3) = 2\` through \`ceil(6/3) = 2\` |
| 7+ nodes | 3 | \`min(3, ceil(N/3))\` caps at 3 |

The formula is \`min(3, ceil(nodeCount / 3))\`. Three replicas is the maximum -- increasing beyond this provides diminishing durability returns while significantly increasing storage and sync costs.

### Full-Node Override

When \`FULL_NODE_CHAT=1\` is set, the shard ownership check (\`isShardOwner\`) always returns true for the local node. This means:

- The node stores all chat threads, not just its assigned ones
- Incoming chat messages for any thread are persisted locally
- The node can serve queries for any thread without forwarding
- Useful for archive nodes, search indexers, or development

The node still participates in the shard ring normally from other nodes' perspective. Other nodes do not know (or care) that this node is in full-node mode.

### Media Sharding

Media cache entries are sharded separately from chat threads. A media entry's shard assignment is determined by its own shard key, independent of the chat thread it may be associated with.

The \`FULL_NODE_MEDIA=1\` environment variable works the same way as \`FULL_NODE_CHAT\` -- it overrides shard ownership so the node stores all media cache entries locally.

### Media Cache Lifecycle

Each media cache entry has a status that tracks its lifecycle:

| Status | Meaning |
|--------|---------|
| \`PENDING\` | Entry created, content not yet fetched or processed |
| \`READY\` | Content successfully cached and available for serving |
| \`ERROR\` | Fetch or processing failed (retryable) |
| \`TOO_LARGE\` | Content exceeded size limits, will not be cached |
| \`MISSING\` | Source content no longer available at origin |

### Media Kinds

Media entries are typed by kind:

| Kind | Description |
|------|-------------|
| \`IMAGE\` | JPEG, PNG, WebP, GIF, SVG |
| \`VIDEO\` | MP4, WebM |
| \`AUDIO\` | MP3, WAV, OGG |
| \`HTML\` | Embedded HTML content (previews, iframes) |
| \`MODEL\` | 3D model files (GLB, GLTF) |
| \`FILE\` | Generic file attachments |

### PSBT Shard Independence

**This is critical to understand:** PSBT (Partially Signed Bitcoin Transaction) shares are completely independent of the chat and media sharding system.

PSBT shares are distributed using the MPC threshold scheme:

- Share distribution is controlled by the MPC ceremony participants
- The threshold is set at 67% (BFT standard) of participating nodes
- Share assignment has NO relationship to \`SHA256(nodeId:threadId)\` or the shard ring
- \`FULL_NODE_CHAT\` and \`FULL_NODE_MEDIA\` have NO effect on PSBT share storage
- PSBT shares are stored in a separate table with their own distribution logic

Conflating PSBT shares with data shards is a common misconception. They are entirely separate systems with different distribution algorithms, different storage backends, and different security properties.`,
  },
];
