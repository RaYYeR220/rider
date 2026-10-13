// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {Fixture} from "./utils/Fixture.sol";
import {RiderPool} from "../src/RiderPool.sol";

contract RiderPoolTest is Fixture {
    function setUp() public override {
        super.setUp();
        _seedPool(100_000e6);
    }

    function test_deposit_mintsSharesWithVirtualOffset() public view {
        assertEq(pool.decimals(), 12);
        assertEq(pool.balanceOf(lp), 100_000e12);
        assertEq(pool.totalAssets(), 100_000e6);
    }

    function test_redeem_isAsynchronous() public {
        uint256 shares = pool.balanceOf(lp) / 4;
        vm.prank(lp);
        uint256 requestId = pool.requestRedeem(shares, lp, lp);
        assertEq(requestId, 0);
        assertEq(pool.pendingRedeemRequest(0, lp), shares);
        assertEq(pool.claimableRedeemRequest(0, lp), 0);
        assertEq(pool.balanceOf(address(pool)), shares, "shares escrowed");

        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(RiderPool.NotClaimable.selector, shares, 0));
        pool.redeem(shares, lp, lp);

        vm.warp(block.timestamp + COOLDOWN);
        assertEq(pool.claimableRedeemRequest(0, lp), shares);
        assertEq(pool.maxRedeem(lp), shares);
        uint256 before = usdc.balanceOf(lp);
        vm.prank(lp);
        uint256 assets = pool.redeem(shares, lp, lp);
        assertEq(assets, 25_000e6);
        assertEq(usdc.balanceOf(lp), before + assets);
        assertEq(pool.claimableRedeemRequest(0, lp), 0);
    }

    function test_withdraw_exactAssets() public {
        uint256 shares = pool.balanceOf(lp) / 2;
        vm.prank(lp);
        pool.requestRedeem(shares, lp, lp);
        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(lp);
        uint256 burned = pool.withdraw(10_000e6, lp, lp);
        assertEq(burned, 10_000e12);
        assertEq(pool.claimableRedeemRequest(0, lp), shares - burned);
    }

    function test_redeem_cannotTouchLockedCapital() public {
        _buy(vaultMarket, alice, 50_000e6, 30 days);
        _buy(pegMarket, bob, 40_000e6, 30 days);
        uint256 shares = pool.balanceOf(lp);
        vm.prank(lp);
        pool.requestRedeem(shares, lp, lp);
        vm.warp(block.timestamp + COOLDOWN);
        uint256 free = pool.freeAssets();
        assertApproxEqAbs(free, 10_000e6 + _vested(), 2);
        assertLe(pool.maxWithdraw(lp), free);
        uint256 all = pool.convertToAssets(shares);
        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(RiderPool.ExceedsFreeAssets.selector, all, free));
        pool.redeem(shares, lp, lp);
        vm.prank(lp);
        pool.withdraw(free, lp, lp);
        assertEq(pool.freeAssets(), 0);
        assertGe(usdc.balanceOf(address(pool)), pool.lockedAssets(), "every policy still backed");
    }

    function test_frozen_closesDepositsAndWithdrawalsDuringAnIncident() public {
        _buy(vaultMarket, alice, 1_000e6, 30 days);
        vm.prank(lp);
        pool.requestRedeem(1_000e12, lp, lp);
        vm.warp(block.timestamp + COOLDOWN);

        vm.prank(operator);
        canary.impair(2_000);
        vaultMarket.openIncident();
        assertTrue(pool.frozen());
        assertEq(pool.maxDeposit(bob), 0);
        assertEq(pool.maxRedeem(lp), 0);

        vm.prank(lp);
        vm.expectRevert(RiderPool.PoolFrozen.selector);
        pool.redeem(1_000e12, lp, lp);

        vm.startPrank(bob);
        usdc.approve(address(pool), 1e6);
        vm.expectRevert(abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, bob, 1e6, 0));
        pool.deposit(1e6, bob);
        vm.stopPrank();

        vm.warp(block.timestamp + 1 hours);
        vaultMarket.resolveIncident();
        vaultMarket.claim(1);
        vm.warp(block.timestamp + 7 days + 1);
        vaultMarket.settle();
        assertFalse(pool.frozen());
        vm.prank(lp);
        assertGt(pool.redeem(1_000e12, lp, lp), 0);
    }

    function test_escrowedSharesStillBearLosses() public {
        _buy(vaultMarket, alice, 50_000e6, 30 days);
        uint256 shares = pool.balanceOf(lp);
        vm.prank(lp);
        pool.requestRedeem(shares, lp, lp);
        _triggerVault(5_000); // 50% loss on 50k cover
        vaultMarket.claim(1);
        vm.warp(block.timestamp + 7 days + 1);
        vaultMarket.settle();
        // The underwriter who asked to leave before the loss still takes it.
        assertLt(pool.convertToAssets(shares), 80_000e6);
    }

    function test_operatorAndAllowancePaths() public {
        address op = makeAddr("op");
        vm.prank(lp);
        pool.setOperator(op, true);
        assertTrue(pool.isOperator(lp, op));
        vm.prank(op);
        pool.requestRedeem(1e12, lp, lp);

        address spender = makeAddr("spender");
        vm.prank(spender);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, spender, 0, 1e12)
        );
        pool.requestRedeem(1e12, spender, lp);
        vm.prank(lp);
        pool.approve(spender, 1e12);
        vm.prank(spender);
        pool.requestRedeem(1e12, spender, lp);
        assertEq(pool.pendingRedeemRequest(0, spender), 1e12);

        vm.warp(block.timestamp + COOLDOWN);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(RiderPool.NotAuthorized.selector);
        pool.redeem(1e12, spender, spender);
    }

    function test_audit_cannotRestartSomeoneElsesCooldown() public {
        vm.prank(lp);
        pool.requestRedeem(1_000e12, lp, lp);
        vm.warp(block.timestamp + COOLDOWN - 1);
        // An attacker tops up the victim's request with dust to restart its cooldown.
        address attacker = makeAddr("attacker");
        usdc.mint(attacker, 1e6);
        vm.startPrank(attacker);
        usdc.approve(address(pool), 1e6);
        pool.deposit(1e6, attacker);
        vm.expectRevert(RiderPool.NotAuthorized.selector);
        pool.requestRedeem(1, lp, attacker);
        vm.stopPrank();
        vm.warp(block.timestamp + 1);
        assertEq(pool.claimableRedeemRequest(0, lp), 1_000e12);
    }

    function test_audit_fencedPoolRefusesOutsideDeposits() public {
        RiderPool fenced = new RiderPool(usdc, "Drill", "rDRILL", 10 minutes, 1 hours, owner, owner);
        vm.startPrank(alice);
        usdc.approve(address(fenced), 1e6);
        vm.expectRevert(abi.encodeWithSelector(RiderPool.DepositorNotAllowed.selector, alice));
        fenced.deposit(1e6, alice);
        vm.stopPrank();
        usdc.mint(owner, 1e6);
        vm.startPrank(owner);
        usdc.approve(address(fenced), 1e6);
        fenced.deposit(1e6, owner);
        vm.stopPrank();
    }

    function test_audit_noticeMustExceedCooldown() public {
        vm.expectRevert(bytes("market delay must exceed cooldown"));
        new RiderPool(usdc, "x", "x", 3 days, 3 days, address(0), owner);
    }

    function test_previewsRevertForAsyncFlows() public {
        vm.expectRevert(RiderPool.AsyncRedeem.selector);
        pool.previewRedeem(1);
        vm.expectRevert(RiderPool.AsyncRedeem.selector);
        pool.previewWithdraw(1);
    }

    function test_supportsInterface() public view {
        assertTrue(pool.supportsInterface(0x01ffc9a7));
        assertTrue(pool.supportsInterface(0xe3bc4e65));
        assertTrue(pool.supportsInterface(0x620ee8e4));
        assertTrue(pool.supportsInterface(0x2f0a18c5));
        assertFalse(pool.supportsInterface(0xce3bbe50), "deposits are synchronous");
        assertEq(pool.share(), address(pool));
    }

    function test_onlyMarketsCanPay() public {
        vm.prank(owner);
        vm.expectRevert(RiderPool.NotMarket.selector);
        pool.payout(owner, 1);
    }

    function test_ownerCannotRegisterMarketsDirectly() public {
        vm.prank(owner);
        vm.expectRevert(RiderPool.NotRegistrar.selector);
        pool.addMarket(owner);
    }

    function test_onlyOwnerPausesSales() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.setSalesPaused(address(vaultMarket), true);
    }

    function test_pausingSalesNeverBlocksClaims() public {
        _buy(vaultMarket, alice, 1_000e6, 30 days);
        vm.prank(operator);
        canary.impair(1_000);
        vm.prank(owner);
        pool.setSalesPaused(address(vaultMarket), true);
        vaultMarket.openIncident();
        vm.warp(block.timestamp + 1 hours);
        vaultMarket.resolveIncident();
        assertGt(vaultMarket.claim(1), 0);
    }

    function test_registrarIsSetOnce() public {
        vm.prank(owner);
        vm.expectRevert(RiderPool.RegistrarAlreadySet.selector);
        pool.setRegistrar(owner);
    }

    function _vested() internal view returns (uint256) {
        uint256 cash = usdc.balanceOf(address(pool));
        return cash - 100_000e6 - vaultMarket.unearnedPremium() - pegMarket.unearnedPremium();
    }
}
