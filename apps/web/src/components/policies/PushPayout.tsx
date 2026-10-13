"use client";

import { useMemo } from "react";
import { marketCalls } from "@rider/sdk";
import { short } from "@/components/Connect";
import { RefusalBox } from "@/components/tx/RefusalBox";
import { TxAction } from "@/components/tx/TxAction";
import { DEMO_HOLDER, call3, useBatch, useSimulation } from "@/components/tx/useBatch";
import { usdc } from "@/components/tx/format";
import type { ApiPolicy } from "./PolicyCertificate";
import styles from "./policies.module.css";

/** Anyone may push a claimable payout; the USDC goes to the policy's holder, never to the caller. */
export function PushPayout({ policy: p, onPaid }: { policy: ApiPolicy; onPaid: () => void }) {
  const batch = useBatch(onPaid);
  const calls = useMemo(() => [call3(p.market, marketCalls.claim(BigInt(p.id)))], [p.market, p.id]);
  const caller = batch.address ?? DEMO_HOLDER;
  const sim = useSimulation(calls, caller);
  const refused = sim.data && !sim.data.ok;

  return (
    <div className={styles.push}>
      <div className={styles.dueBox}>
        <span className="label">Due to the holder</span>
        <strong className="mono">{usdc(p.payout)} USDC</strong>
      </div>
      <p className={styles.payNote}>
        The incident is confirmed. Anyone can push this payout; the contract sends it to {short(p.holder)}, whoever presses the
        button.
      </p>
      {sim.data && !sim.data.ok ? (
        <RefusalBox refusal={sim.data.refusal} where="claim" />
      ) : sim.data?.ok ? (
        <p className={styles.preflight}>
          <span className="chip ok">would pass</span>
          Simulated{batch.connected ? "" : " as the demo holder"}: the contract accepts the claim.
        </p>
      ) : (
        <p className={styles.preflight}>Simulating the claim against Arc…</p>
      )}
      <TxAction
        batch={batch}
        label="Push payout"
        onSend={() => batch.send(calls)}
        disabled={refused ? "The contract would refuse this claim." : !sim.data ? "Waiting for the simulation." : false}
        after={<span>The USDC is in the holder&apos;s wallet.</span>}
      />
    </div>
  );
}
