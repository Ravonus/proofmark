// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title ProofmarkSubscriptionNFT
 * @notice Soulbound (non-transferable) ERC-721 for active subscribers.
 *         Minted when subscription activates, burned when cancelled/expired.
 *         Implements ERC-5192 (Minimal Soulbound Interface).
 */
contract ProofmarkSubscriptionNFT is ERC721 {
    using Strings for uint256;
    using Strings for address;

    struct PlanMetadata {
        uint256 planId;
        string planName;
        uint64 activatedAt;
        address subscriber;
    }

    address public owner;
    mapping(address => bool) public authorizedMinters;
    mapping(address => uint256) public holderTokenId;
    mapping(uint256 => PlanMetadata) public planMetadata;

    uint256 private _nextTokenId;

    // ERC-5192 events
    event Locked(uint256 tokenId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyMinter() {
        require(authorizedMinters[msg.sender] || msg.sender == owner, "Not authorized minter");
        _;
    }

    constructor() ERC721("Proofmark Subscriber", "PMSUB") {
        owner = msg.sender;
        authorizedMinters[msg.sender] = true;
        _nextTokenId = 1; // start at 1, 0 means "no token"
    }

    // ── Soulbound: block all transfers ──

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Allow minting (from == address(0)) and burning (to == address(0))
        // Block all other transfers
        if (from != address(0) && to != address(0)) {
            revert("Soulbound: non-transferable");
        }
        return super._update(to, tokenId, auth);
    }

    function approve(address, uint256) public pure override {
        revert("Soulbound: non-transferable");
    }

    function setApprovalForAll(address, bool) public pure override {
        revert("Soulbound: non-transferable");
    }

    // ERC-5192: always locked
    function locked(uint256 tokenId) external view returns (bool) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return true;
    }

    // ── Mint & Burn ──

    function mint(address to, uint256 planId, string calldata planName) external onlyMinter returns (uint256 tokenId) {
        require(holderTokenId[to] == 0, "Already has subscription NFT");

        tokenId = _nextTokenId++;
        _safeMint(to, tokenId);

        holderTokenId[to] = tokenId;
        planMetadata[tokenId] = PlanMetadata({
            planId: planId,
            planName: planName,
            activatedAt: uint64(block.timestamp),
            subscriber: to
        });

        emit Locked(tokenId);
    }

    function burn(address holder) external onlyMinter {
        uint256 tokenId = holderTokenId[holder];
        require(tokenId != 0, "No NFT to burn");

        _burn(tokenId);
        delete holderTokenId[holder];
        delete planMetadata[tokenId];
    }

    // ── Token URI (on-chain SVG) ──

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        PlanMetadata memory meta = planMetadata[tokenId];

        string memory svg = _generateSVG(meta);
        string memory json = string(abi.encodePacked(
            '{"name":"Proofmark Subscriber: ', meta.planName,
            '","description":"Active subscription to Proofmark ', meta.planName, ' plan",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '",',
            '"attributes":[',
                '{"trait_type":"Plan","value":"', meta.planName, '"},',
                '{"trait_type":"Token ID","value":"', tokenId.toString(), '"},',
                '{"trait_type":"Activated","display_type":"date","value":', uint256(meta.activatedAt).toString(), '},',
                '{"trait_type":"Soulbound","value":"true"}',
            ']}'
        ));

        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    function _generateSVG(PlanMetadata memory meta) internal pure returns (string memory) {
        string memory addrStr = Strings.toHexString(uint256(uint160(meta.subscriber)), 20);
        string memory shortAddr = string(abi.encodePacked(
            _substring(addrStr, 0, 6), "...", _substring(addrStr, bytes(addrStr).length - 4, bytes(addrStr).length)
        ));

        return string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" width="350" height="200" viewBox="0 0 350 200">',
            '<rect width="350" height="200" rx="12" fill="#0e0e12"/>',
            '<rect x="1" y="1" width="348" height="198" rx="11" fill="none" stroke="#1e1e28" stroke-width="1"/>',
            '<text x="24" y="36" font-family="monospace" font-size="14" font-weight="bold" fill="#7c5cfc">PROOFMARK</text>',
            '<text x="24" y="56" font-family="monospace" font-size="10" fill="#4a4a56">SUBSCRIBER</text>',
            '<line x1="24" y1="70" x2="326" y2="70" stroke="#1e1e28" stroke-width="1"/>',
            '<text x="24" y="100" font-family="monospace" font-size="20" font-weight="bold" fill="#f0f0f2">', meta.planName, '</text>',
            '<text x="24" y="140" font-family="monospace" font-size="11" fill="#94949e">', shortAddr, '</text>',
            '<rect x="24" y="160" width="80" height="22" rx="4" fill="#7c5cfc" fill-opacity="0.15"/>',
            '<text x="40" y="175" font-family="monospace" font-size="10" fill="#7c5cfc">ACTIVE</text>',
            '<circle cx="316" cy="172" r="6" fill="#34d399"/>',
            '</svg>'
        ));
    }

    function _substring(string memory str, uint256 start, uint256 end) internal pure returns (string memory) {
        bytes memory strBytes = bytes(str);
        bytes memory result = new bytes(end - start);
        for (uint256 i = start; i < end; i++) {
            result[i - start] = strBytes[i];
        }
        return string(result);
    }

    // ── Admin ──

    function setAuthorizedMinter(address minter, bool authorized) external onlyOwner {
        authorizedMinters[minter] = authorized;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ERC-165: report ERC-721 + ERC-5192
    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == 0xb45a3c0e // ERC-5192
            || super.supportsInterface(interfaceId);
    }
}
