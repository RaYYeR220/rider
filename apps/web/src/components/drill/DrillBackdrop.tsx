"use client";

import { Guilloche } from "@/components/Guilloche";
import { bps, formatReading, lineOf } from "@/components/markets/format";
import { describeReading, useArcState } from "@/lib/state";

/**
 * The security-print background of the drill, with the canary's live reading printed in UV ink.
 * Rendered outside <main> so it stays behind the page's stacking context, as on the landing page.
 */
export function DrillBackdrop() {
  const { data } = useArcState();
  const c = data?.canary;
  // Only values that change with the drill go in, so the print is redrawn when the canary moves, not on every poll.
  const readings = c
    ? `CANARY ${describeReading(c).value} USDC/SHARE  LINE ${formatReading(c.kind, lineOf(c))}  TRIGGER ${bps(c.thresholdBps)}  LOSS ${bps(c.health.lossBps)}  ${c.status.toUpperCase()}`
    : "CANARY DRILL VAULT  TRIGGER 5.00%";
  return <Guilloche lamp readings={readings} />;
}
