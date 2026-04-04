import type { DocEntry } from "./types";

export const MARKETPLACE_FEATURES_DOCS: DocEntry[] = [
  {
    slug: "collections-royalties",
    category: "Marketplace",
    categorySlug: "marketplace",
    title: "Collections & Royalties",
    description:
      "Collection types (EVM contract, parent-child, gallery, curated), the community submission and voting process, conflict detection, burn verification, and royalty distribution.",
    icon: "store",
    sortOrder: 73,
    content: `## Collections & Royalties

Collections group related assets together and define royalty policies. The system supports four collection types across all chains.

### Collection Types

**EVM_CONTRACT** -- Smart contract collections (Ethereum, Base, Arbitrum, Optimism)
- Identified by \`contractAddress\` and \`contractChainId\`
- Supports ERC-721 and ERC-1155 token standards
- Verified against actual on-chain contract state

**PARENT_CHILD** -- Bitcoin ordinal parent-child relationships
- Identified by \`parentInscriptionId\`
- Child inscriptions are automatically grouped under the parent
- Parent can be burned to "finalize" the collection (prevents new children)

**GALLERY** -- Explicit inscription lists
- Defined by a \`galleryManifest\` JSONB array of inscription IDs
- Manual curation -- no automatic parent linking
- Used for curated ordinal collections that don't share a parent

**CURATED** -- Generic custom collections
- No on-chain verification requirements
- User-defined metadata only
- Useful for thematic groupings across chains

### Collection Submission & Voting

Anyone can propose a new collection through the submission system:

1. **Submit** -- User creates a \`collectionSubmissions\` record with:
   - Collection type and chain-specific identifiers
   - Proposed name, description, image URL
   - For ordinal ranges: \`inscriptionNumberStart\` and \`inscriptionNumberEnd\`

2. **Conflict Detection** -- System scans \`inscriptionCache\` for overlaps:
   - If no conflicts: \`autoVerified = true\`, collection is soft-approved immediately
   - If conflicts found: \`hasConflict = true\`, \`conflictDetails\` stored, 7-day voting period begins

3. **Burn Detection** (PARENT_CHILD only):
   - System checks if parent inscription has been burned
   - Detection methods: Satoshi's address, standard burn address, OP_RETURN, zero output value
   - \`parentBurnDetected\` and \`parentBurnMethod\` are recorded

4. **Community Voting** -- Nodes vote to verify or reject:
   - Each node can vote once per submission
   - \`verifyVotes\` and \`rejectVotes\` tallied
   - 7-day deadline for conflicted proposals
   - Requires supermajority to resolve

5. **Resolution** -- Once approved:
   - Status moves to VERIFIED, \`resolvedAt\` timestamp set
   - Metadata merged into \`collectionMetadata\`
   - Listings can now reference this collection for royalty enforcement

### Royalty Distribution

Each collection can have multiple royalty recipients defined in \`collectionRegistry\`:

| Field | Purpose |
|-------|---------|
| \`collectionId\` | Which collection |
| \`recipientAddress\` | Wallet to receive royalties |
| \`bps\` | Basis points (0-10000, i.e. 0% to 100%) |

**Multiple recipients supported** -- co-creators can split royalties. For example:
- Artist A: 500 bps (5%)
- Artist B: 300 bps (3%)
- Total royalty: 800 bps (8%)

Listings can override royalties via \`royaltyBpsOverride\` (0-10000). The \`computeRoyaltyOutputs\` function calculates exact recipient amounts using deterministic integer arithmetic -- no floating point, no rounding errors.

On purchase, royalties are deducted from the seller's proceeds before the marketplace fee:

\`\`\`
sellerReceives = price - marketplaceFee - totalRoyalties
\`\`\`

### Inscription Cache

Bitcoin ordinal metadata is cached locally in \`inscriptionCache\`:

| Field | Purpose |
|-------|---------|
| \`inscriptionId\` | Primary key -- the inscription identifier |
| \`inscriptionNumber\` | Sequential Bitcoin ordinal number |
| \`contentType\` / \`contentUrl\` | Media type and source URL |
| \`owner\` | Current owner address |
| \`satRarity\` | Rarity classification of the underlying satoshi |
| \`parentInscriptionId\` | Parent for child inscriptions |
| \`collectionId\` | Resolved collection assignment |

This cache is populated from the \`ord\` indexer and updated periodically. It enables fast lookups without hitting the indexer for every query.`,
  },

  {
    slug: "media-system",
    category: "Marketplace",
    categorySlug: "marketplace",
    title: "Media Cache & Optimization",
    description:
      "Distributed media caching with multi-format optimization (AVIF, WebP, JXL, video), blur placeholders, demand-based tiered storage, distributed processing with node rewards.",
    icon: "store",
    sortOrder: 74,
    content: `## Media Cache & Optimization

Every listed asset needs media (images, video, 3D models). The media system fetches, processes, optimizes, and distributes media across the network with automatic format conversion and demand-based tiering.

### Media Lifecycle

**1. Discovery** -- When a listing is created, the system extracts the media source URL:
- BTC ordinals: recursive inscription content, \`ord\` indexer metadata
- EVM NFTs: contract metadata URIs (ERC-721 \`tokenURI\`, ERC-1155 \`uri\`)
- Solana: Metaplex metadata accounts

**2. Fetching** -- Media is downloaded with safeguards:
- Maximum size: 100 MB (configurable via \`mediaCacheMaxBytes\`)
- Follows HTTP redirects (max 5 hops)
- Respects cache headers (ETag, Last-Modified)
- Marks as ERROR if unreachable, TOO_LARGE if oversized

**3. Processing** -- Content-aware optimization:
- Images: convert to optimized formats (AVIF, WebP preferred)
- Video: extract poster frame and preview thumbnails
- HTML/JSON: parse and extract referenced media (recursive ordinals)
- Generate blur placeholder data URIs for instant loading

**4. Storage** -- Distributed across the network:
- Local filesystem paths (\`localProcessedPath\`, \`localOriginalPath\`)
- Foundation gateway URL (\`foundationUrl\`) for IPFS or centralized fallback
- Replicated to other nodes based on demand tier

### Media Entry Schema

Each cached media entry tracks:

| Field | Purpose |
|-------|---------|
| \`kind\` | IMAGE, VIDEO, AUDIO, HTML, MODEL, or FILE |
| \`status\` | PENDING, READY, TOO_LARGE, ERROR, MISSING |
| \`sourceContentType\` / \`processedContentType\` | Original and optimized MIME types |
| \`sourceBytes\` / \`processedBytes\` | Size tracking |
| \`blurDataUri\` | Inline base64 blur placeholder for instant display |
| \`transformed\` | Whether processed version differs from original |

### Multi-Format Variants

Each media entry can have multiple optimized variants stored in \`mediaCacheVariants\`:

| Variant Key | Purpose |
|-------------|---------|
| \`blur\` | Tiny blurred preview (< 1 KB) |
| \`micro\` | Minimal thumbnail for grids |
| \`thumb\` | Standard thumbnail |
| \`optimized\` | Web-optimized full size |
| \`original\` | Untouched source file |
| \`poster\` | Video cover frame |
| \`preview\` | Medium-size preview |

**Output Formats:**

| Format | Use Case |
|--------|----------|
| AVIF | Best compression for images (preferred) |
| WebP | Wide browser support fallback |
| JXL (JPEG XL) | Progressive decoding, lossless option |
| H.265/AV1 | Next-gen video compression |
| H.264 | Legacy video compatibility |
| gif-webp / gif-avif | Animated GIF replacements |

Each (parentCacheId, variantKey, format) combination is unique.

### Distributed Processing

Media optimization is distributed across nodes via a job queue:

1. **Enqueue** -- \`mediaOptimizationJobs\` are created with target variant, format, dimensions, and priority (1-100)
2. **Assign** -- Nodes claim jobs based on their optimizer tier (BASIC, STANDARD, HIGH)
3. **Process** -- The assigned node creates the variant and uploads it
4. **Reward** -- Nodes earn \`MEDIA_OPTIMIZATION\` reward claims for completed work

**Reward Formula:**
\`\`\`
reward = (sourceBytes / 1 MB) * FORMAT_MULTIPLIER * TIER_BONUS * BASE_REWARD
\`\`\`

| Factor | Values |
|--------|--------|
| FORMAT_MULTIPLIER | AV1: 10.0, H.265: 5.0, H.264: 3.0, AVIF: 1.5, JXL: 1.2, WebP: 1.0 |
| TIER_BONUS | HIGH: 1.0, STANDARD: 0.8, BASIC: 0.5, NONE: 0.25 |

Computationally expensive formats (AV1, H.265) pay higher rewards to incentivize nodes to invest in processing hardware.

### Demand-Based Tiering

Media access patterns drive storage decisions via \`mediaDemandScores\`:

| Tier | Criteria | Behavior |
|------|----------|----------|
| HOT | High request count, trending up | Replicated aggressively, long cache TTL |
| WARM | Moderate requests, stable trend | Standard replication, moderate cache TTL |
| COLD | Low requests, trending down | Minimal replication, short cache TTL |

Scores are updated on every access. The \`trendScore\` (-1.0 to 1.0) tracks whether demand is rising or falling. The rebalancer periodically promotes/demotes entries between tiers.

### Recursive Ordinal Handling

Bitcoin ordinals can contain HTML/JSON that references other inscriptions (recursive inscriptions). The system handles this by:

1. Detecting recursive references (\`isOrdinalRecursiveSource\`)
2. Resolving dependencies up to \`ordinalRecursionMaxDepth\` (default: 3)
3. Limiting to \`ordinalRecursionMaxDependencies\` (default: 10)
4. Building merged bundles (\`maybeBuildOrdinalRecursiveBundle\`)
5. Applying shorter stale TTL (\`ordinalDynamicStaleMs\`) for dynamic content

### Serving

Media is served via \`/api/media/cache/[cacheId]\`:
- Returns the best available variant based on Accept headers
- Cache-Control headers vary by demand tier (HOT = aggressive caching, COLD = short TTL)
- Blur placeholders are returned inline for instant perceived loading`,
  },

  {
    slug: "moderation-system",
    category: "Marketplace",
    categorySlug: "marketplace",
    title: "Moderation & Reputation",
    description:
      "Community-driven content moderation. Voting on scams, copyright, and inappropriate content with micro-rewards for valid votes and escalating strike penalties.",
    icon: "store",
    sortOrder: 75,
    content: `## Moderation & Reputation

Content moderation is decentralized -- the community votes on what to allow or remove, with token rewards for valid moderation votes.

### Moderation Actions

| Action | Target Types | Purpose |
|--------|-------------|---------|
| \`DISABLE_SCAM\` | Listing, Collection, Profile | Hide malicious or deceptive content |
| \`COPYRIGHT_STRIKE\` | Listing, Collection | Content violates intellectual property |
| \`INAPPROPRIATE_CONTENT\` | Listing, Collection, Profile | NSFW, illegal, or policy-violating content |
| \`RESTORE\` | Listing, Collection, Profile | Reverse a previous moderation action |
| \`OTHER\` | Any | Custom moderation reason |

### Voting Process

1. **Report** -- Any user can submit a moderation vote targeting a listing, collection, or profile
2. **Vote** -- Community members vote APPROVE (agree with action) or REJECT (disagree):
   - Each voter can only vote once per (targetId, action) combination
   - Votes include a text reason explaining the voter's position
   - AI-assisted votes are flagged: \`llmAssisted\`, \`llmModel\`, \`llmConfidence\`
3. **Tally** -- \`moderationOutcomes\` tracks running \`approveCount\` and \`rejectCount\`
4. **Resolution** -- When threshold is reached (e.g. 2/3 supermajority):
   - \`resolved = true\`, action is executed (hide listing, flag profile, etc.)
   - All voters on the winning side earn \`MODERATION_REWARD\` token claims

### Micro-Rewards

Valid moderation votes earn token rewards:
- Reward claims are created with reason \`MODERATION_REWARD\`
- Claims enter the weekly epoch batching system
- Paid out via MPC threshold signature on the sidechain
- Incentivizes active community curation without centralized moderators

### Misbehavior Strikes (Node Level)

Nodes that violate protocol rules accumulate strikes with escalating penalties:

| Strike Count | Penalty |
|-------------|---------|
| 1 | Warning |
| 2 | 24-hour fee suspension |
| 3 | 72-hour fee suspension |
| 4+ | Permanent ban (bond slashed) |

Strikes decay over time -- good behavior reduces your strike count. The strike system is separate from user-facing content moderation; it targets node operators who submit invalid attestations, fail PoA challenges repeatedly, or attempt to manipulate the PoW fee competition.

### Foundation Override

During beta, the foundation master node (Node-1) retains emergency moderation powers. All foundation moderation actions are:
- Signed as protocol events
- Gossiped to every node
- Visible in the protocol explorer
- Subject to the same transparency requirements as any other foundation action`,
  },

  {
    slug: "search-discovery",
    category: "Marketplace",
    categorySlug: "marketplace",
    title: "Search & Discovery",
    description:
      "How users find listings, browse collections, view activity feeds, check ownership, and discover seller profiles. Cursor-based pagination and real-time price conversion.",
    icon: "search",
    sortOrder: 76,
    content: `## Search & Discovery

The marketplace provides several discovery mechanisms for buyers and sellers.

### Seller Profiles

The \`sellerProfile\` endpoint returns comprehensive seller data:

- **Listings**: All listings by this seller, paginated and ordered by creation date
- **Stats**: Open count, sold count, delisted count
- **Volume**: Total listed volume and total sold volume per chain
- **Top Collections**: Most frequently listed collections with per-collection stats

### Global Statistics

The \`stats\` endpoint returns a real-time network snapshot:
- Total listings across all chains
- Total completed orders
- Total protocol events processed
- Currently open listing count

### Activity Feeds

The activity endpoint supports filtered, paginated activity logs:

| Filter | Purpose |
|--------|---------|
| \`kinds\` | Array of activity types (MINT, TRANSFER, LIST, BUY, SELL, etc.) |
| \`chain\` | Filter to specific blockchain |
| \`address\` | Filter to specific wallet |
| \`collectionId\` | Filter to specific collection |
| \`listingOutpoint\` | Filter to specific listing |

Activity uses keyset pagination on \`assetActivity.id\` (which is a sortable \`{epochMs}_{random}\` format). No OFFSET is used anywhere -- all pagination is cursor-based for consistent performance at any depth.

### Ownership Discovery

The \`ownedAssets\` endpoint detects chain from wallet address format and returns owned assets:

- **Bitcoin**: Ordinals via inscription cache lookups
- **EVM**: NFTs via on-chain contract queries (ERC-721/ERC-1155)
- **Solana**: SPL tokens via account enumeration

Results are served from \`assetOwnershipCache\` with optimistic responses (serve cached data immediately, verify on-chain in the background). Stale entries are tracked by \`verifiedAt\` and refreshed periodically.

### Price Conversion

The \`nativeUsdRates\` endpoint provides current BTC/ETH/SOL to USD exchange rates for converting \`priceSats\` to display currencies in the UI.

### Pagination Strategy

All list queries use cursor-based (keyset) pagination:

\`\`\`
WHERE id < ?cursor ORDER BY id DESC LIMIT ?pageSize
\`\`\`

This avoids the performance degradation of OFFSET-based pagination on large tables. Cursors are opaque strings (the \`id\` field) passed back to the client for the next page.

### Indexed vs Unindexed Listings

The system distinguishes between indexed and unindexed listings:
- **Indexed**: Displayed in search, counted in stats -- status is OPEN and not admin-flagged
- **Unindexed**: Hidden from search -- used for admin/test/moderated listings

This allows soft-removal of content through moderation without deleting data.`,
  },
];
