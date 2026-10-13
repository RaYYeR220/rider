// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Fixture} from "./utils/Fixture.sol";
import {RiderMarket} from "../src/RiderMarket.sol";

contract RiderMarketTest is Fixture {
    function setUp() public override {
        super.setUp();
        _seedPool(100_000e6);
    }

    // ─────────────────────────────────────────────────────────────── buying

    function test_buy_collectsPremiumMintsPolicyAndLocksCapital() public {
        (uint256 premium, uint256 end,) = vaultMarket.quote(1_000e6, 30 days);
        uint256 poolBefore = usdc.balanceOf(address(pool));

        uint256 id = _buy(vaultMarket, alice, 1_000e6, 30 days);

        assertEq(policy.ownerOf(id), alice);
        assertEq(policy.marketOf(id), address(vaultMarket));
        assertEq(usdc.balanceOf(address(pool)), poolBefore + premium);
        assertEq(vaultMarket.lockedCoverage(), 1_000e6);
        assertEq(pool.lockedAssets(), 1_000e6);
        assertEq(end % EPOCH, 0, "ends on an epoch boundary");
        RiderMarket.Policy memory p = vaultMarket.policy(id);
        assertEq(p.coverage, 1_000e6);
        assertEq(p.premium, premium);
        assertEq(p.ref, canary.convertToAssets(1e12));
        // Premium arrives unearned: underwriters' share price does not jump.
        assertApproxEqAbs(pool.totalAssets(), 100_000e6, 1);
    }

    function test_quote_risesWithUtilisation() public {
        (, , uint256 lowRate) = vaultMarket.quote(1_000e6, 30 days);
        (, , uint256 highRate) = vaultMarket.quote(50_000e6, 30 days);
        assertEq(lowRate, uint256(200)); // 2% of a 50k cap: the quadratic term rounds to 0
        assertEq(highRate, uint256(1_000)); // fully utilised: base 2% + slope 8%
        assertGt(highRate, lowRate);
    }

    function test_quote_premiumMath() public view {
        (uint256 premium, uint256 end, uint256 rate) = vaultMarket.quote(10_000e6, 365 days);
        uint256 expected = (10_000e6 * rate * (end - block.timestamp) + 1e4 * 365 days - 1) / (1e4 * 365 days);
        assertEq(premium, expected);
    }

    function test_buy_policyNftMetadataRenders() public {
        uint256 id = _buy(vaultMarket, alice, 1_234_560_000, 2 days);
        string memory uri = policy.tokenURI(id);
        assertGt(bytes(uri).length, 1000);
        assertEq(_prefix(uri, 29), "data:application/json;base64,");
    }

    // ─────────────────────────────────────────────────────────────── refusals

    function test_refuse_overCapacity() public {
        // cap = 50% of 100k pool = 50k
        vm.startPrank(alice);
        usdc.approve(address(vaultMarket), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(RiderMarket.CapacityExceeded.selector, 50_001e6, 50_000e6));
        vaultMarket.buyCover(50_001e6, 30 days, alice, type(uint256).max);
        vm.stopPrank();
    }

    function test_refuse_whenPoolCapitalIsCommitted() public {
        // Two markets each allowed 50% — fill one completely, then the other can only use what's left.
        _buy(vaultMarket, alice, 50_000e6, 30 days);
        _buy(pegMarket, bob, 49_000e6, 30 days);
        uint256 free = pool.freeAssets();
        assertLt(free, 2_000e6);
        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(RiderMarket.CapacityExceeded.selector, 2_000e6, 1_000e6));
        pegMarket.buyCover(2_000e6, 30 days, bob, type(uint256).max);
        vm.stopPrank();
    }

    function test_refuse_insufficientFreeCapital() public {
        // Market cap is relative to total assets; free capital is what's left after other locks.
        RiderMarket.Params memory p = _wide();
        vm.prank(owner);
        RiderMarket wide = factory.createMarket(pool, p);
        _buy(vaultMarket, alice, 50_000e6, 30 days);
        _buy(pegMarket, bob, 45_000e6, 30 days);
        uint256 free = pool.freeAssets();
        vm.startPrank(alice);
        usdc.approve(address(wide), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(RiderMarket.InsufficientCapital.selector, 10_000e6, free));
        wide.buyCover(10_000e6, 30 days, alice, type(uint256).max);
        vm.stopPrank();
    }

    function test_refuse_coverOnABurningHouse() public {
        vm.prank(operator);
        canary.impair(150); // 1.5% drawdown, threshold 1%
        vm.startPrank(alice);
        usdc.approve(address(vaultMarket), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(RiderMarket.TriggerFiring.selector, 150));
        vaultMarket.buyCover(1_000e6, 30 days, alice, type(uint256).max);
        vm.stopPrank();
    }

    function test_refuse_staleFeed() public {
        tokenFeed.setUpdatedAt(block.timestamp - 27 hours);
        vm.startPrank(alice);
        usdc.approve(address(pegMarket), type(uint256).max);
        vm.expectRevert(RiderMarket.TriggerUnavailable.selector);
        pegMarket.buyCover(1_000e6, 30 days, alice, type(uint256).max);
        vm.stopPrank();
    }

    function test_refuse_brokenFeed() public {
        pegFeed.setBroken(true);
        vm.startPrank(alice);
        usdc.approve(address(pegMarket), type(uint256).max);
        vm.expectRevert(RiderMarket.TriggerUnavailable.selector);
        pegMarket.buyCover(1_000e6, 30 days, alice, type(uint256).max);
        vm.stopPrank();
    }

    function test_refuse_salesPausedByOwner() public {
        vm.prank(owner);
        pool.setSalesPaused(address(vaultMarket), true);
        vm.startPrank(alice);
        usdc.approve(address(vaultMarket), type(uint256).max);
        vm.expectRevert(RiderMarket.SalesPaused.selector);
        vaultMarket.buyCover(1_000e6, 30 days, alice, type(uint256).max);
        vm.stopPrank();
    }

    function test_refuse_premiumSlippage() public {
        (uint256 premium,,) = vaultMarket.quote(1_000e6, 30 days);
        vm.startPrank(alice);
        usdc.approve(address(vaultMarket), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(RiderMarket.PremiumAboveMax.selector, premium, premium - 1));
        vaultMarket.buyCover(1_000e6, 30 days, alice, premium - 1);
        vm.stopPrank();
    }

    function test_refuse_termAndSizeBounds() public {
        vm.startPrank(alice);
        usdc.approve(address(vaultMarket), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(RiderMarket.DurationOutOfRange.selector, 1 hours));
        vaultMarket.buyCover(1_000e6, 1 hours, alice, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(RiderMarket.DurationOutOfRange.selector, 91 days));
        vaultMarket.buyCover(1_000e6, 91 days, alice, type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(RiderMarket.CoverageBelowMinimum.selector, 1e6 - 1));
        vaultMarket.buyCover(1e6 - 1, 30 days, alice, type(uint256).max);
        vm.expectRevert(RiderMarket.ZeroHolder.selector);
        vaultMarket.buyCover(1_000e6, 30 days, address(0), type(uint256).max);
        vm.stopPrank();
    }

    function test_refuse_incidentOnHealthyReading() public {
        vm.expectRevert(abi.encodeWithSelector(RiderMarket.NotFiring.selector, 0));
        vaultMarket.openIncident();
    }

    function test_refuse_incidentOnUnreadableData() public {
        tokenFeed.set(0);
        vm.expectRevert(RiderMarket.TriggerUnavailable.selector);
        pegMarket.openIncident();
    }

    function test_refuse_claimWithoutIncident() public {
        uint256 id = _buy(vaultMarket, alice, 1_000e6, 30 days);
        vm.expectRevert(abi.encodeWithSelector(RiderMarket.WrongStatus.selector, RiderMarket.Status.Active));
        vaultMarket.claim(id);
    }

    // ─────────────────────────────────────────────────────────────── incidents and claims

    function test_incident_fullLifecycle_paysHolderTheirLoss() public {
        uint256 id = _buy(vaultMarket, alice, 10_000e6, 30 days);
        uint256 aliceBefore = usdc.balanceOf(alice);

        vm.prank(operator);
        canary.impair(2_000); // 20% loss
        vaultMarket.openIncident();
        assertEq(uint8(vaultMarket.status()), uint8(RiderMarket.Status.Pending));
        assertTrue(pool.frozen());

        vm.expectRevert(abi.encodeWithSelector(RiderMarket.ConfirmTooEarly.selector, block.timestamp + 1 hours));
        vaultMarket.resolveIncident();

        vm.warp(block.timestamp + 1 hours);
        vaultMarket.resolveIncident();
        assertEq(uint8(vaultMarket.status()), uint8(RiderMarket.Status.Triggered));

        (uint256 owed, bool canClaim) = vaultMarket.claimable(id);
        assertTrue(canClaim);
        assertApproxEqAbs(owed, 2_000e6, 1e6);

        vm.prank(keeper); // anyone can push the claim; the holder is paid
        uint256 paid = vaultMarket.claim(id);
        assertEq(paid, owed);
        assertEq(usdc.balanceOf(alice), aliceBefore + paid);

        vm.expectRevert(abi.encodeWithSelector(RiderMarket.AlreadyClaimed.selector, id));
        vaultMarket.claim(id);

        vm.expectRevert();
        vaultMarket.settle();
        vm.warp(block.timestamp + 7 days + 1);
        vaultMarket.settle();
        assertEq(uint8(vaultMarket.status()), uint8(RiderMarket.Status.Settled));
        assertEq(vaultMarket.lockedCoverage(), 0);
        assertFalse(pool.frozen());

        vaultMarket.rearm();
        assertEq(uint8(vaultMarket.status()), uint8(RiderMarket.Status.Active));
        assertEq(vaultMarket.generation(), 1);
    }

    function test_incident_payoutFollowsTheNft() public {
        uint256 id = _buy(vaultMarket, alice, 1_000e6, 30 days);
        vm.prank(alice);
        policy.transferFrom(alice, bob, id);
        uint256 bobBefore = usdc.balanceOf(bob);
        _triggerVault(1_000);
        uint256 paid = vaultMarket.claim(id);
        assertGt(paid, 0);
        assertEq(usdc.balanceOf(bob), bobBefore + paid);
    }

    function test_incident_dismissedWhenReadingRecovers() public {
        _buy(vaultMarket, alice, 1_000e6, 30 days);
        vm.prank(operator);
        uint256 moved = canary.impair(500);
        vaultMarket.openIncident();
        vm.prank(operator);
        canary.restore(moved);
        vm.warp(block.timestamp + 1 hours);
        vaultMarket.resolveIncident();
        assertEq(uint8(vaultMarket.status()), uint8(RiderMarket.Status.Active));
        assertFalse(pool.frozen());
        assertEq(vaultMarket.lockedCoverage(), 1_000e6);
    }

    function test_incident_dismissedWhenDataGoesStale() public {
        _buy(pegMarket, alice, 1_000e6, 30 days);
        tokenFeed.set(1.05e8); // EURC at 0.939 per euro
        pegMarket.openIncident();
        vm.warp(block.timestamp + 27 hours); // both feeds now stale
        pegMarket.resolveIncident();
        assertEq(uint8(pegMarket.status()), uint8(RiderMarket.Status.Active));
    }

    function test_incident_pricedAtTheHealthierReading() public {
        uint256 id = _buy(vaultMarket, alice, 10_000e6, 30 days);
        vm.prank(operator);
        canary.impair(3_000); // -30% at open
        vaultMarket.openIncident();
        vm.prank(operator);
        canary.restore(15e6); // partially back before confirmation
        vm.warp(block.timestamp + 1 hours);
        vaultMarket.resolveIncident();
        RiderMarket.Incident memory inc = vaultMarket.incident();
        assertEq(inc.observed, canary.convertToAssets(1e12), "priced at the recovered reading");
        (uint256 owed,) = vaultMarket.claimable(id);
        assertLt(owed, 3_000e6);
        assertApproxEqAbs(owed, 1_500e6, 1e6);
    }

    function test_incident_pegCrossRate() public {
        uint256 id = _buy(pegMarket, alice, 10_000e6, 30 days);
        tokenFeed.set(1.0624e8); // EURC = 0.95 EUR
        pegMarket.openIncident();
        vm.warp(block.timestamp + 1 hours);
        tokenFeed.set(1.0624e8);
        pegFeed.set(1.1183e8);
        pegMarket.resolveIncident();
        uint256 paid = pegMarket.claim(id);
        assertApproxEqAbs(paid, 500e6, 1e6);
    }

    function test_incident_expiredPoliciesAreNotEligible() public {
        uint256 shortId = _buy(vaultMarket, alice, 1_000e6, 1 days);
        uint256 longId = _buy(vaultMarket, bob, 1_000e6, 30 days);
        vm.warp(block.timestamp + 2 days);
        _triggerVault(1_000);
        vm.expectRevert(abi.encodeWithSelector(RiderMarket.NotEligible.selector, shortId));
        vaultMarket.claim(shortId);
        assertGt(vaultMarket.claim(longId), 0);
    }

    function test_incident_exposureIsSnapshotAtOpen() public {
        _buy(vaultMarket, alice, 1_000e6, 1 days);
        _buy(vaultMarket, bob, 2_000e6, 30 days);
        vm.prank(operator);
        canary.impair(1_000);
        vaultMarket.openIncident();
        // A policy expiring while the incident is pending stays covered.
        vm.warp(block.timestamp + 2 days);
        assertEq(vaultMarket.lockedCoverage(), 3_000e6);
        vaultMarket.resolveIncident();
        assertEq(vaultMarket.lockedCoverage(), 3_000e6);
    }

    function test_incident_claimManySkipsTheIneligible() public {
        uint256 a = _buy(vaultMarket, alice, 1_000e6, 30 days);
        uint256 b = _buy(vaultMarket, bob, 3_000e6, 30 days);
        _triggerVault(1_000);
        uint256[] memory ids = new uint256[](4);
        ids[0] = a;
        ids[1] = b;
        ids[2] = a; // duplicate is skipped
        ids[3] = 999; // unknown is skipped
        uint256 total = vaultMarket.claimMany(ids);
        assertApproxEqAbs(total, 400e6, 1e6);
        assertEq(vaultMarket.lockedCoverage(), 0);
    }

    function test_incident_retiresTheGeneration() public {
        uint256 oldId = _buy(vaultMarket, alice, 1_000e6, 30 days);
        _triggerVault(1_000);
        vm.warp(block.timestamp + 7 days + 1);
        vaultMarket.settle();
        vaultMarket.rearm();
        // The old policy is retired: it no longer locks capital and cannot claim again.
        assertEq(vaultMarket.lockedCoverage(), 0);
        (,,,,,, uint8 state,) = vaultMarket.policyCard(oldId);
        assertEq(state, 4);
        uint256 newId = _buy(vaultMarket, bob, 2_000e6, 30 days);
        assertEq(vaultMarket.lockedCoverage(), 2_000e6);
        assertEq(vaultMarket.policy(newId).generation, 1);
    }

    function test_incident_claimWindowCloses() public {
        uint256 id = _buy(vaultMarket, alice, 1_000e6, 30 days);
        _triggerVault(1_000);
        uint256 deadline = vaultMarket.incident().claimDeadline;
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(RiderMarket.ClaimWindowClosed.selector, deadline));
        vaultMarket.claim(id);
    }

    function test_incident_rearmRefusedWhileStillFiring() public {
        _buy(pegMarket, alice, 1_000e6, 30 days);
        tokenFeed.set(1.0e8);
        pegMarket.openIncident();
        vm.warp(block.timestamp + 1 hours);
        tokenFeed.set(1.0e8);
        pegFeed.set(1.1183e8);
        pegMarket.resolveIncident();
        vm.warp(block.timestamp + 7 days + 1);
        tokenFeed.set(1.0e8);
        pegFeed.set(1.1183e8);
        pegMarket.settle();
        vm.expectRevert();
        pegMarket.rearm();
    }

    // ─────────────────────────────────────────────────────────────── premium accounting

    function test_premium_vestsLinearlyToUnderwriters() public {
        uint256 assets0 = pool.totalAssets();
        _buy(vaultMarket, alice, 10_000e6, 30 days);
        uint256 premium = vaultMarket.policy(1).premium;
        uint256 end = vaultMarket.policy(1).end;
        uint256 term = end - block.timestamp;
        assertApproxEqAbs(vaultMarket.unearnedPremium(), premium, 1);

        vm.warp(block.timestamp + term / 2);
        assertApproxEqAbs(pool.totalAssets(), assets0 + premium / 2, 2);

        vm.warp(end);
        assertEq(vaultMarket.unearnedPremium(), 0);
        assertEq(vaultMarket.lockedCoverage(), 0);
        assertEq(pool.totalAssets(), assets0 + premium);
    }

    function test_premium_bitmapMatchesBruteForce() public {
        uint256[] memory durations = new uint256[](6);
        durations[0] = 1 days;
        durations[1] = 1 days + 1;
        durations[2] = 3 days;
        durations[3] = 30 days;
        durations[4] = 60 days;
        durations[5] = 90 days;
        uint256[] memory ends = new uint256[](6);
        for (uint256 i; i < 6; ++i) {
            uint256 id = _buy(vaultMarket, alice, (i + 1) * 100e6, durations[i]);
            ends[i] = vaultMarket.policy(id).end;
            vm.warp(block.timestamp + 37 minutes);
        }
        uint256[] memory checkpoints = new uint256[](5);
        checkpoints[0] = 1 days + 2 hours;
        checkpoints[1] = 2 days;
        checkpoints[2] = 31 days;
        checkpoints[3] = 70 days;
        checkpoints[4] = 200 days;
        uint256 t0 = block.timestamp;
        for (uint256 c; c < checkpoints.length; ++c) {
            vm.warp(t0 + checkpoints[c]);
            uint256 expected;
            for (uint256 i; i < 6; ++i) {
                if (block.timestamp < ends[i]) expected += (i + 1) * 100e6;
            }
            assertEq(vaultMarket.activeCoverage(), expected);
        }
    }

    function test_premium_noSnipingByLateUnderwriter() public {
        _buy(vaultMarket, alice, 40_000e6, 90 days);
        // A new underwriter joins right after a large premium: it buys in at the pre-premium price.
        vm.startPrank(bob);
        usdc.approve(address(pool), 100_000e6);
        uint256 shares = pool.deposit(100_000e6, bob);
        vm.stopPrank();
        assertApproxEqRel(pool.convertToAssets(shares), 100_000e6, 1e12);
    }

    function _wide() internal returns (RiderMarket.Params memory p) {
        p = _params(vaultMarket.trigger(), "Wide", 100);
        p.capBps = 10_000;
    }

    function _prefix(string memory s, uint256 n) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(n);
        for (uint256 i; i < n; ++i) {
            out[i] = b[i];
        }
        return string(out);
    }
}
