// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Test} from "forge-std/Test.sol";
import {MockFeed, MockUSDC} from "./utils/Fixture.sol";
import {PegTrigger} from "../src/triggers/PegTrigger.sol";
import {ReserveTrigger} from "../src/triggers/ReserveTrigger.sol";
import {VaultDrawdownTrigger} from "../src/triggers/VaultDrawdownTrigger.sol";
import {CanaryVault} from "../src/drill/CanaryVault.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";

contract MockBtc is MockUSDC {
    function decimals() public pure override returns (uint8) {
        return 8;
    }
}

contract RevertingVault {
    function decimals() external pure returns (uint8) {
        return 18;
    }

    function convertToAssets(uint256) external pure returns (uint256) {
        revert("paused");
    }
}

contract TriggersTest is Test {
    function setUp() public {
        vm.warp(1_790_000_000);
    }

    function test_peg_singleFeed() public {
        MockFeed usdt = new MockFeed(8, 0.97e8);
        PegTrigger t = new PegTrigger(IAggregatorV3(address(usdt)), IAggregatorV3(address(0)), 26 hours);
        (bool ok, uint256 loss, uint256 observed) = t.read(0);
        assertTrue(ok);
        assertEq(loss, 300);
        assertEq(observed, 0.97e18);
        usdt.set(1.002e8);
        (, loss,) = t.read(0);
        assertEq(loss, 0, "above peg is not a loss");
    }

    function test_peg_crossRate() public {
        MockFeed eurc = new MockFeed(8, 1.0624e8);
        MockFeed eur = new MockFeed(8, 1.1183e8);
        PegTrigger t = new PegTrigger(IAggregatorV3(address(eurc)), IAggregatorV3(address(eur)), 26 hours);
        (bool ok, uint256 loss,) = t.read(0);
        assertTrue(ok);
        assertEq(loss, 499); // 1.0624 / 1.1183 = 0.95001...
    }

    function test_peg_failsClosed() public {
        MockFeed eurc = new MockFeed(8, 1.1e8);
        MockFeed eur = new MockFeed(8, 1.1e8);
        PegTrigger t = new PegTrigger(IAggregatorV3(address(eurc)), IAggregatorV3(address(eur)), 26 hours);
        eur.setUpdatedAt(block.timestamp - 26 hours - 1);
        (bool ok,,) = t.read(0);
        assertFalse(ok, "stale peg feed");
        eur.set(1.1e8);
        eurc.set(-1);
        (ok,,) = t.read(0);
        assertFalse(ok, "negative answer");
        eurc.set(1.1e8);
        eurc.setUpdatedAt(block.timestamp + 1);
        (ok,,) = t.read(0);
        assertFalse(ok, "future round");
        eurc.set(1.1e8);
        eurc.setBroken(true);
        (ok,,) = t.read(0);
        assertFalse(ok, "reverting feed");
    }

    function test_reserve_backing() public {
        MockBtc cirbtc = new MockBtc();
        cirbtc.mint(address(1), 5_000e8);
        MockFeed por = new MockFeed(8, 6_000e8);
        ReserveTrigger t = new ReserveTrigger(IAggregatorV3(address(por)), IERC20Metadata(address(cirbtc)), 26 hours);
        (bool ok, uint256 loss, uint256 observed) = t.read(0);
        assertTrue(ok);
        assertEq(loss, 0);
        assertEq(observed, 1.2e18);
        por.set(4_500e8);
        (, loss, observed) = t.read(0);
        assertEq(loss, 1_000);
        assertEq(observed, 0.9e18);
        por.setUpdatedAt(block.timestamp - 27 hours);
        (ok,,) = t.read(0);
        assertFalse(ok);
    }

    function test_reserve_zeroSupplyIsHealthy() public {
        MockBtc cirbtc = new MockBtc();
        MockFeed por = new MockFeed(8, 0);
        ReserveTrigger t = new ReserveTrigger(IAggregatorV3(address(por)), IERC20Metadata(address(cirbtc)), 26 hours);
        (bool ok, uint256 loss,) = t.read(0);
        assertTrue(ok);
        assertEq(loss, 0);
    }

    function test_vault_drawdownPerReference() public {
        MockUSDC usdc = new MockUSDC();
        address op = makeAddr("op");
        CanaryVault v = new CanaryVault(IERC20(address(usdc)), op);
        usdc.mint(op, 100e6);
        vm.startPrank(op);
        usdc.approve(address(v), type(uint256).max);
        v.deposit(100e6, op);
        VaultDrawdownTrigger t = new VaultDrawdownTrigger(IERC4626(address(v)));
        uint256 ref = t.referenceValue();
        v.impair(1_234);
        vm.stopPrank();
        (bool ok, uint256 loss, uint256 observed) = t.read(ref);
        assertTrue(ok);
        assertEq(loss, 1_234);
        assertEq(t.lossOf(ref, observed), loss);
        assertEq(t.lossOf(observed, observed), 0, "bought after the drop: no loss");
    }

    function test_vault_revertingVaultIsUnavailable() public {
        VaultDrawdownTrigger t = new VaultDrawdownTrigger(IERC4626(address(new RevertingVault())));
        (bool ok,,) = t.read(1e6);
        assertFalse(ok);
    }

    function testFuzz_peg_lossIsBounded(int256 answer) public {
        answer = bound(answer, 1, 10e8);
        MockFeed f = new MockFeed(8, answer);
        PegTrigger t = new PegTrigger(IAggregatorV3(address(f)), IAggregatorV3(address(0)), 26 hours);
        (bool ok, uint256 loss,) = t.read(0);
        assertTrue(ok);
        assertLe(loss, 10_000);
    }
}
