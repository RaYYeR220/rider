import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeErrorResult,
  defineChain,
  http,
  type BaseError,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
  type Chain,
  type Transport,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arc, canaryVaultAbi, explorerTx, riderMarketAbi, riderPoolAbi, type Deployment } from "@rider/sdk";

/** Where we are running: Arc mainnet, or a local Arc Foundry fork of it for rehearsals. */
export const RPC_URL = process.env.RPC_URL ?? arc.rpcUrls.default.http[0];
export const NETWORK = process.env.NETWORK ?? "arc-mainnet";
const root = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../../..");

export const chain: Chain = defineChain({ ...arc, rpcUrls: { default: { http: [RPC_URL] } } });

export const publicClient = createPublicClient({ chain, transport: http(RPC_URL) }) as PublicClient;

export function wallet(envName: string): WalletClient<Transport, Chain, Account> {
  const key = process.env[envName];
  if (!key) throw new Error(`${envName} is not set`);
  return createWalletClient({ account: privateKeyToAccount(key as Hex), chain, transport: http(RPC_URL) });
}

export function deployment(): Deployment {
  const file = resolve(root, "contracts/deployments", `${NETWORK}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Deployment;
}

export interface LedgerEntry {
  label: string;
  hash: Hex;
  status: "success" | "reverted";
  expected: "success" | "reverted";
  from: Address;
  to: Address;
  block: string;
  gasUsed: string;
  url: string;
  note?: string;
  /** Decoded custom error, for transactions that were meant to be refused. */
  reason?: string;
}

const errorAbi = [...riderMarketAbi, ...riderPoolAbi, ...canaryVaultAbi].filter((x) => x.type === "error");

/** Simulate the call and decode the custom error it reverts with, e.g. `CapacityExceeded(1000000, 500000)`. */
async function revertReason(from: Address, tx: { to: Address; data: Hex }): Promise<string> {
  try {
    await publicClient.call({ account: from, to: tx.to, data: tx.data });
    return "did not revert in simulation";
  } catch (e) {
    const err = e as BaseError;
    const raw = err.walk((x) => typeof (x as { data?: unknown }).data === "string") as { data?: Hex } | null;
    if (!raw?.data) return err.shortMessage ?? "reverted";
    try {
      const decoded = decodeErrorResult({ abi: errorAbi, data: raw.data });
      return `${decoded.errorName}(${(decoded.args ?? []).map(String).join(", ")})`;
    } catch {
      return raw.data;
    }
  }
}

/** Every transaction the proof run sends, with what we expected and what the chain said. */
export class Ledger {
  private readonly file = resolve(root, "proof", `${NETWORK}.json`);
  readonly entries: LedgerEntry[] = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : [];

  push(entry: LedgerEntry) {
    this.entries.push(entry);
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.entries, null, 2) + "\n");
  }
}

/**
 * Send a transaction and record it. With `expect: "reverted"` the gas limit is set by hand so the
 * transaction is mined even though it fails: the refusal itself lands on-chain as evidence.
 */
export async function send(
  ledger: Ledger | undefined,
  w: WalletClient<Transport, Chain, Account>,
  tx: { to: Address; data: Hex },
  label: string,
  opts: { expect?: "success" | "reverted"; gas?: bigint; note?: string } = {},
) {
  const expected = opts.expect ?? "success";
  const reason = expected === "reverted" ? await revertReason(w.account.address, tx) : undefined;
  const hash = await w.sendTransaction({
    to: tx.to,
    data: tx.data,
    gas: expected === "reverted" ? (opts.gas ?? 400_000n) : opts.gas,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const entry: LedgerEntry = {
    label,
    hash,
    status: receipt.status,
    expected,
    from: w.account.address,
    to: tx.to,
    block: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    url: explorerTx(hash),
    note: opts.note,
    reason,
  };
  const mark = receipt.status === expected ? "ok " : "!! ";
  console.log(`${mark}${label.padEnd(58)} ${receipt.status.padEnd(8)} ${hash}${reason ? `  ${reason}` : ""}`);
  ledger?.push(entry);
  if (receipt.status !== expected) throw new Error(`${label}: expected ${expected}, got ${receipt.status}`);
  return receipt;
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wait until the chain's clock passes `t` (unix seconds). */
export async function waitUntil(t: number) {
  for (;;) {
    const block = await publicClient.getBlock();
    if (Number(block.timestamp) >= t) return;
    await sleep(Math.min(5_000, Math.max(500, (t - Number(block.timestamp)) * 1_000)));
  }
}
