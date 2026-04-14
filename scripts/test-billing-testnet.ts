/**
 * Testnet billing test — deploys contracts to real testnets and runs the full
 * subscription lifecycle with actual on-chain transactions.
 *
 * Requires:
 *   DEPLOY_PRIVATE_KEY=0x...     (funded testnet wallet)
 *
 * Optional env:
 *   TESTNET=baseSepolia|sepolia|solanaDevnet  (default: baseSepolia)
 *   BASE_SEPOLIA_RPC_URL=...
 *   ETH_SEPOLIA_RPC_URL=...
 *   SOL_DEVNET_RPC_URL=...
 *   TREASURY_ADDRESS=0x...       (defaults to deployer)
 *   SKIP_DEPLOY=1                (skip deploy, use existing contract addresses)
 *   SUBSCRIPTION_CONTRACT=0x...  (use with SKIP_DEPLOY)
 *   ANCHOR_CONTRACT=0x...        (use with SKIP_DEPLOY)
 *
 * Run:
 *   tsx --env-file=.env scripts/test-billing-testnet.ts
 *   TESTNET=sepolia tsx --env-file=.env scripts/test-billing-testnet.ts
 */

import { ethers } from "ethers";
import { createHmac, randomBytes } from "crypto";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL!;
const sql = postgres(DATABASE_URL, { prepare: false });

const TESTNET = process.env.TESTNET || "baseSepolia";
const PRIVATE_KEY = process.env.DEPLOY_PRIVATE_KEY;
const SKIP_DEPLOY = process.env.SKIP_DEPLOY === "1";

if (!PRIVATE_KEY) {
  console.error(`
  DEPLOY_PRIVATE_KEY is required.

  Set it in .env or inline:
    DEPLOY_PRIVATE_KEY=0x... tsx --env-file=.env scripts/test-billing-testnet.ts

  Get testnet ETH:
    Base Sepolia: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
    ETH Sepolia:  https://sepoliafaucet.com
  `);
  process.exit(1);
}

let passed = 0;
let failed = 0;
const ok = (l: string) => { passed++; console.log(`  ✅ ${l}`); };
const fail = (l: string, d?: string) => { failed++; console.log(`  ❌ ${l}${d ? ` — ${d}` : ""}`); };
const section = (n: string) => console.log(`\n${"─".repeat(50)}\n  ${n}\n${"─".repeat(50)}`);

// ── ABI ──

const SUBSCRIPTION_ABI = [
  "constructor(address _treasury, address[] _allowedTokens)",
  "function createSubscription(address token, uint256 amount, uint64 interval) returns (uint256)",
  "function createLifetime(address token, uint256 amount) returns (uint256)",
  "function collectPayment(uint256 subId)",
  "function cancel(uint256 subId)",
  "function isActive(uint256 subId) view returns (bool)",
  "function subscriptions(uint256) view returns (address subscriber, address token, uint256 amount, uint64 interval, uint64 lastPaidAt, uint64 expiresAt, bool active, bool lifetime)",
  "function getSubscriberSubscriptions(address) view returns (uint256[])",
  "function nextSubId() view returns (uint256)",
  "event SubscriptionCreated(uint256 indexed subId, address indexed subscriber, address token, uint256 amount, uint64 interval)",
  "event PaymentCollected(uint256 indexed subId, address indexed subscriber, uint256 amount)",
  "event SubscriptionCancelled(uint256 indexed subId, address indexed subscriber)",
  "event SubscriptionLapsed(uint256 indexed subId, address indexed subscriber)",
  "event LifetimePayment(uint256 indexed subId, address indexed subscriber, uint256 amount)",
];

const ANCHOR_ABI = [
  "constructor()",
  "function anchorHash(bytes32 documentHash)",
  "function anchorBatch(bytes32[] hashes, bytes32 batchId)",
  "function verifyHash(bytes32 documentHash) view returns (bool anchored, uint64 timestamp, address anchorer)",
  "function anchorCount() view returns (uint256)",
  "event HashAnchored(bytes32 indexed documentHash, address indexed anchorer, uint64 timestamp, bytes32 batchId)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  // Mock only
  "function mint(address to, uint256 amount)",
];

