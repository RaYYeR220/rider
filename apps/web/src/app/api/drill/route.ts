import { connection } from "next/server";
import { erc20Abi, isAddress, type Address } from "viem";
import { ARC, explorerTx, planDrill, riderMarketAbi, riderPolicyAbi } from "@rider/sdk";
import { deployment, json, publicClient, relayer } from "@/lib/server";

/**
 * The live drill. GET returns the next step; POST sends it from the drill relayer.
 *
 * The relayer spends real USDC on gas, so starting a new round is rate limited on-chain-derived data
 * (rounds started in the last 24 hours), paused below a balance floor, and every transaction is
 * simulated before it is sent. Steps after the first are always allowed: a round that has started
 * should be able to finish.
 */
const HOLDER = (process.env.DRILL_HOLDER ?? "") as Address;
const DAILY_ROUNDS = Number(process.env.DRILL_DAILY_ROUNDS ?? 24);
const MIN_BALANCE = BigInt(process.env.DRILL_MIN_BALANCE ?? 150_000); // 0.15 USDC
const MIN_GAP_MS = 1_500;

let lastSent = 0;
let inflight: Promise<unknown> | undefined;

export async function GET() {
  await connection();
  if (!isAddress(HOLDER)) return json({ step: "unavailable", note: "The drill is not configured on this deployment." });
  const plan = await planDrill(publicClient, deployment, HOLDER);
  return json({ ...plan, holder: HOLDER, rounds: await roundsToday() });
}

export async function POST() {
  const wallet = relayer();
  if (!wallet || !isAddress(HOLDER)) return json({ error: "The drill is read-only on this deployment." }, { status: 503 });
  if (inflight || Date.now() - lastSent < MIN_GAP_MS) return json({ error: "A step is already being sent." }, { status: 429 });

  const plan = await planDrill(publicClient, deployment, HOLDER);
  if (!plan.tx) return json(plan);

  if (plan.step === "buy") {
    const rounds = await roundsToday();
    if (rounds >= DAILY_ROUNDS) {
      return json({ error: `The drill has run ${rounds} times in the last 24 hours. Try again later.` }, { status: 429 });
    }
    const balance = await publicClient.readContract({
      address: ARC.usdc,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet.account.address],
    });
    if (balance < MIN_BALANCE) return json({ error: "The drill relayer is out of budget." }, { status: 503 });
  }

  const tx = plan.tx;
  const send = (async () => {
    // Another viewer may have moved the drill on; the chain decides, so simulate first.
    await publicClient.call({ account: wallet.account, to: tx.to, data: tx.data });
    const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { step: plan.step, note: plan.note, hash, url: explorerTx(hash), status: receipt.status, block: receipt.blockNumber };
  })();
  inflight = send;
  try {
    const result = await send;
    lastSent = Date.now();
    return json(result);
  } catch (e) {
    return json({ error: "The step was not accepted on-chain; refresh the drill state.", detail: (e as Error).message.split("\n")[0] }, { status: 409 });
  } finally {
    inflight = undefined;
  }
}

/** Drill rounds started in the last 24 hours, counted from the canary policies' start times. */
async function roundsToday(): Promise<number> {
  const next = await publicClient.readContract({ address: deployment.policy, abi: riderPolicyAbi, functionName: "nextId" });
  const block = await publicClient.getBlock();
  const since = Number(block.timestamp) - 86_400;
  let rounds = 0;
  for (let id = next - 1n; id >= 1n && id >= next - 200n; id--) {
    const market = await publicClient.readContract({ address: deployment.policy, abi: riderPolicyAbi, functionName: "marketOf", args: [id] });
    if (market.toLowerCase() !== deployment.canaryMarket.toLowerCase()) continue;
    const p = await publicClient.readContract({ address: market, abi: riderMarketAbi, functionName: "policy", args: [id] });
    if (Number(p.start) < since) break;
    rounds++;
  }
  return rounds;
}
