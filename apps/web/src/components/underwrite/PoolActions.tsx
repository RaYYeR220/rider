"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { encodeFunctionData, erc20Abi, formatUnits, type Address } from "viem";
import { arc } from "viem/chains";
import { useReadContract, useReadContracts } from "wagmi";
import { ARC, arcMainnet, poolCalls, riderPoolAbi } from "@rider/sdk";
import { Connect, short } from "@/components/Connect";
import type { ApiPool } from "@/lib/state";
import { Receipt, type ReceiptLine } from "@/components/tx/Receipt";
import { TxAction } from "@/components/tx/TxAction";
import { DEMO_HOLDER, call3, useBatch, useSimulation } from "@/components/tx/useBatch";
import { parseAmount, parseShares, shares, until, usdc, utc } from "@/components/tx/format";
import styles from "./underwrite.module.css";

const POOL = arcMainnet.pool;
type Tab = "deposit" | "request" | "redeem";

interface Props {
  pool: ApiPool;
  /** Latest block timestamp, used as "now" so countdowns follow the chain. */
  now: number | undefined;
  onDone: () => void;
}

export function PoolActions({ pool, now, onDone }: Props) {
  const [tab, setTab] = useState<Tab>("deposit");
  const [amountText, setAmountText] = useState("0.10");
  const [sharesText, setSharesText] = useState("");

  const queryClient = useQueryClient();
  const batch = useBatch(() => {
    onDone();
    // Refresh every on-chain read on the page: position, previews and values.
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === "readContracts" || q.queryKey[0] === "readContract" });
  });
  const user = batch.address;
  const holder: Address = user ?? DEMO_HOLDER;

  const position = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: POOL, abi: riderPoolAbi, functionName: "balanceOf", args: [holder] },
      { address: POOL, abi: riderPoolAbi, functionName: "redeemRequest", args: [holder] },
      { address: POOL, abi: riderPoolAbi, functionName: "claimableRedeemRequest", args: [0n, holder] },
      { address: POOL, abi: riderPoolAbi, functionName: "maxRedeem", args: [holder] },
      { address: ARC.usdc, abi: erc20Abi, functionName: "balanceOf", args: [holder] },
    ],
    query: { enabled: !!user, refetchInterval: 10_000 },
  });
  const [balance, request, claimable, maxRedeem, wallet] = position.data ?? [];
  const [requested, claimableAt] = request ?? [];

  const values = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: POOL, abi: riderPoolAbi, functionName: "convertToAssets", args: [balance ?? 0n] },
      { address: POOL, abi: riderPoolAbi, functionName: "convertToAssets", args: [requested ?? 0n] },
      { address: POOL, abi: riderPoolAbi, functionName: "convertToAssets", args: [maxRedeem ?? 0n] },
    ],
    query: { enabled: !!position.data, refetchInterval: 10_000 },
  });
  const [value, requestedValue, redeemValue] = values.data ?? [];

  const amount = parseAmount(amountText);
  const exitShares = parseShares(sharesText);

  const sharesOut = useReadContract({
    address: POOL,
    abi: riderPoolAbi,
    functionName: "previewDeposit",
    args: [amount ?? 0n],
    chainId: arc.id,
    query: { enabled: tab === "deposit" && !!amount },
  });
  const exitValue = useReadContract({
    address: POOL,
    abi: riderPoolAbi,
    functionName: "convertToAssets",
    args: [exitShares ?? 0n],
    chainId: arc.id,
    query: { enabled: tab === "request" && !!exitShares },
  });

  const redeemShares = maxRedeem && maxRedeem > 0n ? maxRedeem : (claimable ?? 0n);

  const built = useMemo((): { lines: ReceiptLine[]; blocked?: string } => {
    if (tab === "deposit") {
      if (!amount) return { lines: [], blocked: "Enter an amount to build the batch." };
      const approve = call3(ARC.usdc, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [POOL, amount] }));
      const deposit = call3(POOL, poolCalls.deposit(amount, holder));
      return {
        lines: [
          { fn: "approve", target: "USDC", note: "lets the pool take the deposit", amount: `${usdc(amount)} USDC`, call: approve },
          { fn: "deposit", target: pool.name, note: `${pool.symbol} shares to ${short(holder)}`, amount: `${usdc(amount)} USDC`, call: deposit },
        ],
      };
    }
    if (tab === "request") {
      if (!exitShares) return { lines: [], blocked: "Enter the shares to queue for exit." };
      return {
        lines: [
          {
            fn: "requestRedeem",
            target: pool.name,
            note: `escrow shares, cooldown starts for ${short(holder)}`,
            amount: `${shares(exitShares)} ${pool.symbol}`,
            call: call3(POOL, poolCalls.requestRedeem(exitShares, holder, holder)),
          },
        ],
      };
    }
    if (redeemShares === 0n) {
      return {
        lines: [],
        blocked:
          requested && requested > 0n
            ? `Your request is still cooling down: claimable ${claimableAt ? utc(Number(claimableAt)) : "later"}.`
            : "Nothing to redeem yet. Request an exit first, then wait the cooldown.",
      };
    }
    return {
      lines: [
        {
          fn: "redeem",
          target: pool.name,
          note: `USDC to ${short(holder)}`,
          amount: `${shares(redeemShares)} ${pool.symbol}`,
          call: call3(POOL, poolCalls.redeem(redeemShares, holder, holder)),
        },
      ],
    };
  }, [tab, amount, exitShares, holder, pool.name, pool.symbol, redeemShares, requested, claimableAt]);

  const calls = built.lines.length ? built.lines.map((l) => l.call) : null;
  const sim = useSimulation(calls, tab === "deposit" || user ? holder : undefined);
  const refused = sim.data && !sim.data.ok;

  const totals: [string, string][] =
    tab === "deposit"
      ? [
          ["You pay", amount ? `${usdc(amount)} USDC` : "—"],
          ["Shares out, at today's price", sharesOut.data !== undefined && amount ? `${shares(sharesOut.data)} ${pool.symbol}` : "—"],
        ]
      : tab === "request"
        ? [
            ["Value today", exitValue.data !== undefined && exitShares ? `${usdc(exitValue.data)} USDC` : "—"],
            ["Claimable from", now ? `${utc(now + pool.cooldown)}` : "cooldown after mining"],
          ]
        : [
            ["Shares redeemed", `${shares(redeemShares)} ${pool.symbol}`],
            ["USDC out, at today's price", redeemValue !== undefined ? `${usdc(redeemValue)} USDC` : "—"],
          ];

  const labels: Record<Tab, string> = {
    deposit: "Sign once: approve and deposit",
    request: "Request the exit",
    redeem: "Redeem to USDC",
  };

  const pick = (t: Tab) => {
    setTab(t);
    batch.reset();
  };

  return (
    <section className={`${styles.actions} rv d3`} aria-labelledby="position-title">
      <div className={`panel ${styles.position}`}>
        <div className={styles.positionHead}>
          <h2 id="position-title" className="label">
            Your position
          </h2>
          {user && <span className="mono faint">{short(user)}</span>}
        </div>
        {!user ? (
          <div className={styles.connect}>
            <p className="muted">Connect a wallet to see your shares, your exit request and what you can redeem.</p>
            <Connect />
          </div>
        ) : (
          <dl className="kv">
            <dt>Shares</dt>
            <dd>
              {shares(balance)} {pool.symbol}
            </dd>
            <dt>Value</dt>
            <dd>{usdc(value)} USDC</dd>
            <dt>Exit request</dt>
            <dd>{requested && requested > 0n ? `${shares(requested)} ${pool.symbol} · ${usdc(requestedValue)} USDC` : "none"}</dd>
            {requested !== undefined && requested > 0n && claimableAt !== undefined && (
              <>
                <dt>Claimable at</dt>
                <dd>
                  {utc(Number(claimableAt))}
                  {now && Number(claimableAt) > now ? <span className={styles.sub}>in {until(Number(claimableAt), now)}</span> : null}
                </dd>
              </>
            )}
            <dt>Past cooldown</dt>
            <dd>
              {shares(claimable)} {pool.symbol}
            </dd>
            <dt>Redeemable now</dt>
            <dd>
              {shares(maxRedeem)} {pool.symbol}
            </dd>
            <dt>Wallet</dt>
            <dd>{usdc(wallet)} USDC</dd>
          </dl>
        )}
        {user && claimable !== undefined && maxRedeem !== undefined && claimable > maxRedeem && (
          <p className={styles.warnNote}>
            {pool.frozen
              ? "The pool is frozen, so nothing can be redeemed until the incident settles. Your shares stay escrowed and keep bearing its loss."
              : "Only part of your matured request can leave now: the rest of the pool's capital backs live cover."}
          </p>
        )}
      </div>

      <div className={styles.tabs}>
        <div className="seg" role="group" aria-label="Pool action">
          <button aria-pressed={tab === "deposit"} onClick={() => pick("deposit")}>
            Deposit
          </button>
          <button aria-pressed={tab === "request"} onClick={() => pick("request")}>
            Request exit
          </button>
          <button aria-pressed={tab === "redeem"} onClick={() => pick("redeem")}>
            Redeem
          </button>
        </div>
      </div>

      {tab === "deposit" && (
        <div className={styles.field}>
          <label htmlFor="pool-amount" className="label">
            Deposit
          </label>
          <div className={styles.inputWrap}>
            <input
              id="pool-amount"
              className="input"
              inputMode="decimal"
              autoComplete="off"
              value={amountText}
              onChange={(e) => {
                setAmountText(e.target.value.replace(",", "."));
                batch.reset();
              }}
              aria-invalid={amount === undefined}
            />
            <span className={styles.unit}>USDC</span>
          </div>
          <p className={styles.help}>
            Approve and deposit go through Multicall3From as one transaction. Shares are priced at today&apos;s {pool.symbol} rate;
            unearned premium is not in it.
          </p>
        </div>
      )}

      {tab === "request" && (
        <div className={styles.field}>
          <label htmlFor="pool-shares" className="label">
            Shares to exit
          </label>
          <div className={styles.sharesRow}>
            <div className={styles.inputWrap}>
              <input
                id="pool-shares"
                className="input"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.0"
                value={sharesText}
                onChange={(e) => {
                  setSharesText(e.target.value.replace(",", "."));
                  batch.reset();
                }}
                aria-invalid={sharesText !== "" && exitShares === undefined}
              />
              <span className={styles.unit}>{pool.symbol}</span>
            </div>
            <button
              className="btn ghost small"
              disabled={!balance}
              onClick={() => {
                if (balance) setSharesText(formatUnits(balance, 12));
                batch.reset();
              }}
            >
              All
            </button>
          </div>
          <p className={styles.help}>
            The shares move into escrow now and can be redeemed after the {Math.round(pool.cooldown / 86_400)}-day cooldown. They keep
            bearing losses while they wait. Adding to an open request restarts its cooldown.
          </p>
        </div>
      )}

      {tab === "redeem" && (
        <p className={styles.help}>
          Redeems every share past its cooldown that free capital allows, at today&apos;s price. Closed while the pool is frozen.
        </p>
      )}

      {(tab === "deposit" || user) ? (
        <Receipt
          lines={built.lines}
          sender={holder}
          totals={totals}
          sim={built.blocked ? undefined : sim.data}
          simulating={sim.isFetching}
          simError={sim.isError && !sim.data}
          dryRun={!user}
          blocked={built.blocked}
        >
          <TxAction
            batch={batch}
            calls={built.lines.length}
            label={labels[tab]}
            onSend={() => calls && batch.send(calls)}
            disabled={
              built.blocked
                ? "Nothing to sign yet."
                : refused
                  ? "The contracts would refuse this. Nothing to sign."
                  : !sim.data
                    ? "Waiting for the simulation."
                    : false
            }
            after={<span>Your position above refreshes from the chain.</span>}
          />
        </Receipt>
      ) : (
        <div className={styles.connect}>
          <p className="muted">Exits act on your own shares. Connect a wallet to request or redeem.</p>
        </div>
      )}
    </section>
  );
}
