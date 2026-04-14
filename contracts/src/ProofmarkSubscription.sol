// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProofmarkSubscription
 * @notice Allowance-based subscription contract for ERC-20 payments.
 * @dev Dual mode:
 *   - Open: users create their own subscriptions (token whitelist enforced)
 *   - Managed: authorized server signer creates subscriptions on behalf of users (any token)
 *   Integrates with ProofmarkSubscriptionNFT for soulbound badges.
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

interface ISubscriptionNFT {
    function mint(address to, uint256 planId, string calldata planName) external returns (uint256);
    function burn(address holder) external;
    function holderTokenId(address holder) external view returns (uint256);
}

contract ProofmarkSubscription {
    struct Subscription {
        address subscriber;
        address token;
        uint256 amount;
        uint64 interval;
        uint64 lastPaidAt;
        uint64 expiresAt;
        bool active;
        bool lifetime;
    }

    address public owner;
    address public treasury;
    address public authorizedSigner;     // Server signer for managed mode
    address public nftContract;          // ProofmarkSubscriptionNFT
    mapping(uint256 => Subscription) public subscriptions;
    mapping(address => uint256[]) public subscriberSubs;
    uint256 public nextSubId;

    mapping(address => bool) public allowedTokens;

    // ── Events ──

    event SubscriptionCreated(uint256 indexed subId, address indexed subscriber, address token, uint256 amount, uint64 interval);
    event PaymentCollected(uint256 indexed subId, address indexed subscriber, uint256 amount);
    event SubscriptionCancelled(uint256 indexed subId, address indexed subscriber);
    event SubscriptionLapsed(uint256 indexed subId, address indexed subscriber);
    event LifetimePayment(uint256 indexed subId, address indexed subscriber, uint256 amount);
    event TreasuryUpdated(address indexed newTreasury);
    event TokenAllowed(address indexed token, bool allowed);
    event SignerUpdated(address indexed signer);
    event NftContractUpdated(address indexed nft);

    // ── Modifiers ──

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlySignerOrOwner() {
        require(msg.sender == authorizedSigner || msg.sender == owner, "Not authorized signer");
        _;
    }

    // ── Constructor ──

    constructor(address _treasury, address[] memory _allowedTokens) {
        owner = msg.sender;
        treasury = _treasury;
        for (uint256 i = 0; i < _allowedTokens.length; i++) {
            allowedTokens[_allowedTokens[i]] = true;
            emit TokenAllowed(_allowedTokens[i], true);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // OPEN MODE — user creates their own subscription
    // ═══════════════════════════════════════════════════════════

    function createSubscription(address token, uint256 amount, uint64 interval) external returns (uint256 subId) {
        require(allowedTokens[token], "Token not allowed");
        require(amount > 0, "Amount must be positive");
        require(interval >= 86400, "Interval too short");

        require(IERC20(token).transferFrom(msg.sender, treasury, amount), "First payment failed");

        subId = _createSub(msg.sender, token, amount, interval, false);
    }

    function createLifetime(address token, uint256 amount) external returns (uint256 subId) {
        require(allowedTokens[token], "Token not allowed");
        require(amount > 0, "Amount must be positive");

        require(IERC20(token).transferFrom(msg.sender, treasury, amount), "Lifetime payment failed");

        subId = _createSub(msg.sender, token, amount, 0, true);
        emit LifetimePayment(subId, msg.sender, amount);
    }

    // ═══════════════════════════════════════════════════════════
    // MANAGED MODE — server creates subscription on behalf of user
    // ═══════════════════════════════════════════════════════════

    /**
     * @notice Server creates a subscription for a user. Bypasses token whitelist.
     *         Payment is pulled from the subscriber (they must have approved this contract).
     */
    function createSubscriptionFor(
        address subscriber, address token, uint256 amount, uint64 interval
    ) external onlySignerOrOwner returns (uint256 subId) {
        require(amount > 0, "Amount must be positive");
        require(interval >= 86400, "Interval too short");

        require(IERC20(token).transferFrom(subscriber, treasury, amount), "First payment failed");

        subId = _createSub(subscriber, token, amount, interval, false);
    }

    function createLifetimeFor(
        address subscriber, address token, uint256 amount
    ) external onlySignerOrOwner returns (uint256 subId) {
        require(amount > 0, "Amount must be positive");

        require(IERC20(token).transferFrom(subscriber, treasury, amount), "Lifetime payment failed");

        subId = _createSub(subscriber, token, amount, 0, true);
        emit LifetimePayment(subId, subscriber, amount);
    }

    // ═══════════════════════════════════════════════════════════
    // PAYMENT COLLECTION & LIFECYCLE
    // ═══════════════════════════════════════════════════════════

    function collectPayment(uint256 subId) external {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Subscription not active");
        require(!sub.lifetime, "Lifetime subscriptions do not renew");
        require(block.timestamp >= sub.expiresAt, "Period not elapsed");

        IERC20 token = IERC20(sub.token);
        uint256 allowed = token.allowance(sub.subscriber, address(this));
        uint256 balance = token.balanceOf(sub.subscriber);

        if (allowed < sub.amount || balance < sub.amount) {
            sub.active = false;
            _tryBurnNft(sub.subscriber);
            emit SubscriptionLapsed(subId, sub.subscriber);
            return;
        }

        bool success = token.transferFrom(sub.subscriber, treasury, sub.amount);
        if (!success) {
            sub.active = false;
            _tryBurnNft(sub.subscriber);
            emit SubscriptionLapsed(subId, sub.subscriber);
            return;
        }

        sub.lastPaidAt = uint64(block.timestamp);
        sub.expiresAt = uint64(block.timestamp) + sub.interval;
        emit PaymentCollected(subId, sub.subscriber, sub.amount);
    }

    function cancel(uint256 subId) external {
        Subscription storage sub = subscriptions[subId];
        require(msg.sender == sub.subscriber || msg.sender == authorizedSigner || msg.sender == owner, "Not authorized");
        require(sub.active, "Already cancelled");
        require(!sub.lifetime, "Cannot cancel lifetime");

        sub.active = false;
        _tryBurnNft(sub.subscriber);
        emit SubscriptionCancelled(subId, sub.subscriber);
    }

    // ── View Functions ──

    function isActive(uint256 subId) external view returns (bool) {
        Subscription storage sub = subscriptions[subId];
        if (!sub.active) return false;
        if (sub.lifetime) return true;
        return block.timestamp < sub.expiresAt;
    }

    function getSubscriberSubscriptions(address subscriber) external view returns (uint256[] memory) {
        return subscriberSubs[subscriber];
    }

    // ═══════════════════════════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════════════════════════

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function setAuthorizedSigner(address _signer) external onlyOwner {
        authorizedSigner = _signer;
        emit SignerUpdated(_signer);
    }

    function setNftContract(address _nft) external onlyOwner {
        nftContract = _nft;
        emit NftContractUpdated(_nft);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ═══════════════════════════════════════════════════════════
    // INTERNAL
    // ═══════════════════════════════════════════════════════════

    function _createSub(address subscriber, address token, uint256 amount, uint64 interval, bool isLifetime) internal returns (uint256 subId) {
        subId = nextSubId++;
        uint64 now_ = uint64(block.timestamp);

        subscriptions[subId] = Subscription({
            subscriber: subscriber,
            token: token,
            amount: amount,
            interval: interval,
            lastPaidAt: now_,
            expiresAt: isLifetime ? type(uint64).max : now_ + interval,
            active: true,
            lifetime: isLifetime
        });

        subscriberSubs[subscriber].push(subId);
        _tryMintNft(subscriber, subId);
        emit SubscriptionCreated(subId, subscriber, token, amount, interval);
    }

    function _tryMintNft(address subscriber, uint256 planId) internal {
        if (nftContract == address(0)) return;
        try ISubscriptionNFT(nftContract).holderTokenId(subscriber) returns (uint256 existing) {
            if (existing != 0) return; // already has NFT
        } catch {}
        try ISubscriptionNFT(nftContract).mint(subscriber, planId, "Subscriber") {} catch {}
    }

    function _tryBurnNft(address subscriber) internal {
        if (nftContract == address(0)) return;
        try ISubscriptionNFT(nftContract).burn(subscriber) {} catch {}
    }
}
