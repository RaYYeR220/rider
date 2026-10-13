// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

import {RiderPool} from "../../src/RiderPool.sol";
import {RiderMarket} from "../../src/RiderMarket.sol";
import {RiderPolicy} from "../../src/RiderPolicy.sol";
import {RiderFactory} from "../../src/RiderFactory.sol";
import {CanaryVault} from "../../src/drill/CanaryVault.sol";
import {VaultDrawdownTrigger} from "../../src/triggers/VaultDrawdownTrigger.sol";
import {PegTrigger} from "../../src/triggers/PegTrigger.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {IRiderTrigger} from "../../src/interfaces/IRiderTrigger.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure virtual override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockFeed is IAggregatorV3 {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;
    bool public broken;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function set(int256 answer_) external {
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 t) external {
        updatedAt = t;
    }

    function setBroken(bool b) external {
        broken = b;
    }

    function description() external pure returns (string memory) {
        return "mock";
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        require(!broken, "feed down");
        return (1, answer, updatedAt, updatedAt, 1);
    }
}

/// @dev Common deployment: one pool, one canary-backed vault market and one peg market.
abstract contract Fixture is Test {
    MockUSDC internal usdc;
    RiderPolicy internal policy;
    RiderFactory internal factory;
    RiderPool internal pool;
    CanaryVault internal canary;
    RiderMarket internal vaultMarket;
    RiderMarket internal pegMarket;
    MockFeed internal tokenFeed;
    MockFeed internal pegFeed;

    address internal owner = makeAddr("owner");
    address internal operator = makeAddr("operator");
    address internal lp = makeAddr("lp");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal keeper = makeAddr("keeper");

    uint256 internal constant COOLDOWN = 3 days;
    uint256 internal constant EPOCH = 1 hours;

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        usdc = new MockUSDC();
        policy = new RiderPolicy(owner);
        factory = new RiderFactory(policy, owner);
        pool = new RiderPool(IERC20(address(usdc)), "Rider USDC", "rUSDC", COOLDOWN, owner);
        vm.startPrank(owner);
        policy.setRegistrar(address(factory));
        pool.setRegistrar(address(factory));
        vm.stopPrank();

        canary = new CanaryVault(IERC20(address(usdc)), operator);
        tokenFeed = new MockFeed(8, 1.1183e8); // EURC / USD
        pegFeed = new MockFeed(8, 1.1183e8); // EUR / USD

        vm.startPrank(owner);
        vaultMarket = factory.createMarket(pool, _params(new VaultDrawdownTrigger(IERC4626(address(canary))), "Canary", 100));
        pegMarket = factory.createMarket(
            pool,
            _params(
                new PegTrigger(IAggregatorV3(address(tokenFeed)), IAggregatorV3(address(pegFeed)), 26 hours),
                "EURC peg",
                200
            )
        );
        vm.stopPrank();

        // Seed the canary so it has a share price, and give everyone USDC.
        usdc.mint(operator, 1_000e6);
        usdc.mint(lp, 1_000_000e6);
        usdc.mint(alice, 100_000e6);
        usdc.mint(bob, 100_000e6);
        vm.prank(operator);
        usdc.approve(address(canary), type(uint256).max);
        vm.prank(operator);
        canary.deposit(100e6, operator);
    }

    function _params(IRiderTrigger trigger, string memory name, uint16 thresholdBps)
        internal
        pure
        returns (RiderMarket.Params memory)
    {
        return RiderMarket.Params({
            trigger: trigger,
            name: name,
            thresholdBps: thresholdBps,
            capBps: 5_000,
            baseRateBps: 200,
            slopeBps: 800,
            confirmDelay: 1 hours,
            claimWindow: 7 days,
            epochLength: uint32(EPOCH),
            minDuration: 1 days,
            maxDuration: 90 days,
            minCoverage: 1e6,
            maxCoverage: 1_000_000e6
        });
    }

    function _seedPool(uint256 amount) internal {
        vm.startPrank(lp);
        usdc.approve(address(pool), amount);
        pool.deposit(amount, lp);
        vm.stopPrank();
    }

    function _buy(RiderMarket market, address who, uint256 coverage, uint256 duration) internal returns (uint256 id) {
        vm.startPrank(who);
        usdc.approve(address(market), type(uint256).max);
        id = market.buyCover(coverage, duration, who, type(uint256).max);
        vm.stopPrank();
    }

    /// @dev Impair the canary by `bps`, open an incident, wait, and confirm it.
    function _triggerVault(uint256 bps) internal {
        vm.prank(operator);
        canary.impair(bps);
        vm.prank(keeper);
        vaultMarket.openIncident();
        vm.warp(block.timestamp + 1 hours);
        vm.prank(keeper);
        vaultMarket.resolveIncident();
    }
}
