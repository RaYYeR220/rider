import { describe, expect, it } from "vitest";
import { Budget } from "./budget.js";

const limits = { maxPremium: 50_000n, dailyPremium: 100_000n, maxCoverage: 10_000_000n };

describe("Budget", () => {
  it("refuses to sign anything when limits are missing", () => {
    expect(Budget.limitsFromEnv({ RIDER_MAX_PREMIUM_USDC: "0.05" })).toBeUndefined();
    const b = new Budget(undefined);
    expect(b.check(1n, 1n).ok).toBe(false);
  });

  it("rejects malformed limits instead of reading them as zero or infinity", () => {
    expect(
      Budget.limitsFromEnv({ RIDER_MAX_PREMIUM_USDC: "-1", RIDER_DAILY_PREMIUM_USDC: "1", RIDER_MAX_COVERAGE_USDC: "1" }),
    ).toBeUndefined();
    expect(
      Budget.limitsFromEnv({ RIDER_MAX_PREMIUM_USDC: "1e9", RIDER_DAILY_PREMIUM_USDC: "1", RIDER_MAX_COVERAGE_USDC: "1" }),
    ).toBeUndefined();
  });

  it("parses decimal limits into 6-dp units", () => {
    expect(
      Budget.limitsFromEnv({ RIDER_MAX_PREMIUM_USDC: "0.05", RIDER_DAILY_PREMIUM_USDC: "0.1", RIDER_MAX_COVERAGE_USDC: "10" }),
    ).toEqual(limits);
  });

  it("enforces per-purchase premium and coverage caps", () => {
    const b = new Budget(limits);
    expect(b.check(50_000n, 10_000_000n).ok).toBe(true);
    expect(b.check(50_001n, 1n).ok).toBe(false);
    expect(b.check(1n, 10_000_001n).ok).toBe(false);
    expect(b.check(0n, 1n).ok).toBe(false);
  });

  it("enforces the rolling 24h premium total", () => {
    let t = 1_000_000;
    const b = new Budget(limits, undefined, () => t);
    b.record(50_000n);
    b.record(40_000n);
    expect(b.check(10_000n, 1n).ok).toBe(true);
    expect(b.check(10_001n, 1n).ok).toBe(false);
    t += 86_400_001;
    expect(b.check(50_000n, 1n).ok).toBe(true);
  });
});
