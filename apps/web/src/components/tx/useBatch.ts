"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BaseError,
  HttpRequestError,
  RawContractError,
  TimeoutError,
  UserRejectedRequestError,
  decodeFunctionResult,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { arc } from "viem/chains";
import { useCapabilities, useConfig, useConnection, usePublicClient, useSendCalls, useSendTransaction } from "wagmi";
import { waitForCallsStatus } from "wagmi/actions";
import { asCalls, multicall3FromAbi, multicall3FromTx, type Call3 } from "@rider/sdk";
import { readRefusal, type Refusal } from "@/lib/refusals";

/** Holds real mainnet policies from the proof run; used to dry-run batches when no wallet is connected. */
export const DEMO_HOLDER: Address = "0x73c37EF65789B50511656F3ec4F22E21FFddc549";

export function call3(target: Address, callData: Hex): Call3 {
  return { target, allowFailure: false, callData };
}

/** One transaction for the batch: a single call goes straight to its target, several go through Multicall3From. */
export function txFor(calls: Call3[]): { to: Address; data: Hex } {
  if (calls.length === 1) return { to: calls[0].target, data: calls[0].callData };
  return multicall3FromTx(calls);
}

export type Simulation =
  | { ok: true; block: bigint | undefined; at: number }
  | { ok: false; refusal: Refusal; index: number | null; block: bigint | undefined; at: number };

function isNetwork(e: unknown) {
  return e instanceof BaseError && !!e.walk((x) => x instanceof HttpRequestError || x instanceof TimeoutError);
}

function fallback(e: unknown): Refusal {
  const raw = e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e);
  return { name: "Reverted", raw, message: "The contract refused this transaction." };
}

/**
 * Run the batch against Arc as `account` without signing anything. On a revert, the batch is run
 * again with every sub-call allowed to fail, so the refusal can be pinned to the call that made it.
 */
export async function simulateCalls(client: PublicClient, account: Address, calls: Call3[]): Promise<Simulation> {
  const block = await client.getBlockNumber().catch(() => undefined);
  const at = Date.now();
  try {
    await client.call({ account, ...txFor(calls), blockNumber: block });
    return { ok: true, block, at };
  } catch (e) {
    if (isNetwork(e)) throw e;
    let refusal = readRefusal(e) ?? fallback(e);
    let index: number | null = calls.length === 1 ? 0 : null;
    if (calls.length > 1) {
      try {
        const soft = calls.map((c) => ({ ...c, allowFailure: true }));
        const res = await client.call({ account, ...multicall3FromTx(soft), blockNumber: block });
        if (res.data) {
          const results = decodeFunctionResult({ abi: multicall3FromAbi, functionName: "aggregate3", data: res.data });
          const i = results.findIndex((r) => !r.success);
          if (i >= 0) {
            index = i;
            const located = readRefusal(new RawContractError({ data: results[i].returnData }));
            if (located && (refusal.name === "Reverted" || located.name === refusal.name)) refusal = located;
          }
        }
      } catch {
        // The diagnostic run is best effort; the refusal above already stands.
      }
    }
    return { ok: false, refusal, index, block, at };
  }
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Simulates the batch whenever it changes (debounced), so a refusal shows before anything is signed. */
export function useSimulation(calls: Call3[] | null, account: Address | undefined) {
  const client = usePublicClient({ chainId: arc.id });
  const key = calls ? calls.map((c) => `${c.target}:${c.callData}`).join("|") : "";
  const settled = useDebounced(key, 350);
  return useQuery({
    queryKey: ["rider-simulate", account?.toLowerCase(), settled],
    enabled: !!client && !!account && !!calls && calls.length > 0 && settled === key,
    queryFn: () => simulateCalls(client as PublicClient, account as Address, calls as Call3[]),
    staleTime: 8_000,
    refetchInterval: 20_000,
    retry: 1,
    placeholderData: (prev) => prev,
  });
}

export type Phase =
  | { step: "idle" }
  | { step: "checking" }
  | { step: "refused"; refusal: Refusal; index: number | null }
  | { step: "signing"; atomic: boolean }
  | { step: "pending"; hash?: Hex }
  | { step: "done"; hash: Hex }
  | { step: "declined" }
  | { step: "failed"; message: string; hash?: Hex };

/**
 * Simulate, then send: an atomic wallet batch when the wallet supports one on Arc, otherwise one
 * Multicall3From transaction from the EOA. Either way, the user's address is msg.sender for every call.
 */
export function useBatch(onDone?: (hash: Hex) => void) {
  const { address, chainId, status } = useConnection();
  const client = usePublicClient({ chainId: arc.id });
  const config = useConfig();
  const caps = useCapabilities({ chainId: arc.id, query: { enabled: status === "connected", retry: false, staleTime: Infinity } });
  const atomicStatus = caps.data?.atomic?.status;
  const atomic = atomicStatus === "supported" || atomicStatus === "ready";
  const sendCalls = useSendCalls();
  const sendTx = useSendTransaction();
  const [phase, setPhase] = useState<Phase>({ step: "idle" });

  const ready = status === "connected" && !!address && chainId === arc.id && !!client;
  const busy = phase.step === "checking" || phase.step === "signing" || phase.step === "pending";

  async function send(calls: Call3[]) {
    if (!ready || !address || !client || calls.length === 0) return;
    setPhase({ step: "checking" });
    let sim: Simulation;
    try {
      sim = await simulateCalls(client as PublicClient, address, calls);
    } catch {
      setPhase({ step: "failed", message: "Could not reach Arc to simulate the batch. Nothing was sent." });
      return;
    }
    if (!sim.ok) {
      setPhase({ step: "refused", refusal: sim.refusal, index: sim.index });
      return;
    }

    const batched = atomic && calls.length > 1;
    setPhase({ step: "signing", atomic: batched });
    try {
      let hash: Hex;
      if (batched) {
        const { id } = await sendCalls.mutateAsync({ calls: asCalls(calls), chainId: arc.id, forceAtomic: true });
        setPhase({ step: "pending" });
        const res = await waitForCallsStatus(config, { id, timeout: 120_000 });
        const receipt = res.receipts?.[res.receipts.length - 1];
        if (!receipt) throw new Error("The wallet reported no receipt for the batch.");
        hash = receipt.transactionHash;
        if (res.status !== "success" || receipt.status !== "success") {
          setPhase({ step: "failed", message: "The batch was mined but reverted. Nothing changed.", hash });
          return;
        }
      } else {
        hash = await sendTx.mutateAsync({ ...txFor(calls), chainId: arc.id });
        setPhase({ step: "pending", hash });
        const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
        if (receipt.status !== "success") {
          setPhase({ step: "failed", message: "The transaction was mined but reverted. Nothing changed.", hash });
          return;
        }
      }
      setPhase({ step: "done", hash });
      onDone?.(hash);
    } catch (e) {
      if (e instanceof BaseError && e.walk((x) => x instanceof UserRejectedRequestError)) {
        setPhase({ step: "declined" });
        return;
      }
      const refusal = readRefusal(e);
      if (refusal && refusal.name !== "Reverted") {
        setPhase({ step: "refused", refusal, index: null });
        return;
      }
      setPhase({ step: "failed", message: e instanceof BaseError ? e.shortMessage : e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    send,
    phase,
    reset: () => setPhase({ step: "idle" }),
    ready,
    busy,
    atomic,
    address,
    connected: status === "connected" && !!address,
    wrongChain: status === "connected" && chainId !== arc.id,
  };
}
