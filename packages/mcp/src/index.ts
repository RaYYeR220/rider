#!/usr/bin/env -S npx tsx
// Rider MCP server: lets an agent read Rider markets, quote cover, protect its own deposits and
// push claims on Arc.
//
// Signing is optional and bounded. With RIDER_AGENT_KEY and all three RIDER_*_USDC limits set, the
// server signs purchases itself, inside those limits. Otherwise it returns unsigned calls for the
// agent's own wallet (a Circle agent wallet, a smart account, anything that can send a batch).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPublicClient, createWalletClient, http, isAddress, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import {
  ARC,
  arc,
  arcMainnet,
  asCalls,
  coverCalls,
  createRiderClient,
  explorerTx,
  formatBps,
  formatUsdc,
  liveMarkets,
  marketCalls,
  multicall3FromTx,
  parseUsdc,
  protectCalls,
  type Call3,
  type MarketState,
} from "@rider/sdk";
import { Budget } from "./budget.js";

const RPC_URL = process.env.RPC_URL ?? arc.rpcUrls.default.http[0];
const chain = { ...arc, rpcUrls: { default: { http: [RPC_URL] } } };
const client = createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient;
const deployment = arcMainnet;
const rider = createRiderClient(client, deployment);
const account = process.env.RIDER_AGENT_KEY ? privateKeyToAccount(process.env.RIDER_AGENT_KEY as Hex) : undefined;
const signer = account ? createWalletClient({ account, chain, transport: http(RPC_URL) }) : undefined;
const budget = new Budget(Budget.limitsFromEnv(process.env), process.env.RIDER_BUDGET_FILE);

/** Agents may only ever touch the four live markets; the drill market and anything else is refused. */
const ALLOWED = new Set(liveMarkets(deployment).map((a) => a.toLowerCase()));

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, bigintJson, 2) }],
});
const refuse = (reason: string) => ({ ...text({ refused: true, reason }), isError: true });

function bigintJson(_: string, v: unknown) {
  return typeof v === "bigint" ? v.toString() : v;
}

function summary(m: MarketState) {
  return {
    market: m.address,
    name: m.name,
    trigger: m.kind,
    watches: m.subject,
    status: m.status,
    reading: m.health.ok ? `loss ${formatBps(m.health.lossBps)} of ${formatBps(m.thresholdBps)} threshold` : "unavailable: no sales, no incidents",
    firing: m.health.firing,
    capacityUsdc: formatUsdc(m.capacity),
    activeCoverUsdc: formatUsdc(m.activeCoverage),
    baseRateApr: formatBps(m.baseRateBps),
    termDays: [m.minDuration / 86_400, m.maxDuration / 86_400],
  };
}

function checkMarket(market: string): Address | undefined {
  return isAddress(market) && ALLOWED.has(market.toLowerCase()) ? (market as Address) : undefined;
}

/** Sign within the budget, or hand back the unsigned batch. */
async function execute(calls: Call3[], premium: bigint, coverage: bigint, what: string) {
  const unsigned = {
    signed: false,
    note: "Send these as one batch from the depositing wallet. From an EOA use the multicall3From transaction; smart accounts can send the plain calls.",
    multicall3From: multicall3FromTx(calls),
    calls: asCalls(calls),
    premiumUsdc: formatUsdc(premium),
  };
  if (!signer) return text(unsigned);
  // Reserve first, synchronously: concurrent calls cannot share headroom, and an unknown outcome
  // stays counted against the budget.
  const verdict = budget.reserve(premium, coverage);
  if (!verdict.ok) return refuse(`${what} not signed: ${verdict.reason}`);
  const ticket = verdict.ticket!;
  // The contract has the last word; simulate before spending anything.
  const tx = multicall3FromTx(calls);
  try {
    await client.call({ account: signer.account, to: tx.to, data: tx.data });
  } catch (e) {
    budget.release(ticket);
    return refuse(`${what} would revert on-chain: ${(e as Error).message.split("\n")[0]}`);
  }
  const hash = await signer.sendTransaction(tx);
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status === "reverted") budget.release(ticket);
  return text({ signed: true, status: receipt.status, tx: explorerTx(hash), premiumUsdc: formatUsdc(premium) });
}

/**
 * Who receives the shares and the policy. When the server signs, it is always the signing wallet:
 * a tool call (or an injected instruction) must never be able to send the agent's money elsewhere.
 */
function resolveHolder(requested: string | undefined): { holder?: Address; error?: string } {
  if (signer) {
    if (requested && requested.toLowerCase() !== signer.account.address.toLowerCase()) {
      return { error: "when the server signs, the holder is always the signing wallet" };
    }
    return { holder: signer.account.address };
  }
  if (!requested || !isAddress(requested)) return { error: "holder is required when the server is not signing" };
  return { holder: requested as Address };
}

const server = new McpServer({ name: "rider", version: "0.1.0" });

server.registerTool(
  "list_markets",
  {
    description: "List Rider's live cover markets on Arc with their current trigger readings, capacity and pricing.",
    inputSchema: {},
  },
  async () => {
    const markets = await Promise.all(liveMarkets(deployment).map(rider.market));
    const pool = await rider.pool(deployment.pool);
    return text({
      pool: { totalUsdc: formatUsdc(pool.totalAssets), freeUsdc: formatUsdc(pool.freeAssets), frozen: pool.frozen },
      markets: markets.map(summary),
    });
  },
);

