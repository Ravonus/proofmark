// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProofmarkOpenAnchor
 * @notice Permissionless hash anchoring + data storage with per-tx ETH fee.
 *         For OSS users who pay a small fee per operation.
 *         Fees are owner-updatable and withdrawable to treasury.
 */
contract ProofmarkOpenAnchor {
    struct Anchor {
        uint64 timestamp;
        address anchorer;
        bytes32 batchId;
    }

    mapping(bytes32 => Anchor) public anchors;
    mapping(bytes32 => bytes) public dataStore;
    mapping(bytes32 => mapping(uint256 => bytes)) public dataChunks;
    mapping(bytes32 => uint256) public dataChunkCount;

    uint256 public anchorCount;
    uint256 public feePerHash;
    uint256 public feePerDataWrite;
    address public owner;
    address payable public treasury;

    event HashAnchored(bytes32 indexed documentHash, address indexed anchorer, uint64 timestamp, bytes32 batchId);
    event BatchAnchored(bytes32 indexed batchId, uint256 count, uint64 timestamp);
    event DataStored(bytes32 indexed key, address indexed storer, uint256 dataLength);
    event DataChunkStored(bytes32 indexed key, uint256 chunkIndex, uint256 chunkLength);
    event FeeUpdated(uint256 feePerHash, uint256 feePerDataWrite);
    event FeesWithdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(address payable _treasury, uint256 _feePerHash, uint256 _feePerDataWrite) {
        owner = msg.sender;
        treasury = _treasury;
        feePerHash = _feePerHash;
        feePerDataWrite = _feePerDataWrite;
    }

    // ── Anchoring (fee-based) ──

    function anchorHash(bytes32 documentHash) external payable {
        require(msg.value >= feePerHash, "Insufficient fee");
        require(anchors[documentHash].timestamp == 0, "Already anchored");

        uint64 now_ = uint64(block.timestamp);
        anchors[documentHash] = Anchor({ timestamp: now_, anchorer: msg.sender, batchId: bytes32(0) });
        anchorCount++;

        _refundExcess(feePerHash);
        emit HashAnchored(documentHash, msg.sender, now_, bytes32(0));
    }

    function anchorBatch(bytes32[] calldata hashes, bytes32 batchId) external payable {
        uint256 requiredFee = feePerHash * hashes.length;
        require(msg.value >= requiredFee, "Insufficient fee");

        uint64 now_ = uint64(block.timestamp);
        uint256 anchored = 0;

        for (uint256 i = 0; i < hashes.length; i++) {
            if (anchors[hashes[i]].timestamp != 0) continue;
            anchors[hashes[i]] = Anchor({ timestamp: now_, anchorer: msg.sender, batchId: batchId });
            anchored++;
            emit HashAnchored(hashes[i], msg.sender, now_, batchId);
        }

        anchorCount += anchored;
        // Refund fees for skipped duplicates
        uint256 actualFee = feePerHash * anchored;
        _refundExcess(actualFee);
        emit BatchAnchored(batchId, anchored, now_);
    }

    // ── Data Storage (fee-based) ──

    function storeData(bytes32 key, bytes calldata data) external payable {
        require(msg.value >= feePerDataWrite, "Insufficient fee");
        require(data.length <= 24576, "Data too large (max 24KB)");

        dataStore[key] = data;
        _refundExcess(feePerDataWrite);
        emit DataStored(key, msg.sender, data.length);
    }

    function storeDataChunk(bytes32 key, uint256 chunkIndex, bytes calldata chunk) external payable {
        require(msg.value >= feePerDataWrite, "Insufficient fee");
        require(chunk.length <= 24576, "Chunk too large");

        dataChunks[key][chunkIndex] = chunk;
        if (chunkIndex >= dataChunkCount[key]) {
            dataChunkCount[key] = chunkIndex + 1;
        }
        _refundExcess(feePerDataWrite);
        emit DataChunkStored(key, chunkIndex, chunk.length);
    }

    // ── Verification ──

    function verifyHash(bytes32 documentHash) external view returns (bool anchored, uint64 timestamp, address anchorer) {
        Anchor storage a = anchors[documentHash];
        if (a.timestamp == 0) return (false, 0, address(0));
        return (true, a.timestamp, a.anchorer);
    }

    function getData(bytes32 key) external view returns (bytes memory) {
        return dataStore[key];
    }

    function getDataChunk(bytes32 key, uint256 chunkIndex) external view returns (bytes memory) {
        return dataChunks[key][chunkIndex];
    }

    // ── Admin ──

    function setFees(uint256 _feePerHash, uint256 _feePerDataWrite) external onlyOwner {
        feePerHash = _feePerHash;
        feePerDataWrite = _feePerDataWrite;
        emit FeeUpdated(_feePerHash, _feePerDataWrite);
    }

    function withdrawFees(address payable to) external onlyOwner {
        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");
        (bool ok,) = to.call{value: balance}("");
        require(ok, "Withdrawal failed");
        emit FeesWithdrawn(to, balance);
    }

    function setTreasury(address payable _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ── Internal ──

    function _refundExcess(uint256 requiredFee) internal {
        if (msg.value > requiredFee) {
            (bool ok,) = payable(msg.sender).call{value: msg.value - requiredFee}("");
            require(ok, "Refund failed");
        }
    }

    receive() external payable {}
}
