// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProofmarkHashAnchor
 * @notice On-chain document hash anchoring with batch support.
 * @dev Deploy on Base (cheap L2) for cost-efficient hash storage.
 *      Provides tamper-proof timestamping of document hashes.
 */

contract ProofmarkHashAnchor {
    struct Anchor {
        uint64 timestamp;
        address anchorer;
        bytes32 batchId;
    }

    mapping(bytes32 => Anchor) public anchors;
    uint256 public anchorCount;

    address public owner;
    mapping(address => bool) public authorizedAnchorers;

    // ── Events ──

    event HashAnchored(
        bytes32 indexed documentHash,
        address indexed anchorer,
        uint64 timestamp,
        bytes32 batchId
    );
    event BatchAnchored(bytes32 indexed batchId, uint256 count, uint64 timestamp);
    event AnchorerAuthorized(address indexed anchorer, bool authorized);

    // ── Modifiers ──

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyAuthorized() {
        require(msg.sender == owner || authorizedAnchorers[msg.sender], "Not authorized");
        _;
    }

    // ── Constructor ──

    constructor() {
        owner = msg.sender;
        authorizedAnchorers[msg.sender] = true;
    }

    // ── Anchoring ──

    /**
     * @notice Anchor a single document hash with the current block timestamp.
     * @param documentHash SHA-256 hash of the document content.
     */
    function anchorHash(bytes32 documentHash) external onlyAuthorized {
        require(anchors[documentHash].timestamp == 0, "Already anchored");

        uint64 now_ = uint64(block.timestamp);
        anchors[documentHash] = Anchor({
            timestamp: now_,
            anchorer: msg.sender,
            batchId: bytes32(0)
        });
        anchorCount++;

        emit HashAnchored(documentHash, msg.sender, now_, bytes32(0));
    }

    /**
     * @notice Anchor multiple document hashes in a single transaction (gas-efficient).
     * @param hashes Array of document hashes to anchor.
     * @param batchId Identifier for this batch (for off-chain tracking).
     */
    function anchorBatch(bytes32[] calldata hashes, bytes32 batchId) external onlyAuthorized {
        uint64 now_ = uint64(block.timestamp);
        uint256 anchored = 0;

        for (uint256 i = 0; i < hashes.length; i++) {
            bytes32 h = hashes[i];
            if (anchors[h].timestamp != 0) continue; // skip duplicates

            anchors[h] = Anchor({
                timestamp: now_,
                anchorer: msg.sender,
                batchId: batchId
            });
            anchored++;

            emit HashAnchored(h, msg.sender, now_, batchId);
        }

        anchorCount += anchored;
        emit BatchAnchored(batchId, anchored, now_);
    }

    // ── Data Storage (managed, no fee) ──

    mapping(bytes32 => bytes) public dataStore;

    event DataStored(bytes32 indexed key, address indexed storer, uint256 dataLength);

    function storeData(bytes32 key, bytes calldata data) external onlyAuthorized {
        require(data.length <= 24576, "Data too large (max 24KB)");
        dataStore[key] = data;
        emit DataStored(key, msg.sender, data.length);
    }

    function getData(bytes32 key) external view returns (bytes memory) {
        return dataStore[key];
    }

    // ── Verification ──

    /**
     * @notice Verify whether a document hash has been anchored.
     * @param documentHash The hash to verify.
     * @return anchored Whether the hash exists on-chain.
     * @return timestamp When the hash was anchored (0 if not found).
     * @return anchorer Who anchored the hash (address(0) if not found).
     */
    function verifyHash(bytes32 documentHash)
        external
        view
        returns (bool anchored, uint64 timestamp, address anchorer)
    {
        Anchor storage a = anchors[documentHash];
        if (a.timestamp == 0) {
            return (false, 0, address(0));
        }
        return (true, a.timestamp, a.anchorer);
    }

    // ── Admin ──

    function setAuthorizedAnchorer(address anchorer, bool authorized) external onlyOwner {
        authorizedAnchorers[anchorer] = authorized;
        emit AnchorerAuthorized(anchorer, authorized);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