const MOCK_ERC20_BYTECODE = "0x608060405234801561001057600080fd5b506040516108a03803806108a08339810160408190526100309161012a565b600061003c8482610223565b50600161004984826102e1565b506002805460ff191660ff929092169190911790556100646000600019610079565b505050610383565b634e487b7160e01b5f52604160045260245ffd5b80546001019055565b634e487b7160e01b5f52601160045260245ffd5b600181815b808511156100d657815f19048211156100bc576100bc610086565b808516156100c957918102915b93841c93908002906100a1565b509250929050565b5f826100ec5750600161010f565b816100f85750600061010f565b81600181146101065760028114610110575b5061010f565b600161010f565b506001610110565b60ff84169050806101235760019150610124565b5b9392505050565b5f805f6060848603121561013c575f80fd5b83516001600160401b0380821115610152575f80fd5b818601915086601f830112610165575f80fd5b81518181111561017757610177610071565b604051601f8201601f19908116603f0116810190838211818310171561019f5761019f610071565b816040528281528960208487010111156101b7575f80fd5b8260208601602083015e5f6020848301015280975050505060208601519350604086015191505092959194509250565b600181811c908216806101fa57607f821691505b60208210810361021857634e487b7160e01b5f52602260045260245ffd5b50919050565b601f82111561026757805f5260205f20601f840160051c810160208510156102435750805b601f840160051c820191505b81811015610262575f815560010161024f565b505050565b505050565b81516001600160401b0381111561028557610285610071565b6102998161029384546101e6565b8461021e565b602080601f8311600181146102cc575f84156102b55750858301515b5f19600386901b1c1916600185901b178555610320565b5f85815260208120601f198616915b828110156102fa578886015182559484019460019091019084016102db565b508582101561031757878501515f19600388901b60f8161c191681555b505060018460011b0185555b505050505050565b81516001600160401b0381111561034357610343610071565b610357816103518454610206565b8461022e565b602080601f83116001811461038a575f84156103745750858301515b5f19600386901b1c1916600185901b178555610320565b5f85815260208120601f198616915b828110156103b857888601518255948401946001909101908401610399565b50858210156103d557878501515f19600388901b60f8161c191681555b505060018460011b0185555b505050505050565b61050f806103f15f395ff3fe608060405234801561000f575f80fd5b5060043610610090575f3560e01c806340c10f191161006357806340c10f191461010857806370a082311461011d57806395d89b411461014d578063a9059cbb14610155578063dd62ed3e14610168575f80fd5b8063095ea7b31461009457806318160ddd146100bc57806323b872dd146100d8578063313ce567146100eb575b5f80fd5b6100a76100a236600461043b565b6101a0565b60405190151581526020015b60405180910390f35b6100c560035481565b6040519081526020016100b3565b6100a76100e6366004610463565b610209565b6002546100f89060ff1681565b60405160ff90911681526020016100b3565b61011b61011636600461043b565b6102d4565b005b6100c561012b36600461049c565b6001600160a01b03165f9081526004602052604090205490565b6100c5610321565b6100a761016336600461043b565b6103ac565b6100c56101763660046104bc565b6001600160a01b039182165f90815260056020908152604080832093909416825291909152205490565b335f81815260056020908152604080832086851680855290835281842086905590518581529293909290917f8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925910160405180910390a35060015b92915050565b6001600160a01b0383165f9081526004602052604081205482111561022c575f80fd5b6001600160a01b038481165f9081526005602090815260408083203384529091529020548311156102595750805b6001600160a01b038481165f908152600560209081526040808320338452909152812080548592906102899084906104f4565b90915550506001600160a01b038085165f90815260046020526040808220805486900390559185168152208054830190556102c490849061043b565b5060019392505050565b80600360008282546102e09190610507565b90915550506001600160a01b0382165f81815260046020526040808220805485019055517fddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef905f90a35050565b5f8054610330906104ba565b80601f016020809104026020016040519081016040528092919081815260200182805461035c906104ba565b80156103a75780601f1061037e576101008083540402835291602001916103a7565b820191905f5260205f20905b81548152906001019060200180831161038a57829003601f168201915b505050505081565b335f9081526004602052604081205482111561032157335f90815260046020526040808220805485900390556001600160a01b0384168252812080548401905561040290339061043b565b5060015b92915050565b80356001600160a01b0381168114610422575f80fd5b919050565b5f6020828403121561043757575f80fd5b5035919050565b5f806040838503121561044d575f80fd5b6104568361040c565b946020939093013593505050565b5f805f60608486031215610475575f80fd5b61047e8461040c565b925061048c6020850161040c565b9150604084013590509250925092565b5f602082840312156104ab575f80fd5b6104b48261040c565b9392505050565b5f80604083850312156104cb575f80fd5b6104d48361040c565b91506104e26020840161040c565b90509250929050565b634e487b7160e01b5f52601160045260245ffd5b81810381811115610406576104066104eb565b80820180821115610406576104066104eb56fea164736f6c6343000819000a";

