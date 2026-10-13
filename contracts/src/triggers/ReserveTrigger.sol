// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {IRiderTrigger} from "../interfaces/IRiderTrigger.sol";

/// @title ReserveTrigger
/// @notice Compares a Proof-of-Reserve feed with the supply of the token it is meant to back.
/// @dev On Arc this watches cirBTC: the "cirBTC Reserves" Chainlink feed against cirBTC
///      totalSupply(). Backing below 100% is a loss for every holder in proportion to the shortfall.
contract ReserveTrigger is IRiderTrigger {
    uint256 private constant ONE = 1e18;

    IAggregatorV3 public immutable reserves;
    IERC20Metadata public immutable token;
    uint256 public immutable maxAge;
    uint256 private immutable _feedScale;
    uint256 private immutable _tokenScale;

    constructor(IAggregatorV3 reserves_, IERC20Metadata token_, uint256 maxAge_) {
        reserves = reserves_;
        token = token_;
        maxAge = maxAge_;
        _feedScale = 10 ** reserves_.decimals();
        _tokenScale = 10 ** token_.decimals();
    }

    function referenceValue() external pure returns (uint256) {
        return ONE;
    }

    function read(uint256) external view returns (bool ok, uint256 lossBps, uint256 observed) {
        uint256 reserve;
        try reserves.latestRoundData() returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) {
            if (answer < 0 || updatedAt == 0 || updatedAt > block.timestamp) return (false, 0, 0);
            if (block.timestamp - updatedAt > maxAge) return (false, 0, 0);
            reserve = uint256(answer);
        } catch {
            return (false, 0, 0);
        }
        uint256 supply;
        try token.totalSupply() returns (uint256 s) {
            supply = s;
        } catch {
            return (false, 0, 0);
        }
        // Nothing issued means nothing to back.
        if (supply == 0) return (true, 0, type(uint256).max);
        uint256 backing = reserve * _tokenScale * ONE / (supply * _feedScale);
        return (true, _loss(backing), backing);
    }

    function lossOf(uint256, uint256 observed) external pure returns (uint256) {
        return _loss(observed);
    }

    function kind() external pure returns (string memory) {
        return "reserve";
    }

    function subject() external view returns (address) {
        return address(token);
    }

    function _loss(uint256 backing) private pure returns (uint256) {
        if (backing >= ONE) return 0;
        return (ONE - backing) * 10_000 / ONE;
    }
}
