// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProofmarkSubscription
 * @notice Allowance-based subscription contract for WETH/USDC payments.
 * @dev Users approve this contract to spend tokens, then create subscriptions.
 *      A keeper calls collectPayment() to pull recurring payments.
 *      Deploy on Base (primary) and ETH mainnet (high-value).
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
}

contract ProofmarkSubscription {
    struct Subscription {
        address subscriber;
        address token;
        uint256 amount;
        uint64 interval;      // seconds between payments (monthly ~2592000, yearly ~31536000)
        uint64 lastPaidAt;
        uint64 expiresAt;
        bool active;
        bool lifetime;
    }

    address public owner;
    address public treasury;
    mapping(uint256 => Subscription) public subscriptions;
    mapping(address => uint256[]) public subscriberSubs;
    uint256 public nextSubId;

    mapping(address => bool) public allowedTokens;

    // ── Events ──

    event SubscriptionCreated(
        uint256 indexed subId,
        address indexed subscriber,
        address token,
        uint256 amount,
        uint64 interval
    );
    event PaymentCollected(uint256 indexed subId, address indexed subscriber, uint256 amount);
    event SubscriptionCancelled(uint256 indexed subId, address indexed subscriber);
    event SubscriptionLapsed(uint256 indexed subId, address indexed subscriber);
    event LifetimePayment(uint256 indexed subId, address indexed subscriber, uint256 amount);
    event TreasuryUpdated(address indexed newTreasury);
    event TokenAllowed(address indexed token, bool allowed);

    // ── Modifiers ──

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
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

    // ── Subscription Management ──

    /**
     * @notice Create a recurring subscription. First payment is pulled immediately.
     * @param token Address of ERC-20 payment token (WETH or USDC).
     * @param amount Per-period payment amount (in token decimals).
     * @param interval Payment interval in seconds.
     * @return subId The subscription ID.
     */
    function createSubscription(
        address token,
        uint256 amount,
        uint64 interval
    ) external returns (uint256 subId) {
        require(allowedTokens[token], "Token not allowed");
        require(amount > 0, "Amount must be positive");
        require(interval >= 86400, "Interval too short"); // min 1 day

        // Pull first payment
        require(
            IERC20(token).transferFrom(msg.sender, treasury, amount),
            "First payment failed"
        );

        subId = nextSubId++;
        uint64 now_ = uint64(block.timestamp);

        subscriptions[subId] = Subscription({
            subscriber: msg.sender,
            token: token,
            amount: amount,
            interval: interval,
            lastPaidAt: now_,
            expiresAt: now_ + interval,
            active: true,
            lifetime: false
        });

        subscriberSubs[msg.sender].push(subId);
        emit SubscriptionCreated(subId, msg.sender, token, amount, interval);
    }

    /**
     * @notice Create a lifetime (one-time) subscription.
     * @param token Address of ERC-20 payment token.
     * @param amount One-time payment amount.
     * @return subId The subscription ID.
     */
    function createLifetime(
        address token,
        uint256 amount
    ) external returns (uint256 subId) {
        require(allowedTokens[token], "Token not allowed");
        require(amount > 0, "Amount must be positive");

        require(
            IERC20(token).transferFrom(msg.sender, treasury, amount),
            "Lifetime payment failed"
        );

        subId = nextSubId++;
        uint64 now_ = uint64(block.timestamp);

        subscriptions[subId] = Subscription({
            subscriber: msg.sender,
            token: token,
            amount: amount,
            interval: 0,
            lastPaidAt: now_,
            expiresAt: type(uint64).max, // never expires
            active: true,
            lifetime: true
        });

        subscriberSubs[msg.sender].push(subId);
        emit LifetimePayment(subId, msg.sender, amount);
    }

    /**
     * @notice Collect a recurring payment. Callable by anyone (keeper/cron).
     * @dev Checks if the period has elapsed, attempts transferFrom.
     *      If allowance/balance is insufficient, marks subscription as lapsed.
     * @param subId The subscription ID.
     */
    function collectPayment(uint256 subId) external {
        Subscription storage sub = subscriptions[subId];
        require(sub.active, "Subscription not active");
        require(!sub.lifetime, "Lifetime subscriptions do not renew");
        require(block.timestamp >= sub.expiresAt, "Period not elapsed");

        IERC20 token = IERC20(sub.token);

        // Check allowance and balance
        uint256 allowed = token.allowance(sub.subscriber, address(this));
        uint256 balance = token.balanceOf(sub.subscriber);

        if (allowed < sub.amount || balance < sub.amount) {
            sub.active = false;
            emit SubscriptionLapsed(subId, sub.subscriber);
            return;
        }

        // Pull payment
        bool success = token.transferFrom(sub.subscriber, treasury, sub.amount);
        if (!success) {
            sub.active = false;
            emit SubscriptionLapsed(subId, sub.subscriber);
            return;
        }

        sub.lastPaidAt = uint64(block.timestamp);
        sub.expiresAt = uint64(block.timestamp) + sub.interval;
        emit PaymentCollected(subId, sub.subscriber, sub.amount);
    }

    /**
     * @notice Cancel a subscription. Only the subscriber can cancel.
     *         Subscription remains active until the current period ends.
     * @param subId The subscription ID.
     */
    function cancel(uint256 subId) external {
        Subscription storage sub = subscriptions[subId];
        require(msg.sender == sub.subscriber, "Not subscriber");
        require(sub.active, "Already cancelled");
        require(!sub.lifetime, "Cannot cancel lifetime");

        sub.active = false;
        emit SubscriptionCancelled(subId, sub.subscriber);
    }

    // ── View Functions ──

    /**
     * @notice Check if a subscription is currently active (not expired and not cancelled).
     */
    function isActive(uint256 subId) external view returns (bool) {
        Subscription storage sub = subscriptions[subId];
        if (!sub.active) return false;
        if (sub.lifetime) return true;
        return block.timestamp < sub.expiresAt;
    }

    /**
     * @notice Get all subscription IDs for a subscriber.
     */
    function getSubscriberSubscriptions(address subscriber) external view returns (uint256[] memory) {
        return subscriberSubs[subscriber];
    }

    // ── Admin Functions ──

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setAllowedToken(address token, bool allowed) external onlyOwner {
        allowedTokens[token] = allowed;
        emit TokenAllowed(token, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
