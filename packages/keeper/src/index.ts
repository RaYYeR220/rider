#!/usr/bin/env -S npx tsx
// Rider keeper. Anyone can run it: every action it takes is permissionless, and the contracts decide
// whether an action is allowed. Without KEEPER_KEY it only reports what it would do.
//
//   RPC_URL=https://rpc.mainnet.arc.io KEEPER_KEY=0x... pnpm --filter @rider/keeper start
import { readFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  arc,
  arcMainnet,
  createRiderClient,
  explorerTx,
  formatBps,
  marketCalls,
  type Deployment,
  type MarketState,
} from "@rider/sdk";

const RPC_URL = process.env.RPC_URL ?? arc.rpcUrls.default.http[0];
const INTERVAL_MS = Number(process.env.KEEPER_INTERVAL_MS ?? 5_000);
const ONCE = process.argv.includes("--once");
const deployment: Deployment = process.env.RIDER_DEPLOYMENT_FILE
  ? JSON.parse(readFileSync(process.env.RIDER_DEPLOYMENT_FILE, "utf8"))
  : arcMainnet;

const chain = { ...arc, rpcUrls: { default: { http: [RPC_URL] } } };
const client = createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient;
const rider = createRiderClient(client, deployment);
const account = process.env.KEEPER_KEY ? privateKeyToAccount(process.env.KEEPER_KEY as Hex) : undefined;
const walletClient = account ? createWalletClient({ account, chain, transport: http(RPC_URL) }) : undefined;

/** Markets the keeper looks after. The canary market is driven by the drill runner instead. */
const markets: Address[] = [
  deployment.galaxyMarket,
  deployment.keyrockMarket,
  deployment.eurcMarket,
  deployment.cirbtcMarket,
  ...(process.env.KEEPER_INCLUDE_DRILL === "1" ? [deployment.canaryMarket] : []),
];

type Action = { label: string; data: Hex };

/** The one thing worth doing for a market right now, if anything. */
async function nextAction(m: MarketState, now: number): Promise<Action | undefined> {
  switch (m.status) {
    case "active":
      if (m.health.ok && m.health.firing) return { label: "open incident", data: marketCalls.openIncident() };
      return undefined;
    case "pending":
      if (now >= m.incident.openedAt + m.confirmDelay) return { label: "resolve incident", data: marketCalls.resolveIncident() };
      return undefined;
    case "triggered": {
      if (now > m.incident.claimDeadline) return { label: "settle", data: marketCalls.settle() };
      const ids = await rider.claimableIds(m.address);
      if (ids.length) return { label: `push ${ids.length} claim(s)`, data: marketCalls.claimMany(ids) };
      return undefined;
    }
    case "settled":
      if (m.health.ok) return { label: "rearm", data: marketCalls.rearm() };
      return undefined;
  }
}

async function tick() {
  const now = Number((await client.getBlock()).timestamp);
  for (const address of markets) {
    let m: MarketState;
    try {
      m = await rider.market(address);
    } catch (e) {
      console.error(`[${address}] read failed: ${(e as Error).message}`);
      continue;
    }
    const reading = m.health.ok ? `loss ${formatBps(m.health.lossBps)} / threshold ${formatBps(m.thresholdBps)}` : "reading unavailable";
    const action = await nextAction(m, now);
    if (!action) {
      if (ONCE) console.log(`[${m.name}] ${m.status}, ${reading}: nothing to do`);
      continue;
    }
    if (!walletClient) {
      console.log(`[${m.name}] ${m.status}, ${reading}: would ${action.label} (no KEEPER_KEY, dry run)`);
      continue;
    }
    try {
      // Simulate first: the contract is the judge, the keeper only proposes.
      await client.call({ account: walletClient.account, to: address, data: action.data });
      const hash = await walletClient.sendTransaction({ to: address, data: action.data });
      const receipt = await client.waitForTransactionReceipt({ hash });
      console.log(`[${m.name}] ${action.label}: ${receipt.status} ${explorerTx(hash)}`);
    } catch (e) {
      console.log(`[${m.name}] ${action.label} not accepted: ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

console.log(`rider keeper on ${RPC_URL}, ${markets.length} markets, ${walletClient ? `sending as ${walletClient.account.address}` : "dry run"}`);
do {
  await tick();
  if (!ONCE) await new Promise((r) => setTimeout(r, INTERVAL_MS));
} while (!ONCE);
