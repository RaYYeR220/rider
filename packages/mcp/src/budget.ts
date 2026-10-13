import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Spending limits for an agent that signs its own cover purchases.
 *
 * The limits are enforced here, in code, before anything is signed; the model never sees a way
 * around them. Every limit must be configured: if one is missing the server refuses to sign at all
 * and hands back unsigned calls instead.
 */
export interface Limits {
  /** Largest premium a single purchase may cost, USDC 6 dp. */
  maxPremium: bigint;
  /** Total premium over a rolling 24 hours, USDC 6 dp. */
  dailyPremium: bigint;
  /** Largest cover a single purchase may buy, USDC 6 dp. */
  maxCoverage: bigint;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

interface Spend {
  at: number;
  premium: string;
}

export class Budget {
  private spends: Spend[];

  constructor(
    readonly limits: Limits | undefined,
    private readonly file?: string,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.spends = file && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Spend[]) : [];
  }

  /** Limits from the environment, or undefined if any one of them is missing or malformed. */
  static limitsFromEnv(env: NodeJS.ProcessEnv): Limits | undefined {
    const read = (name: string) => {
      const v = env[name];
      if (!v || !/^\d+(\.\d{1,6})?$/.test(v)) return undefined;
      const [w = "0", f = ""] = v.split(".");
      return BigInt(w) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
    };
    const maxPremium = read("RIDER_MAX_PREMIUM_USDC");
    const dailyPremium = read("RIDER_DAILY_PREMIUM_USDC");
    const maxCoverage = read("RIDER_MAX_COVERAGE_USDC");
    if (maxPremium === undefined || dailyPremium === undefined || maxCoverage === undefined) return undefined;
    return { maxPremium, dailyPremium, maxCoverage };
  }

  spentToday(): bigint {
    const since = this.now() - 86_400_000;
    return this.spends.filter((s) => s.at > since).reduce((sum, s) => sum + BigInt(s.premium), 0n);
  }

  check(premium: bigint, coverage: bigint): Verdict {
    if (!this.limits) return { ok: false, reason: "spending limits are not configured, so nothing will be signed" };
    if (premium <= 0n || coverage <= 0n) return { ok: false, reason: "premium and coverage must be positive" };
    if (coverage > this.limits.maxCoverage) {
      return { ok: false, reason: `coverage ${coverage} exceeds the per-purchase limit ${this.limits.maxCoverage}` };
    }
    if (premium > this.limits.maxPremium) {
      return { ok: false, reason: `premium ${premium} exceeds the per-purchase limit ${this.limits.maxPremium}` };
    }
    const after = this.spentToday() + premium;
    if (after > this.limits.dailyPremium) {
      return { ok: false, reason: `premium would bring 24h spend to ${after}, over the limit ${this.limits.dailyPremium}` };
    }
    return { ok: true };
  }

  /**
   * Check and, if allowed, count the spend in the same synchronous step, before anything is sent.
   * Two concurrent purchases therefore cannot both pass on the same headroom, and a purchase whose
   * outcome is unknown (receipt timeout, crash) stays counted. Call `release` only when the
   * transaction is known not to have spent anything.
   */
  reserve(premium: bigint, coverage: bigint): Verdict & { ticket?: number } {
    const verdict = this.check(premium, coverage);
    if (!verdict.ok) return verdict;
    const at = this.now();
    this.spends.push({ at, premium: premium.toString() });
    this.persist();
    return { ok: true, ticket: this.spends.length - 1 };
  }

  release(ticket: number) {
    const spend = this.spends[ticket];
    if (spend) spend.premium = "0";
    this.persist();
  }

  private persist() {
    if (this.file) writeFileSync(this.file, JSON.stringify(this.spends));
  }
}
