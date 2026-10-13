// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice What a pool needs from each market it backs.
interface IRiderMarket {
    /// @notice Capital the pool must keep available for this market's policies.
    function lockedCoverage() external view returns (uint256);

    /// @notice Premium received but not yet earned by underwriters.
    function unearnedPremium() external view returns (uint256);

    /// @notice True while an incident is pending or its claim window is open.
    function isFrozen() external view returns (bool);
}
