import { ARC, formatBps, formatDuration, formatUsdc } from "@rider/sdk";
import type { ApiMarket, ApiPool } from "@/lib/state";

/** A reading (observed value, reference or line) in the units its trigger kind uses. */
export function formatReading(kind: string, value: bigint): string {
  if (kind === "vault-drawdown") return (Number(value) / 1e6).toFixed(6);
  if (kind === "peg") return (Number(value / 10n ** 12n) / 1e6).toFixed(5);
  return `${(Number(value / 10n ** 14n) / 100).toFixed(1)}%`;
}

export function unitOf(kind: string): string {
  if (kind === "vault-drawdown") return "USDC per share";
  if (kind === "peg") return "EURC per euro";
  return "of supply in reserve";
}

export function kindLabel(kind: string): string {
  if (kind === "vault-drawdown") return "Vault drawdown";
  if (kind === "peg") return "Peg";
  if (kind === "reserve") return "Reserve backing";
  return kind;
}

/** The value at which the market fires: the reference high less the threshold. */
export function lineOf(m: Pick<ApiMarket, "refHigh" | "thresholdBps">): bigint {
  return (BigInt(m.refHigh) * BigInt(10_000 - m.thresholdBps)) / 10_000n;
}

/** What the trigger reads, in words, and the contracts it reads from. */
export function readsOf(m: ApiMarket): { text: string; sources: { label: string; address: string }[] } {
  const subject = m.subject.toLowerCase();
  if (m.kind === "vault-drawdown") {
    const morpho = [ARC.vaults.galaxyUsdc, ARC.vaults.keyrockUsdc].some((v) => v.toLowerCase() === subject);
    return morpho
      ? {
          text: "Morpho Vault V2 share price: what one share redeems for, read from the vault itself. Fires on a drawdown from the highest price seen.",
          sources: [{ label: "Vault", address: m.subject }],
        }
      : {
          text: "Share price of the canary vault, which Rider controls and breaks on purpose. Fires on a drawdown from the highest price seen.",
          sources: [{ label: "Canary vault", address: m.subject }],
        };
  }
  if (m.kind === "peg") {
    return {
      text: "Chainlink EURC/USD divided by Chainlink EUR/USD: how many euros one EURC is worth. Fires when EURC slips below the euro.",
      // The peg trigger's subject is the token's own price feed.
      sources: [
        { label: "EURC/USD feed", address: m.subject },
        { label: "EUR/USD feed", address: ARC.feeds.eurUsd },
        { label: "EURC", address: ARC.eurc },
      ],
    };
  }
  return {
    text: "Chainlink cirBTC Proof-of-Reserve divided by cirBTC supply: the share of tokens backed by reserves. Fires when backing falls short.",
    sources: [
      { label: "cirBTC", address: m.subject },
      { label: "Proof-of-Reserve feed", address: ARC.feeds.cirbtcReserves },
    ],
  };
}

/** formatDuration without a trailing " 0s". */
export function dur(seconds: number): string {
  return formatDuration(seconds).replace(/ 0s$/, "");
}

export function usdc(value: string | bigint, maxDecimals = 6): string {
  return formatUsdc(BigInt(value), maxDecimals);
}

export function bps(value: number): string {
  return formatBps(value);
}

export function utc(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

export function shortAddr(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

/** Why a pool's exits are closed, from the state of its markets. */
export function freezeReasons(markets: ApiMarket[]): string[] {
  return markets.flatMap((m) => {
    if (m.status === "pending") return [`${m.name}: incident open, waiting for confirmation`];
    if (m.status === "triggered") return [`${m.name}: claim window open`];
    if (m.health.ok && m.health.firing) return [`${m.name}: trigger firing`];
    return [];
  });
}

/** Share of a pool's capital that backs live cover, 0..1. */
export function lockedShare(pool: ApiPool): number {
  const total = Number(pool.totalAssets);
  if (total <= 0) return 0;
  return Math.min(1, Number(pool.lockedAssets) / total);
}

/** USDC per whole pool share. */
export function sharePrice(pool: ApiPool): string {
  return (Number(pool.sharePrice) / 1e6).toFixed(6);
}
