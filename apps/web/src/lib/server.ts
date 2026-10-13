import "server-only";
import { createPublicClient, createWalletClient, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc, arcMainnet, createRiderClient } from "@rider/sdk";

export const RPC_URL = process.env.ARC_RPC_URL ?? "https://rpc.mainnet.arc.io";
export const chain = { ...arc, rpcUrls: { default: { http: [RPC_URL] } } };
export const deployment = arcMainnet;
export const publicClient = createPublicClient({ chain, transport: http(RPC_URL, { retryCount: 3 }) }) as PublicClient;
export const rider = createRiderClient(publicClient, deployment);

/** The drill relayer. Absent when RELAYER_KEY is not configured, in which case the drill is read-only. */
export function relayer() {
  const key = process.env.RELAYER_KEY;
  if (!key) return undefined;
  return createWalletClient({ account: privateKeyToAccount(key as Hex), chain, transport: http(RPC_URL) });
}

/** JSON.stringify that writes bigints as decimal strings. */
export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...init?.headers },
  });
}
