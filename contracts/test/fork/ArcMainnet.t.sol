// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {RiderPool} from "../../src/RiderPool.sol";
import {RiderMarket} from "../../src/RiderMarket.sol";
import {RiderPolicy} from "../../src/RiderPolicy.sol";
import {RiderFactory} from "../../src/RiderFactory.sol";
import {CanaryVault} from "../../src/drill/CanaryVault.sol";
import {VaultDrawdownTrigger} from "../../src/triggers/VaultDrawdownTrigger.sol";
import {PegTrigger} from "../../src/triggers/PegTrigger.sol";
import {ReserveTrigger} from "../../src/triggers/ReserveTrigger.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {IRiderTrigger} from "../../src/interfaces/IRiderTrigger.sol";
import {ArcMainnet} from "../../script/ArcMainnet.sol";

interface IMulticall3From {
    struct Call3 {
        address target;
        bool allowFailure;
        bytes callData;
    }

    struct Result {
        bool success;
        bytes returnData;
    }

    function aggregate3(Call3[] calldata calls) external returns (Result[] memory);
}

/// @dev Runs against live Arc mainnet state. Needs Arc's precompiles, so run it with Arc Foundry:
///      arc-forge test --match-path test/fork/* --fork-url https://rpc.mainnet.arc.io
contract ArcMainnetForkTest is Test {
    IERC20 internal usdc = IERC20(ArcMainnet.USDC);
    address internal whale = ArcMainnet.GATEWAY_WALLET;

    RiderPolicy internal policy;
    RiderFactory internal factory;
    RiderPool internal pool;
    address internal owner = makeAddr("owner");
    address internal lp = makeAddr("lp");
    address internal user = makeAddr("user");

    function setUp() public {
        vm.skip(block.chainid != 5042);
        policy = new RiderPolicy(owner);
        factory = new RiderFactory(policy, owner);
        pool = new RiderPool(usdc, "Rider USDC", "rUSDC", 3 days, owner);
        vm.startPrank(owner);
        policy.setRegistrar(address(factory));
        pool.setRegistrar(address(factory));
        vm.stopPrank();

        vm.startPrank(whale);
        usdc.transfer(lp, 10_000e6);
        usdc.transfer(user, 1_000e6);
        vm.stopPrank();
        vm.startPrank(lp);
        usdc.approve(address(pool), 10_000e6);
        pool.deposit(10_000e6, lp);
        vm.stopPrank();
    }

    function test_liveTriggersReadHealthy() public {
        IRiderTrigger[4] memory triggers = [
            IRiderTrigger(new VaultDrawdownTrigger(IERC4626(ArcMainnet.GALAXY_USDC))),
            IRiderTrigger(new VaultDrawdownTrigger(IERC4626(ArcMainnet.KEYROCK_USDC))),
            IRiderTrigger(
                new PegTrigger(IAggregatorV3(ArcMainnet.FEED_EURC_USD), IAggregatorV3(ArcMainnet.FEED_EUR_USD), 26 hours)
            ),
            IRiderTrigger(
                new ReserveTrigger(IAggregatorV3(ArcMainnet.FEED_CIRBTC_POR), IERC20Metadata(ArcMainnet.CIRBTC), 26 hours)
            )
        ];
        for (uint256 i; i < 4; ++i) {
            uint256 ref = triggers[i].referenceValue();
            (bool ok, uint256 loss, uint256 observed) = triggers[i].read(ref);
            emit log_named_string("trigger", triggers[i].kind());
            emit log_named_uint("  observed", observed);
            emit log_named_uint("  lossBps", loss);
            assertTrue(ok, "live reading usable");
            assertLt(loss, 100, "no live incident");
        }
    }

    function test_protectInOneTransaction_viaMulticall3From() public {
        RiderMarket market = _market(new VaultDrawdownTrigger(IERC4626(ArcMainnet.GALAXY_USDC)), "Galaxy USDC");
        IERC4626 vault = IERC4626(ArcMainnet.GALAXY_USDC);
        (uint256 premium,,) = market.quote(100e6, 30 days);

        IMulticall3From.Call3[] memory calls = new IMulticall3From.Call3[](4);
        calls[0] = _call(ArcMainnet.USDC, abi.encodeCall(IERC20.approve, (address(vault), 100e6)));
        calls[1] = _call(address(vault), abi.encodeCall(IERC4626.deposit, (100e6, user)));
        calls[2] = _call(ArcMainnet.USDC, abi.encodeCall(IERC20.approve, (address(market), premium)));
        calls[3] = _call(address(market), abi.encodeCall(RiderMarket.buyCover, (100e6, 30 days, user, premium)));

        uint256 before = usdc.balanceOf(user);
        vm.prank(user, user); // Multicall3From only accepts batches sent by an EOA
        IMulticall3From(ArcMainnet.MULTICALL3_FROM).aggregate3(calls);

        assertGt(vault.balanceOf(user), 0, "vault shares minted to the depositor");
        assertEq(policy.ownerOf(1), user, "policy minted to the depositor");
        assertEq(usdc.balanceOf(user), before - 100e6 - premium);
        assertEq(market.lockedCoverage(), 100e6);
        assertEq(market.policy(1).ref, vault.convertToAssets(1e18));
    }

    function test_drill_paysOnMainnetState() public {
        address operator = makeAddr("operator");
        CanaryVault canary = new CanaryVault(usdc, operator);
        vm.prank(whale);
        usdc.transfer(operator, 10e6);
        vm.startPrank(operator);
        usdc.approve(address(canary), type(uint256).max);
        canary.deposit(10e6, operator);
        vm.stopPrank();

        RiderMarket market = _market(new VaultDrawdownTrigger(IERC4626(address(canary))), "Canary");
        vm.startPrank(user);
        usdc.approve(address(market), type(uint256).max);
        uint256 id = market.buyCover(50e6, 30 days, user, type(uint256).max);
        vm.stopPrank();

        vm.prank(operator);
        canary.impair(2_000);
        market.openIncident();
        vm.warp(block.timestamp + 1 hours);
        market.resolveIncident();
        uint256 before = usdc.balanceOf(user);
        uint256 paid = market.claim(id);
        assertEq(paid, 10e6);
        assertEq(usdc.balanceOf(user), before + 10e6);
    }

    function _market(IRiderTrigger trigger, string memory name) internal returns (RiderMarket m) {
        RiderMarket.Params memory p = RiderMarket.Params({
            trigger: trigger,
            name: name,
            thresholdBps: 100,
            capBps: 5_000,
            baseRateBps: 200,
            slopeBps: 800,
            confirmDelay: 1 hours,
            claimWindow: 7 days,
            epochLength: 1 hours,
            minDuration: 1 days,
            maxDuration: 90 days,
            minCoverage: 1e6,
            maxCoverage: 1_000_000e6
        });
        vm.prank(owner);
        m = factory.createMarket(pool, p);
    }

    function _call(address target, bytes memory data) internal pure returns (IMulticall3From.Call3 memory) {
        return IMulticall3From.Call3({target: target, allowFailure: false, callData: data});
    }
}
