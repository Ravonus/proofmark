import type { DocEntry } from "./types";

export const DEVELOPER_SETUP_DOCS: DocEntry[] = [
  {
    slug: "open-source",
    category: "Developer",
    categorySlug: "developer",
    title: "Open Source",
    description:
      "Complete open source codebase. Repository structure, package architecture, and how anyone can verify, contribute, and operate a node.",
    icon: "github",
    sortOrder: 62,
    content: `## Open Source

Every component is open source. No proprietary components, no hidden services, no closed-source dependencies in the critical path. You can read every line of code that processes your trades.

### What's Open Source

| Component | Description |
|-----------|-------------|
| Protocol Engine | Deterministic validation rules (TypeScript + Rust) |
| Node Software | Complete node runtime with all services |
| Gateway | Front-door routing layer |
| Smart Contracts | EVM and Solana marketplace/staking contracts |
| Explorer | Protocol transparency UI |
| Benchmark Dashboard | Performance testing and visualization |
| Documentation | This documentation site |
| Test Infrastructure | E2E cluster testing, security tests, benchmarks |

### Repository Structure

\`\`\`
decenterlizemarket/
\u251c\u2500\u2500 packages/
\u2502   \u251c\u2500\u2500 protocol/          # Consensus rules (pure Zod schemas, zero deps, deterministic)
\u2502   \u251c\u2500\u2500 db/                # Database schemas (Drizzle ORM, PostgreSQL)
\u2502   \u251c\u2500\u2500 agent/             # Node runtime (mesh networking, gossip, peer management)
\u2502   \u251c\u2500\u2500 server/            # Business logic (tRPC routers, API handlers)
\u2502   \u251c\u2500\u2500 cache/             # Redis client, rate limiting, caching layer
\u2502   \u2514\u2500\u2500 front-door-gateway/  # Stateless routing and load balancing
\u251c\u2500\u2500 services/
\u2502   \u251c\u2500\u2500 node-core/         # Rust microservice (60+ endpoints)
\u2502   \u2514\u2500\u2500 benchmark-dashboard/  # Dev benchmark platform (P5.js, live streaming)
\u251c\u2500\u2500 contracts/             # Solidity smart contracts (Hardhat/Foundry)
\u251c\u2500\u2500 programs/              # Solana Anchor programs
\u251c\u2500\u2500 src/                   # Next.js application (marketplace UI)
\u251c\u2500\u2500 __tests__/             # Integration and E2E test suite
\u2502   \u2514\u2500\u2500 app/api/           # API route tests
\u251c\u2500\u2500 scripts/               # Deployment, migration, and testing scripts
\u2514\u2500\u2500 docs/                  # Protocol documentation
\`\`\`

### Package Architecture

**packages/protocol** \u2014 The protocol package is the foundation. Zero external dependencies. Pure Zod schemas and deterministic validation functions. Every node must compute identical results from identical inputs. If it's in the protocol package, it must be deterministic.

**packages/db** \u2014 Drizzle ORM schemas for PostgreSQL. Each node has its own isolated database (no shared DB). Protocol data is fully replicated via gossip; chat data is sharded across nodes.

**packages/agent** \u2014 The node runtime. Mesh networking, gossip protocol, peer discovery, heartbeat management, and the main node lifecycle. This is what runs when you start a node.

**packages/server** \u2014 Business logic layer built on tRPC. API route handlers, chain-specific settlement logic, PSBT management, PoA challenge generation, and the documentation engine.

**packages/cache** \u2014 Redis client with rate limiting middleware and caching utilities. Handles the escalating rate limit tiers (5min \u2192 15min \u2192 60min \u2192 24h + gossip ban).

**packages/front-door-gateway** \u2014 Stateless request routing. Directs incoming requests to the appropriate handler without maintaining session state.

### Why Open Source

**For Users:** Verify the rules governing your trades. Confirm there are no hidden fees or backdoors. Build confidence that the protocol is fair.

**For Operators:** Inspect every line of code your node runs. Audit the protocol validation engine. Propose improvements through governance.

**For Developers:** Build on top of the public API. Contribute protocol improvements. Fork and experiment. Run the benchmark dashboard to verify performance claims.

### Self-Verification

1. Clone the repository.
2. Read the protocol engine at \`packages/protocol/src/\`.
3. Build from source and compare against release manifests.
4. Run the full test suite (\`pnpm test\`).
5. Run your own node to serve independently verified code.
6. Verify on-chain that smart contract source matches deployed bytecode.
7. Run benchmarks to validate performance claims (\`pnpm bench:dashboard\`).

### Verify, Don't Trust

The entire system is designed around one principle: **every claim the protocol makes is independently verifiable.** Open source isn't a marketing feature here. It's a security requirement. A decentralized marketplace where you can't read the code isn't decentralized at all.`,
  },

  {
    slug: "rust-node-core",
    category: "Developer",
    categorySlug: "developer",
    title: "Rust Node Core",
    description:
      "The high-performance Rust microservice. 60+ endpoints across protocol evaluation, PSBT operations, agent commands, event storage, and scanner loops.",
    icon: "zap",
    sortOrder: 64,
    content: `## Rust Node Core

The Rust node-core microservice handles the performance-critical protocol operations. Runs alongside the TypeScript application and communicates via HTTP on localhost. Over 60 endpoints organized into five major groups.

### Why Rust

- **Deterministic performance.** No GC pauses during validation. Consistent latency under load.
- **Memory safety.** No buffer overflows in cryptographic operations. No use-after-free.
- **Throughput.** Handles high event volumes without degradation. Tokio async runtime.
- **Correctness.** Strong type system and ownership model prevent subtle bugs at compile time.

### Endpoint Groups

#### Protocol Evaluation (Core Truth Engine)

\`\`\`
POST /v1/protocol/truth/evaluate      # Evaluate protocol truth for a set of events
POST /v1/protocol/truth/batch         # Batch evaluation for multiple event sets
POST /v1/protocol/validate            # Validate a single event against protocol rules
POST /v1/protocol/validate/batch      # Batch validation
POST /v1/witness/select               # Deterministic witness selection (HMAC-SHA256)
POST /v1/witness/verify               # Verify witness eligibility
POST /v1/fees/split                   # Calculate fee split for a transaction
POST /v1/fees/verify                  # Verify fee split correctness
POST /v1/poa/challenge/generate       # Generate PoA challenge for a chain
POST /v1/poa/challenge/verify         # Verify PoA challenge response
\`\`\`

The truth engine is the most critical component. Given a set of protocol events, it computes the deterministic marketplace state. Every node must produce identical output from identical input.

#### PSBT Operations

\`\`\`
POST /v1/psbt/encrypt                 # Encrypt PSBT with AES-256-GCM
POST /v1/psbt/decrypt                 # Decrypt PSBT from shards
POST /v1/psbt/shards/split            # Split AES key via Shamir (3-of-4)
POST /v1/psbt/shards/reconstruct      # Reconstruct AES key from shares
POST /v1/psbt/shards/verify-share     # Verify a single shard's integrity
POST /v1/psbt/shards/validate-payload # Validate encrypted PSBT payload
POST /v1/psbt/reveal/challenge/create # Create reveal challenge (Ed25519 signed)
POST /v1/psbt/reveal/challenge/verify # Verify reveal challenge response
POST /v1/psbt/validate/sighash        # Validate SIGHASH_SINGLE|ANYONECANPAY
POST /v1/psbt/validate/inputs         # Validate ordinal input constraints
POST /v1/psbt/coverage/check          # Check shard coverage for a listing
POST /v1/psbt/coverage/rebalance      # Trigger shard rebalancing
\`\`\`

PSBT operations are performance-sensitive because they involve cryptographic operations (AES-GCM, Shamir interpolation, Ed25519 signing) on every reveal and every listing.

#### Agent Operations

\`\`\`
POST /v1/agent/command/list           # Process list command
POST /v1/agent/command/delist         # Process delist command
POST /v1/agent/command/purchase       # Process purchase command
POST /v1/agent/command/pool-register  # Register node in witness pool
POST /v1/agent/command/pool-status    # Query pool registration status
POST /v1/agent/psbt-share             # Handle PSBT share distribution
POST /v1/agent/psbt-share/challenge   # Handle PSBT share challenge
POST /v1/agent/quote/generate         # Generate price quote
POST /v1/agent/quote/verify           # Verify quote signature
POST /v1/agent/runtime/status         # Agent runtime health check
POST /v1/agent/runtime/metrics        # Agent runtime metrics
POST /v1/agent/recovery/initiate      # Initiate PSBT recovery from shards
POST /v1/agent/recovery/status        # Check recovery status
\`\`\`

Agent operations bridge the protocol layer with chain-specific settlement logic. The command endpoints process marketplace actions, while recovery handles edge cases where the normal flow fails.

#### Event Storage

\`\`\`
POST /v1/events/save                  # Persist a signed protocol event
POST /v1/events/save/batch            # Batch persist multiple events
POST /v1/events/replay                # Replay events for state reconstruction
POST /v1/events/query                 # Query events by type, time range, node
POST /v1/events/query/by-listing      # Query events for a specific listing
POST /v1/events/query/by-node         # Query events from a specific node
POST /v1/events/prune                 # Prune events past retention tier
POST /v1/listings/state               # Compute listing state from events
POST /v1/listings/state/batch         # Batch listing state computation
POST /v1/listings/search              # Full-text search over listings
\`\`\`

Event storage is the persistence backbone. Every protocol action is an immutable signed event. The event store handles writing, querying, replay (for state reconstruction after restart), and pruning (based on retention tiers defined in the protocol package).

#### Scanner

\`\`\`
POST /v1/scanner/tick                 # Advance scanner by one tick
POST /v1/scanner/status               # Scanner health and position
POST /v1/scanner/chain/{chain}/head   # Current chain head position
POST /v1/scanner/chain/{chain}/sync   # Force chain sync
\`\`\`

The scanner continuously monitors supported blockchains for settlement transactions. Each tick checks for new blocks, processes confirmed transactions, and emits \`TX_OBSERVED\` events.

### Module Overview

| Module | Size | Responsibility |
|--------|------|----------------|
| main.rs | 28KB | HTTP server setup, routing, middleware |
| agent_runtime.rs | 28KB | Agent lifecycle, quote generation, health |
| agent_commands.rs | 23KB | List/delist/purchase command processing |
| agent_recovery.rs | 18KB | PSBT recovery from shards |
| event_store.rs | 41KB | Event persistence, querying, replay |
| psbt_share.rs | 25KB | PSBT shard management and distribution |
| logic.rs | 24KB | Core marketplace logic and state computation |
| psbt_logic.rs | 12KB | PSBT-specific validation (sighash, inputs) |
| fee_wallets.rs | 18KB | Fee account management and distribution |
| poa.rs | 15KB | Proof-of-Access challenge generation/verification |
| scanner.rs | 20KB | Chain scanner loops and transaction detection |
| witness.rs | 14KB | Witness selection and eligibility verification |

### Parity Testing

The Rust implementation maintains 1:1 parity with the TypeScript protocol logic. Both implementations are tested against shared test vectors:

- Same inputs must produce identical outputs.
- Shared JSON test vector files cover edge cases.
- CI runs parity checks on every commit.
- Any divergence between TypeScript and Rust is treated as a critical bug.

This dual-implementation strategy provides defense against implementation bugs. If TypeScript and Rust independently produce the same result, confidence in correctness is high.

### Communication

The TypeScript application talks to node-core via HTTP on localhost:

\`\`\`typescript
const result = await fetch(
  \`http://localhost:\${NODE_CORE_PORT}/v1/protocol/truth/evaluate\`,
  { method: "POST", body: JSON.stringify(validationInput) }
);
\`\`\`

This separation provides: independent scaling and deployment, language-appropriate tooling for each component, clear API boundaries with typed request/response schemas, and independent testing and auditing.`,
  },

  {
    slug: "getting-started-dev",
    category: "Developer",
    categorySlug: "developer",
    title: "Getting Started (Developer)",
    description:
      "Developer quick start. Local setup, dev commands, package guidelines, and how to add new protocol events and API routes.",
    icon: "terminal",
    sortOrder: 65,
    content: `## Getting Started (Developer)

Everything you need to go from zero to a running local dev cluster.

### Local Setup

\`\`\`bash
# Clone the repository
git clone https://github.com/decenterlize/decenterlizemarket.git
cd decenterlizemarket

# Install dependencies (pnpm required)
pnpm install

# Start infrastructure (PostgreSQL, Redis)
docker compose up -d

# Copy environment template
cp .env.example .env

# Run database migrations
pnpm db:migrate

# Start the dev server
pnpm dev
\`\`\`

### Dev Commands

| Command | Description |
|---------|-------------|
| \`pnpm dev\` | Start single node in development mode |
| \`pnpm dev:cluster\` | Start a multi-node local cluster (3 nodes) |
| \`pnpm dev:btc\` | Start with Bitcoin testnet/regtest configuration |
| \`pnpm dev:evm\` | Start with EVM local chain (Hardhat/Anvil) |
| \`pnpm dev:sol\` | Start with Solana localnet |
| \`pnpm test\` | Run the full test suite (vitest) |
| \`pnpm build\` | Production build |
| \`pnpm bench:dashboard\` | Start the benchmark dashboard on port 4400 |
| \`pnpm db:migrate\` | Run database migrations |
| \`pnpm db:seed\` | Seed development data |

### Package Guidelines

Each package has a specific role and a strict dependency direction. Packages higher in the stack can depend on packages below them, but never the reverse.

**packages/protocol** \u2014 The foundation. Zero external dependencies. Pure Zod schemas and deterministic validation logic. Every function must be deterministic: same input, same output, every time. No IO, no randomness, no side effects. If you're adding something here, it must be a protocol rule that every node computes identically.

**packages/db** \u2014 Database layer. Drizzle ORM schemas for PostgreSQL. Can depend on \`protocol\` for type definitions. Each node has its own isolated database. No shared DB across nodes.

**packages/agent** \u2014 Node runtime. Mesh networking, gossip protocol, peer management, heartbeat. Can depend on \`protocol\` and \`db\`. This is the process lifecycle layer.

**packages/server** \u2014 Business logic. tRPC routers, API handlers, chain-specific settlement. Can depend on all other packages. This is where marketplace logic lives.

**packages/cache** \u2014 Redis caching and rate limiting. Used by \`server\` and \`agent\`.

### Adding a New Protocol Event

When you need to add a new event type to the protocol:

1. **Define the schema** in \`packages/protocol/src/events/\`. Use Zod for the payload schema. The schema must be deterministic (no optional fields that affect validation).

\`\`\`typescript
export const MY_NEW_EVENT = z.object({
  type: z.literal("MY_NEW_EVENT"),
  payload: z.object({
    // your fields here
  }),
  nodeId: z.string(),
  timestamp: z.number(),
  signature: z.string(),
});
\`\`\`

2. **Add the event constant** to the event type registry in \`packages/protocol/src/events/index.ts\`.

3. **Register the event** in the protocol validator so it gets included in truth evaluation.

4. **Add a retention tier.** Events have different retention periods based on their importance. Critical events (settlements, attestations) are kept forever. Ephemeral events (heartbeats) are pruned aggressively.

5. **Implement the handler** in \`packages/server/\` that processes the event when received via gossip.

6. **Add test vectors.** Create test cases in both TypeScript and (if applicable) Rust to maintain parity.

### Adding a New API Route

1. **Create the route file** in the appropriate directory under \`packages/server/src/\`.

2. **Use tRPC.** All routes are tRPC procedures with typed inputs and outputs.

\`\`\`typescript
export const myRouter = router({
  myEndpoint: protectedProcedure
    .input(z.object({ /* input schema */ }))
    .mutation(async ({ input, ctx }) => {
      // implementation
    }),
});
\`\`\`

3. **Add node authentication.** Internal routes must use \`protectedProcedure\` which verifies the Ed25519 signature in the request headers.

4. **Add rate limiting.** Apply the appropriate rate limit tier based on the endpoint's sensitivity and expected call frequency.

5. **Register the route** in the main router composition.

### Testing

The project uses **vitest** for all testing:

- **Unit tests** live alongside the code they test.
- **Integration tests** in \`__tests__/\` cover API routes and cross-package flows.
- **Security tests** in \`packages/server/__tests__/\` cover specific attack vectors:
  - \`dev-cluster/\` \u2014 Session attestation, UI integrity
  - \`governance/\` \u2014 Misbehavior strikes
  - \`mpc/\` \u2014 Key safety
  - \`node-auth/\` \u2014 Authentication edge cases
  - \`pow/\` \u2014 Rogue node detection
  - \`verification/\` \u2014 TX-plan quorum

Run the full suite with \`pnpm test\`. Run a specific test file with \`pnpm vitest run path/to/test.ts\`.

### Environment Variables

Key environment variables (see \`.env.example\` for the full list):

| Variable | Description |
|----------|-------------|
| \`DATABASE_URL\` | PostgreSQL connection string |
| \`REDIS_URL\` | Redis connection string |
| \`NODE_ID\` | Unique node identifier |
| \`NODE_PRIVATE_KEY\` | Ed25519 private key (hex) |
| \`BTC_RPC_URL\` | Bitcoin RPC endpoint |
| \`ETH_RPC_URL\` | Ethereum RPC endpoint |
| \`SOL_RPC_URL\` | Solana RPC endpoint |
| \`FULL_NODE_CHAT\` | Set to \`1\` to store all chat threads (not just assigned shards) |
| \`FULL_NODE_MEDIA\` | Set to \`1\` to cache all media (not just assigned shards) |`,
  },

  {
    slug: "benchmarks",
    category: "Developer",
    categorySlug: "developer",
    title: "Benchmarks",
    description:
      "Benchmark dashboard with 32+ benchmarks, JSON Lines streaming, P5.js visualizations, and coverage across PSBT, protocol, gossip, MPC, and consensus.",
    icon: "bar-chart",
    sortOrder: 66,
    content: `## Benchmarks

The benchmark dashboard is a standalone developer tool for measuring and visualizing protocol performance. It runs 32+ benchmarks across every critical subsystem with real-time streaming and P5.js animated visualizations.

### Quick Start

\`\`\`bash
# Start the benchmark dashboard
pnpm bench:dashboard

# Opens on http://localhost:4400
\`\`\`

The dashboard provides a live UI with benchmark selection, real-time progress bars, animated visualizations, and failure analysis panels.

### Architecture

The benchmark platform has three layers:

1. **Benchmark modules.** Each benchmark is a self-contained module in \`services/benchmark-dashboard/benchmarks/\`. Standardized interface for humans and agents to create new benchmarks.
2. **Test runner.** Executes benchmarks, captures output, and streams results via the JSON Lines protocol.
3. **Dashboard UI.** React frontend with P5.js visualizations, live streaming updates, and a sidebar for benchmark navigation.

### JSON Lines Streaming Protocol

Benchmarks emit structured output using the JSON Lines protocol (one JSON object per line). The dashboard reads this stream in real time:

\`\`\`jsonl
{"type":"start","benchmark":"ed25519-signing","timestamp":1679500000}
{"type":"progress","benchmark":"ed25519-signing","percent":45,"ops_per_sec":12500}
{"type":"result","benchmark":"ed25519-signing","mean_ms":0.08,"p99_ms":0.12,"ops_per_sec":12500}
{"type":"end","benchmark":"ed25519-signing","passed":true,"duration_ms":5000}
\`\`\`

This protocol enables live progress tracking, streaming results to the dashboard without polling, and machine-readable output for CI integration.

### Benchmark Categories

#### Bitcoin & PSBT

| Benchmark | What It Measures |
|-----------|-----------------|
| bitcoin-address-derivation | BIP-32/44/84 key derivation throughput |
| psbt-coverage-analysis | Shard distribution coverage across node sets |

#### Cryptographic Primitives

| Benchmark | What It Measures |
|-----------|-----------------|
| ed25519-signing | Ed25519 sign/verify throughput (TweetNaCl) |
| signature-verification | Batch signature verification performance |

#### Protocol & Serialization

| Benchmark | What It Measures |
|-----------|-----------------|
| event-serialization | Protocol event serialize/deserialize throughput |
| listing-state-machine | State machine transition performance under load |

#### Gossip & Networking

| Benchmark | What It Measures |
|-----------|-----------------|
| gossip-sync-engine | Gossip push/pull sync convergence speed |
| heartbeat-processing | Heartbeat processing throughput at scale |
| neighbor-selection | Mesh neighbor selection algorithm performance |

#### Consensus & Governance

| Benchmark | What It Measures |
|-----------|-----------------|
| governance-vote-tally | Vote counting and delegation chain resolution |
| delegation-chain | Deep delegation chain traversal performance |

#### MPC & Security

| Benchmark | What It Measures |
|-----------|-----------------|
| mpc-threshold-security | MPC key share operations and threshold signing simulation |

#### Infrastructure & Scaling

| Benchmark | What It Measures |
|-----------|-----------------|
| cache-stampede | Redis cache stampede resistance under concurrent load |
| rate-limiter-throughput | Rate limiter decision throughput at scale |
| shard-ring-scaling | Consistent hash ring performance as node count grows |

#### Network Resilience

| Benchmark | What It Measures |
|-----------|-----------------|
| rogue-node-detection | Time to detect and evict misbehaving nodes |
| self-heal-convergence | Network convergence time after node failures |

### P5.js Visualizations

Each benchmark category has animated P5.js visualizations in the dashboard:

- **Network graphs** showing gossip propagation in real time.
- **Ring diagrams** for consistent hash ring shard distribution.
- **Convergence plots** for self-healing and sync benchmarks.
- **Throughput meters** for cryptographic primitive benchmarks.
- **State machine diagrams** for listing lifecycle benchmarks.

Visualizations update live as benchmark data streams in.

### Dashboard UI Components

The dashboard UI is built with React and includes:

- **TopNav** \u2014 Benchmark suite controls and global status.
- **TestSidebar** \u2014 Tree view of all benchmark categories and individual benchmarks.
- **TestProgressBar** \u2014 Real-time progress for the running benchmark.
- **TestCounters** \u2014 Pass/fail/skip counters.
- **TestFailurePanel** \u2014 Detailed failure analysis with stack traces and expected vs. actual comparisons.
- **TestDashboard** \u2014 Main content area with results and visualizations.

### Adding a New Benchmark

Create a new directory under \`services/benchmark-dashboard/benchmarks/\`:

\`\`\`
benchmarks/
\u2514\u2500\u2500 my-new-benchmark/
    \u251c\u2500\u2500 index.ts          # Benchmark entry point
    \u251c\u2500\u2500 benchmark.ts      # Core benchmark logic
    \u2514\u2500\u2500 visualization.ts  # Optional P5.js visualization
\`\`\`

The benchmark module must export a standard interface:

\`\`\`typescript
export interface Benchmark {
  name: string;
  description: string;
  category: string;
  run(): AsyncGenerator<BenchmarkEvent>;
}
\`\`\`

The \`run()\` method yields JSON Lines events as the benchmark progresses. The dashboard picks these up automatically.

### CI Integration

Benchmarks can run in CI by capturing the JSON Lines output:

\`\`\`bash
pnpm bench:run --json > benchmark-results.jsonl
\`\`\`

Results can be compared across commits to detect performance regressions. The dashboard also supports loading historical results for comparison.`,
  },
];
