import styles from "./Gauge.module.css";

interface Props {
  ok: boolean;
  lossBps: number;
  thresholdBps: number;
  /** Shrink to a single line for dense lists. */
  compact?: boolean;
}

/**
 * The reading against its printed trigger line. The scale runs to twice the threshold, so the
 * threshold always sits at the centre and a reading past it is unmistakable.
 */
export function Gauge({ ok, lossBps, thresholdBps, compact = false }: Props) {
  const max = Math.max(thresholdBps * 2, lossBps * 1.1, 1);
  const pos = Math.min(100, (lossBps / max) * 100);
  const firing = ok && lossBps >= thresholdBps;
  const ticks = Array.from({ length: 21 }, (_, i) => i * 5);
  const state = !ok ? styles.unavailable : firing ? styles.firing : styles.healthy;

  return (
    <div className={`${styles.gauge} ${state} ${compact ? styles.compact : ""}`}>
      <div className={styles.track} role="img" aria-label={ok ? `loss ${(lossBps / 100).toFixed(2)}%, fires at ${(thresholdBps / 100).toFixed(2)}%` : "reading unavailable"}>
        {ticks.map((t) => (
          <span key={t} className={styles.tick} style={{ left: `${t}%` }} data-major={t % 25 === 0 || undefined} />
        ))}
        {ok && <span className={styles.fill} style={{ width: `${pos}%` }} />}
        <span className={styles.threshold} style={{ left: "50%" }}>
          {!compact && <em>fires at {(thresholdBps / 100).toFixed(2)}%</em>}
        </span>
        {ok && <span className={styles.needle} style={{ left: `${pos}%` }} />}
      </div>
      {!compact && (
        <div className={styles.legend}>
          <span>0%</span>
          <span className={styles.reading}>
            {ok ? `loss ${(lossBps / 100).toFixed(2)}%` : "no trusted reading: sales and incidents closed"}
          </span>
          <span>{(max / 100).toFixed(2)}%</span>
        </div>
      )}
    </div>
  );
}
