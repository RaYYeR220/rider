// Funds a fresh deployment: underwriting capital in both pools, a seeded canary vault, and working
// balances for the drill relayer and the demo policyholder.
import { encodeFunctionData, erc20Abi, erc4626Abi } from "viem";
import { ARC, parseUsdc, poolCalls } from "@rider/sdk";
import { Ledger, deployment, send, wallet } from "./lib.js";

const POOL = parseUsdc(process.env.SEED_POOL ?? "1.5");
const DRILL_POOL = parseUsdc(process.env.SEED_DRILL_POOL ?? "0.5");
const RELAYER = parseUsdc(process.env.SEED_RELAYER ?? "1.3");
const CANARY = parseUsdc(process.env.SEED_CANARY ?? "0.3");
const HOLDER = parseUsdc(process.env.SEED_HOLDER ?? "0.4");

const d = deployment();
const ledger = new Ledger();
const deployer = wallet("DEPLOYER_KEY");
const relayer = wallet("RELAYER_KEY");
const holder = wallet("HOLDER_KEY");

const approve = (spender: `0x${string}`, amount: bigint) => ({
  to: ARC.usdc,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }),
});
const transfer = (to: `0x${string}`, amount: bigint) => ({
  to: ARC.usdc,
  data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, amount] }),
});

await send(ledger, deployer, approve(d.pool, POOL), "Underwriter approves the Rider USDC pool");
await send(ledger, deployer, { to: d.pool, data: poolCalls.deposit(POOL, deployer.account.address) }, "Underwriter deposits into the Rider USDC pool");
await send(ledger, deployer, approve(d.drillPool, DRILL_POOL), "Underwriter approves the drill pool");
await send(ledger, deployer, { to: d.drillPool, data: poolCalls.deposit(DRILL_POOL, deployer.account.address) }, "Underwriter deposits into the drill pool");
await send(ledger, deployer, transfer(relayer.account.address, RELAYER), "Fund the drill relayer");
await send(ledger, deployer, transfer(holder.account.address, HOLDER), "Fund the demo policyholder");

await send(ledger, relayer, approve(d.canary, CANARY), "Drill operator approves the canary vault");
await send(
  ledger,
  relayer,
  {
    to: d.canary,
    data: encodeFunctionData({ abi: erc4626Abi, functionName: "deposit", args: [CANARY, relayer.account.address] }),
  },
  "Drill operator seeds the canary vault",
);
console.log("seeded");
