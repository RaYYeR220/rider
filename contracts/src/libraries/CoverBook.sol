// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title CoverBook
/// @notice Running totals for a set of policies that expire on epoch boundaries.
/// @dev Policies end exactly on an epoch boundary, so everything that expires inside an epoch can be
///      folded into one bucket. A bitmap (256 epochs per word) marks the buckets that hold expirations,
///      so catching up after a long quiet period costs one storage read per 256 epochs instead of one
///      per epoch.
///
///      Unearned premium is tracked in closed form. Each policy earns its premium linearly, at
///      `rate = premium / duration`. For the set of live policies,
///          unearned(t) = Σ rate_i · (end_i − t) = S − R · t
///      where R = Σ rate_i and S = Σ rate_i · end_i. Expiring a policy subtracts its own terms, so the
///      formula stays exact without touching the policies one by one.
library CoverBook {
    uint256 internal constant WAD = 1e18;

    struct Book {
        uint256 active; // coverage live as of `epoch`
        uint256 rate; // R, premium per second, WAD-scaled
        uint256 rateEnd; // S, Σ rate · end
        uint256 epoch; // every bucket up to and including this epoch has been applied
        mapping(uint256 epoch => uint256) coverDrop;
        mapping(uint256 epoch => uint256) rateDrop;
        mapping(uint256 epoch => uint256) rateEndDrop;
        mapping(uint256 word => uint256) bitmap;
    }

    struct Totals {
        uint256 active;
        uint256 rate;
        uint256 rateEnd;
    }

    /// @notice Start a fresh book at `epoch` so the first catch-up does not scan from zero.
    function start(Book storage self, uint256 epoch) internal {
        self.epoch = epoch;
    }

    /// @notice Add a policy that expires at the boundary `endEpoch * epochLength`.
    function add(Book storage self, uint256 coverage, uint256 premium, uint256 startTime, uint256 endTime, uint256 endEpoch)
        internal
    {
        uint256 rate = Math.mulDiv(premium, WAD, endTime - startTime);
        self.active += coverage;
        self.rate += rate;
        self.rateEnd += rate * endTime;
        self.coverDrop[endEpoch] += coverage;
        self.rateDrop[endEpoch] += rate;
        self.rateEndDrop[endEpoch] += rate * endTime;
        self.bitmap[endEpoch >> 8] |= (1 << (endEpoch & 0xff));
    }

    /// @notice Apply every expiry bucket up to `nowEpoch` and persist the result.
    function sync(Book storage self, uint256 nowEpoch) internal {
        if (nowEpoch <= self.epoch) return;
        Totals memory t = project(self, nowEpoch);
        self.active = t.active;
        self.rate = t.rate;
        self.rateEnd = t.rateEnd;
        self.epoch = nowEpoch;
    }

    /// @notice Totals as they would be after applying every bucket up to `nowEpoch`.
    function project(Book storage self, uint256 nowEpoch) internal view returns (Totals memory t) {
        t = Totals(self.active, self.rate, self.rateEnd);
        uint256 cursor = self.epoch;
        while (true) {
            (uint256 next, bool found) = _nextSet(self, cursor, nowEpoch);
            if (!found) break;
            t.active -= self.coverDrop[next];
            t.rate -= self.rateDrop[next];
            t.rateEnd -= self.rateEndDrop[next];
            cursor = next;
        }
    }

    /// @notice Premium not yet earned at time `nowTime`, rounded up in favour of policyholders' cover.
    function unearned(Totals memory t, uint256 nowTime) internal pure returns (uint256) {
        uint256 accrued = t.rate * nowTime;
        if (t.rateEnd <= accrued) return 0;
        return Math.ceilDiv(t.rateEnd - accrued, WAD);
    }

    /// @dev First set bit in (from, to]. Scans whole words, so a gap of N epochs costs N / 256 reads.
    function _nextSet(Book storage self, uint256 from, uint256 to) private view returns (uint256, bool) {
        uint256 e = from + 1;
        while (e <= to) {
            uint256 masked = self.bitmap[e >> 8] >> (e & 0xff);
            if (masked != 0) {
                uint256 candidate = e + _lsb(masked);
                return candidate <= to ? (candidate, true) : (0, false);
            }
            e = ((e >> 8) + 1) << 8;
        }
        return (0, false);
    }

    function _lsb(uint256 x) private pure returns (uint256) {
        return Math.log2(x & (~x + 1));
    }
}
