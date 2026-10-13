// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice A parametric trigger turns an on-chain reading into a loss ratio.
/// @dev Every reading is "higher is healthier" (share price, peg ratio, reserve backing), so a
///      conservative observation is always the larger of two readings.
interface IRiderTrigger {
    /// @notice Value recorded on a policy at purchase. Vault triggers return the current share price;
    ///         triggers measured against a fixed target return that target (1e18).
    function referenceValue() external view returns (uint256);

    /// @notice Current reading and the loss it implies relative to `ref`.
    /// @return ok      false when the data cannot be trusted (stale, non-positive, call reverted).
    ///                 Callers must fail closed on `ok == false`: no sales and no incidents.
    /// @return lossBps loss in basis points, 0..10_000.
    /// @return observed the raw reading the loss was computed from.
    function read(uint256 ref) external view returns (bool ok, uint256 lossBps, uint256 observed);

    /// @notice Loss implied by a past reading, used to price claims at the confirmed observation.
    function lossOf(uint256 ref, uint256 observed) external view returns (uint256 lossBps);

    /// @notice Short machine-readable kind: "vault-drawdown", "peg", "reserve".
    function kind() external view returns (string memory);

    /// @notice The asset, vault or feed the trigger watches.
    function subject() external view returns (address);
}
