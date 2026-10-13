// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Fixture, MockUSDC, MockFeed} from "../utils/Fixture.sol";
import {RiderPool} from "../../src/RiderPool.sol";
import {RiderMarket} from "../../src/RiderMarket.sol";
import {RiderPolicy} from "../../src/RiderPolicy.sol";
import {CanaryVault} from "../../src/drill/CanaryVault.sol";

/// @dev Drives random sequences of underwriting, buying, time, market shocks, incidents and claims.
contract Handler is Test {
    MockUSDC internal usdc;
    RiderPool internal pool;
    RiderPolicy internal policy;
    CanaryVault internal canary;
    MockFeed internal eurc;
    MockFeed internal eur;
    RiderMarket[2] internal markets;
    address internal operator;
    address[3] internal actors;

    uint256 public ghostPaid;
    uint256 public ghostCoverageOfPaid;
    uint256 public doublePays;
    uint256 public bought;
    mapping(uint256 => bool) public paid;

    constructor(
        MockUSDC usdc_,
        RiderPool pool_,
        RiderPolicy policy_,
        CanaryVault canary_,
        MockFeed eurc_,
        MockFeed eur_,
        RiderMarket vaultMarket,
        RiderMarket pegMarket,
        address operator_
    ) {
        usdc = usdc_;
        pool = pool_;
        policy = policy_;
        canary = canary_;
        eurc = eurc_;
        eur = eur_;
        markets = [vaultMarket, pegMarket];
        operator = operator_;
        actors = [makeAddr("a0"), makeAddr("a1"), makeAddr("a2")];
        for (uint256 i; i < 3; ++i) {
            usdc.mint(actors[i], 10_000_000e6);
            vm.startPrank(actors[i]);
            usdc.approve(address(pool), type(uint256).max);
            usdc.approve(address(vaultMarket), type(uint256).max);
            usdc.approve(address(pegMarket), type(uint256).max);
            vm.stopPrank();
        }
    }

    function deposit(uint256 who, uint256 amount) external {
        address a = actors[who % 3];
        amount = bound(amount, 1e6, 500_000e6);
        if (pool.maxDeposit(a) == 0) return;
        vm.prank(a);
        pool.deposit(amount, a);
    }

    function requestRedeem(uint256 who, uint256 fraction) external {
        address a = actors[who % 3];
        uint256 shares = pool.balanceOf(a) * bound(fraction, 1, 100) / 100;
        if (shares == 0) return;
        vm.prank(a);
        pool.requestRedeem(shares, a, a);
    }

    function redeem(uint256 who) external {
        address a = actors[who % 3];
        uint256 shares = pool.maxRedeem(a);
        if (shares == 0) return;
        vm.prank(a);
        pool.redeem(shares, a, a);
    }

    function buy(uint256 who, uint256 m, uint256 coverage, uint256 duration) external {
        address a = actors[who % 3];
        RiderMarket market = markets[m % 2];
        coverage = bound(coverage, 1e6, 200_000e6);
        duration = bound(duration, 1 days, 90 days);
        vm.prank(a);
        try market.buyCover(coverage, duration, a, type(uint256).max) {
            ++bought;
        } catch {}
    }

    function warp(uint256 secs) external {
        secs = bound(secs, 1, 20 days);
        vm.warp(block.timestamp + secs);
        // Keep the feeds fresh unless a test step deliberately lets them age.
        eurc.set(eurc.answer());
        eur.set(eur.answer());
    }

    function shockVault(uint256 bps) external {
        bps = bound(bps, 1, 6_000);
        vm.prank(operator);
        canary.impair(bps);
    }

    function healVault(uint256 amount) external {
        amount = bound(amount, 1, 50e6);
        uint256 bal = usdc.balanceOf(operator);
        if (bal == 0) return;
        vm.prank(operator);
        canary.restore(amount > bal ? bal : amount);
    }

    function movePeg(uint256 price) external {
        eurc.set(int256(bound(price, 0.8e8, 1.2e8)));
    }

    function open(uint256 m) external {
        try markets[m % 2].openIncident() {} catch {}
    }

    function resolve(uint256 m) external {
        try markets[m % 2].resolveIncident() {} catch {}
    }

    function claimAll(uint256 m) external {
        RiderMarket market = markets[m % 2];
        uint256 last = policy.nextId();
        for (uint256 id = 1; id < last; ++id) {
            if (policy.marketOf(id) != address(market)) continue;
            uint256 cov = market.policy(id).coverage;
            try market.claim(id) returns (uint256 p) {
                if (paid[id]) ++doublePays;
                paid[id] = true;
                ghostPaid += p;
                ghostCoverageOfPaid += cov;
            } catch {}
        }
    }

    function settle(uint256 m) external {
        try markets[m % 2].settle() {} catch {}
    }

    function rearm(uint256 m) external {
        try markets[m % 2].rearm() {} catch {}
    }
}

contract SolvencyInvariantTest is StdInvariant, Fixture {
    Handler internal handler;

    function setUp() public override {
        super.setUp();
        _seedPool(250_000e6);
        handler = new Handler(usdc, pool, policy, canary, tokenFeed, pegFeed, vaultMarket, pegMarket, operator);
        targetContract(address(handler));
    }

    /// Every unit of live cover and unearned premium is held by the pool.
    function invariant_poolHoldsEveryCommitment() public view {
        uint256 cash = usdc.balanceOf(address(pool));
        uint256 owed = vaultMarket.unearnedPremium() + pegMarket.unearnedPremium() + pool.lockedAssets();
        assertGe(cash, owed);
    }

    function invariant_lockedNeverExceedsAssets() public view {
        assertLe(pool.lockedAssets(), pool.totalAssets());
    }

    function invariant_paidNeverExceedsCoverage() public view {
        assertLe(handler.ghostPaid(), handler.ghostCoverageOfPaid());
        RiderMarket.Incident memory a = vaultMarket.incident();
        RiderMarket.Incident memory b = pegMarket.incident();
        assertLe(a.paid, a.claimedCoverage);
        assertLe(a.claimedCoverage, a.exposure);
        assertLe(b.paid, b.claimedCoverage);
        assertLe(b.claimedCoverage, b.exposure);
    }

    function invariant_noPolicyPaidTwice() public view {
        assertEq(handler.doublePays(), 0);
    }

    function invariant_everyPurchaseMintedOnePolicy() public view {
        assertEq(policy.nextId() - 1, handler.bought());
    }
}

contract HandlerSmokeTest is Fixture {
    function test_handlerCanBuy() public {
        _seedPool(250_000e6);
        Handler h = new Handler(usdc, pool, policy, canary, tokenFeed, pegFeed, vaultMarket, pegMarket, operator);
        h.buy(0, 0, 1_000e6, 30 days);
        assertEq(h.bought(), 1);
    }

    /// Negative control for the invariant suite: the handler can reach a paid claim, so the
    /// solvency invariants are checked against states where money actually left the pool.
    /// (Shrunk from a deliberately failing "no payouts ever" invariant.)
    function test_handlerReachesPaidClaims() public {
        _seedPool(250_000e6);
        Handler h = new Handler(usdc, pool, policy, canary, tokenFeed, pegFeed, vaultMarket, pegMarket, operator);
        h.buy(1, 1, 100_000e6, 30 days);
        assertEq(h.bought(), 1);
        h.movePeg(0.9e8);
        h.open(1);
        h.warp(2 hours);
        h.resolve(1);
        h.claimAll(1);
        assertGt(h.ghostPaid(), 0);
        assertEq(h.doublePays(), 0);
        assertGe(usdc.balanceOf(address(pool)), pool.lockedAssets());
    }
}
