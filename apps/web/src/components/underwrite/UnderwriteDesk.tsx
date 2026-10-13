"use client";

import { useQueryClient } from "@tanstack/react-query";
import { arc } from "viem/chains";
import { useReadContract } from "wagmi";
import { arcMainnet, explorerAddress, formatDuration, riderPoolAbi } from "@rider/sdk";
import { short } from "@/components/Connect";
import { useArcState } from "@/lib/state";
import { shares, usdc } from "@/components/tx/format";
import { PoolActions } from "./PoolActions";
import styles from "./underwrite.module.css";

const POOL = arcMainnet.pool;

function price(sharePrice: string) {
  return (Number(sharePrice) / 1e6).toFixed(6);
}

export function UnderwriteDesk() {
  const state = useArcState();
  const queryClient = useQueryClient();
  const delay = useReadContract({ address: POOL, abi: riderPoolAbi, functionName: "marketDelay", chainId: arc.id });
  const pool = state.data?.pool;

  if (state.isPending) {
    return (
      <div className={`panel ${styles.loading}`}>
        <span className="label">Reading the pool from Arc…</span>
      </div>
    );
  }
  if (!pool) {
    return (
      <div className="refusal" role="alert">
        Could not read the pool from Arc right now.{" "}
        <button className="btn ghost small" onClick={() => state.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const total = BigInt(pool.totalAssets);
  const locked = BigInt(pool.lockedAssets);
  const free = BigInt(pool.freeAssets);
  const lockedPct = total > 0n ? Number((locked * 10_000n) / total) / 100 : 0;
  const unearned = BigInt(pool.cash) > total ? BigInt(pool.cash) - total : 0n;
  const cooldown = pool.cooldown;
  const notice = delay.data !== undefined ? Number(delay.data) : undefined;

  return (
    <div className={styles.desk}>
      <section className={`panel ${styles.ledger} rv d2`} aria-labelledby="pool-title">
        <div className={styles.ledgerHead}>
          <div>
            <span className="label">{pool.symbol} · the underwriting pool</span>
            <h2 id="pool-title" className="h3">
              {pool.name}
            </h2>
          </div>
          <span className={`chip ${pool.frozen ? "bad" : "ok"}`}>{pool.frozen ? "frozen" : "open"}</span>
        </div>

        <div className={styles.figures}>
          <div>
            <span className="label">Total assets</span>
            <strong className="mono">{usdc(total)}</strong>
            <span className="faint">USDC, earned premium included</span>
          </div>
          <div>
            <span className="label">Backing live cover</span>
            <strong className="mono">{usdc(locked)}</strong>
            <span className="faint">USDC locked</span>
          </div>
          <div>
            <span className="label">Free</span>
            <strong className="mono">{usdc(free)}</strong>
            <span className="faint">USDC for new cover or exits</span>
          </div>
          <div>
            <span className="label">Share price</span>
            <strong className="mono">{price(pool.sharePrice)}</strong>
            <span className="faint">USDC per {pool.symbol}</span>
          </div>
        </div>

        <div className={styles.bar} role="img" aria-label={`${lockedPct}% of the pool backs live cover`}>
          <span className={styles.barLocked} style={{ width: `${lockedPct}%` }} />
          <span className={styles.barLabels}>
            <span>locked {lockedPct.toFixed(1)}%</span>
            <span>free {(100 - lockedPct).toFixed(1)}%</span>
          </span>
        </div>

        <p className={pool.frozen ? styles.frozenNote : styles.openNote}>
          {pool.frozen
            ? "Frozen: a trigger is firing or an incident is open. Deposits and redemptions are closed until it settles, so nobody enters or leaves ahead of a loss. Exit requests can still be queued."
            : "Open. The pool freezes on its own when any trigger fires or an incident is open, and reopens once the incident settles. While frozen, nobody can deposit or redeem ahead of a loss."}
        </p>

        <dl className={`kv ${styles.terms}`}>
          <dt>Exit cooldown</dt>
          <dd>{formatDuration(cooldown)}</dd>
          <dt>New-market notice</dt>
          <dd>{notice !== undefined ? formatDuration(notice) : "—"}</dd>
          <dt>Unearned premium</dt>
          <dd>{usdc(unearned)} USDC</dd>
          <dt>Shares outstanding</dt>
          <dd>{shares(BigInt(pool.totalSupply))}</dd>
          <dt>Markets backed</dt>
          <dd>{pool.markets.length}</dd>
          <dt>Contract</dt>
          <dd>
            <a className="link" href={explorerAddress(pool.address)} target="_blank" rel="noreferrer">
              {short(pool.address)} ↗
            </a>
          </dd>
        </dl>
      </section>

      <div className="split">
        <PoolActions
          pool={pool}
          now={state.data?.timestamp}
          onDone={() => void queryClient.invalidateQueries({ queryKey: ["arc-state"] })}
        />

        <section className={`${styles.rules} rv d3`} aria-labelledby="rules-title">
          <span className="label">How the pool behaves</span>
          <h2 id="rules-title" className="h3">
            Written into the contract, not a policy document.
          </h2>
          <ol>
            <li>
              <h3>Fully collateralised</h3>
              <p>
                Markets sell cover only out of free capital. Every policy is backed in full, even if all {pool.markets.length}{" "}
                triggers fire at once.
              </p>
            </li>
            <li>
              <h3>Premiums vest linearly</h3>
              <p>
                A premium is earned evenly across its policy&apos;s term, and only the earned part counts in the share price. A deposit
                made just before a large sale cannot skim it.
              </p>
            </li>
            <li>
              <h3>Exits are asynchronous</h3>
              <p>
                ERC-7540: request an exit, wait the {formatDuration(cooldown)} cooldown, then redeem at that day&apos;s price. Adding to
                a request restarts its cooldown.
              </p>
            </li>
            <li>
              <h3>Waiting shares still bear losses</h3>
              <p>
                Shares in a request are escrowed by the pool and keep paying claims until redeemed. Nobody steps out from under a loss
                they can see coming.
              </p>
            </li>
            <li>
              <h3>New risks give notice</h3>
              <p>
                A market added after you joined cannot sell for {notice !== undefined ? formatDuration(notice) : "its notice period"},
                longer than the cooldown, so you can leave before it writes a policy.
              </p>
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}
