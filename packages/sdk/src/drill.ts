import { encodeFunctionData, erc20Abi, type Address, type Hex, type PublicClient } from "viem";
import { canaryVaultAbi, riderMarketAbi, riderPolicyAbi } from "./abis.js";
import { ARC, type Deployment } from "./addresses.js";
import { coverCalls, multicall3FromTx } from "./calls.js";

/**
 * The live drill runs the whole claims path on mainnet against a canary vault Rider controls:
 * buy cover → break the vault → open incident → confirm → pay the holder → settle → repair → rearm.
 *
 * Each step is one transaction, and which step comes next is read from chain state, so the drill
 * needs no database: any caller can ask for the next step and the answer is the same.
 */
export type DrillStep =
  | "buy"
  | "impair"
  | "open"
  | "wait-confirm"
  | "resolve"
  | "claim"
  | "wait-settle"
  | "settle"
  | "restore"
  | "rearm"
  | "unavailable";

export interface DrillPlan {
  step: DrillStep;
  /** Human-readable reason, shown in the UI next to the step. */
  note: string;
  /** Transaction to send, if this step sends one. */
  tx?: { to: Address; data: Hex };
  /** Unix seconds when the next step becomes available, for waiting steps. */
  readyAt?: number;
  /** Live policy the drill is about, if any. */
  policyId?: bigint;
}

export const DRILL = {
  coverage: 100_000n, // 0.10 USDC
  duration: 300n, // 5 minutes
  impairBps: 2_000n, // 20 % drawdown, against a 5 % threshold
} as const;

export async function planDrill(client: PublicClient, d: Deployment, holder: Address): Promise<DrillPlan> {
  const market = { address: d.canaryMarket, abi: riderMarketAbi } as const;
  const [status, health, incident, confirmDelay, nextId, block] = await Promise.all([
    client.readContract({ ...market, functionName: "status" }),
    client.readContract({ ...market, functionName: "health" }),
    client.readContract({ ...market, functionName: "incident" }),
    client.readContract({ ...market, functionName: "confirmDelay" }),
    client.readContract({ address: d.policy, abi: riderPolicyAbi, functionName: "nextId" }),
    client.getBlock(),
  ]);
  const now = Number(block.timestamp);
  const [ok, , , firing] = health;

  // Settled: repair the canary first, then reopen sales.
  if (status === 3) {
    const deficit = await canaryDeficit(client, d.canary);
    if (deficit > 0n) {
      return {
        step: "restore",
        note: "Return the moved USDC so the canary's share price recovers (approve + restore, one batch).",
        tx: multicall3FromTx([
          {
            target: ARC.usdc,
            allowFailure: false,
            callData: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [d.canary, deficit] }),
          },
          {
            target: d.canary,
            allowFailure: false,
            callData: encodeFunctionData({ abi: canaryVaultAbi, functionName: "restore", args: [deficit] }),
          },
        ]),
      };
    }
    return { step: "rearm", note: "Reopen the market at the repaired share price.", tx: marketTx(d, "rearm") };
  }

  if (status === 2) {
    const deadline = Number(incident.claimDeadline);
    const policyId = await latestDrillPolicy(client, d, nextId);
    if (policyId !== undefined && now <= deadline) {
      const [, canClaim] = await client.readContract({ ...market, functionName: "claimable", args: [policyId] });
      if (canClaim) {
        return {
          step: "claim",
          note: "Pay the policy holder their loss, straight from the drill pool.",
          tx: { to: d.canaryMarket, data: encodeFunctionData({ abi: riderMarketAbi, functionName: "claim", args: [policyId] }) },
          policyId,
        };
      }
    }
    if (now <= deadline) {
      return { step: "wait-settle", note: "Claim window still open.", readyAt: deadline + 1, policyId };
    }
    return { step: "settle", note: "Close the claim window and retire this round of policies.", tx: marketTx(d, "settle") };
  }

  if (status === 1) {
    const readyAt = Number(incident.openedAt) + Number(confirmDelay);
    if (now < readyAt) return { step: "wait-confirm", note: "The loss must persist before it counts.", readyAt };
    return { step: "resolve", note: "Re-read the vault; confirm the incident if it is still down.", tx: marketTx(d, "resolveIncident") };
  }

  // Active.
  if (!ok) return { step: "unavailable", note: "The canary vault cannot be read right now." };
  if (firing) return { step: "open", note: "The canary is down past the threshold: open an incident.", tx: marketTx(d, "openIncident") };

  const live = await latestDrillPolicy(client, d, nextId);
  if (live !== undefined) {
    const p = await client.readContract({ ...market, functionName: "policy", args: [live] });
    const current = await client.readContract({ ...market, functionName: "generation" });
    if (p.generation === current && !p.claimed && now < Number(p.end)) {
      return {
        step: "impair",
        note: "Break the canary: move 20% of its USDC out.",
        tx: {
          to: d.canary,
          data: encodeFunctionData({ abi: canaryVaultAbi, functionName: "impair", args: [DRILL.impairBps] }),
        },
        policyId: live,
      };
    }
  }

  const [premium] = await client.readContract({
    ...market,
    functionName: "quote",
    args: [DRILL.coverage, DRILL.duration],
  });
  const tx = multicall3FromTx(coverCalls(d.canaryMarket, DRILL.coverage, DRILL.duration, holder, premium + premium / 10n + 1n));
  return { step: "buy", note: "Buy 0.10 USDC of cover on the canary, approve and buy in one Multicall3From batch.", tx };
}

/** USDC the canary needs back to return to a 1 : 1 share price. */
export async function canaryDeficit(client: PublicClient, canary: Address): Promise<bigint> {
  const [supply, assets] = await Promise.all([
    client.readContract({ address: canary, abi: canaryVaultAbi, functionName: "totalSupply" }),
    client.readContract({ address: ARC.usdc, abi: erc20Abi, functionName: "balanceOf", args: [canary] }),
  ]);
  const target = supply / 1_000_000n; // 1e12 shares per 1e6 USDC
  return target > assets ? target - assets : 0n;
}

async function latestDrillPolicy(client: PublicClient, d: Deployment, nextId: bigint): Promise<bigint | undefined> {
  for (let id = nextId - 1n; id >= 1n && id >= nextId - 50n; id--) {
    const m = await client.readContract({ address: d.policy, abi: riderPolicyAbi, functionName: "marketOf", args: [id] });
    if (m.toLowerCase() === d.canaryMarket.toLowerCase()) return id;
  }
  return undefined;
}

function marketTx(d: Deployment, functionName: "rearm" | "settle" | "resolveIncident" | "openIncident") {
  return { to: d.canaryMarket, data: encodeFunctionData({ abi: riderMarketAbi, functionName }) };
}
