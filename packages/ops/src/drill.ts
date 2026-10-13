// Runs one complete drill on the canary market: buy, break, open, confirm, pay, settle, repair, rearm.
// Two refusals are landed on the way: buying cover while the canary is down, and an underwriter
// trying to leave the drill pool while its incident is open.
import { encodeFunctionData } from "viem";
import { DRILL, planDrill, poolCalls, riderMarketAbi, riderPoolAbi } from "@rider/sdk";
import { Ledger, deployment, publicClient, send, waitUntil, wallet } from "./lib.js";

const d = deployment();
const ledger = new Ledger();
const relayer = wallet("RELAYER_KEY");
const holder = wallet("HOLDER_KEY");
const deployer = wallet("DEPLOYER_KEY");
const withRefusals = process.env.DRILL_REFUSALS !== "0";

const LABELS: Record<string, string> = {
  buy: "Drill: buy canary cover (approve + buy, one Multicall3From tx)",
  impair: "Drill: break the canary vault (-20%)",
  open: "Drill: open incident",
  resolve: "Drill: confirm incident after the delay",
  claim: "Drill: pay the policyholder",
  settle: "Drill: settle and retire the round",
  restore: "Drill: repair the canary vault",
  rearm: "Drill: rearm the market",
};

let paid = false;
for (let i = 0; i < 20; i++) {
  const plan = await planDrill(publicClient, d, holder.account.address);
  if (plan.readyAt) {
    console.log(`.. ${plan.step}: ${plan.note} (until ${plan.readyAt})`);
    await waitUntil(plan.readyAt);
    continue;
  }
  if (!plan.tx) throw new Error(`drill stuck at ${plan.step}: ${plan.note}`);
  if (paid && plan.step === "buy") break; // a full round is done
  await send(ledger, relayer, plan.tx, LABELS[plan.step] ?? plan.step);

  if (withRefusals && plan.step === "buy") {
    // The canary is ours to break, so its market sells only to the drill runner.
    await send(
      ledger,
      holder,
      {
        to: d.canaryMarket,
        data: encodeFunctionData({
          abi: riderMarketAbi,
          functionName: "buyCover",
          args: [DRILL.coverage, DRILL.duration, holder.account.address, 10n ** 9n],
        }),
      },
      "Refused: outsider buys cover on the drill market",
      { expect: "reverted" },
    );
  }
  if (withRefusals && plan.step === "impair") {
    await send(
      ledger,
      relayer,
      {
        to: d.canaryMarket,
        data: encodeFunctionData({
          abi: riderMarketAbi,
          functionName: "buyCover",
          args: [DRILL.coverage, DRILL.duration, holder.account.address, 10n ** 9n],
        }),
      },
      "Refused: cover on a burning house",
      { expect: "reverted" },
    );
  }
  if (withRefusals && plan.step === "open") {
    const shares = await publicClient.readContract({ address: d.drillPool, abi: riderPoolAbi, functionName: "convertToShares", args: [10_000n] });
    await send(
      ledger,
      deployer,
      { to: d.drillPool, data: poolCalls.requestRedeem(shares, deployer.account.address, deployer.account.address) },
      "Drill-pool underwriter queues an exit during the incident",
    );
    await send(
      ledger,
      deployer,
      { to: d.drillPool, data: poolCalls.redeem(shares, deployer.account.address, deployer.account.address) },
      "Refused: underwriter exit while an incident is open",
      { expect: "reverted" },
    );
  }
  if (plan.step === "claim") paid = true;
  if (paid && plan.step === "rearm") break;
}
console.log("drill complete");
