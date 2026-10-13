"use client";

import { useArcState } from "@/lib/state";
import { MarketCertificate } from "./MarketCertificate";
import { PoolBand } from "./PoolBand";
import { utc } from "./format";
import styles from "./Markets.module.css";

/** Live markets and the pool behind them, read from Arc every few seconds. */
export function MarketsBoard() {
  const { data, error, isPending, isFetching } = useArcState();

  if (isPending) {
    return (
      <div className={styles.loading} aria-busy="true">
        <div className={`panel ${styles.skeleton}`}>
          <span className="label">Reading Arc…</span>
        </div>
        <div className={`panel ${styles.skeleton} ${styles.skeletonTall}`} />
      </div>
    );
  }

  if (!data) {
    return (
      <p className="refusal" role="alert">
        Arc could not be read just now ({error?.message ?? "no response"}). Trying again every few seconds.
      </p>
    );
  }

  return (
    <div className={styles.board}>
      <p className={styles.live} aria-live="polite">
        <span className={`${styles.dot} ${isFetching ? styles.dotBusy : ""}`} aria-hidden />
        Block {Number(data.block).toLocaleString("en-US")} · {utc(data.timestamp)} · read every 6 s
        {error && <span className="alarm"> · last refresh failed, showing the block above</span>}
      </p>

      <PoolBand
        pool={data.pool}
        markets={data.markets}
        role="Backs all four markets. Every unit of cover sold is locked against a unit of this capital."
      />

      <div className={styles.list}>
        {data.markets.map((m, i) => (
          <MarketCertificate key={m.address} market={m} index={i} now={data.timestamp} />
        ))}
      </div>
    </div>
  );
}
