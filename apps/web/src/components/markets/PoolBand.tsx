import { explorerAddress } from "@rider/sdk";
import type { ApiMarket, ApiPool } from "@/lib/state";
import { dur, freezeReasons, lockedShare, sharePrice, shortAddr, usdc } from "./format";
import styles from "./Markets.module.css";

interface Props {
  pool: ApiPool;
  /** The markets this pool backs, used to say why exits are closed. */
  markets: ApiMarket[];
  /** Short line under the title. */
  role?: string;
}

/** One pool as a ledger band: what it holds, what is locked behind live cover, and whether exits are open. */
export function PoolBand({ pool, markets, role }: Props) {
  const share = lockedShare(pool);
  const reasons = freezeReasons(markets);

  return (
    <section className={`panel ${styles.band}`} aria-label={pool.name}>
      <div className={styles.bandHead}>
        <div className={styles.bandTitle}>
          <span className="label">
            {pool.symbol} ·{" "}
            <a className={styles.addr} href={explorerAddress(pool.address)} target="_blank" rel="noreferrer">
              {shortAddr(pool.address)} ↗
            </a>
          </span>
          <h2 className="h3">{pool.name}</h2>
          {role && <p className={styles.bandRole}>{role}</p>}
        </div>
        <span className={`chip ${pool.frozen ? "warn" : ""}`}>{pool.frozen ? "exits frozen" : "exits open"}</span>
      </div>

      <dl className={styles.figures}>
        <div>
          <dt className="label">Total</dt>
          <dd>
            {usdc(pool.totalAssets)} <small>USDC</small>
          </dd>
        </div>
        <div>
          <dt className="label">Locked</dt>
          <dd>
            {usdc(pool.lockedAssets)} <small>USDC</small>
          </dd>
        </div>
        <div>
          <dt className="label">Free</dt>
          <dd>
            {usdc(pool.freeAssets)} <small>USDC</small>
          </dd>
        </div>
        <div>
          <dt className="label">Share price</dt>
          <dd>
            {sharePrice(pool)} <small>USDC</small>
          </dd>
        </div>
      </dl>

      <div className={styles.bar} role="img" aria-label={`${Math.round(share * 100)}% of the pool backs live cover`}>
        <span className={styles.barLocked} style={{ width: `${share * 100}%` }} />
      </div>
      <div className={styles.barLegend}>
        <span>
          <i className={styles.keyLocked} /> {Math.round(share * 100)}% locked behind live cover
        </span>
        <span>
          <i className={styles.keyFree} /> {Math.round((1 - share) * 100)}% free to back new cover or leave
        </span>
      </div>

      <p className={styles.why}>
        {pool.frozen ? (
          <>
            <b className={styles.amber}>Exits and deposits are closed.</b>{" "}
            {reasons.length ? `${reasons.join("; ")}.` : "A market reports a loss."} They reopen once every market is back to normal, so
            nobody can leave ahead of a loss.
          </>
        ) : (
          <>
            Exits are open with a {dur(pool.cooldown)} cooldown. They close the moment any market fires, has an incident pending or has a
            claim window open, so nobody can leave ahead of a loss.
          </>
        )}
      </p>
    </section>
  );
}
