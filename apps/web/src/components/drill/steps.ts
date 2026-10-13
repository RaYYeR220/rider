import type { Address } from "viem";
import type { DrillStep } from "@rider/sdk";

/** GET /api/drill: the next step, read from chain state. */
export interface DrillPlanJson {
  step: DrillStep;
  note: string;
  tx?: { to: Address; data: `0x${string}` };
  readyAt?: number;
  policyId?: string;
  holder?: Address;
  rounds?: number;
  dailyLimit?: number;
}

/** POST /api/drill when a transaction was sent. */
export interface DrillSentJson {
  step: DrillStep;
  note: string;
  hash: `0x${string}`;
  url: string;
  status: "success" | "reverted";
  block?: string;
}

/** The drill policyholder: receives every drill payout. GET /api/drill returns it as `holder` too. */
export const DRILL_HOLDER: Address = "0x73c37EF65789B50511656F3ec4F22E21FFddc549";

/** The claims path in order. The first six prove the payout; the last four reset the stage. */
export const ORDER: DrillStep[] = [
  "buy",
  "impair",
  "open",
  "wait-confirm",
  "resolve",
  "claim",
  "wait-settle",
  "settle",
  "restore",
  "rearm",
];

export const STEP: Record<DrillStep, { title: string; what: string; cleanup?: boolean }> = {
  buy: {
    title: "Buy cover",
    what: "0.10 USDC of cover on the canary for five minutes. Approve and buy go out as one Multicall3From batch.",
  },
  impair: {
    title: "Break the canary",
    what: "Move 20% of the canary's USDC out. Its share price falls from 1.00 to 0.80.",
  },
  open: {
    title: "Open the incident",
    what: "The trigger now reads a 20% loss against a 5% line. Anyone may open the incident.",
  },
  "wait-confirm": {
    title: "Confirmation delay",
    what: "The loss has to still be there when the delay ends, or the incident is dismissed and nothing is paid.",
  },
  resolve: {
    title: "Confirm the incident",
    what: "Re-read the canary. Still down, so the incident is confirmed and claims open, priced at the healthier of the two readings.",
  },
  claim: {
    title: "Pay the policyholder",
    what: "Cover × loss since purchase, in USDC, from the drill pool to whoever holds the policy NFT. Nobody files anything.",
  },
  "wait-settle": {
    title: "Claim window",
    what: "Claims stay open for the window; after it the round can be settled.",
    cleanup: true,
  },
  settle: { title: "Settle the round", what: "Close the claim window and retire this round's policies.", cleanup: true },
  restore: { title: "Repair the canary", what: "Return the moved USDC so the share price is back to 1.00.", cleanup: true },
  rearm: { title: "Rearm the market", what: "Reopen sales at the repaired price, ready for the next visitor.", cleanup: true },
  unavailable: { title: "Unavailable", what: "The drill cannot run right now." },
};

export function clock(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 19)} UTC`;
}

export function countdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
