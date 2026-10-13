import { erc20Abi, type Address, type PublicClient } from "viem";
import { riderMarketAbi, riderPolicyAbi, riderPoolAbi, riderTriggerAbi } from "./abis.js";
import type { Deployment } from "./addresses.js";

export type MarketStatus = "active" | "pending" | "triggered" | "settled";
const STATUS: MarketStatus[] = ["active", "pending", "triggered", "settled"];

export type PolicyState = "live" | "expired" | "claimable" | "paid" | "retired";
const POLICY_STATE: PolicyState[] = ["live", "expired", "claimable", "paid", "retired"];

export interface Health {
  /** false when the trigger's data cannot be trusted; the market then neither sells nor pays. */
  ok: boolean;
  lossBps: number;
  observed: bigint;
  firing: boolean;
}

export interface Incident {
  openedAt: number;
  resolvedAt: number;
  claimDeadline: number;
  exposure: bigint;
  claimedCoverage: bigint;
  paid: bigint;
  observedAtOpen: bigint;
  observed: bigint;
  lossBps: number;
}

export interface MarketState {
  address: Address;
  name: string;
  kind: string;
  trigger: Address;
  subject: Address;
  pool: Address;
  status: MarketStatus;
  generation: bigint;
  thresholdBps: number;
  refHigh: bigint;
  health: Health;
  activeCoverage: bigint;
  capacity: bigint;
  lockedCoverage: bigint;
  unearnedPremium: bigint;
  baseRateBps: number;
  slopeBps: number;
  confirmDelay: number;
  claimWindow: number;
  epochLength: number;
  minDuration: number;
  maxDuration: number;
  minCoverage: bigint;
  maxCoverage: bigint;
  incident: Incident;
}

export interface PoolState {
  address: Address;
  name: string;
  symbol: string;
  totalAssets: bigint;
  lockedAssets: bigint;
  freeAssets: bigint;
  cash: bigint;
  totalSupply: bigint;
  frozen: boolean;
  cooldown: number;
  /** USDC (6 dp) per 1e12 shares, i.e. per whole share. */
  sharePrice: bigint;
  markets: Address[];
}

export interface PolicyView {
  id: bigint;
  market: Address;
  marketName: string;
  kind: string;
  holder: Address;
  coverage: bigint;
  premium: bigint;
  start: number;
  end: number;
  generation: bigint;
  claimed: boolean;
  ref: bigint;
  state: PolicyState;
  payout: bigint;
}

export interface Quote {
  premium: bigint;
  end: number;
  annualRateBps: number;
}

