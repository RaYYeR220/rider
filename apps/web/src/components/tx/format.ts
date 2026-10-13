import { formatUnits } from "viem";
import { formatUsdc } from "@rider/sdk";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** USDC from a bigint or the API's decimal string. */
export function usdc(v: bigint | string | undefined | null, maxDecimals = 6): string {
  if (v === undefined || v === null || v === "") return "—";
  return formatUsdc(typeof v === "bigint" ? v : BigInt(v), maxDecimals);
}

/** Pool shares carry 12 decimals (USDC's 6 plus a 6-decimal offset). */
export function shares(v: bigint | undefined, maxDecimals = 6): string {
  if (v === undefined) return "—";
  const [whole, frac = ""] = formatUnits(v, 12).split(".");
  const f = frac.slice(0, maxDecimals).replace(/0+$/, "");
  return `${BigInt(whole).toLocaleString("en-US")}${f ? `.${f}` : ""}`;
}

/** Parse a decimal share amount into 12-decimal units; undefined when malformed. */
export function parseShares(value: string): bigint | undefined {
  if (!/^\d*(\.\d{0,12})?$/.test(value.trim()) || value.trim() === "" || value.trim() === ".") return undefined;
  const [whole = "0", frac = ""] = value.trim().split(".");
  return BigInt(whole || "0") * 10n ** 12n + BigInt((frac + "0".repeat(12)).slice(0, 12));
}

/** Parse a decimal USDC amount into 6-decimal units; undefined when malformed. */
export function parseAmount(value: string): bigint | undefined {
  const v = value.trim();
  if (v === "" || v === "." || !/^\d*(\.\d{0,6})?$/.test(v)) return undefined;
  const [whole = "0", frac = ""] = v.split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** "12 Nov 2026, 00:00 UTC", formatted by hand so server and browser always agree. */
export function utc(seconds: number, withTime = true): string {
  const d = new Date(seconds * 1000);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return withTime ? `${day}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC` : day;
}

/** "2d 4h" style countdown, or "now" once it has passed. */
export function until(target: number, now: number): string {
  const s = target - now;
  if (s <= 0) return "now";
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

export function days(seconds: number): string {
  const d = seconds / 86_400;
  return Number.isInteger(d) ? `${d} day${d === 1 ? "" : "s"}` : `${d.toFixed(1)} days`;
}
