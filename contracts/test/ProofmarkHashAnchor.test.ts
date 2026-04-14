import { expect } from "chai";
import { ethers } from "hardhat";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ProofmarkHashAnchor", function () {
  let anchor: any;
  let owner: SignerWithAddress;
  let authorized: SignerWithAddress;
  let unauthorized: SignerWithAddress;

  // Sample document hashes
  const hash1 = ethers.keccak256(ethers.toUtf8Bytes("document-content-1"));
  const hash2 = ethers.keccak256(ethers.toUtf8Bytes("document-content-2"));
  const hash3 = ethers.keccak256(ethers.toUtf8Bytes("document-content-3"));

  beforeEach(async function () {
    [owner, authorized, unauthorized] = await ethers.getSigners();

    const Anchor = await ethers.getContractFactory("ProofmarkHashAnchor");
    anchor = await Anchor.deploy();
    await anchor.waitForDeployment();

    // Authorize a second anchorer
    await anchor.setAuthorizedAnchorer(authorized.address, true);
  });

  describe("anchorHash", function () {
    it("should anchor a single hash", async function () {
      await anchor.anchorHash(hash1);

      const [anchored, timestamp, anchorer] = await anchor.verifyHash(hash1);
      expect(anchored).to.be.true;
      expect(timestamp).to.be.greaterThan(0);
      expect(anchorer).to.equal(owner.address);
      expect(await anchor.anchorCount()).to.equal(1);
    });

    it("should reject duplicate anchoring", async function () {
      await anchor.anchorHash(hash1);
      await expect(anchor.anchorHash(hash1)).to.be.revertedWith("Already anchored");
    });

    it("should allow authorized anchorer", async function () {
      await anchor.connect(authorized).anchorHash(hash1);
      const [anchored, , anchorer] = await anchor.verifyHash(hash1);
      expect(anchored).to.be.true;
      expect(anchorer).to.equal(authorized.address);
    });

    it("should reject unauthorized anchorer", async function () {
      await expect(anchor.connect(unauthorized).anchorHash(hash1)).to.be.revertedWith("Not authorized");
    });
  });

  describe("anchorBatch", function () {
    it("should anchor multiple hashes in one transaction", async function () {
      const batchId = ethers.keccak256(ethers.toUtf8Bytes("batch-001"));
      await anchor.anchorBatch([hash1, hash2, hash3], batchId);

      expect(await anchor.anchorCount()).to.equal(3);

      for (const hash of [hash1, hash2, hash3]) {
        const [anchored] = await anchor.verifyHash(hash);
        expect(anchored).to.be.true;
      }
    });

    it("should skip duplicates in batch without reverting", async function () {
      await anchor.anchorHash(hash1); // Anchor hash1 first

      const batchId = ethers.keccak256(ethers.toUtf8Bytes("batch-002"));
      await anchor.anchorBatch([hash1, hash2], batchId); // hash1 skipped, hash2 new

      expect(await anchor.anchorCount()).to.equal(2); // 1 from single + 1 from batch
    });

    it("should handle empty batch", async function () {
      const batchId = ethers.keccak256(ethers.toUtf8Bytes("batch-empty"));
      await anchor.anchorBatch([], batchId);
      expect(await anchor.anchorCount()).to.equal(0);
    });
  });

  describe("verifyHash", function () {
    it("should return false for unanchored hash", async function () {
      const [anchored, timestamp, anchorer] = await anchor.verifyHash(hash1);
      expect(anchored).to.be.false;
      expect(timestamp).to.equal(0);
      expect(anchorer).to.equal(ethers.ZeroAddress);
    });
  });

  describe("admin", function () {
    it("should allow owner to revoke authorization", async function () {
      await anchor.setAuthorizedAnchorer(authorized.address, false);
      await expect(anchor.connect(authorized).anchorHash(hash1)).to.be.revertedWith("Not authorized");
    });

    it("should allow ownership transfer", async function () {
      await anchor.transferOwnership(authorized.address);
      // Old owner can no longer admin
      await expect(
        anchor.setAuthorizedAnchorer(unauthorized.address, true),
      ).to.be.revertedWith("Not owner");
    });
  });
});
