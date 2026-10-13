// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {IRiderTrigger} from "../interfaces/IRiderTrigger.sol";

/// @title PegTrigger
/// @notice Measures how far a stablecoin trades below its peg, using Chainlink feeds on Arc.
/// @dev With one feed the peg is 1.00 in the feed's quote currency (USDT / USD). With two feeds the
///      peg is the cross rate, which is how a non-dollar stablecoin is checked against its own
///      currency: (EURC / USD) / (EUR / USD) = EURC per euro. A stale, future-dated or non-positive
///      round makes the reading unusable rather than healthy.
contract PegTrigger is IRiderTrigger {
    uint256 private constant ONE = 1e18;

    IAggregatorV3 public immutable token;
    IAggregatorV3 public immutable peg;
    uint256 public immutable maxAge;
    uint256 private immutable _tokenScale;
    uint256 private immutable _pegScale;

    /// @param token_ feed for the stablecoin, e.g. EURC / USD
    /// @param peg_ feed for its reference currency, e.g. EUR / USD; address(0) for a dollar peg
    /// @param maxAge_ oldest acceptable round, in seconds
    constructor(IAggregatorV3 token_, IAggregatorV3 peg_, uint256 maxAge_) {
        token = token_;
        peg = peg_;
        maxAge = maxAge_;
        _tokenScale = 10 ** token_.decimals();
        _pegScale = address(peg_) == address(0) ? 0 : 10 ** peg_.decimals();
    }

    function referenceValue() external pure returns (uint256) {
        return ONE;
    }

    function read(uint256) external view returns (bool ok, uint256 lossBps, uint256 observed) {
        (bool okToken, uint256 tokenPrice) = _price(token, _tokenScale);
        if (!okToken) return (false, 0, 0);
        uint256 ratio = tokenPrice;
        if (address(peg) != address(0)) {
            (bool okPeg, uint256 pegPrice) = _price(peg, _pegScale);
            if (!okPeg) return (false, 0, 0);
            ratio = tokenPrice * ONE / pegPrice;
        }
        return (true, _loss(ratio), ratio);
    }

    function lossOf(uint256, uint256 observed) external pure returns (uint256) {
        return _loss(observed);
    }

    function kind() external pure returns (string memory) {
        return "peg";
    }

    function subject() external view returns (address) {
        return address(token);
    }

    /// @dev Price normalised to 1e18, or false when the round is unusable.
    function _price(IAggregatorV3 feed, uint256 scale) private view returns (bool, uint256) {
        try feed.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp) return (false, 0);
            if (block.timestamp - updatedAt > maxAge) return (false, 0);
            return (true, uint256(answer) * ONE / scale);
        } catch {
            return (false, 0);
        }
    }

    function _loss(uint256 ratio) private pure returns (uint256) {
        if (ratio >= ONE) return 0;
        return (ONE - ratio) * 10_000 / ONE;
    }
}
