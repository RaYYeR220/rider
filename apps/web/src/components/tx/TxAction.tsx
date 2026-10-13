"use client";

import type { ReactNode } from "react";
import { explorerTx } from "@rider/sdk";
import { Connect, short } from "@/components/Connect";
import { RefusalBox } from "./RefusalBox";
import type { useBatch } from "./useBatch";
import styles from "./tx.module.css";

interface Props {
  batch: ReturnType<typeof useBatch>;
  /** Button text. */
  label: string;
  onSend: () => void;
  /** Why the button is disabled, if it is (e.g. the simulation refused). */
  disabled?: string | false;
  /** Links shown inside the verified box once the transaction lands. */
  after?: ReactNode;
  /** Number of sub-calls, for the signing hint. */
  calls?: number;
}

/** The sign button and everything that follows it: wallet prompt, pending, verified or refused. */
export function TxAction({ batch, label, onSend, disabled, after, calls = 1 }: Props) {
  const { phase } = batch;

  if (!batch.connected) {
    return (
      <div className={styles.action}>
        <p className={styles.hint}>Connect a wallet on Arc to sign. Gas is paid in USDC from the same balance.</p>
        <Connect />
      </div>
    );
  }
  if (batch.wrongChain) {
    return (
      <div className={styles.action}>
        <p className={styles.hint}>Your wallet is on another network. Rider runs on Arc mainnet, chain 5042.</p>
        <Connect />
      </div>
    );
  }

  if (phase.step === "done") {
    return (
      <div className={styles.action}>
        <div className={`verified ${styles.done}`} role="status">
          <strong>Verified on Arc.</strong>
          <a href={explorerTx(phase.hash)} target="_blank" rel="noreferrer">
            Transaction {short(phase.hash)} ↗
          </a>
          {after}
        </div>
        <button className="btn ghost small" onClick={batch.reset}>
          Start another
        </button>
      </div>
    );
  }

  return (
    <div className={styles.action}>
      <div className={styles.sendRow}>
        <button className="btn" onClick={onSend} disabled={batch.busy || !!disabled}>
          {phase.step === "checking"
            ? "Simulating…"
            : phase.step === "signing"
              ? "Confirm in wallet…"
              : phase.step === "pending"
                ? "Waiting for Arc…"
                : label}
        </button>
        {disabled && !batch.busy && <span className={styles.why}>{disabled}</span>}
      </div>

      {phase.step === "checking" && <p className={styles.hint}>Simulating once more against the latest block before your wallet opens.</p>}
      {phase.step === "signing" && (
        <p className={styles.status}>
          <span className="chip warn">awaiting signature</span>
          {phase.atomic
            ? `Your wallet batches the ${calls} calls atomically: all land or none do.`
            : calls > 1
              ? `One transaction to Multicall3From carrying ${calls} calls.`
              : "One transaction."}
        </p>
      )}
      {phase.step === "pending" && (
        <p className={styles.status}>
          <span className="chip warn">pending</span>
          {phase.hash ? (
            <a className="link" href={explorerTx(phase.hash)} target="_blank" rel="noreferrer">
              {short(phase.hash)} ↗
            </a>
          ) : (
            "Submitted. Arc finalises in under a second once included."
          )}
        </p>
      )}
      {phase.step === "refused" && (
        <RefusalBox refusal={phase.refusal} stamp="Refused · nothing was signed" />
      )}
      {phase.step === "declined" && <p className={styles.hint}>Signature declined in the wallet. Nothing was sent.</p>}
      {phase.step === "failed" && (
        <div className={`refusal ${styles.refusal}`} role="alert">
          <p className={styles.plain}>{phase.message}</p>
          {phase.hash && (
            <a className={styles.raw} href={explorerTx(phase.hash)} target="_blank" rel="noreferrer">
              {short(phase.hash)} ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
