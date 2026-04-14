import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ProofmarkSubscription", function () {
  let subscription: any;
  let mockToken: any;
  let owner: SignerWithAddress;
  let subscriber: SignerWithAddress;
  let treasury: SignerWithAddress;

  const MONTHLY_INTERVAL = 30 * 24 * 60 * 60; // 30 days
  const YEARLY_INTERVAL = 365 * 24 * 60 * 60;
  const MONTHLY_AMOUNT = ethers.parseUnits("10", 6); // 10 USDC
  const LIFETIME_AMOUNT = ethers.parseUnits("500", 6); // 500 USDC

  beforeEach(async function () {
    [owner, subscriber, treasury] = await ethers.getSigners();

    // Deploy a mock ERC-20 token (acts as USDC)
    const MockToken = await ethers.getContractFactory("MockERC20");
    mockToken = await MockToken.deploy("Mock USDC", "USDC", 6);
    await mockToken.waitForDeployment();

    // Mint tokens to subscriber
    await mockToken.mint(subscriber.address, ethers.parseUnits("10000", 6));

    // Deploy subscription contract
    const Subscription = await ethers.getContractFactory("ProofmarkSubscription");
    subscription = await Subscription.deploy(treasury.address, [await mockToken.getAddress()]);
    await subscription.waitForDeployment();

    // Subscriber approves contract to spend tokens
    await mockToken.connect(subscriber).approve(
      await subscription.getAddress(),
      ethers.MaxUint256, // unlimited approval
    );
  });

  describe("createSubscription", function () {
    it("should create a monthly subscription and pull first payment", async function () {
      const treasuryBefore = await mockToken.balanceOf(treasury.address);

      const tx = await subscription
        .connect(subscriber)
        .createSubscription(await mockToken.getAddress(), MONTHLY_AMOUNT, MONTHLY_INTERVAL);
      const receipt = await tx.wait();

      const treasuryAfter = await mockToken.balanceOf(treasury.address);
      expect(treasuryAfter - treasuryBefore).to.equal(MONTHLY_AMOUNT);

      const sub = await subscription.subscriptions(0);
      expect(sub.subscriber).to.equal(subscriber.address);
      expect(sub.active).to.be.true;
      expect(sub.lifetime).to.be.false;
      expect(sub.amount).to.equal(MONTHLY_AMOUNT);
    });

    it("should reject unapproved tokens", async function () {
      const MockToken2 = await ethers.getContractFactory("MockERC20");
      const badToken = await MockToken2.deploy("Bad Token", "BAD", 18);
      await badToken.waitForDeployment();

      await expect(
        subscription.connect(subscriber).createSubscription(await badToken.getAddress(), 100, MONTHLY_INTERVAL),
      ).to.be.revertedWith("Token not allowed");
    });

    it("should reject zero amount", async function () {
      await expect(
        subscription.connect(subscriber).createSubscription(await mockToken.getAddress(), 0, MONTHLY_INTERVAL),
      ).to.be.revertedWith("Amount must be positive");
    });

    it("should reject interval less than 1 day", async function () {
      await expect(
        subscription.connect(subscriber).createSubscription(await mockToken.getAddress(), MONTHLY_AMOUNT, 3600),
      ).to.be.revertedWith("Interval too short");
    });
  });

  describe("createLifetime", function () {
    it("should create a lifetime subscription", async function () {
      await subscription
        .connect(subscriber)
        .createLifetime(await mockToken.getAddress(), LIFETIME_AMOUNT);

      const sub = await subscription.subscriptions(0);
      expect(sub.active).to.be.true;
      expect(sub.lifetime).to.be.true;
      expect(sub.amount).to.equal(LIFETIME_AMOUNT);

      // Lifetime subs are always active
      expect(await subscription.isActive(0)).to.be.true;
    });
  });

  describe("collectPayment", function () {
    it("should collect payment after period elapses", async function () {
      await subscription
        .connect(subscriber)
        .createSubscription(await mockToken.getAddress(), MONTHLY_AMOUNT, MONTHLY_INTERVAL);

      // Fast-forward time past the interval
      await ethers.provider.send("evm_increaseTime", [MONTHLY_INTERVAL + 1]);
      await ethers.provider.send("evm_mine", []);

      const treasuryBefore = await mockToken.balanceOf(treasury.address);
      await subscription.collectPayment(0);
      const treasuryAfter = await mockToken.balanceOf(treasury.address);

      expect(treasuryAfter - treasuryBefore).to.equal(MONTHLY_AMOUNT);
      expect(await subscription.isActive(0)).to.be.true;
    });

    it("should revert if period has not elapsed", async function () {
      await subscription
        .connect(subscriber)
        .createSubscription(await mockToken.getAddress(), MONTHLY_AMOUNT, MONTHLY_INTERVAL);

      await expect(subscription.collectPayment(0)).to.be.revertedWith("Period not elapsed");
    });

    it("should lapse subscription if allowance revoked", async function () {
      await subscription
        .connect(subscriber)
        .createSubscription(await mockToken.getAddress(), MONTHLY_AMOUNT, MONTHLY_INTERVAL);

      // Subscriber revokes allowance
      await mockToken.connect(subscriber).approve(await subscription.getAddress(), 0);

      // Fast-forward
      await ethers.provider.send("evm_increaseTime", [MONTHLY_INTERVAL + 1]);
      await ethers.provider.send("evm_mine", []);

      await subscription.collectPayment(0);
      expect(await subscription.isActive(0)).to.be.false;
    });

    it("should lapse subscription if balance insufficient", async function () {
      await subscription
        .connect(subscriber)
        .createSubscription(await mockToken.getAddress(), MONTHLY_AMOUNT, MONTHLY_INTERVAL);

      // Drain subscriber's balance
      const balance = await mockToken.balanceOf(subscriber.address);
      await mockToken.connect(subscriber).transfer(owner.address, balance);

      await ethers.provider.send("evm_increaseTime", [MONTHLY_INTERVAL + 1]);
      await ethers.provider.send("evm_mine", []);

      await subscription.collectPayment(0);
      expect(await subscription.isActive(0)).to.be.false;
    });
  });

  describe("cancel", function () {
    it("should allow subscriber to cancel", async function () {
      await subscription
        .connect(subscriber)
        .createSubscription(await mockToken.getAddress(), MONTHLY_AMOUNT, MONTHLY_INTERVAL);

      await subscription.connect(subscriber).cancel(0);
      const sub = await subscription.subscriptions(0);
      expect(sub.active).to.be.false;
    });

    it("should reject cancel from non-subscriber", async function () {
      await subscription
        .connect(subscriber)
        .createSubscription(await mockToken.getAddress(), MONTHLY_AMOUNT, MONTHLY_INTERVAL);

      await expect(subscription.connect(owner).cancel(0)).to.be.revertedWith("Not subscriber");
    });
  });

  describe("isActive", function () {
    it("should return false for expired subscription", async function () {
      await subscription
        .connect(subscriber)
        .createSubscription(await mockToken.getAddress(), MONTHLY_AMOUNT, MONTHLY_INTERVAL);

      // Revoke so collectPayment will lapse it
      await mockToken.connect(subscriber).approve(await subscription.getAddress(), 0);

      await ethers.provider.send("evm_increaseTime", [MONTHLY_INTERVAL + 1]);
      await ethers.provider.send("evm_mine", []);

      // isActive checks expiresAt > block.timestamp — period has passed and no payment collected
      // The subscription is still "active" in storage, but isActive checks timestamp
      // After lapse from collect, it becomes inactive
      await subscription.collectPayment(0);
      expect(await subscription.isActive(0)).to.be.false;
    });
  });

  describe("getSubscriberSubscriptions", function () {
    it("should return all subscription IDs for a subscriber", async function () {
      await subscription
        .connect(subscriber)
        .createSubscription(await mockToken.getAddress(), MONTHLY_AMOUNT, MONTHLY_INTERVAL);
      await subscription
        .connect(subscriber)
        .createLifetime(await mockToken.getAddress(), LIFETIME_AMOUNT);

      const ids = await subscription.getSubscriberSubscriptions(subscriber.address);
      expect(ids.length).to.equal(2);
    });
  });
});
