import type { DocEntry } from "./types";

export const SECURITY_ARCHITECTURE_DOCS: DocEntry[] = [
  {
    slug: "proof-of-access",
    category: "Security & Verification",
    categorySlug: "security",
    title: "Proof of Access",
    description:
      "Chain verification challenges. How nodes prove real-time RPC access to supported blockchains through deterministic historical state queries.",
    icon: "lock",
    sortOrder: 30,
    content: `## Proof of Access (PoA)

Proof of Access ensures every node in a quorum has real-time access to the blockchain it claims to support. Without PoA, a node could fake attestations by parroting answers from honest peers.

### Deterministic Challenge Derivation

All challenges are derived deterministically so every node in a quorum produces the same challenge set independently. The seed formula:

\`\`\`
challengeSeed = SHA256("poa-challenge-v1|{chain}|{seed}|{windowStart}")
\`\`\`

**Time windowing:** challenges operate on 60-second intervals. The window start is computed as \`floor(now / 60) * 60\` (Unix epoch seconds). This means all nodes querying within the same 60s window derive identical challenges without coordination.

The seed feeds into per-challenge offset derivation:

\`\`\`
blockOffset = challengeSeed[0..4] mod 900 + 100   // 100 to 1000 blocks back
inscriptionOffset = challengeSeed[4..8] mod 10000  // 10,000 recent inscriptions
\`\`\`

Nodes cannot pre-cache answers because the seed incorporates the time window and chain-specific entropy. But any node can independently verify the derivation.

### Challenge Types per Chain

**Bitcoin (5 challenges, highest bar):**

Bitcoin requires the most challenges because ordinal trading depends on two separate infrastructure components: a full BTC node and an \`ord\` indexer.

| # | Type | Source | What It Verifies |
|---|------|--------|------------------|
| 1 | \`current_item\` | BTC RPC | UTXO status of the item being traded |
| 2 | \`current_chain_event\` | BTC RPC | Best block hash at query time |
| 3 | \`historical_chain_event\` | BTC RPC | Block hash 100-1000 blocks back |
| 4 | \`current_ordinal_event\` | Ord indexer | Inscription content hash for a recent inscription |
| 5 | \`historical_ordinal_event\` | Ord indexer | Inscription data from the 10,000 recent inscriptions range |

**Ethereum (3 challenges):**

| # | Type | What It Verifies |
|---|------|------------------|
| 1 | \`BLOCK_HASH\` | Block hash at a historical height (100-1000 blocks back) |
| 2 | \`TX_DATA\` | Transaction receipt from a historical block |
| 3 | \`ACCOUNT_STATE\` | Balance or storage slot at a historical block |

**Solana (3 challenges):**

| # | Type | What It Verifies |
|---|------|------------------|
| 1 | \`BLOCK_HASH\` | Slot hash for a recent confirmed slot |
| 2 | \`ACCOUNT_STATE\` | Account data at a recent slot |
| 3 | \`TX_DATA\` | Transaction signature history |

### Historical Block Range

Challenge block offsets are always between 100 and 1000 blocks behind the current tip. This range is chosen deliberately:

- **100 minimum** prevents challenges that could be answered from mempool data or unconfirmed state.
- **1000 maximum** ensures standard pruned nodes can still answer (most prune beyond 1000).
- **Ordinal inscription range** covers the 10,000 most recent inscriptions, which requires an actively synced \`ord\` indexer.

### Over-Subscription

When forming a quorum, the protocol invites **1.5x** the required number of nodes plus a small fixed extra count. This absorbs timeouts and infrastructure failures without restarting the entire round. Only the fastest correct responders are selected into the final quorum.

### Scoring and Misbehavior

- **Correct answer**: the node passes and is eligible for quorum selection.
- **Wrong answer**: recorded as a misbehavior strike. Wrong answers indicate either a desynchronized chain or deliberate malice. Accumulated strikes feed into the governance misbehavior system and can result in slashing.
- **Timeout**: the node is excluded from this quorum but receives no strike. Timeouts indicate infrastructure issues, not malicious intent.
- **Critical distinction**: this separation prevents honest nodes with temporary connectivity problems from being penalized the same way as actively malicious nodes.

### Quorum Formation

A quorum forms exclusively from nodes that passed all PoA challenges for the relevant chain. The fastest correct responders (within the over-subscribed pool) are selected. Every attesting node has independently verified the transaction using its own RPC connection. No delegation, no shortcuts.

### Why This Matters

Without PoA, a colluding minority could run lightweight nodes without real chain access, copy attestations from honest nodes, and participate in quorums without performing real verification. PoA makes that impossible because each challenge requires data that can only be obtained by querying the actual blockchain at the specified historical point.`,
  },

  {
    slug: "proof-of-work",
    category: "Security & Verification",
    categorySlug: "security",
    title: "Proof of Work Fee Competition",
    description:
      "The 8-phase sealed PoW protocol that determines which node earns transaction fees. Uses cluster beacons derived from all participants, not coordinators.",
    icon: "cpu",
    sortOrder: 31,
    content: `## Proof of Work Fee Competition

Every transaction has a fee. Instead of giving it to a random node or whoever responds first, the protocol runs a sealed Proof-of-Work competition to determine who earns it. No hosting-node advantage. No coordinator discretion. A cluster beacon derived from all participants' random contributions provides the start signal.

### 8-Phase Protocol

#### Phase 1: PREPARE
The requesting node broadcasts a sealed request containing a ciphertext and commitment hash. Nobody knows the actual challenge yet. The commitment binds the requester to a specific challenge without revealing it.

#### Phase 2: ACK
All selected nodes must acknowledge the exact same sealed round. This is a unanimous barrier: every participant sees identical starting conditions or the round aborts. Any disagreement halts the process immediately.

#### Phase 3: LOCK
The participant set is locked. No late joiners can enter after this phase. The locked set is hashed and included in the challenge derivation.

#### Phase 4: START
Each node checks in with a random \`startShare\`. The cluster beacon is computed as \`SHA256(ackSetHash + allStartShares + cohortHash + requestCommit + roundId)\`. Since every node contributes entropy, no single node can predict or control the beacon. The work window starts at a wall-clock time derived from check-in completion plus a grace period.

#### Phase 5: WORK
Nodes solve a hash puzzle (\`sha256_best_of_window_v1\`) using the beacon-derived challenge. The work window is bounded by a wall-clock stop time (default 5 seconds, max 120 seconds). Nodes iterate nonces to find the lowest score.

#### Phase 6: COMMIT
Before the work window closes, each node broadcasts their best score along with peer receipts. The committed score is what counts for ranking, not submission speed.

#### Phase 7: REVEAL
After all commitments are collected, nodes reveal their winning nonce. The revealed nonce must reproduce the score committed in Phase 6. Any mismatch disqualifies the node.

#### Phase 8: FINALIZE
The winner is determined deterministically: lowest valid committed score wins. Ties are broken by lexicographic hash ordering. The result is verifiable by any observer.

### Security Properties

| Threat | Mitigation |
|--------|------------|
| Hosting-node advantage | Sealed challenge + unanimous ACK barrier |
| Coordinator discretion | Cluster beacon from all nodes' random shares determines challenge |
| Pure latency win | Committed score beats first-response |
| Replay attacks | Per-round unique challenge derivation |
| Late entry | Participant set locked at LOCK phase |
| Fake scores | Reveal must match commit |
| Grinding attacks | Memory-hard Argon2id prevents ASIC optimization |
| Score withholding | Commit deadline enforced by wall-clock stop time |

### Puzzle Profile

\`\`\`
Algorithm:    Argon2id
Memory:       64 MB
Iterations:   3
Parallelism:  1
Output:       32 bytes
\`\`\`

The puzzle is compute-bound and memory-hard. The 64 MB memory requirement makes it resistant to ASIC and GPU optimization while remaining feasible on standard server hardware.

### Winner Determination

\`\`\`
winner = nodes
  .filter(n => n.revealMatchesCommit)
  .filter(n => n.commitBeforeDeadline)
  .sort((a, b) => a.score - b.score || a.hash.localeCompare(b.hash))
  [0]  // Lowest valid score wins
\`\`\`

### Rogue Node Detection

Nodes that submit invalid reveals, commit after the work window closes, or produce scores that do not match their nonce are flagged as rogue. Rogue detection is deterministic: any honest node can independently verify whether a participant violated the protocol. Detected rogue behavior feeds into the misbehavior strike system.

### Fee Distribution

The PoW winner receives the full agent share of the marketplace fee (1% of sale price). Witnesses attest without separate fee outputs. Their incentive is maintaining their bonded position and reputation within the network.`,
  },

  {
    slug: "release-verification",
    category: "Security & Verification",
    categorySlug: "security",
    title: "Release Verification",
    description:
      "Client-side release verification. How users verify they are running authentic marketplace code without trusting any server.",
    icon: "file-check",
    sortOrder: 32,
    content: `## Release Verification

Release verification ensures users are running authentic, untampered marketplace code. All verification happens client-side using browser crypto APIs. No trusted server is needed.

### Manifest and Signature

Every release ships with two artifacts:

1. **Manifest**: a JSON document listing every served asset and its SHA-256 hash.
2. **Signature**: an Ed25519 signature over the canonical (deterministically serialized) manifest.

The release public key is published in the repository and well-known endpoints. Nodes pin this key and reject manifests signed by unknown keys.

### Client-Side Verification Flow

The browser performs these checks without any server trust:

\`\`\`typescript
async function verifyReleaseManifestClient(
  manifest: ReleaseManifest,
  signature: Uint8Array,
  publicKey: CryptoKey
) {
  // 1. Parse and validate manifest schema
  const parsed = ReleaseManifestSchema.parse(manifest);

  // 2. Canonical serialization (deterministic key ordering)
  const canonicalManifest = canonicalJSON(parsed);

  // 3. Verify Ed25519 signature against release public key
  const isValid = await crypto.subtle.verify(
    "Ed25519", publicKey, signature,
    new TextEncoder().encode(canonicalManifest)
  );
  if (!isValid) throw new Error("Invalid release signature");

  // 4. Hash the manifest payload for cross-node comparison
  const manifestHash = await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(canonicalManifest)
  );

  // 5. Fetch each asset and verify its hash individually
  for (const asset of parsed.assets) {
    const response = await fetch(asset.path);
    const assetBytes = await response.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", assetBytes);
    if (toHex(hash) !== asset.expectedHash) {
      throw new Error("Asset tampered: " + asset.path);
    }
  }
}
\`\`\`

### Network Consensus on Releases

Nodes track release manifests via \`RELEASE_MANIFEST_SEEN\` protocol events:

1. When a node detects a new release, it broadcasts a \`RELEASE_MANIFEST_SEEN\` event containing the manifest hash and its own signature.
2. All nodes record which release hash each peer is serving.
3. **Strict mode**: consensus requires all nodes to serve the same release hash. Nodes serving a different hash are flagged.
4. The marketplace UI includes a \`ReleaseGuard\` component that warns users immediately if a mismatch is detected between the serving node and network consensus.

### UI Integrity

Session attestation (see Node Authentication) binds the served content hash to the serving node identity. If a node serves tampered UI assets, the attestation will not match what other nodes expect, and clients can detect the discrepancy.

### Self-Verification

Because the marketplace is fully open source, any participant can:

1. Clone the repository and build from source.
2. Compute SHA-256 hashes of all build artifacts.
3. Compare those hashes against the signed release manifest.
4. Run their own node to serve verified code.
5. Inspect every line of the protocol validation engine.

### Security Guarantees

- **No trusted server.** All verification uses browser-native crypto APIs (Web Crypto).
- **Canonical serialization.** Deterministic JSON key ordering prevents order-dependent tampering.
- **Full asset verification.** Every served file (JS bundles, CSS, images) is individually hash-checked.
- **Public key pinning.** The release signing key is published and embedded in well-known endpoints.
- **Consensus enforcement.** Nodes serving incorrect hashes are flagged via gossip protocol events.
- **Tamper detection.** Any modification to any single byte of any served asset is caught.`,
  },

  {
    slug: "mpc-treasury-security",
    category: "Security & Verification",
    categorySlug: "security",
    title: "MPC Treasury Security",
    description:
      "Threshold signature scheme for treasury wallets. Key shares, DKG ceremonies, emergency reshare, and multi-chain signing without ever reconstructing the private key.",
    icon: "key",
    sortOrder: 33,
    content: `## MPC Treasury Security

The marketplace treasury uses a Multi-Party Computation (MPC) threshold signature scheme. The private key is split across all participating nodes and is **never reconstructed** at any point, not even during signing.

### Threshold Signature Scheme

Each node holds a key share derived from a Distributed Key Generation (DKG) ceremony. To produce a valid signature:

1. Each participating node computes a **partial signature** using its key share.
2. Partial signatures are combined via **Lagrange interpolation** over the signing group.
3. The result is a standard ECDSA (secp256k1 for BTC/ETH) or Ed25519 (for SOL) signature indistinguishable from one produced by a single signer.

No single node, and no subset below the threshold, can sign independently.

### Default Threshold

The threshold is set at **2/3 BFT standard (6667 basis points)**, with a minimum of 2 signers. For a 9-node network, the threshold is 6. This matches the Byzantine Fault Tolerance bound: the network can tolerate up to 1/3 faulty or malicious nodes.

### Two Wallet Types

| Wallet | Threshold | Purpose |
|--------|-----------|---------|
| Treasury | 67%+ of nodes | Primary marketplace funds, listing escrow |
| Rewards | 67%+ of nodes | Automated reward claim payouts |

Both wallets use the standard BFT threshold (67%) to ensure consistent security guarantees across all MPC operations. This prevents a compromised rewards wallet from being exploited at a lower threshold than the treasury.

### Three MPC Ceremonies

#### 1. Distributed Key Generation (DKG)

Generates a shared public key and individual key shares without any trusted dealer.

\`\`\`
Phase flow:
  PREPARE -> COMMITMENT -> SHARE_EXCHANGE -> VERIFICATION -> FINALIZED
\`\`\`

- **PREPARE**: coordinator broadcasts participant list and parameters.
- **COMMITMENT**: each node generates a random polynomial and broadcasts commitments (SHA-256 hashes of coefficients).
- **SHARE_EXCHANGE**: nodes exchange encrypted shares derived from their polynomials.
- **VERIFICATION**: each node verifies received shares against published commitments.
- **FINALIZED**: all nodes derive the shared public key. Individual shares are stored encrypted.

#### 2. Key Reshare

Redistributes key shares to a new participant set while preserving the same public key. Old shares are cryptographically invalidated.

\`\`\`
Phase flow:
  PREPARE -> COMMITMENT -> SHARE_EXCHANGE -> VERIFICATION -> FINALIZED
\`\`\`

Same phase structure as DKG, but the old share holders act as dealers for the new set. After reshare completes, the previous shares cannot produce valid partial signatures.

#### 3. Signing

Produces a threshold signature over a transaction digest.

\`\`\`
Phase flow:
  PREPARE -> NONCE_COMMIT -> NONCE_REVEAL -> PARTIAL -> FINALIZED
\`\`\`

- **PREPARE**: coordinator distributes the message digest and selects signing participants.
- **NONCE_COMMIT**: each signer generates a random nonce and broadcasts a commitment.
- **NONCE_REVEAL**: nonces are revealed and verified against commitments.
- **PARTIAL**: each signer produces a partial signature using their key share and the combined nonce.
- **FINALIZED**: partial signatures are combined via Lagrange interpolation to produce the final signature.

### Share Storage

Key shares are encrypted at rest using **AES-256-GCM**. Each share file includes:

- The encrypted share bytes.
- A **SHA-256 commitment** of the plaintext share for integrity verification.
- The DKG round identifier and participant index.

Shares are never written to disk in plaintext. The encryption key is derived from node-specific secrets.

### Emergency Reshare

An emergency reshare triggers automatically when more than **15% of nodes** go offline. The protocol:

1. Detects health degradation via heartbeat monitoring.
2. Waits a **5-minute grace period** to avoid resharing on transient failures.
3. If the threshold is still at risk after the grace period, initiates reshare with the currently healthy node set.
4. Old shares from departed nodes are invalidated.

This prevents a slow leak of offline nodes from eventually dropping below the signing threshold.

### Multi-Chain Wallet Support

| Chain | Curve | Signature Scheme |
|-------|-------|-----------------|
| Bitcoin | secp256k1 | ECDSA |
| Ethereum | secp256k1 | ECDSA |
| Solana | Ed25519 | EdDSA |

Each chain has its own MPC wallet instance with independent key shares. A single DKG ceremony produces shares for one curve. Multi-chain support requires separate ceremonies per curve.

### Key Safety Invariants

- The full private key is never assembled in memory, on disk, or in transit.
- Partial signatures from fewer than threshold nodes reveal nothing about the key.
- Reshare invalidates all previous shares while preserving the public key.
- Each ceremony phase requires explicit acknowledgment from all participants before advancing.
- Failed ceremonies abort cleanly without leaving partial state.`,
  },
];
