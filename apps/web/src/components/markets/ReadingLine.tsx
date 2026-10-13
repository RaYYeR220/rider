import { Gauge } from "@/components/Gauge";
import { describeReading, type ApiMarket } from "@/lib/state";
import { bps, formatReading, lineOf } from "./format";
import styles from "./ReadingLine.module.css";

interface Props {
  market: ApiMarket;
  /** "large" for a market certificate, "medium" for a side panel. */
  size?: "large" | "medium";
}

/**
 * The reading against its printed line: the live value on the left, the value at which the market
 * fires on the right, and the gauge between them. This is what the contract enforces.
 */
export function ReadingLine({ market: m, size = "large" }: Props) {
  const reading = describeReading(m);
  const line = formatReading(m.kind, lineOf(m));
  const ref = formatReading(m.kind, BigInt(m.refHigh));
  const ok = m.health.ok;
  const firing = ok && m.health.firing;
  const headroom = m.thresholdBps - m.health.lossBps;
  const state = !ok ? "unavailable" : firing ? "firing" : "healthy";

  return (
    <div className={`${styles.root} ${styles[size]}`} data-state={state}>
      <div className={styles.pair}>
        <div className={styles.side}>
          <span className="label">Reading now</span>
          <span className={styles.value}>{reading.value}</span>
          <span className={styles.unit}>{reading.unit}</span>
        </div>
        <div className={styles.vs} aria-hidden>
          <span>vs</span>
        </div>
        <div className={`${styles.side} ${styles.line}`}>
          <span className="label">Printed line</span>
          <span className={styles.value}>{line}</span>
          <span className={styles.unit}>
            {bps(m.thresholdBps)} below the reference high of {ref}
          </span>
        </div>
      </div>
      <Gauge ok={ok} lossBps={m.health.lossBps} thresholdBps={m.thresholdBps} />
      <p className={styles.verdict}>
        {!ok
          ? "No trusted reading. The market neither sells nor opens incidents until the data is fresh again."
          : firing
            ? `Past the line by ${bps(m.health.lossBps - m.thresholdBps)}. New cover is refused; anyone can open an incident.`
            : `${bps(headroom)} of headroom before it fires. Cover is sold only while the reading stays above the line.`}
      </p>
    </div>
  );
}
