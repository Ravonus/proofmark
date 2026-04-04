import type { DocEntry } from "./types";

export const PROTOCOL_DOCS: DocEntry[] = [
  {
    slug: "protocol-truth",
    category: "Protocol",
    categorySlug: "protocol",
    title: "Protocol Truth",
    description:
      "The deterministic validation engine. How every node independently computes identical results from the same inputs with zero coordination.",
    icon: "shield-check",
    sortOrder: 10,
    content: `## Protocol Truth

Protocol Truth is the foundational guarantee of the network. Every node independently computes identical results from the same inputs. There is no coordinator, no leader election, no voting on what is "true." Truth is the deterministic output of pure computation over shared state.

This property eliminates an entire class of consensus failures. Nodes do not need to agree on what happened -- they each derive the same answer from the same evidence, independently.

### The Validation Engine: validateSaleTx()

The \`validateSaleTx()\` function is the core of the protocol. It accepts a transaction and its full context, then returns a deterministic verdict. Every node that runs this function over the same inputs will produce the same output, every time, without exception.

\`\`\`typescript
interface ValidationInput {
  tx: TransactionData;
  quote: SignedQuote;
  listing: ListingRecord;
  witnesses: WitnessSet;
  blockContext: BlockContext;
  protocolConfig: RuntimeConfig;
}

type Verdict = "VALID" | "INVALID";

const verdict: Verdict = validateSaleTx(input);
\`\`\`

### Validation Checks (in order)

The validator runs these checks sequentially. The first failure short-circuits and returns INVALID with a reason code. Order matters -- cheaper checks run first.

1. **Protocol Version Match** -- The event must declare protocol version \`"mvp-1"\`. Any mismatch is an immediate rejection. This prevents cross-version contamination during upgrades.

2. **Validator Version Match** -- The validator version embedded in the transaction must match the version running on the evaluating node. Nodes that have not upgraded will correctly reject events produced by newer validators, preventing split-brain during rolling deploys.

3. **Quote Signature Verification** -- The \`SignedQuote\` attached to the transaction must carry a valid Ed25519 signature from the serving node. The signature covers the canonical JSON of the quote payload. Invalid or missing signatures are rejected outright.

4. **Quote Expiration Check** -- The quote has a configurable TTL (default: 15 minutes). If the current block timestamp exceeds \`quote.issuedAt + ttl\`, the quote is expired and the transaction is invalid. This prevents replay attacks with stale quotes.

5. **Release Hash Consensus** -- The serving node's release hash (a SHA-256 digest of the running binary) must match the network-consensus release hash stored in the governance config. Nodes running unauthorized or modified code cannot produce valid quotes.

6. **Listing Status Validation** -- The referenced listing must be in OPEN status and must not have passed its expiration timestamp. Delisted, sold, or expired listings cannot be purchased.

7. **Asset Outpoint Verification** -- For BTC transactions, the asset outpoint (txid:vout) referenced in the listing must appear in the transaction inputs. This proves the seller is actually spending the correct UTXO. For EVM/SOL chains, equivalent ownership proofs are checked.

8. **Witness Set Verification** -- The witness set attached to the transaction must exactly match the deterministic selection for this session. Witnesses are selected via \`SHA256(seed + pubkey)\` ranking (see Witness Selection). Any deviation in the witness set invalidates the transaction.

9. **Witness Count Minimum** -- The number of attesting witnesses must meet or exceed the supermajority threshold: \`ceil(2/3 * witnessCount)\`. A transaction with too few attestations cannot finalize.

10. **Fee Distribution Verification** -- The transaction outputs must match the governance fee split with basis-point precision. Every satoshi/lamport/wei must land in the correct address. The validator recomputes the split independently and compares.

11. **Seller Payout Verification** -- After fees, the seller must receive exactly the correct amount. The validator independently computes \`salePrice - totalFees\` and verifies the output matches.

### Fee Computation

Fees are computed with basis-point precision (1 basis point = 0.01%). No floating-point arithmetic is used. All fee math uses integer basis-point multiplication followed by deterministic rounding.

\`\`\`
totalFee = (salePrice * feeBps) / 10000
foundationShare = (totalFee * foundationBps) / 10000
winnerShare = totalFee - foundationShare
sellerPayout = salePrice - totalFee
\`\`\`

| Parameter | Default | Governance Range |
|-----------|---------|------------------|
| Marketplace fee | 200 bps (2.00%) | 50 -- 500 bps |
| Foundation share | 5000 bps (50% of fee) | 3000 -- 7000 bps |
| Winner/agent share | 5000 bps (50% of fee) | 3000 -- 7000 bps |

The foundation and winner shares are complementary -- they must sum to 10000 bps (100% of the fee). Governance votes can shift the split within the allowed range.

### Protocol Version

The current protocol version is \`"mvp-1"\`. This string is embedded in every protocol event and every validation context. Version mismatches cause immediate rejection.

Validator versioning is separate from protocol versioning. The validator version tracks the implementation revision. Two nodes can run different validator versions and still agree on protocol truth, as long as both correctly implement the same protocol version.

### Canonical JSON and Deterministic Hashing

All protocol data that gets hashed or signed must first be serialized to canonical JSON. The canonical form is defined in \`packages/protocol/src/hash.ts\`:

- Keys are sorted lexicographically at every nesting level
- No extraneous whitespace (no pretty-printing)
- Numbers use their minimal JSON representation
- No undefined values (stripped before serialization)

This produces a deterministic byte string for any given object, regardless of insertion order or runtime quirks.

Hashing uses SHA-256 from the \`@noble/hashes\` library (a zero-dependency, audited implementation). The hash is computed over the UTF-8 bytes of the canonical JSON string and output as a lowercase hex digest.

\`\`\`typescript
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

function canonicalHash(obj: unknown): string {
  const json = canonicalStringify(obj);
  return bytesToHex(sha256(new TextEncoder().encode(json)));
}
\`\`\`

### LLM Advisory Layer

The protocol includes an optional LLM advisory layer that generates risk notes for listings and transactions. These notes are stored in the \`llmRiskNotes\` table and surfaced in the UI as informational warnings.

Critical rule: LLM risk notes are **NON-CONSENSUS**. They never affect validation verdicts. They are never included in hashed payloads. They are never part of attestation data. Only deterministic code decides protocol truth.

Examples of advisory notes:
- "This collection has unusual transfer patterns"
- "Price is significantly below floor"
- "Seller has no transaction history"

Nodes may run different LLM models or disable the advisory layer entirely. This has zero effect on protocol correctness.

### Rust Node-Core Parity

The critical validation paths run in both TypeScript and a Rust microservice (\`node-core\`). The Rust implementation is a line-by-line port of the TypeScript protocol logic:

\`\`\`
POST /v1/protocol/truth/evaluate   -- Full validateSaleTx()
POST /v1/protocol/validate         -- Individual check execution
POST /v1/witness/select            -- Deterministic witness selection
POST /v1/fees/split                -- Fee computation
\`\`\`

Both runtimes must produce identical results for identical inputs. The integration test suite runs every validation scenario against both runtimes and diffs the outputs. Any divergence is a release-blocking bug.

The Rust runtime is used for performance-critical paths (batch validation, replay). The TypeScript runtime is the reference implementation. When in doubt, TypeScript is authoritative.`,
  },

  {
    slug: "witness-selection",
    category: "Protocol",
    categorySlug: "protocol",
    title: "Witness Selection & Attestation",
    description:
      "How witnesses get picked using deterministic seeded selection with SHA-256 ranking. Unpredictable assignment that prevents front-running and collusion.",
    icon: "eye",
    sortOrder: 11,
    content: `## Witness Selection & Attestation

For every transaction, a set of independent nodes are selected to verify and attest. The selection is deterministic but unpredictable. You cannot collude if you do not know who will be picked, and you cannot know who will be picked until a future blockchain block is finalized.

### The Selection Algorithm

Witnesses are selected by computing a SHA-256 ranking score for every eligible candidate, then taking the top N:

\`\`\`typescript
function selectWitnesses(
  seed: string,
  candidates: NodeRecord[],
  count: number,
): NodeRecord[] {
  return candidates
    .filter(c => c.pubkey !== uiAgentPubkey)   // UI agent never witnesses
    .filter(c => !c.suspended)                  // Struck nodes excluded
    .filter(c => c.stakeAmount >= minStake)     // Must be bonded
    .map(c => ({
      node: c,
      rank: sha256(seed + c.pubkey),            // Deterministic score
    }))
    .sort((a, b) => a.rank.localeCompare(b.rank))
    .slice(0, count)
    .map(r => r.node);
}
\`\`\`

### Seed Construction

The seed combines two values that are both unknown at the time the session begins:

\`\`\`
seed = sessionCommitHash + nextBlockHash
\`\`\`

- **sessionCommitHash**: The SHA-256 hash of the SESSION_COMMIT event, which includes the buyer's intent and a timestamp.
- **nextBlockHash**: The hash of the next Bitcoin block after session creation. This is unknown to all parties at session creation time.

Because the seed depends on a future block hash, no participant can predict or influence the witness selection. The hosting node, the buyer, the seller -- none of them know who will be selected until the block confirms.

### Witness Scaling Formula

The number of witnesses scales logarithmically with total network size. This balances security (more witnesses = harder to corrupt) against overhead (fewer witnesses = faster finalization):

\`\`\`
witnessCount = floor(3.50 * ln(N) - 1.50)
\`\`\`

Where N is the number of eligible (non-suspended, bonded) nodes. The result is clamped to the range [3, 20].

| Network Size (N) | Raw Formula | Clamped Result |
|-------------------|-------------|----------------|
| 3 nodes | 2.34 | 3 (minimum) |
| 5 nodes | 4.13 | 4 |
| 10 nodes | 6.56 | 6 |
| 20 nodes | 8.99 | 8 |
| 50 nodes | 12.19 | 12 |
| 100 nodes | 14.61 | 14 |
| 200 nodes | 17.04 | 17 |
| 500 nodes | 20.23 | 20 (maximum) |
| 1000 nodes | 22.66 | 20 (maximum) |

The minimum of 3 ensures Byzantine fault tolerance even in tiny networks (3 witnesses can tolerate 1 dishonest node). The maximum of 20 caps overhead -- beyond 500 nodes, adding more witnesses provides diminishing security returns.

### Supermajority Threshold

Settlement requires a supermajority of witnesses to attest the same verdict:

\`\`\`
threshold = ceil((2/3) * witnessCount)
\`\`\`

| Witness Count | Supermajority Needed | Can Tolerate |
|---------------|---------------------|--------------|
| 3 | 2 | 1 faulty |
| 6 | 4 | 2 faulty |
| 10 | 7 | 3 faulty |
| 14 | 10 | 4 faulty |
| 20 | 14 | 6 faulty |

A minority of compromised witnesses cannot force an invalid transaction through. With BFT-standard 2/3 supermajority, up to 1/3 of witnesses can be faulty or malicious without affecting correctness.

### Attestation Flow

1. A purchase session is created, producing a SESSION_COMMIT event.
2. The next blockchain block confirms, providing the second seed component.
3. Every node independently computes the witness set from the seed.
4. Each selected witness independently runs \`validateSaleTx()\` on the transaction.
5. Each witness signs their verdict (VALID or INVALID) with their Ed25519 key.
6. TX_ATTESTATION events are gossiped across the network.
7. When supermajority VALID attestations are collected, a TX_FINALIZED event is emitted.
8. If supermajority is not reached within the timeout window, the session expires.

### Misbehavior Detection and Strikes

The protocol distinguishes between dishonesty and downtime. This distinction is critical.

**Wrong attestation (strike-worthy):** A witness signs VALID for a transaction that is provably invalid (or vice versa). Other nodes can independently verify the correct verdict and prove the witness was wrong. This earns a strike.

**Timeout (not strike-worthy):** A witness fails to respond within the attestation window. The witness is excluded from the current session's tally, but does not receive a strike. Downtime is an infrastructure problem, not dishonesty. The protocol punishes lying, not being offline.

### Strike Escalation

Strikes accumulate and trigger escalating suspensions:

| Strike Count | Suspension Duration |
|--------------|-------------------|
| 1st strike | 24 hours |
| 2nd strike | 72 hours (3 days) |
| 3rd strike | 168 hours (7 days) |
| 4th strike | Permanent ban |

During suspension, a node is excluded from witness selection and earns no fees. After the 4th strike, the node is permanently banned from the network and must re-register with a new identity (losing all reputation and stake history).

### Strike Decay

Strikes are not permanent (except the 4th). Clean behavior causes strikes to decay:

- **Decay rate:** 1 strike removed per 30 days of clean operation
- **Clean operation:** No new strikes during the decay period
- **Reset on new strike:** The 30-day clock resets if a new strike is earned

A node with 2 strikes that operates cleanly for 60 days returns to 0 strikes. A node that earns a 3rd strike at day 29 resets the clock and still has 3 strikes.`,
  },

  {
    slug: "event-system",
    category: "Protocol",
    categorySlug: "protocol",
    title: "Event System & Gossip",
    description:
      "The gossip protocol and event-driven state replication. All 46 event types, signing, propagation, sync, and data retention.",
    icon: "radio",
    sortOrder: 12,
    content: `## Event System & Gossip Protocol

The event system is the backbone of the network. Every state change -- listings, purchases, attestations, governance votes, MPC ceremonies, everything -- is captured as a signed protocol event and replicated across all nodes via gossip. The event log is the single source of truth. Database tables are materialized views over the event stream.

### Event Structure

Every protocol event follows a common envelope:

\`\`\`typescript
interface ProtocolEvent {
  id: string;           // UUIDv4, unique per event
  kind: EventKind;      // One of 46 event types
  actor: string;        // Ed25519 public key of the emitter
  payload: unknown;     // Event-specific structured data
  signature: string;    // Ed25519 signature (hex-encoded)
  timestamp: number;    // Unix milliseconds (UTC)
  hash: string;         // SHA-256 of canonical JSON payload
  protocolVersion: string; // "mvp-1"
}
\`\`\`

### Event Signing

Every event is signed by the emitting node's Ed25519 key. The signing process:

1. Serialize the event payload (excluding \`signature\` and \`hash\`) to canonical JSON (sorted keys, no whitespace).
2. Compute the SHA-256 hash of the canonical JSON bytes.
3. Sign the hash with the node's Ed25519 private key.
4. Attach both the \`hash\` and \`signature\` to the event.

Any node can verify any event by re-canonicalizing the payload, recomputing the hash, and checking the signature against the actor's known public key. Tampered events are detected and discarded.

### All 46 Event Types

#### Agent Events (3)

| Kind | Description |
|------|-------------|
| \`AGENT_ANNOUNCE\` | Node announces itself to the network with its capabilities, version, and endpoints |
| \`AGENT_REGISTER\` | Node formally registers and bonds stake to become an active participant |
| \`AGENT_HEARTBEAT\` | Periodic liveness signal broadcast to neighbors (default: every 30 seconds) |

#### Marketplace Events (9)

| Kind | Description |
|------|-------------|
| \`LISTING_CREATE\` | A new listing is published (includes asset data, price, expiration) |
| \`LISTING_DELIST\` | Seller removes a listing from the marketplace |
| \`ORDER_INTENT\` | Buyer declares intent to purchase (pre-session) |
| \`BTC_PURCHASE_SUBMITTED\` | A Bitcoin purchase transaction has been broadcast |
| \`EVM_PURCHASE_SUBMITTED\` | An EVM-chain purchase transaction has been broadcast |
| \`SOL_PURCHASE_SUBMITTED\` | A Solana purchase transaction has been broadcast |
| \`TX_OBSERVED\` | A witness observes the transaction on-chain |
| \`TX_ATTESTATION\` | A witness signs and publishes their validation verdict |
| \`TX_FINALIZED\` | Supermajority reached -- transaction is settled |

#### PoW Fee Competition Events (7)

| Kind | Description |
|------|-------------|
| \`POW_ROUND_PREPARE\` | Hosting node broadcasts sealed challenge (ciphertext + commitment hash) |
| \`POW_ROUND_ACK\` | Participant acknowledges readiness for the round |
| \`POW_ROUND_LOCKED\` | Participant set is finalized, no more entries accepted |
| \`POW_ROUND_START\` | Cluster beacon computed from node contributions -- challenge is decryptable, work begins |
| \`POW_ROUND_COMMIT\` | Participant publishes their score commitment (hash of nonce + score) |
| \`POW_ROUND_REVEAL\` | Participant reveals their actual nonce and score |
| \`POW_ROUND_FINALIZED\` | Round is settled -- winner determined by lowest valid score |

#### Governance Events (10)

| Kind | Description |
|------|-------------|
| \`MISBEHAVIOR_PROOF\` | Evidence of witness misbehavior (wrong attestation with proof) |
| \`RUNTIME_CONFIG_VOTE_CAST\` | Node votes on a governance parameter change |
| \`NODE_FEE_WALLETS_UPDATED\` | Node updates its fee-receiving wallet addresses |
| \`NODE_STAKE_UPDATED\` | Node's staked amount has changed (deposit or withdrawal) |
| \`NODE_BENCHMARK_SUBMITTED\` | Node publishes its benchmark results for performance ranking |
| \`NODE_DELEGATE_STATUS_CHANGED\` | Node toggles its delegate availability on or off |
| \`NODE_DELEGATION_CHANGED\` | A delegator assigns or revokes delegation to a delegate |
| \`REWARD_CLAIM_CREATED\` | A reward claim is initiated for earned fees |
| \`REWARD_CLAIM_SIGNED\` | The MPC wallet co-signs a reward claim payout |
| \`MODERATION_VOTE_CAST\` | Node votes on a content moderation action |
| \`FOUNDATION_TREASURY_TX\` | Foundation executes a treasury transaction (fully transparent) |

#### MPC Ceremony Events (11)

| Kind | Description |
|------|-------------|
| \`MPC_CEREMONY_PREPARE\` | Coordinator initiates a new DKG or signing ceremony |
| \`DKG_COMMITMENT\` | Participant publishes their Feldman VSS commitment |
| \`DKG_SHARE_EXCHANGE\` | Participant distributes encrypted key shares to peers |
| \`DKG_VERIFICATION\` | Participant confirms received shares are consistent |
| \`CEREMONY_FINALIZED\` | DKG complete -- public key derived, shares distributed |
| \`SIGN_NONCE_COMMIT\` | Signing participant commits to a nonce (hash of R-value) |
| \`SIGN_NONCE_REVEAL\` | Signing participant reveals their actual nonce |
| \`SIGN_PARTIAL\` | Signing participant contributes their partial signature |
| \`RESHARE_OLD_SHARE\` | Existing holder re-shares their key material to updated set |
| \`CLAIM_EPOCH_UPDATED\` | Reward claim epoch boundary has advanced |
| \`TREASURY_SPEND_PROPOSED\` | A treasury spend is proposed for governance approval |

#### Realtime Events (4)

| Kind | Description |
|------|-------------|
| \`PROFILE_ANNOUNCED\` | User announces or updates their public profile |
| \`CHAT_THREAD_OPENED\` | A new direct-message thread is opened between buyer and seller |
| \`NODE_MESH_PING\` | Low-level mesh connectivity probe between neighbors |
| \`RATE_LIMIT_VIOLATION\` | Node detected and logged a rate-limit breach from a peer |

#### Release Events (1)

| Kind | Description |
|------|-------------|
| \`RELEASE_MANIFEST_SEEN\` | Node has observed and validated a new release manifest |

#### Session Events (3)

| Kind | Description |
|------|-------------|
| \`SESSION_COMMIT\` | Purchase session is committed with buyer intent and timestamp |
| \`UI_SESSION_QUOTE\` | UI agent produces a signed quote for the session |
| \`UI_SESSION_ATTESTATION\` | UI agent attests to the session parameters it served |

### Gossip Propagation

Events propagate through the network using a push/pull model:

**Push (WebSocket):** When a node creates or receives a new valid event, it immediately pushes a 33-byte notification to all connected neighbors via the binary wire protocol (0x04 EVENT_NOTIFY + 32-byte hash). Neighbors that do not have the event pull the full payload.

**Pull (HTTP fallback):** Nodes that missed push notifications (due to disconnection, restart, or partition) catch up via HTTP sync:

\`\`\`
GET /api/gossip/sync?since=<timestamp>&limit=250
\`\`\`

Sync is paginated at 250 events per page. The response includes a \`nextCursor\` for continuation. Nodes can filter by event kind to prioritize critical events during catch-up.

**Pull on reconnect:** When a node reconnects to a neighbor, it immediately initiates a sync from its last-known cursor. This ensures no events are lost during network partitions.

### Data Retention Tiers

Not all events are stored forever. The protocol defines three retention tiers:

**Tier 1 -- Permanent:** Events that define protocol state and must be replayable forever.
- LISTING_CREATE, LISTING_DELIST
- TX_ATTESTATION, TX_FINALIZED
- All governance events (votes, stake changes, config changes)
- All MPC ceremony events
- FOUNDATION_TREASURY_TX
- MISBEHAVIOR_PROOF

**Tier 2 -- Retention-bounded:** Events kept for a configurable retention window (default: 90 days), then pruned.
- ORDER_INTENT
- BTC/EVM/SOL_PURCHASE_SUBMITTED
- TX_OBSERVED
- POW_ROUND_* (all PoW phases)
- SESSION_COMMIT, UI_SESSION_QUOTE, UI_SESSION_ATTESTATION
- REWARD_CLAIM_CREATED, REWARD_CLAIM_SIGNED

**Tier 3 -- Ephemeral:** Events used for real-time coordination only. Not persisted after processing.
- AGENT_HEARTBEAT
- NODE_MESH_PING
- RATE_LIMIT_VIOLATION
- PROFILE_ANNOUNCED
- CHAT_THREAD_OPENED

### Event Projection

Events are projected into materialized state tables. The event log is always authoritative -- if a table disagrees with the event log, the table is wrong and must be rebuilt:

\`\`\`
Event Log (source of truth)
  |
  v
Projectors
  |
  +---> Listing state (OPEN, SOLD, DELISTED, EXPIRED)
  +---> Order state (PENDING, ATTESTING, FINALIZED, FAILED)
  +---> UTXO tracking (spent/unspent)
  +---> Node registry (active, suspended, banned)
  +---> Governance config (current parameter values)
  +---> MPC key state (ceremony status, share assignments)
  +---> Delegation graph (who delegates to whom)
  +---> Strike ledger (per-node misbehavior history)
\`\`\`

### Replay

The entire protocol state can be reconstructed by replaying events from genesis. Deterministic replay means the same events always produce the same state, regardless of timing or order of receipt. The Rust node-core provides efficient batch replay:

\`\`\`
POST /v1/events/replay
{
  "fromSequence": 0,
  "toSequence": "latest",
  "batchSize": 1000
}
\`\`\`

### Foundation Transparency

All foundation actions -- treasury withdrawals, governance overrides, admin operations, parameter changes -- are signed protocol events gossiped to every node and visible in the public explorer. There is no off-chain authority. Everything is on the record, verifiable by anyone running a node.`,
  },

  {
    slug: "wire-protocol",
    category: "Protocol",
    categorySlug: "protocol",
    title: "Wire Protocol",
    description:
      "The binary wire protocol for node-to-node communication. 18 message types, byte layouts, and design philosophy for minimal gossip overhead.",
    icon: "cpu",
    sortOrder: 13,
    content: `## Wire Protocol

The binary wire protocol defines how nodes communicate at the lowest level. Every WebSocket frame between peers uses this compact binary format. The design prioritizes minimal overhead -- gossip-heavy networks cannot afford JSON bloat on every hop.

### Design Philosophy

- **Minimal bytes on the wire.** Most messages are under 50 bytes. A heartbeat is a single byte.
- **Push notifications are tiny.** Event notifications are 33 bytes (1 type byte + 32-byte hash). The full event payload is only transferred on demand.
- **No JSON in the hot path.** JSON is used for event payloads (which are hashed and signed), but the gossip plumbing itself is pure binary.
- **Fixed-size headers.** Every message starts with a 1-byte type code. Parsers branch on the first byte with zero lookahead.

### Message Types

All 18 message types, their hex codes, and byte layouts:

| Code | Name | Payload Size | Description |
|------|------|-------------|-------------|
| \`0x01\` | HEARTBEAT | 0 bytes | Keepalive ping. No payload. Sent every 30s. |
| \`0x02\` | MESH_RTT | 2 bytes | Round-trip-time measurement. Payload: uint16 RTT in milliseconds. |
| \`0x03\` | PRESENCE_UPDATE | variable | Node presence state change (online, idle, busy). Includes node ID and status byte. |
| \`0x04\` | EVENT_NOTIFY | 32 bytes | Notification that a new event exists. Payload: SHA-256 hash of the event. Triggers pull if unknown. |
| \`0x05\` | EVENT_REQUEST | 32 bytes | Request full event data by hash. Payload: SHA-256 hash of the desired event. |
| \`0x06\` | EVENT_DATA | variable (gzipped) | Full event payload, gzip-compressed. Response to EVENT_REQUEST. |
| \`0x07\` | SYNC_CURSOR | 8 bytes | Sync position announcement. Payload: uint64 timestamp cursor (Unix ms). |
| \`0x08\` | SYNC_HASHES | variable | Batch of event hashes for sync comparison. Array of 32-byte hashes. |
| \`0x09\` | AUTH | variable | Authentication handshake. Contains Ed25519 public key + signed challenge. |
| \`0x0A\` | AUTH_ACK | 1 byte | Authentication acknowledgment. Payload: 0x01 (success) or 0x00 (failure). |
| \`0x0B\` | PEER_EXCHANGE_REQ | 0 bytes | Request the neighbor's known peer list. |
| \`0x0C\` | PEER_EXCHANGE_RES | variable | Response with known peers. Array of (pubkey, endpoint) pairs. |
| \`0x0D\` | COHORT_ASSIGN | variable | Cohort membership assignment from coordinator. |
| \`0x0E\` | COHORT_ACK | 1 byte | Acknowledgment of cohort assignment. |
| \`0x10\` | HEARTBEAT_PROPAGATE | 25 bytes | Propagated heartbeat from a non-neighbor. 1-byte hop count + 24-byte node fingerprint + timestamp. |
| \`0x11\` | NODE_OFFLINE | 32 bytes | Notification that a node has gone offline. Payload: pubkey hash of the departed node. |
| \`0x12\` | NEIGHBOR_ADOPT_REQ | 32 bytes | Request to adopt a peer as a direct neighbor. Payload: pubkey hash. |

### Event Propagation Flow

When a node creates a new protocol event, the propagation follows this sequence:

1. Node serializes and signs the event (canonical JSON + Ed25519).
2. Node computes the 32-byte SHA-256 hash.
3. Node sends \`0x04 EVENT_NOTIFY\` (33 bytes total) to all direct neighbors.
4. Each neighbor checks if it already has this hash in its event store.
5. If unknown, the neighbor sends \`0x05 EVENT_REQUEST\` (33 bytes) back.
6. The originator responds with \`0x06 EVENT_DATA\` (gzipped full payload).
7. The neighbor validates the event (signature, schema, hash).
8. If valid, the neighbor stores the event and sends \`0x04 EVENT_NOTIFY\` to its own neighbors (excluding the sender).

This push-notify-then-pull pattern means that a single event propagating through a 100-node network generates approximately 100 x 33 = 3.3 KB of notification traffic, plus N full-payload transfers (where N is the number of unique nodes that actually need the event, typically all of them exactly once).

### Authentication Handshake

When two nodes first connect via WebSocket:

1. Initiator sends \`0x09 AUTH\` with its Ed25519 public key and a signed timestamp challenge.
2. Responder verifies the signature and checks the timestamp is within a 30-second window.
3. Responder sends \`0x0A AUTH_ACK\` with 0x01 (success) or 0x00 (rejection).
4. On success, the responder sends its own \`0x09 AUTH\` for mutual authentication.
5. Both sides confirm with \`0x0A AUTH_ACK\`.
6. The connection is now authenticated and ready for gossip.

Unauthenticated connections cannot send or receive any message type except AUTH and AUTH_ACK.

### Sync Recovery

When a node reconnects after downtime, it uses the cursor-based sync protocol:

1. Node sends \`0x07 SYNC_CURSOR\` with its last-known timestamp.
2. Peer responds with \`0x08 SYNC_HASHES\` -- a batch of event hashes since that cursor.
3. Node checks which hashes it is missing.
4. Node sends \`0x05 EVENT_REQUEST\` for each missing hash.
5. Peer responds with \`0x06 EVENT_DATA\` for each.
6. Process repeats with updated cursor until fully caught up.

This is the WebSocket equivalent of the HTTP \`/api/gossip/sync\` endpoint, but operates over the persistent binary channel for lower latency.`,
  },

  {
    slug: "pow-fee-competition",
    category: "Protocol",
    categorySlug: "protocol",
    title: "PoW Fee Competition",
    description:
      "The 8-phase proof-of-work fee competition protocol. Memory-hard puzzles, sealed challenges, cluster beacons, and how the winner is determined.",
    icon: "zap",
    sortOrder: 14,
    content: `## PoW Fee Competition

When a buyer wants to purchase a listing, nodes compete for the right to facilitate the sale and earn the fee. The competition uses an 8-phase proof-of-work protocol designed to be provably fair. No node has an advantage based on its position in the network, its relationship to the buyer, or its ability to see challenges early.

### Why PoW?

The fee competition must satisfy several constraints simultaneously:

- **No hosting-node advantage.** The node that hosts the listing cannot see the challenge before others.
- **No front-running.** Nodes cannot submit solutions after seeing others' answers.
- **Deterministic winner.** Every node agrees on who won without voting.
- **Sybil resistance.** Running more nodes does not help (each node must independently solve a memory-hard puzzle).
- **Verifiable.** Any node can verify the winning solution offline.

### The 8 Phases

#### Phase 1: PREPARE

The hosting node creates a sealed challenge. The challenge itself is encrypted -- nobody, including the hosting node, can derive the actual work input yet because it depends on a cluster beacon that has not been computed.

The PREPARE event contains:
- \`ciphertext\`: The encrypted challenge data (AES-256-GCM)
- \`commitmentHash\`: SHA-256 hash of the plaintext challenge, proving the hosting node committed before the beacon
- \`sealedKey\`: A random value used as part of beacon derivation

\`\`\`
POW_ROUND_PREPARE {
  roundId: string;
  sessionId: string;
  ciphertext: string;       // Encrypted challenge
  commitmentHash: string;   // SHA-256 of plaintext
  sealedKey: string;        // Random contribution to beacon
  timestamp: number;
}
\`\`\`

#### Phase 2: ACK (Unanimous Barrier)

Every eligible node that wants to participate sends a POW_ROUND_ACK. This phase serves as a barrier -- the round does not advance until all declared participants have acknowledged.

If a node does not ACK within the timeout window (default: 10 seconds), it is excluded from the round. This is not punished (no strike), but the node forfeits its chance to compete.

#### Phase 3: LOCK

The participant set is locked. After this point, no new entrants are accepted. The LOCK event lists the final set of participants by public key, creating a deterministic participant roster that all nodes agree on.

#### Phase 4: START (Beacon Computation)

Each node checks in with its own random \`startShare\`. Once all check-ins are collected, the cluster beacon is computed deterministically:

\`\`\`
roundBeacon = SHA256(JSON.stringify({
  ackSetHash,
  beaconContributions,   // All nodes' startShares
  cohortHash,
  requestCommit,
  roundId,
}))

challenge = SHA256(roundId + requestCommit + cohortHash + roundBeacon + difficultyProfileId)
\`\`\`

Every participant independently computes the same beacon from the same inputs. The work window starts at a wall-clock time derived from check-in completion plus a configurable grace period (default 250ms). The hosting node gains zero advantage because the beacon depends on contributions from ALL participants -- no single node controls it.

#### Phase 5: WORK (Computation)

Each participant solves a hash puzzle using the current difficulty profile (\`sha256_best_of_window_v1\`):

\`\`\`
Input:   challenge + participant_pubkey + nonce
Output:  256-bit score (lower is better)
Window:  POW_WORK_WINDOW_MS (default 5000ms, max 120s)
\`\`\`

The participant tries different nonces within the work window to find the lowest possible score. Each participant's input includes their own public key, so solutions are non-transferable. A node cannot use another node's work.

The protocol schema also supports memory-hard profiles (Argon2id, 64 MB, 3 iterations) for future use, but the current implementation uses SHA256 best-of-window for faster rounds.

There is no explicit event for this phase -- it is pure local computation.

#### Phase 6: COMMIT (Before Work Window Closes)

Before the work window closes (wall-clock \`workStopAt\` timestamp), each participant must commit to their best result:

\`\`\`
POW_ROUND_COMMIT {
  roundId: string;
  participant: string;        // Public key
  scoreCommitment: string;    // SHA-256(nonce + score)
  timestamp: number;
}
\`\`\`

This is a sealed commitment. The actual nonce and score are hidden behind the hash. Participants cannot change their answer after seeing others' commitments.

#### Phase 7: REVEAL

After all commitments are collected (or the timeout expires), each participant reveals their actual nonce and score:

\`\`\`
POW_ROUND_REVEAL {
  roundId: string;
  participant: string;
  nonce: string;
  score: string;
  timestamp: number;
}
\`\`\`

Every node independently verifies:
1. The revealed nonce + score hash matches the previously committed hash.
2. The score is valid by re-running Argon2id with the given nonce.

Mismatches (committed hash does not match reveal) result in disqualification from the round.

#### Phase 8: FINALIZE

The round settles. The winner is the participant with the lowest valid score. Every node independently computes this from the reveal data, so no voting or coordination is needed.

\`\`\`
POW_ROUND_FINALIZED {
  roundId: string;
  sessionId: string;
  winner: string;            // Public key of winner
  winningScore: string;
  participants: number;
  timestamp: number;
}
\`\`\`

The winner earns the right to facilitate the sale and receive the winner's share of the marketplace fee.

### Security Properties

**Sealed challenges with commitment:** The hosting node commits to the challenge before the beacon is computed. It cannot change the challenge to favor itself after seeing the beacon.

**Cluster beacons eliminate timing advantage:** The beacon is derived from random contributions (startShares) from ALL participating nodes. No single node controls the beacon value, and the challenge cannot be known until all nodes have checked in. Start and stop times are wall-clock timestamps derived deterministically from check-in completion.

**Memory-hard puzzles resist acceleration:** Argon2id with 64 MB and 3 iterations requires real memory allocation per attempt. GPU farms and ASICs provide minimal advantage over commodity hardware.

**Non-transferable work:** Each participant's puzzle input includes their own public key. Solutions cannot be shared, pooled, or delegated.

**Commit-reveal prevents front-running:** Participants commit scores before seeing others' results. The reveal phase only confirms what was already locked in.

**Deterministic winner selection:** The lowest valid score wins. Every node computes this independently from the same reveal data. No coordinator needed.`,
  },
];
