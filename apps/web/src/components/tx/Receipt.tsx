"use client";

import type { ReactNode } from "react";
import type { Address } from "viem";
import { ARC, type Call3 } from "@rider/sdk";
import { short } from "@/components/Connect";
import { RefusalBox } from "./RefusalBox";
import type { Simulation } from "./useBatch";
import styles from "./tx.module.css";

export interface ReceiptLine {
  /** Function called, e.g. "approve". */
  fn: string;
  /** Contract called, in words. */
  target: string;
  /** What the call does, in a few words. */
  note: string;
  /** Amount column, already formatted. */
  amount?: string;
  call: Call3;
}

interface Props {
  lines: ReceiptLine[];
  /** The address that will be msg.sender for every call. */
  sender: Address | undefined;
  /** Totals printed under the lines, as [label, value]. */
  totals: [string, string][];
  sim: Simulation | undefined;
  simulating: boolean;
  simError: boolean;
  /** True when simulating as the demo holder because no wallet is connected. */
  dryRun: boolean;
  /** Shown instead of a simulation when the batch cannot be built yet. */
  blocked?: string;
  children?: ReactNode;
}

const num = (i: number) => String(i + 1).padStart(2, "0");

/** The batch printed as a receipt, with the pre-flight simulation stamped underneath. */
export function Receipt({ lines, sender, totals, sim, simulating, simError, dryRun, blocked, children }: Props) {
  const refusedAt = sim && !sim.ok ? sim.index : null;
  const via = lines.length > 1;
  return (
    <section className={styles.receipt} aria-label="Transaction preview">
      <header className={styles.receiptHead}>
        <span className="label">Receipt preview</span>
        <span className="label">
          {lines.length} call{lines.length === 1 ? "" : "s"} · 1 transaction
        </span>
      </header>
      <p className={styles.route}>
        {via ? (
          <>
            To Multicall3From <span className="mono">{short(ARC.multicall3From)}</span>. Each call keeps{" "}
            <span className="mono">{sender ? short(sender) : "your address"}</span> as msg.sender; no router holds the USDC.
          </>
        ) : (
          <>
            Straight to <span className="mono">{lines[0] ? short(lines[0].call.target) : ""}</span>, sent by{" "}
            <span className="mono">{sender ? short(sender) : "your address"}</span>.
          </>
        )}
      </p>
      <ol className={styles.lines}>
        {lines.map((l, i) => (
          <li key={i} className={refusedAt === i ? styles.lineRefused : undefined}>
            <span className={styles.n}>{num(i)}</span>
            <span className={styles.fn}>{l.fn}</span>
            <span className={styles.target}>
              {l.target}
              <small>
                {l.note} · <span className="mono">{short(l.call.target)}</span> · {l.call.callData.slice(0, 10)}
              </small>
            </span>
            <span className={styles.amount}>{refusedAt === i ? "refused" : (l.amount ?? "")}</span>
          </li>
        ))}
      </ol>
      <dl className={styles.totals}>
        {totals.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>

      <div className={styles.preflight}>
        <span className="label">Pre-flight</span>
        {blocked ? (
          <p className="faint">{blocked}</p>
        ) : simError ? (
          <p className="faint">Could not reach Arc to simulate. Retrying.</p>
        ) : !sim || (simulating && !sim) ? (
          <p className="faint">Simulating against Arc…</p>
        ) : sim.ok ? (
          <p className={styles.pass}>
            <span className="chip ok">would pass</span>
            <span>
              Simulated{sim.block ? ` at block ${sim.block.toLocaleString("en-US")}` : ""}
              {simulating ? ", checking again…" : "."} The contracts accept every call.
            </span>
          </p>
        ) : (
          <RefusalBox
            refusal={sim.refusal}
            where={sim.index !== null && lines[sim.index] ? `Call ${num(sim.index)} · ${lines[sim.index].fn}` : undefined}
          />
        )}
        {dryRun && !blocked && (
          <p className={styles.dry}>
            No wallet connected: simulated as the demo holder <span className="mono">{short(sender ?? "")}</span>. Connect to
            simulate as yourself.
          </p>
        )}
      </div>
      {children}
    </section>
  );
}
