"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";

/** Market state as served by /api/state: every bigint arrives as a decimal string. */
export interface ApiMarket {
  address: Address;
  name: string;
  kind: string;
  trigger: Address;
  subject: Address;
  pool: Address;
  status: "active" | "pending" | "triggered" | "settled";
  generation: string;
  thresholdBps: number;
  refHigh: string;
  health: { ok: boolean; lossBps: number; observed: string; firing: boolean };
  activeCoverage: string;
  capacity: string;
  lockedCoverage: string;
  unearnedPremium: string;
  baseRateBps: number;
  slopeBps: number;
  confirmDelay: number;
  claimWindow: number;
  epochLength: number;
  minDuration: number;
  maxDuration: number;
  minCoverage: string;
  maxCoverage: string;
  incident: {
    openedAt: number;
    resolvedAt: number;
    claimDeadline: number;
    exposure: string;
    claimedCoverage: string;
    paid: string;
    observedAtOpen: string;
    observed: string;
    lossBps: number;
  };
}

export interface ApiPool {
  address: Address;
  name: string;
  symbol: string;
  totalAssets: string;
  lockedAssets: string;
  freeAssets: string;
  cash: string;
  totalSupply: string;
  frozen: boolean;
  cooldown: number;
  sharePrice: string;
  markets: Address[];
}

export interface ApiState {
  block: string;
  timestamp: number;
  deployment: Record<string, Address | number>;
  pool: ApiPool;
  drillPool: ApiPool;
  markets: ApiMarket[];
  canary: ApiMarket;
}

/** Live protocol state, refreshed every few seconds. Arc finalises in under a second. */
export function useArcState() {
  return useQuery({
    queryKey: ["arc-state"],
    queryFn: async (): Promise<ApiState> => {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (!res.ok) throw new Error(`state ${res.status}`);
      return res.json();
    },
    refetchInterval: 6_000,
  });
}

/** Short trigger description for each market, keyed by kind and subject. */
export function describeReading(m: ApiMarket): { value: string; unit: string } {
  const observed = BigInt(m.health.observed || "0");
  if (!m.health.ok) return { value: "—", unit: "reading unavailable" };
  if (m.kind === "vault-drawdown") return { value: (Number(observed) / 1e6).toFixed(6), unit: "USDC per share" };
  if (m.kind === "peg") return { value: (Number(observed / 10n ** 12n) / 1e6).toFixed(5), unit: "EURC per euro" };
  return { value: `${(Number(observed / 10n ** 14n) / 100).toFixed(1)}%`, unit: "of supply in reserve" };
}
