import { encodeFunctionData, erc20Abi, erc4626Abi, type Address, type Hex } from "viem";
import { riderMarketAbi, riderPoolAbi } from "./abis.js";
import { ARC } from "./addresses.js";

/** One sub-call of an Arc Multicall3From batch. */
export interface Call3 {
  target: Address;
  allowFailure: boolean;
  callData: Hex;
}

/** A plain call, for smart accounts that batch natively (Circle SCA / MSCA, ERC-4337, EIP-7702). */
export interface Call {
  to: Address;
  data: Hex;
  value: bigint;
}

export const multicall3FromAbi = [
  {
    type: "function",
    name: "aggregate3",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "allowFailure", type: "bool" },
          { name: "callData", type: "bytes" },
        ],
      },
    ],
    outputs: [
      {
        name: "returnData",
        type: "tuple[]",
        components: [
          { name: "success", type: "bool" },
          { name: "returnData", type: "bytes" },
        ],
      },
    ],
  },
] as const;

export interface ProtectParams {
  /** ERC-4626 vault to deposit into, e.g. an Earn Kit vault. */
  vault: Address;
  /** Rider market whose trigger watches that vault. */
  market: Address;
  /** USDC to deposit, 6 decimals. */
  amount: bigint;
  /** Cover to buy, 6 decimals. Usually equal to `amount`. */
  coverage: bigint;
  /** Cover term in seconds. */
  duration: bigint;
  /** Receives the vault shares and the policy NFT. */
  holder: Address;
  /** Upper bound on the premium; quote first and add headroom. */
  maxPremium: bigint;
  usdc?: Address;
}

/**
 * The four calls of a protected deposit: approve, deposit, approve, buy cover.
 * Sent through Multicall3From they run in one transaction with the depositor as msg.sender for
 * each call, so no router contract ever takes custody of the funds.
 */
export function protectCalls(p: ProtectParams): Call3[] {
  const usdc = p.usdc ?? ARC.usdc;
  return [
    call3(usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [p.vault, p.amount] })),
    call3(p.vault, encodeFunctionData({ abi: erc4626Abi, functionName: "deposit", args: [p.amount, p.holder] })),
    call3(usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [p.market, p.maxPremium] })),
    call3(p.market, buyCoverData(p.coverage, p.duration, p.holder, p.maxPremium)),
  ];
}

/** Cover alone, for a position the holder already has: approve then buy. */
export function coverCalls(
  market: Address,
  coverage: bigint,
  duration: bigint,
  holder: Address,
  maxPremium: bigint,
  usdc: Address = ARC.usdc,
): Call3[] {
  return [
    call3(usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [market, maxPremium] })),
    call3(market, buyCoverData(coverage, duration, holder, maxPremium)),
  ];
}

/** Wrap sub-calls into a single Multicall3From transaction. Must be sent by an EOA. */
export function multicall3FromTx(calls: Call3[]): { to: Address; data: Hex } {
  return {
    to: ARC.multicall3From,
    data: encodeFunctionData({ abi: multicall3FromAbi, functionName: "aggregate3", args: [calls] }),
  };
}

/** The same batch as plain calls, for wallets that batch on their own. */
export function asCalls(calls: Call3[]): Call[] {
  return calls.map((c) => ({ to: c.target, data: c.callData, value: 0n }));
}

export function buyCoverData(coverage: bigint, duration: bigint, holder: Address, maxPremium: bigint): Hex {
  return encodeFunctionData({ abi: riderMarketAbi, functionName: "buyCover", args: [coverage, duration, holder, maxPremium] });
}

export const marketCalls = {
  openIncident: () => encodeFunctionData({ abi: riderMarketAbi, functionName: "openIncident" }),
  resolveIncident: () => encodeFunctionData({ abi: riderMarketAbi, functionName: "resolveIncident" }),
  claim: (policyId: bigint) => encodeFunctionData({ abi: riderMarketAbi, functionName: "claim", args: [policyId] }),
  claimMany: (ids: bigint[]) => encodeFunctionData({ abi: riderMarketAbi, functionName: "claimMany", args: [ids] }),
  settle: () => encodeFunctionData({ abi: riderMarketAbi, functionName: "settle" }),
  rearm: () => encodeFunctionData({ abi: riderMarketAbi, functionName: "rearm" }),
  poke: () => encodeFunctionData({ abi: riderMarketAbi, functionName: "poke" }),
};

export const poolCalls = {
  deposit: (assets: bigint, receiver: Address) =>
    encodeFunctionData({ abi: riderPoolAbi, functionName: "deposit", args: [assets, receiver] }),
  requestRedeem: (shares: bigint, controller: Address, owner: Address) =>
    encodeFunctionData({ abi: riderPoolAbi, functionName: "requestRedeem", args: [shares, controller, owner] }),
  redeem: (shares: bigint, receiver: Address, controller: Address) =>
    encodeFunctionData({ abi: riderPoolAbi, functionName: "redeem", args: [shares, receiver, controller] }),
};

function call3(target: Address, callData: Hex): Call3 {
  return { target, allowFailure: false, callData };
}
