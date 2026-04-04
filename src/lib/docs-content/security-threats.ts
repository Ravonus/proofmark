import type { DocEntry } from "./types";

export const SECURITY_THREATS_DOCS: DocEntry[] = [
  {
    slug: "psbt-security",
    category: "Security & Verification",
    categorySlug: "security",
    title: "PSBT Security",
    description:
      "Shamir secret sharing for PSBT distribution. GF(256) field arithmetic, AES-GCM encryption, manifest validation, reveal challenges, and race condition protection.",
    icon: "split",
    sortOrder: 34,
    content: `## PSBT Security

Partially Signed Bitcoin Transactions (PSBTs) are the atomic unit of Bitcoin ordinal trades. Because a PSBT contains enough information to complete a transaction, it must be protected during distribution to quorum nodes. The protocol uses Shamir's Secret Sharing to ensure no single node (or insufficient subset) can reconstruct the PSBT independently.

### Shamir's Secret Sharing over GF(256)

The sharing scheme operates over the Galois Field GF(256) using the irreducible polynomial \`0x1b\`. All arithmetic (addition, multiplication, inversion) happens in this finite field, which provides the information-theoretic security guarantee.

**Information-theoretic security**: given T-1 shares (where T is the threshold), an attacker learns absolutely nothing about the secret. This is not computational security -- it holds even against an adversary with unbounded computing power.

### Distribution Process

1. Generate a random **256-bit AES-GCM key**.
2. **Encrypt** the PSBT payload using AES-256-GCM with this key.
3. **Split** the AES key into N shares using Shamir's Secret Sharing with threshold T.
4. **Distribute** one encrypted PSBT copy and one key share to each quorum participant.

The default configuration is **3-of-4 threshold**: 4 shares are created, and any 3 can reconstruct the AES key to decrypt the PSBT. This tolerates 1 node failure while preventing any pair of colluding nodes from accessing the PSBT.

### Manifest Validation

Every PSBT distribution includes a manifest that is validated before shares are accepted:

- **Unique participants**: no duplicate node IDs in the share recipient list.
- **Share count**: the number of shares matches the declared participant count.
- **Commitment verification**: each share includes a SHA-256 commitment that is verified on receipt.
- **Threshold bounds**: threshold T must satisfy \`2 <= T <= N\`.

### PSBT Reveal Challenges

When a quorum needs to reconstruct the PSBT (at transaction finalization), nodes must respond to reveal challenges:

- Each challenge is **Ed25519 signed** by the requesting node.
- Challenges include a **unique nonce** to prevent replay.
- Challenges have a **30-second TTL** -- expired challenges are rejected.
- Challenge IDs are tracked for **dedup** -- the same challenge cannot be answered twice.

A node only reveals its share in response to a valid, non-expired, non-duplicate challenge from an authorized quorum participant.

### Bitcoin Ordinal PSBT Validation

For ordinal trades, the PSBT structure is validated against specific sighash requirements:

- Seller inputs use \`ANYONECANPAY | SIGHASH_SINGLE\` to allow buyer inputs to be added without invalidating the seller signature.
- This sighash combination is mandatory for ordinal PSBTs and is enforced during PSBT construction and validation.

### Race Condition Protection

A critical failure mode in PSBT distribution is partial delivery: some nodes receive their shares while others do not, leaving the transaction in an unrecoverable state. The protocol addresses this with:

- **Atomic distribution**: shares are distributed in a coordinated round with acknowledgment from all recipients before the round is considered complete.
- **Retry logic**: failed deliveries are retried with exponential backoff within the distribution window.
- **Coverage validation**: the coordinator verifies that all required participants have acknowledged receipt before advancing the transaction state.
- **Timeout handling**: if coverage cannot be achieved within the distribution window, the entire round is aborted and can be retried cleanly.

### Full-Node Mode Isolation

Nodes running in full-node mode (storing all chat threads and media cache) do **not** gain access to PSBT shards outside their assigned quorum. PSBT share distribution is strictly scoped to quorum membership, regardless of the node storage configuration.`,
  },

  {
    slug: "node-authentication",
    category: "Security & Verification",
    categorySlug: "security",
    title: "Node Authentication",
    description:
      "Ed25519 node-to-node authentication, HTTP signature headers, gossip auth, session attestation, and TX-plan quorum witness verification.",
    icon: "shield",
    sortOrder: 35,
    content: `## Node Authentication

All node-to-node communication is authenticated using Ed25519 signatures. There is no shared secret, no TLS client certificates, and no central authority. Each node has a persistent Ed25519 keypair that serves as its network identity.

### Cryptographic Primitives

| Component | Library | Purpose |
|-----------|---------|---------|
| Ed25519 signatures | TweetNaCl.js (libsodium-compatible) | All node signatures |
| SHA-256 hashing | @noble/hashes | Body hashing, commitments |
| JSON serialization | Canonical JSON (sorted keys) | Deterministic message encoding |

### HTTP Request Authentication

Every node-to-node HTTP request includes three headers:

\`\`\`
X-Node-Pubkey:    <hex-encoded Ed25519 public key>
X-Node-Timestamp: <Unix epoch milliseconds>
X-Node-Signature: <hex-encoded Ed25519 signature>
\`\`\`

The signature covers a canonical string constructed as:

\`\`\`
signedPayload = "\${method}:\${pathname}:\${timestamp}:\${bodyHash}"
\`\`\`

Where \`bodyHash\` is the SHA-256 hex digest of the request body (or empty string for bodyless requests).

**Replay protection**: the receiving node rejects any request where the timestamp is more than **30 seconds** from the receiver's clock. This bounds the replay window without requiring synchronized clocks beyond NTP accuracy.

**Body binding**: including the body hash in the signed payload prevents an attacker from intercepting a signed request and substituting a different body.

### Gossip Authentication

Gossip protocol messages use a simplified auth scheme:

\`\`\`
signature = Ed25519.sign("gossip-auth:{timestamp}")
\`\`\`

The gossip auth signature is attached to every gossip message and verified by each receiving peer. The timestamp provides the same 30-second replay window as HTTP auth.

### Session Attestation

When a node serves UI content to a client, it produces a session attestation that binds the served content to the serving node and the current cohort:

\`\`\`
attestationInput = hash(
  sorted(cohortNodeIds) +
  contentHash +
  requestPath +
  servingNodeId +
  timestamp
)
\`\`\`

The attestation is signed by the serving node and can be verified by any other node in the cohort. If a node serves tampered content, its attestation will not match what peers expect for the same content hash.

### TX-Plan Quorum Witness Verification

Transaction plans require **2/3 witness agreement** before execution. The witness verification process:

1. The transaction plan is broadcast to all quorum members.
2. Each witness independently verifies the plan against its own chain state (via PoA-verified RPC).
3. Witnesses sign their attestation with their Ed25519 key.
4. The coordinator collects attestations and verifies that at least 2/3 of quorum members agree.
5. If fewer than 2/3 agree, the transaction is aborted.

**Rogue node detection**: if a witness signs contradictory attestations (approving and rejecting the same plan, or approving different plans for the same round), this is flagged as rogue behavior. The detection is deterministic and verifiable by any node holding both conflicting attestations.

### Key Management

- Node keypairs are generated once and persist across restarts.
- Public keys are exchanged during node registration and propagated via gossip.
- There is no key rotation protocol yet; key compromise requires re-registration.
- All signature verification is strict: malformed signatures, unknown public keys, and expired timestamps result in immediate rejection with no fallback.`,
  },

  {
    slug: "rate-limiting",
    category: "Security & Verification",
    categorySlug: "security",
    title: "Rate Limiting",
    description:
      "Sliding window rate limiting with escalation, per-tier limits, gossip-propagated blocklists, and token bucket implementation for anti-abuse protection.",
    icon: "gauge",
    sortOrder: 36,
    content: `## Rate Limiting

The protocol implements a multi-tier rate limiting system that protects against abuse, DoS attacks, and resource exhaustion. Rate limits are enforced locally at each node and violations are propagated across the network via gossip.

### Sliding Window with Escalation

Rate limit violations trigger escalating cooldown periods:

| Violation Count | Cooldown Duration |
|-----------------|-------------------|
| 1st violation | 5 minutes |
| 2nd violation | 15 minutes |
| 3rd violation | 60 minutes |
| 4th+ violation | 24 hours + gossip broadcast |

After the 4th violation, the offending identity is broadcast to all nodes via a \`RATE_LIMIT_VIOLATION\` gossip event, causing network-wide blocking.

### Rate Limit Tiers

Limits are scoped by identity type and action:

| Tier Key | Scope | Purpose |
|----------|-------|---------|
| \`ip:agent_api\` | IP address | Agent API endpoint rate limiting |
| \`ip:checkout\` | IP address | Checkout flow rate limiting |
| \`session:*\` | Session ID | Per-session action limits |
| \`wallet:*\` | Wallet address | Per-wallet transaction limits |
| \`global_flood\` | Entire node | Global request ceiling for flood protection |

Each tier has independently configured request limits and time windows. The \`global_flood\` tier acts as a circuit breaker: if total inbound request volume exceeds the threshold, the node begins rejecting all non-authenticated requests.

### Token Bucket Implementation

The core rate limiter (in \`packages/cache\`) uses a token bucket algorithm:

- Each identity/tier combination maintains a bucket with a configured capacity and refill rate.
- Each request consumes one token.
- Tokens refill at a constant rate up to the bucket capacity.
- When the bucket is empty, requests are rejected until tokens refill.

The token bucket provides smooth rate limiting without the sharp edges of fixed-window counters. Burst traffic is absorbed up to the bucket capacity, but sustained abuse is caught.

### Gossip-Propagated Blocklists

When a node detects a severe or repeated violation, it broadcasts a \`RATE_LIMIT_VIOLATION\` event via the gossip protocol:

\`\`\`
Event: RATE_LIMIT_VIOLATION
Fields:
  - offenderType: "ip" | "session" | "wallet"
  - offenderIdentity: string (hashed for privacy)
  - tier: string
  - violationCount: number
  - reportingNodeId: string
  - timestamp: number
  - signature: Ed25519 signature of reporting node
\`\`\`

Receiving nodes add the offender to their local blocklist. The blocklist entry includes the reporting node's signature so that false reports can be traced. A single node's report is sufficient to trigger a temporary block on receiving nodes, but permanent bans require reports from multiple independent nodes.

### Anti-Abuse Protections

- **IP rate limits** prevent unauthenticated endpoint abuse from botnets.
- **Session limits** prevent a single authenticated session from monopolizing resources.
- **Wallet limits** prevent transaction spam from a single wallet address.
- **Global flood protection** prevents any form of volumetric attack from overwhelming a node.
- **Escalating penalties** ensure that persistent abusers face increasingly severe consequences.
- **Network propagation** ensures that an abuser blocked by one node cannot simply target another.`,
  },

  {
    slug: "bundle-integrity-verification",
    category: "Security & Verification",
    categorySlug: "security",
    title: "Bundle Integrity Verification",
    description:
      "Multi-layer defense ensuring every node serves identical, untampered code. SRI enforcement, content probing, manifest consensus, and IP discrimination detection.",
    icon: "shield",
    sortOrder: 37,
    content: `## Bundle Integrity Verification

The marketplace uses a defense-in-depth strategy to ensure every user loads the exact same code from every node. A compromised node that serves tampered JavaScript could steal wallet keys, redirect payments, or manipulate transaction parameters.

### Threat Model

| Attack | Description | Defense Layer |
|--------|-------------|---------------|
| **Direct code injection** | Node serves modified JS bundles | SRI enforcement, release manifest |
| **Two-directory attack** | Node maintains clean code for audits, tampered code for users | Content probing (browser-style requests) |
| **IP discrimination** | Node detects auditing node IPs and serves clean code to them only | Client bundle attestation + SRI |
| **Gateway collusion** | Gateway + node collude to serve tampered content | Session attestation, multi-gateway verification |

### Layer 1: Subresource Integrity (SRI)

The gateway sits between the serving node and the browser. When proxying HTML navigation responses, the gateway:

1. Parses all \`<script src="...">\` and \`<link rel="stylesheet">\` tags in the response.
2. Fetches each referenced asset from the serving node.
3. Computes SHA-256 of the actual content.
4. Injects \`integrity="sha256-..." crossorigin="anonymous"\` attributes.

The **browser itself** enforces SRI before any JavaScript executes. If the serving node tampers with a script after the gateway computed the hash, the browser **refuses to execute it**. This is a browser-level guarantee that tampered JS cannot bypass.

The gateway also injects a \`<meta name="x-bundle-fingerprint">\` tag containing a composite hash of all asset SRI hashes. This fingerprint is used by the client attestation system.

\`\`\`html
<!-- Gateway injects integrity attributes and bundle fingerprint -->
<head>
  <meta name="x-bundle-fingerprint" content="a1b2c3...64hex">
  <script src="/_next/static/chunks/main.js"
          integrity="sha256-ABC123..."
          crossorigin="anonymous"></script>
</head>
\`\`\`

A rogue node's only options:
1. **Serve clean code** \u2192 SRI passes, client code runs honestly \u2713
2. **Serve tampered code** \u2192 SRI fails, browser blocks execution, page breaks \u2717

There is no option 3.

### Layer 2: Bundle Manifest Consensus

Every node computes a deterministic manifest of all served files:

1. Walk \`.next/static/\`, \`.next/server/\`, and \`public/\` directories.
2. SHA-256 hash each JS, CSS, WASM, and source map file.
3. Sort chunks by path for deterministic ordering.
4. Compute a composite \`manifestHash = SHA256(sorted chunk hashes)\`.

Nodes broadcast their manifest hash via \`BUNDLE_INTEGRITY_ATTESTATION\` protocol events. The explorer tracks which manifest hash each node reports. Divergent nodes are flagged.

**Audit frequency:** Every 5 minutes, each node queries all peers for their manifest hash.

### Layer 3: Content Probing (Defeats "Two Directory" Attack)

A rogue node could maintain two build directories \u2014 clean code for peer audits, tampered code for users. The manifest audit (Layer 2) wouldn't catch this because it's self-reported.

Content probing solves this by fetching actual served content **as a regular user**:

1. The auditing node fetches the suspect's \`/api/release/manifest\` to get the declared asset list.
2. It picks 5 random assets from the manifest.
3. It fetches each asset with **no node authentication headers** \u2014 using a standard browser User-Agent.
4. It hashes the received bytes locally and compares against the manifest's declared hashes.

The rogue node cannot distinguish this request from a real user request, so it cannot serve different content.

\`\`\`
Request headers (indistinguishable from a browser):
  Accept: */*
  User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36
  Accept-Encoding: identity
  (NO x-node-pubkey, NO x-node-signature, NO x-dm-skip-quorum)
\`\`\`

**Audit frequency:** Every 15 minutes (heavier than manifest checks).

**Detection probability:** With 200 chunks and 1 tampered, probing 5 random chunks:
- Per round: ~2.5% catch rate
- Over 24 hours (96 rounds): ~91% catch rate
- If multiple chunks are tampered, detection is faster

### Layer 4: Client Bundle Attestation (Defeats IP Discrimination)

Even with content probing, a rogue node could whitelist known node IPs and serve clean code to them while serving tampered code to everyone else.

Client bundle attestation closes this gap:

1. The browser loads the page. SRI guarantees the loaded JS is untampered.
2. The untampered client code reads the \`x-bundle-fingerprint\` meta tag.
3. The client sends this fingerprint directly to 2-3 random peer nodes (bypassing the gateway).
4. Each peer compares the client's fingerprint against its own content probe of the serving node.
5. If the fingerprints differ \u2192 the serving node is IP-discriminating.

Because SRI guarantees the client code is honest, the client's report is trustworthy. The rogue node cannot serve tampered JS that lies about its own fingerprint, because the browser would refuse to execute it (SRI check fails).

\`\`\`
Client \u2192 POST /node/bundle-attestation/verify (directly to peer)
Body: { clientFingerprint: "a1b2c3...", servingNodeId: "suspect-node" }

Peer response: { matches: false, expectedFingerprint: "d4e5f6..." }
\u2192 IP DISCRIMINATION DETECTED
\`\`\`

### Consequences of Detection

When bundle divergence is detected at any layer:

| Severity | Action |
|----------|--------|
| Manifest mismatch | Node quarantined (5-min TTL), \`BUNDLE_INTEGRITY_ATTESTATION\` event gossiped |
| Content probe mismatch | \`MISBEHAVIOR_PROOF\` with type \`BUNDLE_DIVERGENCE\`, misbehavior strike applied |
| IP discrimination | Governance lock on stake (7 days), misbehavior strike, explorer flag |

The misbehavior strike system escalates:
- Strike 1: 24-hour fee suspension
- Strike 2: 72-hour fee suspension
- Strike 3: 168-hour fee suspension
- Strike 4+: Permanent ban from fee competition

### Protocol Events

\`\`\`
BUNDLE_INTEGRITY_ATTESTATION
  bundleManifestHash: string (64 hex)
  chunkCount: number
  releaseVersion: string
  checkedPeerNodeIds: string[]
  agreeingPeerCount: number
  divergentPeerNodeIds: string[]
  attestedAt: ISO timestamp
\`\`\``,
  },

  {
    slug: "transaction-session-reconciliation",
    category: "Security & Verification",
    categorySlug: "security",
    title: "Transaction Session Reconciliation",
    description:
      "Post-transaction audit system that links user sessions to on-chain transactions, detects discrepancies between simulated and executed transactions, and governance-locks suspect node stakes.",
    icon: "search",
    sortOrder: 38,
    content: `## Transaction Session Reconciliation

Even with bundle integrity enforcement, the marketplace includes a final safety net: every transaction is audited after the fact by comparing the **expected** transaction (from the quorum simulation) against the **actual** on-chain transaction.

### Why This Layer Exists

The previous layers (SRI, content probing, attestation) prevent code tampering. But what if:
- A rogue node somehow bypasses all code integrity checks?
- A browser vulnerability allows execution despite SRI failure?
- The node manipulates the transaction at the RPC level rather than the code level?

Session-TX reconciliation catches these by auditing on-chain state \u2014 it doesn't depend on code integrity at all.

### How It Works

#### 1. Session-TX Registration

When a user initiates a purchase, the serving node runs the quorum simulation and records the mapping:

\`\`\`
sessionHash \u2194 txPlanHash \u2194 walletAddress \u2194 servingNodeId
\`\`\`

This links the user's UI session to the specific transaction plan that the quorum attested.

#### 2. On-Chain Observation

After a transaction appears on-chain, honest nodes observe it and extract:
- Transaction hash
- Recipient addresses
- Transfer amounts
- Contract calls and parameters

#### 3. Reconciliation

The engine compares the on-chain observation against the registered session plan:

| Check | What It Catches |
|-------|----------------|
| **TX_PLAN_HASH_MISMATCH** | On-chain tx doesn't match the attested plan \u2014 node substituted a different transaction |
| **UNATTESTED_TX_DURING_SESSION** | A transaction occurred from the user's wallet during a session with no corresponding attestation \u2014 node injected an unauthorized tx |
| **UNEXPECTED_RECIPIENT** | Funds went to addresses not in the original plan \u2014 payment diversion attack |
| **AMOUNT_MISMATCH** | Transfer amount differs from the simulated amount \u2014 partial theft |

#### 4. Consequences

Discrepancies trigger immediate governance actions:

| Severity | Trigger | Governance Lock | Misbehavior Strike |
|----------|---------|-----------------|-------------------|
| WARNING | Amount mismatch | 48 hours | No |
| CRITICAL | Plan hash mismatch, unexpected recipient, unattested tx | 168 hours (7 days) | Yes |

**Governance lock** prevents the suspect node from unstaking its collateral while under investigation. This is implemented via \`applyGovernanceLock()\` which extends the node's \`withdrawableAt\` timestamp.

**Misbehavior strike** feeds into the escalating penalty system (24h \u2192 72h \u2192 168h \u2192 permanent ban).

### Client-Side Direct Witness Verification

In addition to server-side reconciliation, the client independently verifies the quorum result:

1. After the loading node returns a quorum result, the client picks 2-3 random witness nodes.
2. The client contacts each witness **directly** (bypassing the loading node).
3. Each witness confirms it attested the claimed \`txPlanHash\`.
4. If any witness disagrees \u2192 the loading node fabricated the quorum result.

This prevents a compromised loading node from faking the entire quorum response.

### TX Attestation Cache

Each node maintains an in-memory cache of recent tx-plan attestations (10-minute TTL). When a client directly queries a witness at \`GET /node/tx-attest/verify/{hash}\`, the witness looks up the hash in this cache and confirms or denies its attestation.

### Protocol Events

\`\`\`
TX_SESSION_DISCREPANCY
  discrepancyId: string
  sessionHash: string (64 hex)
  walletAddress: string
  chain: "BTC" | "ETH" | "SOL"
  onChainTxHash: string
  expectedTxPlanHash: string (64 hex)
  servingNodeId: string
  cohortNodeIds: string[]
  reason: "TX_PLAN_HASH_MISMATCH" | "UNATTESTED_TX_DURING_SESSION" |
          "SIMULATION_RESULT_DIVERGENCE" | "UNEXPECTED_RECIPIENT" | "AMOUNT_MISMATCH"
  severity: "WARNING" | "CRITICAL"
  stakeLocked: boolean
  lockHours: number
  detectedAt: ISO timestamp
\`\`\`

### Defense in Depth Summary

The full transaction security stack, from first to last line of defense:

| Layer | What It Protects | Who Enforces It |
|-------|-----------------|-----------------|
| SRI integrity attributes | Code authenticity | Browser (cannot be bypassed by JS) |
| Bundle manifest consensus | Node code agreement | All nodes via gossip |
| Content probing | Against two-directory attacks | Honest nodes (browser-like requests) |
| Client bundle attestation | Against IP discrimination | Client + peer nodes |
| TX-plan quorum | Transaction plan agreement | Witness nodes (67% BFT) |
| Client witness verification | Against fake quorum results | Client + witness nodes directly |
| Session-TX reconciliation | Against post-attestation tampering | All honest nodes + on-chain state |
| Governance stake lock | Flight risk during investigation | Smart contract / protocol |
| Misbehavior strikes | Repeat offenders | Escalating penalties \u2192 permanent ban |`,
  },
];
