/**
 * Deploy all Proofmark contracts:
 *   1. ProofmarkSubscription (managed, ERC20 payments)
 *   2. ProofmarkSubscriptionNFT (soulbound badge)
 *   3. ProofmarkHashAnchor (managed hash anchoring + data storage)
 *   4. ProofmarkOpenAnchor (permissionless, fee-based)
 *   5. ProofmarkPriceOracle (Chainlink wrapper)
 *
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network baseSepolia
 *   npx hardhat run scripts/deploy.ts --network sepolia
 *   npx hardhat run scripts/deploy.ts --network hardhat
 */

import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  const chainId = (await ethers.provider.getNetwork()).chainId;
  const tokens = getTokenAddresses(chainId);
  const feeds = getChainlinkFeeds(chainId);
  const treasuryAddress = process.env.TREASURY_ADDRESS || deployer.address;
  const signerAddress = process.env.AUTHORIZED_SIGNER || deployer.address;

  console.log(`\nChain: ${chainId}  Treasury: ${treasuryAddress}  Signer: ${signerAddress}`);

  // ── 1. ProofmarkSubscription ──
  console.log("\n─── ProofmarkSubscription ───");
  const Sub = await ethers.getContractFactory("ProofmarkSubscription");
  const sub = await Sub.deploy(treasuryAddress, tokens.map((t) => t.address));
  await sub.waitForDeployment();
  const subAddr = await sub.getAddress();
  console.log("  Deployed:", subAddr);

  // ── 2. ProofmarkSubscriptionNFT ──
  console.log("\n─── ProofmarkSubscriptionNFT ───");
  const NFT = await ethers.getContractFactory("ProofmarkSubscriptionNFT");
  const nft = await NFT.deploy();
  await nft.waitForDeployment();
  const nftAddr = await nft.getAddress();
  console.log("  Deployed:", nftAddr);

  // Wire: subscription ↔ NFT
  await (await sub.setNftContract(nftAddr)).wait();
  await (await sub.setAuthorizedSigner(signerAddress)).wait();
  await (await nft.setAuthorizedMinter(subAddr, true)).wait();
  console.log("  Wired: sub.nftContract =", nftAddr);
  console.log("  Wired: sub.authorizedSigner =", signerAddress);
  console.log("  Wired: nft.authorizedMinter(sub) = true");

  // ── 3. ProofmarkHashAnchor (managed) ──
  console.log("\n─── ProofmarkHashAnchor ───");
  const Anchor = await ethers.getContractFactory("ProofmarkHashAnchor");
  const anchor = await Anchor.deploy();
  await anchor.waitForDeployment();
  const anchorAddr = await anchor.getAddress();
  console.log("  Deployed:", anchorAddr);

  // ── 4. ProofmarkOpenAnchor (permissionless, fee-based) ──
  console.log("\n─── ProofmarkOpenAnchor ───");
  const feePerHash = ethers.parseEther("0.0001");     // 0.0001 ETH per hash
  const feePerData = ethers.parseEther("0.001");       // 0.001 ETH per data write
  const Open = await ethers.getContractFactory("ProofmarkOpenAnchor");
  const open = await Open.deploy(treasuryAddress, feePerHash, feePerData);
  await open.waitForDeployment();
  const openAddr = await open.getAddress();
  console.log("  Deployed:", openAddr);
  console.log(`  Fee per hash: ${ethers.formatEther(feePerHash)} ETH`);
  console.log(`  Fee per data: ${ethers.formatEther(feePerData)} ETH`);

  // ── 5. ProofmarkPriceOracle ──
  console.log("\n─── ProofmarkPriceOracle ───");
  const Oracle = await ethers.getContractFactory("ProofmarkPriceOracle");
  const oracle = await Oracle.deploy(3600); // 1 hour staleness threshold
  await oracle.waitForDeployment();
  const oracleAddr = await oracle.getAddress();
  console.log("  Deployed:", oracleAddr);

  // Set Chainlink feeds
  for (const feed of feeds) {
    await (await oracle.setPriceFeed(feed.token, feed.feed, feed.decimals)).wait();
    console.log(`  Feed: ${feed.symbol} → ${feed.feed} (${feed.decimals} dec)`);
  }

  // ── Summary ──
  console.log("\n═══ DEPLOYMENT SUMMARY ═══");
  console.log(`Chain ID:              ${chainId}`);
  console.log(`ProofmarkSubscription: ${subAddr}`);
  console.log(`SubscriptionNFT:       ${nftAddr}`);
  console.log(`HashAnchor (managed):  ${anchorAddr}`);
  console.log(`OpenAnchor (fee):      ${openAddr}`);
  console.log(`PriceOracle:           ${oracleAddr}`);
  console.log(`Treasury:              ${treasuryAddress}`);
  console.log(`Server Signer:         ${signerAddress}`);

  console.log("\nAdd to .env:");
  console.log(`SUBSCRIPTION_CONTRACT=${subAddr}`);
  console.log(`NFT_CONTRACT=${nftAddr}`);
  console.log(`ANCHOR_CONTRACT=${anchorAddr}`);
  console.log(`OPEN_ANCHOR_CONTRACT=${openAddr}`);
  console.log(`PRICE_ORACLE_CONTRACT=${oracleAddr}`);
}

type TokenInfo = { symbol: string; address: string };
type FeedInfo = { symbol: string; token: string; feed: string; decimals: number };

function getTokenAddresses(chainId: bigint): TokenInfo[] {
  if (chainId === 31337n) return [];
  if (chainId === 84532n) return [{ symbol: "USDC", address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" }];
  if (chainId === 11155111n) return [{ symbol: "USDC", address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" }];
  if (chainId === 8453n) return [
    { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
    { symbol: "WETH", address: "0x4200000000000000000000000000000000000006" },
  ];
  if (chainId === 1n) return [
    { symbol: "USDC", address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
    { symbol: "WETH", address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
  ];
  return [];
}

function getChainlinkFeeds(chainId: bigint): FeedInfo[] {
  // Base mainnet
  if (chainId === 8453n) return [
    { symbol: "ETH", token: "0x4200000000000000000000000000000000000006", feed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70", decimals: 18 },
    { symbol: "USDC", token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", feed: "0x7e860098F58bBFC8648a4311b374B1D669a2bc6B", decimals: 6 },
  ];
  // ETH mainnet
  if (chainId === 1n) return [
    { symbol: "ETH", token: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", feed: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419", decimals: 18 },
    { symbol: "USDC", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", feed: "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", decimals: 6 },
  ];
  // Testnets — no reliable Chainlink feeds, skip
  return [];
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
