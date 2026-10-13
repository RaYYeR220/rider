// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IRiderTrigger} from "./interfaces/IRiderTrigger.sol";
import {IRiderMarket} from "./interfaces/IRiderMarket.sol";
import {IRiderPool} from "./interfaces/IRiderPool.sol";
import {CoverBook} from "./libraries/CoverBook.sol";
import {RiderPolicy} from "./RiderPolicy.sol";

/// @title RiderMarket
/// @notice Sells cover against one on-chain risk and pays claims when that risk is proven on-chain.
///
/// Lifecycle
///   Active ──openIncident──▶ Pending ──resolveIncident──▶ Triggered ──settle──▶ Settled ──rearm──▶ Active
///                               │ (reading recovered)
///                               └────────────▶ Active
///
/// - Cover is sold only while the trigger reads healthy. A reading that cannot be trusted stops sales
///   and stops incidents: the market never prices risk it cannot see and never pays on bad data.
/// - An incident must still be firing after `confirmDelay`, so a transient reading cannot trigger it.
/// - Claims are priced at the more conservative of the two observations and pay
///   `coverage × loss` to whoever holds the policy NFT. Anyone can push a claim; the money always goes
///   to the holder.
/// - Every policy pays at most once. Settling an incident retires the whole generation of policies
///   that were live when it opened.
contract RiderMarket is IRiderMarket, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using CoverBook for CoverBook.Book;

    enum Status {
        Active,
        Pending,
        Triggered,
        Settled
    }

    /// @notice Everything fixed about a market at creation.
    struct Params {
        IRiderTrigger trigger;
        string name;
        uint16 thresholdBps; // loss that fires the market
        uint16 capBps; // most this market may draw on the pool, as a share of pool assets
        uint16 baseRateBps; // annual premium rate at zero utilisation
        uint16 slopeBps; // added at full utilisation, quadratic in between
        uint32 confirmDelay; // seconds an incident must stay firing
        uint32 claimWindow; // seconds to claim after confirmation
        uint32 epochLength; // policies end on multiples of this
        uint32 minDuration;
        uint32 maxDuration;
        uint128 minCoverage;
        uint128 maxCoverage;
        address restrictedBuyer; // address(0) = open to anyone; set for markets whose trigger the operator controls
    }

    struct Policy {
        uint128 coverage;
        uint128 premium;
        uint64 start;
        uint64 end;
        uint64 generation;
        bool claimed;
        uint256 ref;
    }

    struct Incident {
        uint64 openedAt;
        uint64 resolvedAt;
        uint64 claimDeadline;
        uint256 exposure; // coverage live when the incident opened
        uint256 claimedCoverage;
        uint256 paid;
        uint256 observedAtOpen;
        uint256 observed; // reading claims are priced at
        uint256 lossBps; // market-level loss at confirmation, against `refHigh`
    }

    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR = 365 days;

    IRiderPool public immutable pool;
    RiderPolicy public immutable policyNft;
    IERC20 public immutable asset;
    IRiderTrigger public immutable trigger;
    uint256 public immutable thresholdBps;
    uint256 public immutable capBps;
    uint256 public immutable baseRateBps;
    uint256 public immutable slopeBps;
    uint256 public immutable confirmDelay;
    uint256 public immutable claimWindow;
    uint256 public immutable epochLength;
    uint256 public immutable minDuration;
    uint256 public immutable maxDuration;
    uint256 public immutable minCoverage;
    uint256 public immutable maxCoverage;
    /// @notice If set, the only address allowed to buy cover. Used for the drill market, whose trigger
    ///         Rider controls: an open drill market would pay anyone who bought just before a scheduled drill.
    address public immutable restrictedBuyer;
    string public name;

    Status public status;
    uint256 public generation;
    /// @notice Highest reference seen this generation. Incidents measure loss from here.
    uint256 public refHigh;
    Incident internal _incident;

    mapping(uint256 generation => CoverBook.Book) internal _books;
    mapping(uint256 policyId => Policy) internal _policies;

    event CoverBought(
        uint256 indexed policyId,
        address indexed holder,
        address indexed payer,
        uint256 coverage,
        uint256 premium,
        uint256 start,
        uint256 end,
        uint256 ref
    );
    event IncidentOpened(uint256 indexed generation, uint256 lossBps, uint256 observed, uint256 exposure);
    event IncidentConfirmed(uint256 indexed generation, uint256 lossBps, uint256 observed, uint256 claimDeadline);
    event IncidentDismissed(uint256 indexed generation, bool readingOk, uint256 lossBps, uint256 observed);
    event Claimed(uint256 indexed policyId, address indexed holder, uint256 coverage, uint256 lossBps, uint256 payout);
    event Settled(uint256 indexed generation, uint256 exposure, uint256 claimedCoverage, uint256 paid);
    event Rearmed(uint256 indexed generation, uint256 refHigh);
    event RefRaised(uint256 refHigh);

    error SalesPaused();
    error WrongStatus(Status current);
    error TriggerUnavailable();
    error TriggerFiring(uint256 lossBps);
    error NotFiring(uint256 lossBps);
    error DurationOutOfRange(uint256 duration);
    error CoverageBelowMinimum(uint256 coverage);
    error CapacityExceeded(uint256 requested, uint256 available);
    error InsufficientCapital(uint256 requested, uint256 free);
    error PremiumAboveMax(uint256 premium, uint256 maxPremium);
    error ConfirmTooEarly(uint256 readyAt);
    error ClaimWindowClosed(uint256 deadline);
    error ClaimWindowOpen(uint256 deadline);
    error NotEligible(uint256 policyId);
    error AlreadyClaimed(uint256 policyId);
    error UnknownPolicy(uint256 policyId);
    error ZeroHolder();
    error BuyerNotAllowed(address buyer);

    constructor(IRiderPool pool_, RiderPolicy policyNft_, Params memory p) {
        require(p.thresholdBps > 0 && p.thresholdBps <= BPS, "threshold");
        require(p.capBps > 0 && p.capBps <= BPS, "cap");
        require(p.epochLength > 0 && p.minDuration > 0 && p.minDuration <= p.maxDuration, "duration");
        require(p.minCoverage > 0 && p.minCoverage <= p.maxCoverage, "coverage");
        pool = pool_;
        policyNft = policyNft_;
        asset = IERC20(pool_.asset());
        trigger = p.trigger;
        name = p.name;
        thresholdBps = p.thresholdBps;
        capBps = p.capBps;
        baseRateBps = p.baseRateBps;
        slopeBps = p.slopeBps;
        confirmDelay = p.confirmDelay;
        claimWindow = p.claimWindow;
        epochLength = p.epochLength;
        minDuration = p.minDuration;
        maxDuration = p.maxDuration;
        minCoverage = p.minCoverage;
        maxCoverage = p.maxCoverage;
        restrictedBuyer = p.restrictedBuyer;

        refHigh = p.trigger.referenceValue();
        _books[0].start(_epoch(block.timestamp));
    }

    // ─────────────────────────────────────────────────────────────── buying cover

    /// @notice Price of `coverage` for `duration` seconds right now.
    /// @return premium in asset units
    /// @return end timestamp the policy would expire at (rounded up to the epoch)
    /// @return annualRateBps the rate the premium was priced at
    function quote(uint256 coverage, uint256 duration)
        public
        view
        returns (uint256 premium, uint256 end, uint256 annualRateBps)
    {
        end = _roundUp(block.timestamp + duration);
        uint256 cap = _capacityCeiling();
        uint256 active = _totals().active;
        uint256 utilisation = cap == 0 ? BPS : Math.min(BPS, (active + coverage) * BPS / cap);
        annualRateBps = baseRateBps + slopeBps * utilisation * utilisation / (BPS * BPS);
        premium = Math.max(1, Math.mulDiv(coverage * annualRateBps, end - block.timestamp, BPS * YEAR, Math.Rounding.Ceil));
    }

    /// @notice Buy cover. The premium is paid by the caller; the policy NFT goes to `holder`.
    /// @dev Designed to sit in one Arc `Multicall3From` batch right after a vault deposit, so the
    ///      depositor stays `msg.sender` for both calls and no router ever holds their funds.
    /// @param maxPremium reverts if utilisation moved and the premium came out higher than this
    function buyCover(uint256 coverage, uint256 duration, address holder, uint256 maxPremium)
        external
        nonReentrant
        returns (uint256 policyId)
    {
        if (holder == address(0)) revert ZeroHolder();
        _checkSaleOpen(coverage, duration);
        (uint256 premium, uint256 end) = _underwrite(coverage, duration, maxPremium);

        uint256 ref = trigger.referenceValue();
        if (ref > refHigh) refHigh = ref;

        policyId = policyNft.mint(holder);
        _policies[policyId] = Policy({
            coverage: uint128(coverage),
            premium: uint128(premium),
            start: uint64(block.timestamp),
            end: uint64(end),
            generation: uint64(generation),
            claimed: false,
            ref: ref
        });
        emit CoverBought(policyId, holder, msg.sender, coverage, premium, block.timestamp, end, ref);
    }

    /// @dev Refuses a sale that the market could not stand behind.
    function _checkSaleOpen(uint256 coverage, uint256 duration) private view {
        if (status != Status.Active) revert WrongStatus(status);
        if (pool.salesPaused(address(this))) revert SalesPaused();
        if (duration < minDuration || duration > maxDuration) revert DurationOutOfRange(duration);
        if (coverage < minCoverage) revert CoverageBelowMinimum(coverage);
        if (restrictedBuyer != address(0) && msg.sender != restrictedBuyer) revert BuyerNotAllowed(msg.sender);
        // No cover on a burning house, and no cover on a risk we cannot read.
        (bool ok, uint256 loss,) = trigger.read(refHigh);
        if (!ok) revert TriggerUnavailable();
        if (loss >= thresholdBps) revert TriggerFiring(loss);
    }

    /// @dev Checks capacity and capital, collects the premium and books the policy.
    function _underwrite(uint256 coverage, uint256 duration, uint256 maxPremium)
        private
        returns (uint256 premium, uint256 end)
    {
        CoverBook.Book storage book = _books[generation];
        book.sync(_epoch(block.timestamp));

        uint256 cap = _capacityCeiling();
        uint256 room = cap > book.active ? cap - book.active : 0;
        if (coverage > room) revert CapacityExceeded(coverage, room);
        // Fully collateralised: every unit of cover sold is backed by a unit of free pool capital.
        uint256 free = pool.freeAssets();
        if (coverage > free) revert InsufficientCapital(coverage, free);

        (premium, end,) = quote(coverage, duration);
        if (premium > maxPremium) revert PremiumAboveMax(premium, maxPremium);

        asset.safeTransferFrom(msg.sender, address(pool), premium);
        book.add(coverage, premium, block.timestamp, end, end / epochLength);
    }

    /// @notice Raise the incident reference to the current reading. Anyone may call it.
    /// @dev Keeps drawdown measured from a recent high when nobody has bought cover for a while.
    function poke() external {
        if (status != Status.Active) revert WrongStatus(status);
        (bool ok, uint256 loss,) = trigger.read(refHigh);
        if (!ok) revert TriggerUnavailable();
        if (loss >= thresholdBps) revert TriggerFiring(loss);
        uint256 ref = trigger.referenceValue();
        if (ref > refHigh) {
            refHigh = ref;
            emit RefRaised(ref);
        }
    }

    // ─────────────────────────────────────────────────────────────── incidents

    /// @notice Open an incident when the trigger reads a loss at or past the threshold. Anyone may call.
    function openIncident() external nonReentrant {
        if (status != Status.Active) revert WrongStatus(status);
        (bool ok, uint256 loss, uint256 observed) = trigger.read(refHigh);
        if (!ok) revert TriggerUnavailable();
        if (loss < thresholdBps) revert NotFiring(loss);

        CoverBook.Book storage book = _books[generation];
        book.sync(_epoch(block.timestamp));

        status = Status.Pending;
        _incident = Incident({
            openedAt: uint64(block.timestamp),
            resolvedAt: 0,
            claimDeadline: 0,
            exposure: book.active,
            claimedCoverage: 0,
            paid: 0,
            observedAtOpen: observed,
            observed: 0,
            lossBps: loss
        });
        emit IncidentOpened(generation, loss, observed, book.active);
    }

    /// @notice After `confirmDelay`, confirm the incident if the trigger still fires, else dismiss it.
    function resolveIncident() external nonReentrant {
        if (status != Status.Pending) revert WrongStatus(status);
        Incident storage inc = _incident;
        uint256 readyAt = inc.openedAt + confirmDelay;
        if (block.timestamp < readyAt) revert ConfirmTooEarly(readyAt);

        (bool ok, uint256 loss, uint256 observed) = trigger.read(refHigh);
        inc.resolvedAt = uint64(block.timestamp);
        if (!ok || loss < thresholdBps) {
            status = Status.Active;
            emit IncidentDismissed(generation, ok, loss, observed);
            return;
        }

        // Price claims at the healthier of the two readings: a spike at one end cannot inflate payouts.
        uint256 priced = Math.max(inc.observedAtOpen, observed);
        inc.observed = priced;
        inc.lossBps = trigger.lossOf(refHigh, priced);
        inc.claimDeadline = uint64(inc.exposure == 0 ? block.timestamp : block.timestamp + claimWindow);
        status = Status.Triggered;
        emit IncidentConfirmed(generation, inc.lossBps, priced, inc.claimDeadline);
    }

    /// @notice Pay a claim to the current holder of the policy. Anyone may call.
    function claim(uint256 policyId) external nonReentrant returns (uint256 payout) {
        if (status != Status.Triggered) revert WrongStatus(status);
        Incident storage inc = _incident;
        if (block.timestamp > inc.claimDeadline) revert ClaimWindowClosed(inc.claimDeadline);
        Policy storage p = _policies[policyId];
        if (p.coverage == 0) revert UnknownPolicy(policyId);
        if (p.claimed) revert AlreadyClaimed(policyId);
        if (!_eligible(p)) revert NotEligible(policyId);
        payout = _pay(policyId, p, inc);
    }

    /// @notice Push every eligible claim in `policyIds`; ineligible or already-paid ids are skipped.
    function claimMany(uint256[] calldata policyIds) external nonReentrant returns (uint256 total) {
        if (status != Status.Triggered) revert WrongStatus(status);
        Incident storage inc = _incident;
        if (block.timestamp > inc.claimDeadline) revert ClaimWindowClosed(inc.claimDeadline);
        for (uint256 i; i < policyIds.length; ++i) {
            Policy storage p = _policies[policyIds[i]];
            if (p.coverage == 0 || p.claimed || !_eligible(p)) continue;
            total += _pay(policyIds[i], p, inc);
        }
    }

    /// @notice Close the claim window, release unclaimed cover and retire this generation of policies.
    function settle() external nonReentrant {
        if (status != Status.Triggered) revert WrongStatus(status);
        Incident storage inc = _incident;
        if (block.timestamp <= inc.claimDeadline) revert ClaimWindowOpen(inc.claimDeadline);
        status = Status.Settled;
        emit Settled(generation, inc.exposure, inc.claimedCoverage, inc.paid);
        generation += 1;
        _books[generation].start(_epoch(block.timestamp));
    }

    /// @notice Reopen sales once the trigger reads healthy again, measured from the current reference.
    function rearm() external nonReentrant {
        if (status != Status.Settled) revert WrongStatus(status);
        uint256 ref = trigger.referenceValue();
        (bool ok, uint256 loss,) = trigger.read(ref);
        if (!ok) revert TriggerUnavailable();
        if (loss >= thresholdBps) revert TriggerFiring(loss);
        refHigh = ref;
        status = Status.Active;
        emit Rearmed(generation, ref);
    }

    // ─────────────────────────────────────────────────────────────── pool hooks

    /// @inheritdoc IRiderMarket
    function lockedCoverage() public view returns (uint256) {
        if (status == Status.Active) return _totals().active;
        if (status == Status.Pending) return _incident.exposure;
        if (status == Status.Triggered) return _incident.exposure - _incident.claimedCoverage;
        return 0;
    }

    /// @inheritdoc IRiderMarket
    function unearnedPremium() external view returns (uint256) {
        return CoverBook.unearned(_totals(), block.timestamp);
    }

    /// @inheritdoc IRiderMarket
    function isFrozen() external view returns (bool) {
        return status == Status.Pending || status == Status.Triggered;
    }

    // ─────────────────────────────────────────────────────────────── views

    /// @notice The trigger's current reading against `refHigh`, and whether it is past the threshold.
    function health() external view returns (bool ok, uint256 lossBps, uint256 observed, bool firing) {
        (ok, lossBps, observed) = trigger.read(refHigh);
        firing = ok && lossBps >= thresholdBps;
    }

    /// @notice Cover currently live in this generation.
    function activeCoverage() external view returns (uint256) {
        return _totals().active;
    }

    /// @notice How much more cover can be sold right now.
    function capacity() external view returns (uint256) {
        uint256 cap = _capacityCeiling();
        uint256 active = _totals().active;
        uint256 room = cap > active ? cap - active : 0;
        return Math.min(room, pool.freeAssets());
    }

    function policy(uint256 policyId) external view returns (Policy memory) {
        return _policies[policyId];
    }

    function incident() external view returns (Incident memory) {
        return _incident;
    }

    /// @notice Flattened view of a policy for the NFT renderer and indexers.
    /// @dev `state`: 0 live, 1 expired, 2 claimable, 3 paid, 4 retired (incident settled, never claimed).
    function policyCard(uint256 policyId)
        external
        view
        returns (
            string memory marketName,
            string memory kind,
            uint256 coverage,
            uint256 premium,
            uint256 start,
            uint256 end,
            uint8 state,
            uint256 payout
        )
    {
        Policy storage p = _policies[policyId];
        if (p.coverage == 0) revert UnknownPolicy(policyId);
        marketName = name;
        kind = trigger.kind();
        coverage = p.coverage;
        premium = p.premium;
        start = p.start;
        end = p.end;
        if (p.claimed) {
            state = 3;
            payout = uint256(p.coverage) * trigger.lossOf(p.ref, _incident.observed) / BPS;
        } else if (p.generation < generation) {
            state = 4;
        } else if (status == Status.Triggered && _eligible(p) && block.timestamp <= _incident.claimDeadline) {
            state = 2;
            payout = uint256(p.coverage) * trigger.lossOf(p.ref, _incident.observed) / BPS;
        } else {
            state = block.timestamp < p.end ? 0 : 1;
        }
    }

    /// @notice What `policyId` would be paid if claimed now, and whether it can be claimed.
    function claimable(uint256 policyId) external view returns (uint256 payout, bool canClaim) {
        Policy storage p = _policies[policyId];
        if (status != Status.Triggered || p.coverage == 0 || p.claimed || !_eligible(p)) return (0, false);
        if (block.timestamp > _incident.claimDeadline) return (0, false);
        uint256 loss = trigger.lossOf(p.ref, _incident.observed);
        return (uint256(p.coverage) * loss / BPS, true);
    }

    // ─────────────────────────────────────────────────────────────── internals

    function _pay(uint256 policyId, Policy storage p, Incident storage inc) private returns (uint256 payout) {
        uint256 loss = trigger.lossOf(p.ref, inc.observed);
        payout = uint256(p.coverage) * loss / BPS;
        p.claimed = true;
        inc.claimedCoverage += p.coverage;
        inc.paid += payout;
        address holder = policyNft.ownerOf(policyId);
        if (payout > 0) pool.payout(holder, payout);
        emit Claimed(policyId, holder, p.coverage, loss, payout);
    }

    /// @dev Live when the incident opened, and from the generation the incident belongs to.
    function _eligible(Policy storage p) private view returns (bool) {
        uint256 openedAt = _incident.openedAt;
        return p.generation == generation && p.start <= openedAt && openedAt < p.end;
    }

    function _totals() private view returns (CoverBook.Totals memory) {
        return _books[generation].project(_epoch(block.timestamp));
    }

    function _capacityCeiling() private view returns (uint256) {
        return Math.min(maxCoverage, pool.totalAssets() * capBps / BPS);
    }

    function _epoch(uint256 t) private view returns (uint256) {
        return t / epochLength;
    }

    function _roundUp(uint256 t) private view returns (uint256) {
        return Math.ceilDiv(t, epochLength) * epochLength;
    }
}
