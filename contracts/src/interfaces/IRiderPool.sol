// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IRiderPool {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function freeAssets() external view returns (uint256);
    function salesPaused(address market) external view returns (bool);
    function payout(address to, uint256 amount) external;
}
