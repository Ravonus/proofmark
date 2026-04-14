// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ProofmarkPriceOracle
 * @notice Chainlink aggregator wrapper for token price lookups.
 *         Maps token addresses to Chainlink feeds, converts USD cents to token amounts.
 */

interface AggregatorV3Interface {
    function latestRoundData()
        external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

contract ProofmarkPriceOracle {
    address public owner;
    uint256 public stalePriceThreshold; // seconds

    // token address => Chainlink aggregator address
    mapping(address => address) public priceFeeds;
    // token address => decimals (ERC20 decimals, not Chainlink decimals)
    mapping(address => uint8) public tokenDecimals;

    event PriceFeedSet(address indexed token, address indexed feed, uint8 tokenDecimals);
    event StalenessUpdated(uint256 newThreshold);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(uint256 _stalePriceThreshold) {
        owner = msg.sender;
        stalePriceThreshold = _stalePriceThreshold;
    }

    /**
     * @notice Set the Chainlink price feed for a token.
     * @param token ERC20 token address
     * @param feed Chainlink aggregator address (token/USD pair)
     * @param _tokenDecimals The ERC20 decimal count for the token (e.g., 18 for WETH, 6 for USDC)
     */
    function setPriceFeed(address token, address feed, uint8 _tokenDecimals) external onlyOwner {
        priceFeeds[token] = feed;
        tokenDecimals[token] = _tokenDecimals;
        emit PriceFeedSet(token, feed, _tokenDecimals);
    }

    function setStalenessThreshold(uint256 _seconds) external onlyOwner {
        stalePriceThreshold = _seconds;
        emit StalenessUpdated(_seconds);
    }

    /**
     * @notice Get the latest USD price for a token from Chainlink.
     * @return price The price (scaled by Chainlink decimals)
     * @return feedDecimals The number of decimals in the price
     */
    function getLatestPrice(address token) public view returns (int256 price, uint8 feedDecimals) {
        address feed = priceFeeds[token];
        require(feed != address(0), "No price feed for token");

        AggregatorV3Interface aggregator = AggregatorV3Interface(feed);
        (, int256 answer,, uint256 updatedAt,) = aggregator.latestRoundData();

        require(answer > 0, "Invalid price");
        if (stalePriceThreshold > 0) {
            require(block.timestamp - updatedAt <= stalePriceThreshold, "Stale price");
        }

        return (answer, aggregator.decimals());
    }

    /**
     * @notice Convert a USD amount (in cents) to the equivalent token amount.
     * @param token The ERC20 token address
     * @param usdCents The price in USD cents (e.g., 1999 = $19.99)
     * @return tokenAmount The amount in the token's smallest unit
     *
     * Formula: tokenAmount = (usdCents / 100) / (price / 10^feedDecimals) * 10^tokenDecimals
     *        = usdCents * 10^tokenDecimals * 10^feedDecimals / (100 * price)
     */
    function getTokenAmount(address token, uint256 usdCents) external view returns (uint256 tokenAmount) {
        (int256 price, uint8 feedDecimals) = getLatestPrice(token);
        uint8 tDecimals = tokenDecimals[token];

        // usdCents * 10^tokenDecimals * 10^feedDecimals / (100 * price)
        tokenAmount = (usdCents * (10 ** tDecimals) * (10 ** feedDecimals)) / (100 * uint256(price));
    }

    // ── Admin ──

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
