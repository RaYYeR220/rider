// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IRiderPool} from "./interfaces/IRiderPool.sol";
import {RiderMarket} from "./RiderMarket.sol";
import {RiderPolicy} from "./RiderPolicy.sol";
import {RiderPool} from "./RiderPool.sol";

/// @title RiderFactory
/// @notice Deploys markets and wires them into a pool and the policy NFT in one step.
/// @dev Creating a market commits a pool's capital to a new risk, so it is a curated action.
contract RiderFactory is Ownable {
    RiderPolicy public immutable policyNft;
    address[] internal _markets;

    event MarketCreated(address indexed market, address indexed pool, address indexed trigger, string name);

    constructor(RiderPolicy policyNft_, address owner_) Ownable(owner_) {
        policyNft = policyNft_;
    }

    function createMarket(RiderPool pool, RiderMarket.Params calldata params)
        external
        onlyOwner
        returns (RiderMarket market)
    {
        market = new RiderMarket(IRiderPool(address(pool)), policyNft, params);
        pool.addMarket(address(market));
        policyNft.addMinter(address(market));
        _markets.push(address(market));
        emit MarketCreated(address(market), address(pool), address(params.trigger), params.name);
    }

    function markets() external view returns (address[] memory) {
        return _markets;
    }
}
