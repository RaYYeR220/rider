// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {RiderPool} from "../src/RiderPool.sol";
import {RiderMarket} from "../src/RiderMarket.sol";
import {RiderPolicy} from "../src/RiderPolicy.sol";
import {RiderFactory} from "../src/RiderFactory.sol";
import {CanaryVault} from "../src/drill/CanaryVault.sol";
import {VaultDrawdownTrigger} from "../src/triggers/VaultDrawdownTrigger.sol";
import {PegTrigger} from "../src/triggers/PegTrigger.sol";
import {ReserveTrigger} from "../src/triggers/ReserveTrigger.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IRiderTrigger} from "../src/interfaces/IRiderTrigger.sol";
import {ArcMainnet} from "./ArcMainnet.sol";

/// @notice Deploys Rider on Arc mainnet: the policy NFT, the factory, the underwriting pool with its four
///         live markets, and a separate drill pool with a canary market.
/// @dev PRIVATE_KEY deploys and owns. DRILL_OPERATOR may impair and restore the canary vault.
///      arc-forge script script/Deploy.s.sol --rpc-url https://rpc.mainnet.arc.io --broadcast
contract Deploy is Script {
    uint256 internal constant STALE_AFTER = 26 hours; // Chainlink heartbeat on Arc is 24h

    struct Deployment {
        address policy;
        address factory;
        address pool;
        address drillPool;
        address canary;
        address galaxyMarket;
        address keyrockMarket;
        address eurcMarket;
        address cirbtcMarket;
        address canaryMarket;
    }

    function run() external returns (Deployment memory d) {
        require(block.chainid == ArcMainnet.CHAIN_ID, "Arc mainnet only");
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        address drillOperator = vm.envAddress("DRILL_OPERATOR");
        IERC20 usdc = IERC20(ArcMainnet.USDC);

        vm.startBroadcast(key);

        RiderPolicy policy = new RiderPolicy(deployer);
        RiderFactory factory = new RiderFactory(policy, deployer);
        // Main pool: 3-day exit cooldown, and any market added later waits 4 days before selling.
        RiderPool pool = new RiderPool(usdc, "Rider USDC Underwriting", "rUSDC", 3 days, 4 days, address(0), deployer);
        // Drill pool: only the deployer may underwrite it, because its canary is broken on purpose.
        RiderPool drillPool = new RiderPool(usdc, "Rider Drill Pool", "rDRILL", 10 minutes, 1 hours, deployer, deployer);
        policy.setRegistrar(address(factory));
        pool.setRegistrar(address(factory));
        drillPool.setRegistrar(address(factory));

        d.policy = address(policy);
        d.factory = address(factory);
        d.pool = address(pool);
        d.drillPool = address(drillPool);

        d.galaxyMarket = address(
            factory.createMarket(
                pool,
                _live(new VaultDrawdownTrigger(IERC4626(ArcMainnet.GALAXY_USDC)), "Galaxy USDC vault", 100, 150, 600, 1 hours)
            )
        );
        d.keyrockMarket = address(
            factory.createMarket(
                pool,
                _live(
                    new VaultDrawdownTrigger(IERC4626(ArcMainnet.KEYROCK_USDC)), "Keyrock Prime USDC vault", 100, 150, 600, 1 hours
                )
            )
        );
        d.eurcMarket = address(
            factory.createMarket(
                pool,
                _live(
                    new PegTrigger(
                        IAggregatorV3(ArcMainnet.FEED_EURC_USD), IAggregatorV3(ArcMainnet.FEED_EUR_USD), STALE_AFTER
                    ),
                    "EURC peg to the euro",
                    200,
                    100,
                    400,
                    6 hours
                )
            )
        );
        d.cirbtcMarket = address(
            factory.createMarket(
                pool,
                _live(
                    new ReserveTrigger(
                        IAggregatorV3(ArcMainnet.FEED_CIRBTC_POR), IERC20Metadata(ArcMainnet.CIRBTC), STALE_AFTER
                    ),
                    "cirBTC reserve backing",
                    100,
                    100,
                    400,
                    6 hours
                )
            )
        );

        CanaryVault canary = new CanaryVault(usdc, drillOperator);
        d.canary = address(canary);
        d.canaryMarket = address(
            factory.createMarket(
                drillPool,
                RiderMarket.Params({
                    trigger: new VaultDrawdownTrigger(IERC4626(address(canary))),
                    name: "Canary drill vault",
                    thresholdBps: 500,
                    capBps: 10_000,
                    baseRateBps: 1_000,
                    slopeBps: 0,
                    confirmDelay: 30,
                    claimWindow: 90,
                    epochLength: 60,
                    minDuration: 5 minutes,
                    maxDuration: 60 minutes,
                    minCoverage: 0.01e6,
                    maxCoverage: 5e6,
                    restrictedBuyer: drillOperator
                })
            )
        );

        vm.stopBroadcast();
        _write(d, deployer, drillOperator);
    }

    /// @dev Live markets end policies on day boundaries, which bounds the expiry buckets a market can
    ///      carry to its 90-day maximum term. Feed-based triggers wait 6 hours to confirm, so a lagging
    ///      Proof-of-Reserve or cross-rate update cannot confirm a loss on its own.
    function _live(
        IRiderTrigger trigger,
        string memory name,
        uint16 threshold,
        uint16 baseRate,
        uint16 slope,
        uint32 confirmDelay
    ) internal pure returns (RiderMarket.Params memory) {
        return RiderMarket.Params({
            trigger: trigger,
            name: name,
            thresholdBps: threshold,
            capBps: 5_000,
            baseRateBps: baseRate,
            slopeBps: slope,
            confirmDelay: confirmDelay,
            claimWindow: 7 days,
            epochLength: 1 days,
            minDuration: 1 days,
            maxDuration: 90 days,
            minCoverage: 0.1e6,
            maxCoverage: 1_000_000e6,
            restrictedBuyer: address(0)
        });
    }

    function _write(Deployment memory d, address deployer, address drillOperator) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "block", block.number);
        vm.serializeAddress(k, "deployer", deployer);
        vm.serializeAddress(k, "drillOperator", drillOperator);
        vm.serializeAddress(k, "usdc", ArcMainnet.USDC);
        vm.serializeAddress(k, "multicall3From", ArcMainnet.MULTICALL3_FROM);
        vm.serializeAddress(k, "policy", d.policy);
        vm.serializeAddress(k, "factory", d.factory);
        vm.serializeAddress(k, "pool", d.pool);
        vm.serializeAddress(k, "drillPool", d.drillPool);
        vm.serializeAddress(k, "canary", d.canary);
        vm.serializeAddress(k, "galaxyMarket", d.galaxyMarket);
        vm.serializeAddress(k, "keyrockMarket", d.keyrockMarket);
        vm.serializeAddress(k, "eurcMarket", d.eurcMarket);
        vm.serializeAddress(k, "cirbtcMarket", d.cirbtcMarket);
        string memory json = vm.serializeAddress(k, "canaryMarket", d.canaryMarket);
        string memory path = vm.envOr("DEPLOYMENT_FILE", string("deployments/arc-mainnet.json"));
        vm.writeJson(json, path);
        console2.log("written", path);
    }
}
