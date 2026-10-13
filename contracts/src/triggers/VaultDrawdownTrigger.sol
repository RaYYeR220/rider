// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {IRiderTrigger} from "../interfaces/IRiderTrigger.sol";

/// @title VaultDrawdownTrigger
/// @notice Measures the drop in an ERC-4626 vault's share price since a reference price.
/// @dev Built for Morpho Vault V2 on Arc, which marks realised losses into the share price
///      immediately, but works for any ERC-4626 vault. Claims are priced per policy against the
///      share price the policy was bought at, so each holder is made whole on their own entry.
contract VaultDrawdownTrigger is IRiderTrigger {
    IERC4626 public immutable vault;
    uint256 public immutable unit;

    constructor(IERC4626 vault_) {
        vault = vault_;
        unit = 10 ** vault_.decimals();
    }

    function referenceValue() external view returns (uint256) {
        return vault.convertToAssets(unit);
    }

    function read(uint256 ref) external view returns (bool ok, uint256 lossBps, uint256 observed) {
        try vault.convertToAssets(unit) returns (uint256 price) {
            if (price == 0) return (false, 0, 0);
            return (true, _loss(ref, price), price);
        } catch {
            return (false, 0, 0);
        }
    }

    function lossOf(uint256 ref, uint256 observed) external pure returns (uint256) {
        return _loss(ref, observed);
    }

    function kind() external pure returns (string memory) {
        return "vault-drawdown";
    }

    function subject() external view returns (address) {
        return address(vault);
    }

    function _loss(uint256 ref, uint256 price) private pure returns (uint256) {
        if (ref == 0 || price >= ref) return 0;
        return (ref - price) * 10_000 / ref;
    }
}