/** Read-only view of a Rider deployment. Every read is one multicall round trip. */
export function createRiderClient(client: PublicClient, deployment: Deployment) {
  async function market(address: Address): Promise<MarketState> {
    const m = { address, abi: riderMarketAbi } as const;
    const r = await client.multicall({
      allowFailure: false,
      contracts: [
        { ...m, functionName: "name" },
        { ...m, functionName: "trigger" },
        { ...m, functionName: "pool" },
        { ...m, functionName: "status" },
        { ...m, functionName: "generation" },
        { ...m, functionName: "thresholdBps" },
        { ...m, functionName: "refHigh" },
        { ...m, functionName: "health" },
        { ...m, functionName: "activeCoverage" },
        { ...m, functionName: "capacity" },
        { ...m, functionName: "lockedCoverage" },
        { ...m, functionName: "unearnedPremium" },
        { ...m, functionName: "baseRateBps" },
        { ...m, functionName: "slopeBps" },
        { ...m, functionName: "confirmDelay" },
        { ...m, functionName: "claimWindow" },
        { ...m, functionName: "epochLength" },
        { ...m, functionName: "minDuration" },
        { ...m, functionName: "maxDuration" },
        { ...m, functionName: "minCoverage" },
        { ...m, functionName: "maxCoverage" },
        { ...m, functionName: "incident" },
      ],
    });
    const trigger = r[1];
    const [kind, subject] = await client.multicall({
      allowFailure: false,
      contracts: [
        { address: trigger, abi: riderTriggerAbi, functionName: "kind" },
        { address: trigger, abi: riderTriggerAbi, functionName: "subject" },
      ],
    });
    const [ok, lossBps, observed, firing] = r[7];
    const inc = r[21];
    return {
      address,
      name: r[0],
      kind,
      trigger,
      subject,
      pool: r[2],
      status: STATUS[r[3]] ?? "active",
      generation: r[4],
      thresholdBps: Number(r[5]),
      refHigh: r[6],
      health: { ok, lossBps: Number(lossBps), observed, firing },
      activeCoverage: r[8],
      capacity: r[9],
      lockedCoverage: r[10],
      unearnedPremium: r[11],
      baseRateBps: Number(r[12]),
      slopeBps: Number(r[13]),
      confirmDelay: Number(r[14]),
      claimWindow: Number(r[15]),
      epochLength: Number(r[16]),
      minDuration: Number(r[17]),
      maxDuration: Number(r[18]),
      minCoverage: r[19],
      maxCoverage: r[20],
      incident: {
        openedAt: Number(inc.openedAt),
        resolvedAt: Number(inc.resolvedAt),
        claimDeadline: Number(inc.claimDeadline),
        exposure: inc.exposure,
        claimedCoverage: inc.claimedCoverage,
        paid: inc.paid,
        observedAtOpen: inc.observedAtOpen,
        observed: inc.observed,
        lossBps: Number(inc.lossBps),
      },
    };
  }

  async function pool(address: Address): Promise<PoolState> {
    const p = { address, abi: riderPoolAbi } as const;
    const r = await client.multicall({
      allowFailure: false,
      contracts: [
        { ...p, functionName: "name" },
        { ...p, functionName: "symbol" },
        { ...p, functionName: "totalAssets" },
        { ...p, functionName: "lockedAssets" },
        { ...p, functionName: "freeAssets" },
        { ...p, functionName: "totalSupply" },
        { ...p, functionName: "frozen" },
        { ...p, functionName: "cooldown" },
        { ...p, functionName: "convertToAssets", args: [10n ** 12n] },
        { ...p, functionName: "markets" },
        { ...p, functionName: "asset" },
      ],
    });
    const cash = await client.readContract({ address: r[10], abi: erc20Abi, functionName: "balanceOf", args: [address] });
    return {
      address,
      name: r[0],
      symbol: r[1],
      totalAssets: r[2],
      lockedAssets: r[3],
      freeAssets: r[4],
      totalSupply: r[5],
      frozen: r[6],
      cooldown: Number(r[7]),
      sharePrice: r[8],
      markets: [...r[9]],
      cash,
    };
  }

  async function quote(address: Address, coverage: bigint, duration: bigint): Promise<Quote> {
    const [premium, end, rate] = await client.readContract({
      address,
      abi: riderMarketAbi,
      functionName: "quote",
      args: [coverage, duration],
    });
    return { premium, end: Number(end), annualRateBps: Number(rate) };
  }

  async function policy(id: bigint): Promise<PolicyView> {
    const marketAddress = await client.readContract({
      address: deployment.policy,
      abi: riderPolicyAbi,
      functionName: "marketOf",
      args: [id],
    });
    const m = { address: marketAddress, abi: riderMarketAbi } as const;
    const [p, card, holder] = await client.multicall({
      allowFailure: false,
      contracts: [
        { ...m, functionName: "policy", args: [id] },
        { ...m, functionName: "policyCard", args: [id] },
        { address: deployment.policy, abi: riderPolicyAbi, functionName: "ownerOf", args: [id] },
      ],
    });
    return {
      id,
      market: marketAddress,
      marketName: card[0],
      kind: card[1],
      holder,
      coverage: p.coverage,
      premium: p.premium,
      start: Number(p.start),
      end: Number(p.end),
      generation: p.generation,
      claimed: p.claimed,
      ref: p.ref,
      state: POLICY_STATE[card[6]] ?? "live",
      payout: card[7],
    };
  }

  /** Every policy ever minted, newest first. Fine at today's scale; an indexer replaces it later. */
  async function allPolicyIds(): Promise<bigint[]> {
    const next = await client.readContract({ address: deployment.policy, abi: riderPolicyAbi, functionName: "nextId" });
    const ids: bigint[] = [];
    for (let i = next - 1n; i >= 1n; i--) ids.push(i);
    return ids;
  }

  async function policiesOf(holder: Address): Promise<PolicyView[]> {
    const ids = await allPolicyIds();
    if (ids.length === 0) return [];
    const owners = await client.multicall({
      allowFailure: true,
      contracts: ids.map((id) => ({
        address: deployment.policy,
        abi: riderPolicyAbi,
        functionName: "ownerOf" as const,
        args: [id] as const,
      })),
    });
    const mine = ids.filter((_, i) => owners[i]?.status === "success" && sameAddress(owners[i]?.result as Address, holder));
    return Promise.all(mine.map(policy));
  }

  /** Policies of `market` that can be claimed right now, for keepers that push payouts. */
  async function claimableIds(marketAddress: Address): Promise<bigint[]> {
    const ids = await allPolicyIds();
    if (ids.length === 0) return [];
    const markets = await client.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({
        address: deployment.policy,
        abi: riderPolicyAbi,
        functionName: "marketOf" as const,
        args: [id] as const,
      })),
    });
    const ofMarket = ids.filter((_, i) => sameAddress(markets[i] as Address, marketAddress));
    if (ofMarket.length === 0) return [];
    const claimable = await client.multicall({
      allowFailure: false,
      contracts: ofMarket.map((id) => ({
        address: marketAddress,
        abi: riderMarketAbi,
        functionName: "claimable" as const,
        args: [id] as const,
      })),
    });
    return ofMarket.filter((_, i) => claimable[i]?.[1] === true);
  }

  /** The Rider market whose trigger watches `vault`, if any. Lets an Earn Kit integration find its cover. */
  async function marketForVault(vault: Address, markets: Address[]): Promise<Address | undefined> {
    for (const address of markets) {
      const trigger = await client.readContract({ address, abi: riderMarketAbi, functionName: "trigger" });
      const subject = await client.readContract({ address: trigger, abi: riderTriggerAbi, functionName: "subject" });
      if (sameAddress(subject, vault)) return address;
    }
    return undefined;
  }

  return { deployment, market, pool, quote, policy, policiesOf, claimableIds, allPolicyIds, marketForVault };
}

export type RiderClient = ReturnType<typeof createRiderClient>;

function sameAddress(a: Address | undefined, b: Address | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}
