import type { DocEntry } from "./types";

export const GOVERNANCE_DOCS: DocEntry[] = [
  {
    slug: "governance",
    category: "Governance & Economics",
    categorySlug: "governance",
    title: "Governance",
    description:
      "1-Node-1-Vote governance across 13 configurable domains. Node voting, delegation, burn voting, proposal lifecycle, and foundation beta powers.",
    icon: "vote",
    sortOrder: 50,
    content: `## Governance

The protocol is governed by a 1-Node-1-Vote system. Stake gets you in, but every bonded node gets exactly one vote regardless of how much it staked. This prevents whale domination while still requiring skin in the game.

### 13 Governance Domains

Every runtime parameter lives in one of 13 governance categories. Each category groups related parameters that can be proposed and voted on independently.

| Domain | Key | What It Controls |
|--------|-----|------------------|
| Gateway Routing | \`gatewayRouting\` | Cache TTL, cohort sizing, node recommendation limits |
| Marketplace Fee Split | \`marketplaceFeeSplit\` | Foundation vs. winner allocation (default 50/50 at 5000 bps each) |
| Token Swap Fee | \`tokenSwapFee\` | Marketplace swap fee (default 200 bps = 2%, max 2000 bps) |
| Token Rewards | \`tokenRewards\` | Incentive rates, burn allocation, user reward share |
| Burn Voting | \`burnVoting\` | Proposal creation cost, per-wallet caps, advisory quorum |
| Node Economics | \`nodeEconomics\` | Min stake, admission fee, collateral types, cooldown periods |
| Node Performance | \`nodePerformance\` | Bandwidth, latency, disk I/O, CPU score thresholds |
| Beta Safety | \`betaSafety\` | Foundation veto, config locks, label overrides |
| Governance Policy | \`governancePolicy\` | Vote threshold, min voting power, open proposal limits |
| Witness Scaling | \`witnessScaling\` | Logarithmic curve coefficients, min/max witnesses, quorum bps |
| Data Retention | \`dataRetention\` | Event log TTL, media cache duration, PSBT cleanup, compaction |
| Reward Claims | \`rewardClaims\` | Claim expiry, moderation reward amount, moderation quorum |
| MPC Treasury | \`mpcTreasury\` | Threshold bps, epoch frequency, reshare grace period |

### 1-Node-1-Vote

The voting model is deliberately flat:

- **Stake is the entry ticket.** You must bond the minimum stake (currently $1,000 USD, demand-adjusted) to become a voting node.
- **Every node gets exactly one vote.** A node that staked $10,000 has the same voting power as a node that staked $1,000.
- **Delegation amplifies influence.** The only way to gain more than one vote is to receive delegations from other nodes (see the Delegation System page).
- **Effective voting power** = 1 (own vote) + count of active delegations received.

### Three Governance Tracks

**1. Node Voting (Binding)**

Bonded node operators propose and vote on runtime configuration changes. These votes directly modify protocol parameters. Different parameters have different quorum requirements based on sensitivity. The governance policy controls the vote threshold (default: 2 nodes minimum) and limits on open proposals per key (16) and per node (4).

**2. Token Burn Voting (Advisory)**

Public token holders signal preferences by burning tokens. USD-indexed, not fixed token count. Advisory only -- burn votes never directly change parameters. See the Burn Voting page for full details.

**3. Delegation**

Nodes can delegate their voting power to a trusted operator. Delegates forfeit their own fee eligibility and accrue escalating unstake cooldowns. No chaining allowed -- a delegate cannot re-delegate received votes. See the Delegation System page for full details.

### Proposal Lifecycle

Every governance proposal moves through a defined state machine:

\`\`\`
PROPOSED  -->  Voting Period  -->  READY (quorum met)
                               -->  REJECTED (quorum failed or expired)
READY     -->  Applied by governance engine  -->  APPLIED
\`\`\`

During beta, the foundation can lock specific config keys. Proposals targeting locked keys are rejected with a BETA_LOCKED status. The default locked keys are: \`marketplaceFeeSplit\`, \`governancePolicy\`, and \`betaSafety\`.

### Foundation Role (Beta Period)

During beta, the foundation master node (Node-1) holds temporary powers:

- **Veto governance votes** -- can block any proposal during beta
- **Direct config changes** -- can modify parameters without a vote
- **MPC ceremony activation** -- manually triggers initial DKG
- **Reward token creation** -- decides when to launch the token
- **Fee recipient** -- receives admission fees and foundation fee split

These powers are gated by a \`betaMode\` flag. As the network matures and decentralizes, beta powers get progressively removed through governance votes. The goal is full removal of all foundation special privileges.

### Transparency

Every foundation action is a signed protocol event:

- Gossiped to all nodes in the network
- Stored in the \`protocolEvents\` table
- Visible in the explorer UI

Event kinds include \`FOUNDATION_CONFIG_OVERRIDE\`, \`FOUNDATION_VETO\`, \`FOUNDATION_MPC_TRIGGER\`, \`FOUNDATION_TOKEN_MINT\`, and \`FOUNDATION_TREASURY_TX\`. There are no hidden admin actions. The explorer supports filtering specifically for foundation events.

### Misbehavior Enforcement

Nodes that violate protocol rules face escalating strikes: 24h fee suspension, then 72h, then 7 days, then permanent ban. All misbehavior proofs are public protocol events with full evidence. See the Misbehavior Strikes page for the complete strike system.`,
  },

  {
    slug: "token-economics",
    category: "Governance & Economics",
    categorySlug: "governance",
    title: "Token Economics",
    description:
      "Five claim types, signature-based distribution on sidechain, dynamic staking curve, admission fees, revenue locks, and the full reward lifecycle.",
    icon: "coins",
    sortOrder: 51,
    content: `## Token Economics

The protocol token powers the economic engine. Distribution follows a claim-based model on sidechain (Base, chain ID 8453 by default). Claims are IOUs, not transfers -- the claimant must submit a signed claim transaction on-chain to receive tokens.

### Five Claim Types

Every reward entitlement falls into one of five categories:

| Claim Type | Rate | Description |
|------------|------|-------------|
| \`NODE_FEE_REIMBURSEMENT\` | 100% pass-through | Full reimbursement of transaction fees paid by the winning node |
| \`NODE_INCENTIVE\` | 2400 bps (24%) | Incentive reward for the node that processed the transaction |
| \`USER_PURCHASE_REWARD\` | 3333 bps of incentive (~8% effective) | Buyer cashback carved from the node incentive pool |
| \`MODERATION_REWARD\` | $0.01 per accepted vote | Micro-reward for community moderation participation |
| \`BURN_ALLOCATION\` | 1200 bps (12%) | Tokens allocated for burn from each transaction |

The \`NODE_INCENTIVE\` rate of 2400 bps means 24% of each transaction's value is allocated as node incentive. The \`USER_PURCHASE_REWARD\` takes 3333 bps (33.33%) of that incentive pool, yielding roughly 8% effective buyer cashback. The \`BURN_ALLOCATION\` of 1200 bps sends 12% to burn, creating deflationary pressure.

### Claim Lifecycle

Every claim moves through a strict state machine:

\`\`\`
PENDING  -->  SIGNED (EIP-712 typed-data signature)  -->  CLAIMED (redeemed on-chain)
                                                      -->  EXPIRED (past claim deadline)
\`\`\`

- **PENDING**: Claim recorded in state machine, linked to source event hash for independent verification.
- **SIGNED**: Foundation signer authorizes the claim with an EIP-712 signature. The signature includes a nonce, chain ID, and claim contract address to prevent replay.
- **CLAIMED**: Claimant submitted the signature to the sidechain contract and received tokens.
- **EXPIRED**: Claim passed its deadline (default 720 hours / 30 days) without redemption.

Each claim links 1:1 to an originating state-machine event via \`sourceEventHash\`, so every claim is independently verifiable.

### Staking Mechanics

**Dynamic Minimum Stake:**

The minimum bond adjusts sub-linearly with demand using a power curve:

\`\`\`
effectiveMinStake = minStakeUsd + stakeDemandIncrementUsd * nodeCount^0.75
\`\`\`

- Base: \`minStakeUsd\` = $1,000 USD
- Increment: \`stakeDemandIncrementUsd\` = $5 per node (scaled by 0.75 exponent)
- Override: \`stakeFlatOverrideUsd\` can force a fixed amount (0 = disabled)

This keeps a flood of low-quality nodes out while staying accessible as the network grows.

**Admission Fee:**

A one-time fee of 500 bps (5%) is carved from each new stake and sent to the foundation. For example, a $1,000 stake deposits $950 as collateral and $50 as the admission fee.

**Acceptable Collateral:**

| Symbol | Chains |
|--------|--------|
| USDC | ETH, BASE, ARBITRUM, OPTIMISM, SOL |
| USDT | ETH, BASE, ARBITRUM, OPTIMISM, SOL |

The primary settlement chain defaults to ETH but is governance-configurable. Collateral amounts are tracked in raw units with explicit decimals for precision.

**Stake Status Lifecycle:**

\`\`\`
ACTIVE  -->  EXITING (cooldown started)  -->  INACTIVE (withdrawable)
\`\`\`

Default unstake cooldown is 24 hours, with a 10-minute exit throttle between unstake requests.

### Revenue Model

| Source | Fee | Split |
|--------|-----|-------|
| NFT + Ordinal trades | 2.0% | Configurable foundation/winner bps (default 50/50) |
| Token swap fees | Up to 2000 bps (default 200 bps = 2%) | Via swap router contract |
| Launchpad fees | 1.0% | On bonding curve trades + graduation |
| Node staking | Dynamic minimum | Admission fee to foundation |
| Decentralized RPC | Per-call metered | Future revenue stream |

**Fee Split Configuration:**

The \`marketplaceFeeSplit\` governance domain controls how transaction fees are divided:

- \`foundationBps\`: Default 5000 (50%) -- foundation share
- \`winnerBps\`: Default 5000 (50%) -- winning node share

Both values are independently governance-votable. The token swap fee (\`tokenSwapFee.marketplaceFeeBps\`) is capped at 2000 bps by schema validation.

### Revenue Locks

Not every node earns fees:

- **Delegates cannot earn.** Nodes in delegate mode forfeit fee eligibility entirely. This is enforced at the stake position level.
- **Suspended nodes cannot earn.** Nodes under misbehavior suspension have \`feeEligible\` set to false until the suspension expires.
- **Banned nodes never earn.** Permanent bans are irreversible.
- **Inactive or exiting nodes cannot earn.** Only ACTIVE stake positions with \`feeEligible = true\` participate in fee distribution.

### Foundation Treasury Audit

All treasury transactions are logged in the \`foundationTreasuryLedger\` table:

| Transaction Type | Description |
|-----------------|-------------|
| PAYOUT | Reward claim distributions to claimants |
| WITHDRAWAL | Foundation operational expenses |

The explorer shows a full audit trail with automated warnings:

- **WARN**: Unexpected withdrawals without governance approval
- **CRITICAL**: Large withdrawals exceeding \`foundationDailyWithdrawalCapUsd\` (default $10,000/day)

Governance-approved treasury spends do not trigger warnings.

### Token Utility

- Governance voting via burn voting (advisory proposals)
- Optional fee payment in native token
- Node operator bonds (via stablecoin collateral)
- Token launch platform fees
- Burn allocation creates deflationary pressure`,
  },

  {
    slug: "mpc-treasury",
    category: "Governance & Economics",
    categorySlug: "governance",
    title: "MPC Treasury",
    description:
      "Threshold wallet where the private key is split across ALL nodes. Three ceremony types, two wallet tiers, multi-chain support, emergency reshare, and epoch batching.",
    icon: "vault",
    sortOrder: 52,
    content: `## MPC Treasury

The MPC (Multi-Party Computation) Treasury is a threshold wallet where the private key is split across ALL network nodes. No single node -- not even the foundation -- can spend treasury funds alone. There is no hot wallet to hack.

### Core Principle

**The private key is NEVER reconstructed.** Not during key generation. Not during reshare. Not during signing. Each node holds a key share and produces a partial signature. Partial signatures are combined to create a valid on-chain signature without ever assembling the complete key. The full private key literally never exists in one place.

### Three Ceremony Types

#### 1. DKG (Distributed Key Generation)

Runs once per asset to bootstrap a new key pair.

| Stage | What Happens |
|-------|-------------|
| PREPARE | Coordinator broadcasts ceremony parameters, participants acknowledge |
| COMMITMENT | Each node generates a random polynomial and broadcasts commitments |
| SHARE_EXCHANGE | Nodes exchange encrypted key shares via pairwise channels |
| VERIFICATION | Each node verifies received shares against commitments |
| FINALIZED | Public key derived, key shares stored locally, wallet address usable |

All nodes participate simultaneously. Each receives a unique key share. The public key (wallet address) is immediately usable for receiving funds. The private key exists only as distributed shares that never leave their respective nodes.

#### 2. RESHARE

Runs automatically when node membership changes (join or leave events).

| Stage | What Happens |
|-------|-------------|
| PREPARE | Coordinator identifies old and new participant sets |
| COMMITMENT | Old shareholders commit to re-sharing their existing shares |
| SHARE_EXCHANGE | Old shares are redistributed to include new nodes |
| VERIFICATION | New shareholders verify they received valid shares |
| FINALIZED | New share set active, old shares from departed nodes invalidated |

The public key stays the same, so no fund migration is needed. This is triggered automatically when \`autoReshareOnMembershipChange\` is enabled (default: true).

#### 3. SIGN

Runs for each treasury transaction requiring an on-chain signature.

| Stage | What Happens |
|-------|-------------|
| PREPARE | Coordinator broadcasts the transaction to sign |
| NONCE_COMMIT | Each signer commits to a random nonce |
| NONCE_REVEAL | Nonces are revealed and aggregated |
| PARTIAL_SIGN | Each signer produces a partial signature using their key share |
| FINALIZED | Partial signatures combined into a valid ECDSA or Ed25519 signature |

The resulting signature is indistinguishable from a normal single-key signature. No one can tell it was produced by an MPC ceremony.

### Two Wallet Tiers

**Treasury Wallet (67%+ threshold):**

- Threshold: 6667 bps -- the standard BFT threshold (survives up to 33% node loss)
- Requires governance-voted spending proposals
- Used for: foundation operations, grants, strategic investments
- Minimum 3 signers required regardless of percentage

**Rewards Wallet (67%+ threshold):**

- Same BFT threshold as treasury for consistent security
- Used for: claim payouts, batch distributions
- Weekly epoch frequency for batch signing
- Consistent threshold prevents lower-bar attack surface

Both wallets require the same 67%+ BFT threshold, ensuring a uniform security model across all MPC operations.

### Multi-Chain Keys

The MPC system maintains separate key pairs per chain:

| Chain | Algorithm | Usage |
|-------|-----------|-------|
| SOL | Ed25519 | SPL token operations, reward distributions |
| ETH | secp256k1 | ERC-20 distributions, staking contract |
| BTC | secp256k1 | Bitcoin treasury holdings |
| BTC_ORDINALS | secp256k1 | Ordinal-specific operations |

Each chain gets its own DKG ceremony and independent key shares. A compromise of one chain's shares does not affect other chains.

### Emergency Reshare

When network health degrades, the system triggers an immediate reshare without waiting for the standard grace period:

- **Trigger**: More than 15% of shareholders go offline (\`emergencyReshareHealthBps\` = 8500, meaning health drops below 85%)
- **Grace period**: Standard reshare waits 5 minutes (\`reshareGracePeriodMinutes\`); emergency reshare fires immediately
- **Detection**: Heartbeat staleness checked every 120 seconds (\`heartbeatStalenessSecs\`)
- **Sweep loop**: Runs every 15 seconds when degraded, every 30 seconds when stable
- **Ceremony healer**: Separate loop running every 20 seconds to detect and recover stalled ceremonies (up to 5 retry attempts)
- **Stale share refresh**: Shares older than 168 hours (7 days) trigger proactive reshare via \`maxStaleShareSetHours\`

The emergency reshare action type is \`EMERGENCY_RESHARE_INITIATED\`, broadcast as a protocol event.

### Epoch System

Payouts are batched into epochs to minimize ceremony overhead:

\`\`\`
OPEN  -->  CLOSING  -->  FUNDING  -->  SIGNING  -->  BROADCASTING  -->  CONFIRMED
                                                                    -->  FAILED
\`\`\`

| Stage | What Happens |
|-------|-------------|
| OPEN | Claims accumulate as PENDING entitlements |
| CLOSING | Epoch cutoff reached, no new claims accepted |
| FUNDING | Verify treasury has sufficient balance for all claims |
| SIGNING | MPC SIGN ceremony produces batch transaction signature |
| BROADCASTING | Signed transaction submitted to the blockchain |
| CONFIRMED | On-chain confirmation received, claims marked SIGNED |
| FAILED | Transaction failed, claims returned to next epoch |

Default epoch frequency: 168 hours (weekly), governance-configurable. Each ceremony stage has a 30-second timeout (\`ceremonyStageTimeoutMs\`).

### Spend Proposals

Any staked node can propose a treasury spend:

1. **PROPOSED**: Node submits a spend proposal with amount, recipient, and justification
2. **VOTING**: All staked nodes vote. Required approvals: \`ceil(N * thresholdBps / 10000)\` where N is total staked nodes
3. **APPROVED**: Quorum achieved after the 7-day voting period
4. **EXECUTING**: MPC SIGN ceremony generates the transaction signature
5. **EXECUTED**: Combined signature submitted on-chain, funds transferred

Governance-approved spends are flagged in the foundation audit system so they do not trigger withdrawal warnings.

### Production Activation

In production, the foundation master node (Node-1) manually activates the initial MPC DKG ceremony:

- The \`mpcTreasury.enabled\` flag starts as \`true\` but \`autoInitiateCeremony\` is \`false\`
- Node-1 triggers DKG once the network has sufficient node count and stake distribution
- This prevents premature key generation when a small group could control the treasury
- The dev cluster auto-triggers DKG for convenience via \`instrumentation.ts\`
- Automatic ceremonies kick in only after decentralization milestones are reached

### Security Properties

- **No hot wallet.** No single point of key compromise exists anywhere in the system.
- **BFT threshold.** Up to 33% of nodes can be compromised without risk (67% threshold).
- **Key rotation.** Every reshare effectively rotates key material, invalidating old shares.
- **Full transparency.** All ceremony events are public protocol events visible in the explorer.
- **Self-healing.** The ceremony healer automatically recovers from failed rounds with retry logic.
- **Multi-chain isolation.** Compromise of one chain's key shares does not affect other chains.`,
  },

  {
    slug: "misbehavior-strikes",
    category: "Governance & Economics",
    categorySlug: "governance",
    title: "Misbehavior Strikes",
    description:
      "Escalating strike system for protocol violations. Fee suspensions, permanent bans, strike decay, and public misbehavior proofs.",
    icon: "shield",
    sortOrder: 53,
    content: `## Misbehavior Strikes

Nodes that violate protocol rules face an escalating strike system. Each confirmed misbehavior proof increments the node's strike counter and triggers progressively harsher penalties.

### Strike Escalation

| Strike | Penalty | Duration |
|--------|---------|----------|
| 1st | Fee eligibility suspended | 24 hours |
| 2nd | Fee eligibility suspended | 72 hours |
| 3rd | Fee eligibility suspended | 168 hours (7 days) |
| 4th+ | Permanent ban | Irreversible |

When a strike is applied, the node's \`feeEligible\` flag is set to \`false\` on its stake position. A \`NODE_STAKE_UPDATED\` event is broadcast to all nodes so the entire network knows the node is suspended.

### Strike Decay

Strikes are not permanent (unless you hit 4):

- After **30 days** of clean behavior (no new misbehavior proofs), one strike decays automatically.
- Decay is checked at the time a new strike would be applied -- if enough time has passed since the last proof, the counter decrements by 1 before the new strike is added.
- A node with 3 strikes that stays clean for 30 days drops to 2. Another 30 clean days drops to 1. Another 30 drops to 0.
- **Banned nodes cannot benefit from decay.** Once a node hits strike 4 and receives a permanent ban, the \`banned\` flag is irreversible regardless of time elapsed.

### Misbehavior Proof Types

Each proof type targets a specific protocol violation:

| Proof Type | What It Catches |
|------------|----------------|
| \`FEE_OUTPUT_MISMATCH\` | Transaction fee outputs do not match the expected fee structure |
| \`ROYALTY_MISMATCH\` | Creator royalty payments are missing or incorrect |
| \`QUOTE_SIGNATURE_INVALID\` | The node submitted a quote with an invalid or forged signature |
| \`WITNESS_SELECTION_MISMATCH\` | The node manipulated witness selection to favor specific nodes |

Additionally, the \`poa_wrong_answer\` kind covers nodes that give definitively wrong chain data during Proof-of-Access challenges.

### Proof Structure

Every misbehavior proof contains:

- **txid**: The transaction where the violation occurred
- **orderId**: The order associated with the violation
- **proofType**: One of the four proof types above
- **expected**: What the correct values should have been
- **actual**: What the node actually submitted
- **evidencePointers**: References to on-chain data or protocol events that prove the violation

### Fee Eligibility Suspension

When a node is struck:

1. The \`nodeMisbehaviorPenalties\` table records the new strike count, suspension timestamp, and suspension end time.
2. The node's stake position has \`feeEligible\` set to \`false\`.
3. A \`NODE_STAKE_UPDATED\` event propagates the change across the network.
4. During suspension, the node cannot win fee distribution rounds or earn \`NODE_FEE_REIMBURSEMENT\` or \`NODE_INCENTIVE\` claims.
5. When the suspension expires, fee eligibility is restored during the next heartbeat processing cycle.

For permanent bans (strike 4+), there is no \`suspendedUntil\` timestamp -- the ban has no end date.

### Integration with Other Systems

- **Quorum selection**: Penalized nodes are excluded from PoW quorum formation via the \`isNodePenalized\` check.
- **Fee distribution**: Only nodes with \`feeEligible = true\` and \`status = "ACTIVE"\` participate in fee splits.
- **Delegation**: A banned node's delegations are effectively worthless since the node cannot participate.
- **Explorer**: All misbehavior proofs and strike events are visible in the protocol event explorer.

### Public Accountability

All misbehavior proofs are public protocol events:

- The \`MISBEHAVIOR_PROOF\` event contains the full proof payload with evidence.
- Any node or user can verify the proof independently using the evidence pointers.
- The explorer displays strike history per node, including proof details and suspension timelines.
- There is no private or hidden enforcement -- every penalty is auditable.`,
  },

  {
    slug: "delegation-system",
    category: "Governance & Economics",
    categorySlug: "governance",
    title: "Delegation System",
    description:
      "Vote delegation with fee forfeiture, escalating cooldowns, one-to-one constraints, and automatic revocation on exit.",
    icon: "users",
    sortOrder: 54,
    content: `## Delegation System

Not all nodes will actively participate in every governance vote. Delegation lets active operators represent passive ones, preventing governance stalls while maintaining the 1-Node-1-Vote principle.

### How Delegation Works

1. A node operator opts into delegate mode by publishing a \`NODE_DELEGATE_STATUS_CHANGED\` event with status \`ACTIVE\`.
2. Other nodes can delegate their vote to this delegate by publishing a \`NODE_DELEGATION_CHANGED\` event with action \`DELEGATE\`.
3. The delegate's effective voting power becomes: **1 (own vote) + count of active delegations received**.
4. Nodes that have delegated their vote away have **0 effective power** and cannot vote directly.

### Fee Forfeiture

Delegates forfeit their own fee eligibility entirely. This is a deliberate design trade-off:

- When a node enters delegate mode, its \`feeEligible\` flag is set to \`false\`.
- The node cannot earn \`NODE_FEE_REIMBURSEMENT\` or \`NODE_INCENTIVE\` claims while in delegate mode.
- This mirrors a "politician" model: you represent others, you do not also collect marketplace fees.
- Fee forfeiture is enforced at the stake position level and broadcast as a \`NODE_STAKE_UPDATED\` event.

### Escalating Unstake Cooldown

The longer a node stays in delegate mode, the longer its unstake cooldown becomes:

\`\`\`
cooldown = min(baseCooldownHours + daysInDelegateMode * 24, 8760)
\`\`\`

Where \`baseCooldownHours\` is the governance-configured \`unstakeCooldownHours\` (default: 24 hours) and the maximum plateau is 8760 hours (1 year).

| Days in Delegate Mode | Effective Cooldown |
|----------------------:|-------------------:|
| 0 | 24 hours |
| 7 | 192 hours |
| 30 | 744 hours |
| 90 | 2,184 hours |
| 365 | 8,760 hours (max) |

This prevents delegates from accumulating political power and then quickly unstaking to exit without consequence.

### Constraints

- **One delegation per delegator.** Each node can only delegate to one other node at a time. Changing delegates requires revoking the current delegation first.
- **No chaining.** A delegate cannot re-delegate votes received from other nodes. Delegated power is not transitive.
- **No self-delegation.** A node cannot delegate to itself.
- **Stake required.** Both the delegator and the delegate must have an ACTIVE stake position.

### Auto-Revocation

When a delegate exits delegate mode (publishes \`NODE_DELEGATE_STATUS_CHANGED\` with status \`EXITED\`):

1. All incoming delegations are automatically revoked.
2. Each delegator receives their vote back (effective power returns to 1).
3. \`NODE_DELEGATION_CHANGED\` events with action \`REVOKE\` are published for each affected delegator.
4. The former delegate's fee eligibility can be restored (subject to the escalated cooldown for unstaking).

### Database Schema

Two tables track delegation state:

**\`nodeDelegateRegistrations\`** -- Tracks which nodes are in delegate mode:

- \`agentPubkey\`: The node that registered as a delegate
- \`status\`: ACTIVE or EXITED
- \`enteredAt\`: Timestamp when delegate mode was activated (used for cooldown calculation)
- \`exitedAt\`: Timestamp when delegate mode was deactivated

**\`nodeDelegations\`** -- Tracks individual delegation relationships:

- \`delegatorPubkey\`: The node giving its vote away
- \`delegatePubkey\`: The node receiving the delegated vote
- \`revokedAt\`: Null while active, set when revoked

### Voting Power Calculation

When a governance vote is tallied:

1. Each non-delegating, non-penalized, ACTIVE node counts as 1 vote.
2. Each active delegate counts as 1 + (number of active incoming delegations).
3. Nodes that have delegated their vote count as 0.
4. Penalized or banned nodes count as 0 regardless of delegation status.

The total eligible voting power equals the count of ACTIVE, non-penalized nodes (both direct voters and delegates). The quorum is calculated against this total.`,
  },

  {
    slug: "burn-voting",
    category: "Governance & Economics",
    categorySlug: "governance",
    title: "Burn Voting",
    description:
      "Advisory burn voting with two tracks, USD-weighted votes, per-wallet caps, moderation actions, and LLM-assisted voting.",
    icon: "flame",
    sortOrder: 55,
    content: `## Burn Voting

Burn voting is the protocol's advisory governance system for public token holders. Unlike node voting (which directly changes parameters), burn votes are non-binding signals. The foundation decides whether and how to implement burn vote outcomes.

### Two Voting Tracks

**1. Social Vote (Signal)**

General sentiment signals on protocol direction, feature priorities, or ecosystem decisions. Labels are governance-configurable (default: "Signal" during beta via \`betaSafety.socialVoteLabel\`).

**2. Change Request (RFC)**

Specific requests for parameter changes or feature implementations. More structured than social votes, with concrete proposals attached. Labels are governance-configurable (default: "RFC" during beta via \`betaSafety.changeRequestLabel\`).

Both tracks can be independently enabled or disabled via \`burnVoting.signalVotingEnabled\` and \`burnVoting.changeRequestVotingEnabled\`.

### USD-Weighted Burn Votes

Burn votes are weighted by USD value, not by fixed token count:

- Each vote unit costs \`usdPerVoteUnit\` (default: $5 USD).
- The tokens equivalent to that USD value are permanently burned.
- A voter spending $50 gets 10 vote units; a voter spending $5 gets 1.
- USD weighting prevents token price volatility from distorting vote counts.

### Proposal Creation

Anyone can create a burn voting proposal by burning \`proposalCreateBurnUsd\` worth of tokens (default: $25 USD). This prevents spam while keeping proposal creation accessible.

### Per-Wallet Cap

Each wallet can burn at most \`maxUsdBurnPerWalletPerProposal\` (default: $500 USD) on a single proposal. This prevents wealthy participants from dominating individual votes.

### Advisory Quorum

A burn vote reaches quorum when total burned USD across all voters meets or exceeds \`advisoryQuorumUsd\` (default: $250 USD). Reaching quorum signals strong community interest but still does not bind the foundation to act.

### Non-Binding Nature

Burn votes are explicitly advisory:

- The foundation reviews proposals that reach quorum.
- Implementation is at the foundation's discretion during beta.
- As the network matures, governance proposals can change how burn vote results are weighted in decision-making.
- Burn votes can influence node voting by surfacing community priorities.

### Moderation System

Burn voting includes a moderation track for community content enforcement:

| Action | What It Does |
|--------|-------------|
| \`DISABLE_SCAM\` | Flags a listing as fraudulent, triggers delisting vote |
| \`COPYRIGHT_STRIKE\` | Reports intellectual property violation |
| \`INAPPROPRIATE_CONTENT\` | Flags content that violates community standards |
| \`RESTORE\` | Requests reinstatement of a previously moderated item |

Moderation targets can be listings, collections, or profiles (\`targetType\`: LISTING, COLLECTION, PROFILE).

**Moderation Quorum:**

- Default: 5 votes required to reach moderation quorum (\`rewardClaims.moderationQuorum\`)
- Each accepted moderation vote earns a \`MODERATION_REWARD\` claim of $0.01 (\`rewardClaims.moderationRewardCents\` = 1 cent)
- Voters submit a verdict of APPROVE or REJECT with an optional text reason (max 1000 characters)

### LLM-Assisted Voting

Moderation votes can be LLM-assisted (opt-in):

- The \`llmAssisted\` flag on each vote indicates whether an AI model contributed to the decision.
- If LLM-assisted, the \`llmModel\` (model identifier) and \`llmConfidence\` (0.0 to 1.0 score) are recorded.
- LLM assistance is enabled globally via \`rewardClaims.llmModerationEnabled\` (default: true).
- The protocol records but does not mandate LLM usage -- human-only votes are equally valid.
- LLM confidence scores are informational; they do not weight the vote differently.

### Governance Parameters

All burn voting parameters are governance-configurable under the \`burnVoting\` domain:

| Parameter | Default | Description |
|-----------|---------|-------------|
| \`enabled\` | true | Master switch for burn voting |
| \`signalVotingEnabled\` | true | Enable social vote track |
| \`changeRequestVotingEnabled\` | true | Enable change request track |
| \`usdPerVoteUnit\` | $5 | Cost per vote unit in USD |
| \`proposalCreateBurnUsd\` | $25 | Cost to create a new proposal |
| \`maxUsdBurnPerWalletPerProposal\` | $500 | Maximum burn per wallet per proposal |
| \`advisoryQuorumUsd\` | $250 | USD threshold for quorum |`,
  },
];
