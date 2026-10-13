/** USDC amount (6 dp) as a decimal string with at least two places. */
export function formatUsdc(amount: bigint, maxDecimals = 6): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / 1_000_000n;
  let frac = (abs % 1_000_000n).toString().padStart(6, "0").slice(0, maxDecimals);
  frac = frac.replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}.${frac}`;
}

/** Parse a decimal USDC string into 6-dp units. */
export function parseUsdc(value: string): bigint {
  const [whole = "0", frac = ""] = value.trim().split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

export function formatBps(bps: number, digits = 2): string {
  return `${(bps / 100).toFixed(digits)}%`;
}

/** A 1e18-scaled ratio as a decimal string. */
export function formatWad(value: bigint, digits = 4): string {
  const scaled = Number((value * 10n ** BigInt(digits)) / 10n ** 18n) / 10 ** digits;
  return scaled.toFixed(digits);
}

export function formatDuration(seconds: number): string {
  if (seconds >= 86_400) {
    const d = Math.floor(seconds / 86_400);
    const h = Math.floor((seconds % 86_400) / 3_600);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  if (seconds >= 3_600) {
    const h = Math.floor(seconds / 3_600);
    const m = Math.floor((seconds % 3_600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${seconds}s`;
}
