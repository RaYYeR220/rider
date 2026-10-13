// The on-chain proof run. Buys real cover on all four live markets (one of them as a protected
// deposit into Galaxy's Morpho vault in a single Multicall3From transaction), then lands each
// refusal on-chain as a mined, reverted transaction.
import { encodeFunctionData } from "viem";
import {
  ARC,
  coverCalls,
  createRiderClient,
  marketCalls,
  multicall3FromTx,
  parseUsdc,
  poolCalls,
  protectCalls,
  riderMarketAbi,
  riderPoolAbi,
} from "@rider/sdk";
import { Ledger, deployment, publicClient, send, wallet } from "./lib.js";

const d = deployment();
const rider = createRiderClient(publicClient, d);
const ledger = new Ledger();
const deployer = wallet("DEPLOYER_KEY");
const holder = wallet("HOLDER_KEY");
const me = holder.account.address;
const DAYS_30 = 30n * 86_400n;

async function headroom(market: `0x${string}`, coverage: bigint, duration: bigint) {
  const q = await rider.quote(market, coverage, duration);
  return q.premium + q.premium / 5n + 1n;
}

// 1. Protected deposit: approve, deposit into Galaxy's vault, approve, buy cover. One transaction.
const deposit = parseUsdc(process.env.PROOF_DEPOSIT ?? "0.25");
await send(
  ledger,
  holder,
  multicall3FromTx(
    protectCalls({
      vault: ARC.vaults.galaxyUsdc,
      market: d.galaxyMarket,
      amount: deposit,
      coverage: deposit,
      duration: DAYS_30,
      holder: me,
      maxPremium: await headroom(d.galaxyMarket, deposit, DAYS_30),
    }),
  ),
  "Protected deposit: Galaxy USDC vault + cover, one Multicall3From tx",
);

// 2. Cover on the other three live markets.
const cover = parseUsdc(process.env.PROOF_COVER ?? "0.2");
for (const [market, label] of [
  [d.keyrockMarket, "Cover: Keyrock Prime USDC vault drawdown"],
  [d.eurcMarket, "Cover: EURC peg to the euro"],
  [d.cirbtcMarket, "Cover: cirBTC reserve backing"],
] as const) {
  await send(ledger, holder, multicall3FromTx(coverCalls(market, cover, DAYS_30, me, await headroom(market, cover, DAYS_30))), label);
}

// 3. Refusals, each mined as a reverted transaction.
const galaxy = await rider.market(d.galaxyMarket);
const tooMuch = galaxy.capacity + parseUsdc("0.5");
await send(
  ledger,
  holder,
  {
    to: d.galaxyMarket,
    data: encodeFunctionData({ abi: riderMarketAbi, functionName: "buyCover", args: [tooMuch, DAYS_30, me, 10n ** 12n] }),
  },
  "Refused: cover beyond the market's capacity",
  { expect: "reverted" },
);
await send(
  ledger,
  holder,
  {
    to: d.galaxyMarket,
    data: encodeFunctionData({ abi: riderMarketAbi, functionName: "buyCover", args: [cover, DAYS_30, me, 0n] }),
  },
  "Refused: premium above the buyer's limit",
  { expect: "reverted" },
);
await send(ledger, deployer, { to: d.galaxyMarket, data: marketCalls.openIncident() }, "Refused: incident on a healthy reading", {
  expect: "reverted",
});
const [first] = await rider.policiesOf(me);
if (first) {
  await send(ledger, holder, { to: first.market, data: marketCalls.claim(first.id) }, "Refused: claim with no incident", {
    expect: "reverted",
  });
}

// 4. Underwriter exit is asynchronous: request, then an early claim is refused.
const shares = await publicClient.readContract({
  address: d.pool,
  abi: riderPoolAbi,
  functionName: "convertToShares",
  args: [parseUsdc("0.05")],
});
await send(
  ledger,
  deployer,
  { to: d.pool, data: poolCalls.requestRedeem(shares, deployer.account.address, deployer.account.address) },
  "Underwriter requests a redemption (ERC-7540)",
);
await send(
  ledger,
  deployer,
  { to: d.pool, data: poolCalls.redeem(shares, deployer.account.address, deployer.account.address) },
  "Refused: redemption before the cooldown",
  { expect: "reverted" },
);

console.log(`proof run done: ${ledger.entries.length} transactions in the ledger`);