// ── Network config ──

const NETWORKS: Record<string, { rpc: string; chainId: number; explorer: string; usdc?: string }> = {
  baseSepolia: {
    rpc: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
    chainId: 84532,
    explorer: "https://sepolia.basescan.org",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
  sepolia: {
    rpc: process.env.ETH_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    chainId: 11155111,
    explorer: "https://sepolia.etherscan.io",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
};

async function run() {
  const net = NETWORKS[TESTNET];
  if (!net) {
    console.error(`Unknown testnet: ${TESTNET}. Options: ${Object.keys(NETWORKS).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n🌐 TESTNET BILLING TEST — ${TESTNET}\n`);
  console.log(`  RPC: ${net.rpc}`);
  console.log(`  Explorer: ${net.explorer}`);

  const provider = new ethers.JsonRpcProvider(net.rpc);
  const wallet = new ethers.Wallet(PRIVATE_KEY!, provider);
  const balance = await provider.getBalance(wallet.address);

  console.log(`  Wallet: ${wallet.address}`);
  console.log(`  Balance: ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    console.error(`\n  Wallet has no ETH! Get testnet ETH from a faucet first.`);
    process.exit(1);
  }

  let subContractAddr: string;
  let anchorContractAddr: string;
  let mockTokenAddr: string | null = null;

  if (SKIP_DEPLOY) {
    subContractAddr = process.env.SUBSCRIPTION_CONTRACT!;
    anchorContractAddr = process.env.ANCHOR_CONTRACT!;
    if (!subContractAddr || !anchorContractAddr) {
      console.error("SKIP_DEPLOY requires SUBSCRIPTION_CONTRACT and ANCHOR_CONTRACT env vars");
      process.exit(1);
    }
    console.log(`\n  Using existing contracts:`);
    console.log(`    Subscription: ${subContractAddr}`);
    console.log(`    Anchor: ${anchorContractAddr}`);
  } else {
    // ═══════════════════════════════════════════════════════════
    section("1. DEPLOY CONTRACTS");
    // ═══════════════════════════════════════════════════════════

    const fs = await import("fs");
    const path = await import("path");
    const artifactsDir = path.resolve(__dirname, "../contracts/artifacts/src");

    function loadArtifact(name: string) {
      const p = path.join(artifactsDir, `${name}.sol/${name}.json`);
      if (!fs.existsSync(p)) throw new Error(`Artifact not found: ${p}\nRun: npm run contracts:compile`);
      return JSON.parse(fs.readFileSync(p, "utf8"));
    }

    // Deploy mock ERC20 for testing
    console.log("  Deploying MockERC20 (test USDC)...");
    const mockArtifact = loadArtifact("MockERC20");
    const mockFactory = new ethers.ContractFactory(mockArtifact.abi, mockArtifact.bytecode, wallet);
    const mockToken = await mockFactory.deploy("Test USDC", "tUSDC", 6);
    await mockToken.waitForDeployment();
    mockTokenAddr = await mockToken.getAddress();
    ok(`MockERC20 deployed: ${mockTokenAddr}`);
    console.log(`    ${net.explorer}/address/${mockTokenAddr}`);

    // Mint test tokens
    const mintTx = await (mockToken as any).mint(wallet.address, ethers.parseUnits("10000", 6));
    await mintTx.wait();
    ok("Minted 10,000 tUSDC to deployer");

    // Deploy ProofmarkSubscription
    console.log("\n  Deploying ProofmarkSubscription...");
    const subArtifact = loadArtifact("ProofmarkSubscription");
    const subFactory = new ethers.ContractFactory(subArtifact.abi, subArtifact.bytecode, wallet);
    const treasury = process.env.TREASURY_ADDRESS || wallet.address;
    const subContract = await subFactory.deploy(treasury, [mockTokenAddr]);
    await subContract.waitForDeployment();
    subContractAddr = await subContract.getAddress();
    ok(`ProofmarkSubscription deployed: ${subContractAddr}`);
    console.log(`    ${net.explorer}/address/${subContractAddr}`);

    // Deploy ProofmarkHashAnchor
    console.log("\n  Deploying ProofmarkHashAnchor...");
    const anchorArtifact = loadArtifact("ProofmarkHashAnchor");
    const anchorFactory = new ethers.ContractFactory(anchorArtifact.abi, anchorArtifact.bytecode, wallet);
    const anchorContract = await anchorFactory.deploy();
    await anchorContract.waitForDeployment();
    anchorContractAddr = await anchorContract.getAddress();
    ok(`ProofmarkHashAnchor deployed: ${anchorContractAddr}`);
    console.log(`    ${net.explorer}/address/${anchorContractAddr}`);
  }

  // ═══════════════════════════════════════════════════════════
  section("2. ERC20 APPROVE + SUBSCRIBE");
  // ═══════════════════════════════════════════════════════════

  if (subContractAddr !== ethers.ZeroAddress && mockTokenAddr) {
    const token = new ethers.Contract(mockTokenAddr, ERC20_ABI, wallet);
    const sub = new ethers.Contract(subContractAddr, SUBSCRIPTION_ABI, wallet);

    // Check balance
    const bal = await token.balanceOf(wallet.address);
    ok(`Token balance: ${ethers.formatUnits(bal, 6)} tUSDC`);

    // Approve
    const approveTx = await token.approve(subContractAddr, ethers.MaxUint256);
    await approveTx.wait();
    ok(`Approved subscription contract for spending`);
    console.log(`    TX: ${net.explorer}/tx/${approveTx.hash}`);

    // Check allowance
    const allowance = await token.allowance(wallet.address, subContractAddr);
    ok(`Allowance: ${ethers.formatUnits(allowance, 6)} tUSDC`);

    // Create monthly subscription (10 USDC, 30 days)
    const monthlyAmount = ethers.parseUnits("10", 6);
    const monthlyInterval = 30 * 24 * 60 * 60;
    const createTx = await sub.createSubscription(mockTokenAddr, monthlyAmount, monthlyInterval);
    const receipt = await createTx.wait();
    ok(`Monthly subscription created`);
    console.log(`    TX: ${net.explorer}/tx/${createTx.hash}`);
    console.log(`    Gas used: ${receipt.gasUsed.toString()}`);

    // Read subscription state
    const subData = await sub.subscriptions(0);
    ok(`On-chain sub: subscriber=${subData.subscriber.slice(0, 10)}... amount=${ethers.formatUnits(subData.amount, 6)} active=${subData.active}`);

    const isActive = await sub.isActive(0);
    isActive ? ok("isActive() = true") : fail("isActive() should be true");

    // Create lifetime
    const lifetimeAmount = ethers.parseUnits("500", 6);
    const lifetimeTx = await sub.createLifetime(mockTokenAddr, lifetimeAmount);
    await lifetimeTx.wait();
    ok(`Lifetime subscription created`);
    console.log(`    TX: ${net.explorer}/tx/${lifetimeTx.hash}`);

    const lifetimeData = await sub.subscriptions(1);
    lifetimeData.lifetime ? ok("Lifetime flag set on-chain") : fail("Lifetime flag not set");

    // Cancel monthly
    const cancelTx = await sub.cancel(0);
    await cancelTx.wait();
    ok(`Monthly subscription cancelled`);
    console.log(`    TX: ${net.explorer}/tx/${cancelTx.hash}`);

    const afterCancel = await sub.subscriptions(0);
    !afterCancel.active ? ok("On-chain active=false after cancel") : fail("Still active after cancel");

    // Get all subs for this wallet
    const allSubs = await sub.getSubscriberSubscriptions(wallet.address);
    ok(`Total subscriptions for wallet: ${allSubs.length}`);
  } else {
    console.log("  ⚠️  Skipping (no contract deployed — run 'npm run contracts:compile' first)");
  }

  // ═══════════════════════════════════════════════════════════
  section("3. HASH ANCHORING");
  // ═══════════════════════════════════════════════════════════

  if (anchorContractAddr !== ethers.ZeroAddress) {
    const anchor = new ethers.Contract(anchorContractAddr, ANCHOR_ABI, wallet);

    // Anchor single hash
    const docHash = ethers.keccak256(ethers.toUtf8Bytes(`test-doc-${Date.now()}`));
    const anchorTx = await anchor.anchorHash(docHash);
    const anchorReceipt = await anchorTx.wait();
    ok(`Single hash anchored`);
    console.log(`    Hash: ${docHash.slice(0, 20)}...`);
    console.log(`    TX: ${net.explorer}/tx/${anchorTx.hash}`);
    console.log(`    Gas: ${anchorReceipt.gasUsed.toString()}`);

    // Verify
    const [anchored, timestamp, anchorer] = await anchor.verifyHash(docHash);
    anchored ? ok(`Verified on-chain: ts=${timestamp} anchorer=${anchorer.slice(0, 10)}...`) : fail("Not verified");

    // Batch anchor
    const batchHashes = Array.from({ length: 5 }, (_, i) =>
      ethers.keccak256(ethers.toUtf8Bytes(`batch-doc-${Date.now()}-${i}`))
    );
    const batchId = ethers.keccak256(ethers.toUtf8Bytes(`batch-${Date.now()}`));
    const batchTx = await anchor.anchorBatch(batchHashes, batchId);
    const batchReceipt = await batchTx.wait();
    ok(`Batch anchored: ${batchHashes.length} hashes`);
    console.log(`    TX: ${net.explorer}/tx/${batchTx.hash}`);
    console.log(`    Gas: ${batchReceipt.gasUsed.toString()} (${Math.round(Number(batchReceipt.gasUsed) / batchHashes.length)} per hash)`);

    // Verify batch
    let batchVerified = 0;
    for (const h of batchHashes) {
      const [a] = await anchor.verifyHash(h);
      if (a) batchVerified++;
    }
    batchVerified === batchHashes.length
      ? ok(`All ${batchHashes.length} batch hashes verified`)
      : fail(`Only ${batchVerified}/${batchHashes.length} verified`);

    const totalAnchored = await anchor.anchorCount();
    ok(`Total anchors on-chain: ${totalAnchored}`);
  } else {
    console.log("  ⚠️  Skipping (no anchor contract)");
  }

  // ═══════════════════════════════════════════════════════════
  section("4. RECORD TO DB");
  // ═══════════════════════════════════════════════════════════

  if (subContractAddr !== ethers.ZeroAddress) {
    // Save contract addresses to DB
    const cryptoPlanId = randomBytes(12).toString("base64url");
    await sql`INSERT INTO crypto_plans (id, name, tier, "interval", price_usdc, features, is_active)
      VALUES (${cryptoPlanId}, 'Testnet Pro', 'pro', 'monthly', 1000, ${JSON.stringify(["templates"])}, true)
      ON CONFLICT DO NOTHING`;

    const subId = randomBytes(12).toString("base64url");
    await sql`INSERT INTO crypto_subscriptions (id, subscriber_address, subscriber_chain, plan_id, payment_chain, payment_token, "interval", status, contract_address, on_chain_subscription_id, current_period_start, current_period_end)
      VALUES (${subId}, ${wallet.address}, 'ETH', ${cryptoPlanId}, ${TESTNET === "baseSepolia" ? "BASE" : "ETH"}, 'tUSDC', 'monthly', 'active',
      ${subContractAddr}, '0', ${new Date()}, ${new Date(Date.now() + 30*24*60*60*1000)})`;
    ok(`DB crypto subscription: ${subId}`);
    ok(`Contract address saved: ${subContractAddr}`);
  }

  if (anchorContractAddr !== ethers.ZeroAddress) {
    const docHash = ethers.keccak256(ethers.toUtf8Bytes("testnet-anchor-doc"));
    await sql`INSERT INTO hash_anchors (id, document_hash, anchor_tx_hash, chain, contract_address, verified, created_at)
      VALUES (${randomBytes(12).toString("base64url")}, ${docHash.slice(2)}, 'testnet-pending', ${TESTNET === "baseSepolia" ? "BASE" : "ETH"},
      ${anchorContractAddr}, true, ${new Date()})
      ON CONFLICT DO NOTHING`;
    ok(`DB hash anchor saved`);
  }

  // ═══════════════════════════════════════════════════════════
  section("5. SUMMARY");
  // ═══════════════════════════════════════════════════════════

  console.log(`\n  Network:              ${TESTNET}`);
  console.log(`  Wallet:               ${wallet.address}`);
  console.log(`  Balance remaining:    ${ethers.formatEther(await provider.getBalance(wallet.address))} ETH`);
  if (mockTokenAddr) console.log(`  Mock Token:           ${mockTokenAddr}`);
  if (subContractAddr !== ethers.ZeroAddress) console.log(`  Subscription Contract: ${subContractAddr}`);
  if (anchorContractAddr !== ethers.ZeroAddress) console.log(`  Anchor Contract:       ${anchorContractAddr}`);
  console.log(`  Explorer:             ${net.explorer}`);

  console.log(`\n  Add to .env for reuse:`);
  if (subContractAddr !== ethers.ZeroAddress) console.log(`  SUBSCRIPTION_CONTRACT=${subContractAddr}`);
  if (anchorContractAddr !== ethers.ZeroAddress) console.log(`  ANCHOR_CONTRACT=${anchorContractAddr}`);

  console.log(`\n${"═".repeat(50)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`${"═".repeat(50)}\n`);

  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

async function getSubscriptionBytecode(): Promise<string> {
  // Placeholder — real bytecode comes from Hardhat artifacts
  return "0x";
}

run().catch((err) => { console.error("💥 Fatal:", err.message); process.exit(1); });
