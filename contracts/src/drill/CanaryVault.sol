// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title CanaryVault
/// @notice A deliberately breakable ERC-4626 vault, used to run the claims path end to end on mainnet.
/// @dev The drill operator can move part of the vault's USDC out (an impairment) and put it back.
///      That is the entire purpose of this contract and the reason it is only ever used for drills.
///      Drill markets sit in their own pool, apart from real underwriting capital.
contract CanaryVault is ERC4626 {
    using SafeERC20 for IERC20;

    address public immutable operator;

    event Impaired(uint256 bps, uint256 assetsMoved, uint256 sharePrice);
    event Restored(uint256 assetsReturned, uint256 sharePrice);

    error NotOperator();
    error BadBps();

    constructor(IERC20 usdc, address operator_) ERC20("Rider Canary USDC", "canaryUSDC") ERC4626(usdc) {
        operator = operator_;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    /// @notice Move `bps` of the vault's assets to the operator, lowering the share price.
    function impair(uint256 bps) external onlyOperator returns (uint256 moved) {
        if (bps == 0 || bps > 10_000) revert BadBps();
        moved = IERC20(asset()).balanceOf(address(this)) * bps / 10_000;
        IERC20(asset()).safeTransfer(operator, moved);
        emit Impaired(bps, moved, convertToAssets(10 ** decimals()));
    }

    /// @notice Return assets to the vault, lifting the share price back.
    function restore(uint256 amount) external onlyOperator {
        IERC20(asset()).safeTransferFrom(operator, address(this), amount);
        emit Restored(amount, convertToAssets(10 ** decimals()));
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