server.registerTool(
  "quote_cover",
  {
    description: "Price cover on one market. Returns the premium in USDC and the exact expiry.",
    inputSchema: {
      market: z.string().describe("Market address from list_markets"),
      coverage_usdc: z.string().describe("Cover amount in USDC, e.g. \"250\""),
      days: z.number().int().min(1).max(90),
    },
  },
  async ({ market, coverage_usdc, days }) => {
    const m = checkMarket(market);
    if (!m) return refuse("unknown market: only the markets returned by list_markets can be quoted");
    const q = await rider.quote(m, parseUsdc(coverage_usdc), BigInt(days * 86_400));
    return text({ premiumUsdc: formatUsdc(q.premium), annualRate: formatBps(q.annualRateBps), expires: new Date(q.end * 1000).toISOString() });
  },
);

server.registerTool(
  "protect_deposit",
  {
    description:
      "Deposit USDC into an ERC-4626 vault on Arc and buy matching cover in the same transaction. The vault must be one a live Rider market watches.",
    inputSchema: {
      vault: z.string().describe("Vault address, e.g. an Earn Kit vault"),
      amount_usdc: z.string(),
      days: z.number().int().min(1).max(90),
      holder: z.string().optional().describe("Receives the vault shares and the policy; defaults to the signing wallet"),
    },
  },
  async ({ vault, amount_usdc, days, holder }) => {
    if (!isAddress(vault)) return refuse("vault is not an address");
    const market = await rider.marketForVault(vault, liveMarkets(deployment));
    if (!market) return refuse("no Rider market watches this vault, so it cannot be covered");
    const { holder: to, error } = resolveHolder(holder);
    if (!to) return refuse(error!);
    const amount = parseUsdc(amount_usdc);
    const duration = BigInt(days * 86_400);
    const q = await rider.quote(market, amount, duration);
    const maxPremium = q.premium + q.premium / 10n + 1n;
    const calls = protectCalls({ vault, market, amount, coverage: amount, duration, holder: to, maxPremium });
    return execute(calls, maxPremium, amount, "protected deposit");
  },
);

server.registerTool(
  "buy_cover",
  {
    description: "Buy cover on a live market for a position the holder already has.",
    inputSchema: {
      market: z.string(),
      coverage_usdc: z.string(),
      days: z.number().int().min(1).max(90),
      holder: z.string().optional(),
    },
  },
  async ({ market, coverage_usdc, days, holder }) => {
    const m = checkMarket(market);
    if (!m) return refuse("unknown market: only the markets returned by list_markets can be bought");
    const { holder: to, error } = resolveHolder(holder);
    if (!to) return refuse(error!);
    const coverage = parseUsdc(coverage_usdc);
    const duration = BigInt(days * 86_400);
    const q = await rider.quote(m, coverage, duration);
    const maxPremium = q.premium + q.premium / 10n + 1n;
    return execute(coverCalls(m, coverage, duration, to, maxPremium), maxPremium, coverage, "cover purchase");
  },
);

server.registerTool(
  "my_policies",
  {
    description: "List the Rider policies held by an address, with status and any payout owed.",
    inputSchema: { holder: z.string().optional() },
  },
  async ({ holder }) => {
    const who = holder ?? signer?.account.address;
    if (!who || !isAddress(who)) return refuse("holder is required when the server is not signing");
    const policies = await rider.policiesOf(who as Address);
    return text(
      policies.map((p) => ({
        id: p.id,
        market: p.marketName,
        coverUsdc: formatUsdc(p.coverage),
        state: p.state,
        payoutUsdc: formatUsdc(p.payout),
        expires: new Date(p.end * 1000).toISOString(),
      })),
    );
  },
);

server.registerTool(
  "incident_status",
  {
    description: "Show a market's incident state: when it opened, whether it is confirmed, and the claim deadline.",
    inputSchema: { market: z.string() },
  },
  async ({ market }) => {
    const m = checkMarket(market);
    if (!m) return refuse("unknown market");
    const s = await rider.market(m);
    return text({ ...summary(s), incident: s.incident });
  },
);

server.registerTool(
  "claim",
  {
    description: "Push the payout for a claimable policy. Anyone can call this; the money always goes to the policy holder.",
    inputSchema: { policy_id: z.string() },
  },
  async ({ policy_id }) => {
    const id = BigInt(policy_id);
    const p = await rider.policy(id);
    if (p.state !== "claimable") return refuse(`policy ${id} is ${p.state}, not claimable`);
    const tx = { to: p.market, data: marketCalls.claim(id) };
    if (!signer) return text({ signed: false, tx, payoutUsdc: formatUsdc(p.payout) });
    const hash = await signer.sendTransaction(tx);
    const receipt = await client.waitForTransactionReceipt({ hash });
    return text({ signed: true, status: receipt.status, tx: explorerTx(hash), payoutUsdc: formatUsdc(p.payout), to: p.holder });
  },
);

await server.connect(new StdioServerTransport());
console.error(`rider mcp on ${RPC_URL}; ${signer ? `signing as ${signer.account.address} within budget` : "unsigned mode"}; usdc ${ARC.usdc}`);
