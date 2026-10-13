import Link from "next/link";
import { explorerAddress } from "@rider/sdk";
import type { ApiMarket } from "@/lib/state";
import { ReadingLine } from "./ReadingLine";
import { bps, dur, formatReading, kindLabel, readsOf, shortAddr, unitOf, usdc, utc } from "./format";
import styles from "./Markets.module.css";

interface Props {
  market: ApiMarket;
  /** Serial number printed on the certificate. */
  index: number;
  /** Chain time of the snapshot, unix seconds. */
  now: number;
}

const STATUS_CHIP: Record<ApiMarket["status"], string> = {
  active: "",
  pending: "warn",
  triggered: "bad",
  settled: "",
};

/** A market as a certificate: the risk, the reading against its line, the terms, the book and the incident record. */
export function MarketCertificate({ market: m, index, now }: Props) {
  const reads = readsOf(m);
  const ok = m.health.ok;
  const firing = ok && m.health.firing;
  const selling = m.status === "active" && ok && !firing && BigInt(m.capacity) > 0n;
  const vault = m.kind === "vault-drawdown";
  const serial = String(index + 1).padStart(2, "0");
  const ribbon = `${m.name.replace(/\s+/g, "").toUpperCase()}·${m.kind.toUpperCase()}·`;

  return (
    <article className={`panel ${styles.cert}`} id={m.address} aria-labelledby={`${m.address}-name`}>
      <header className={styles.certHead}>
        <div className={styles.certTitle}>
          <span className="label">
            No. {serial} · {kindLabel(m.kind)}
          </span>
          <h2 className={styles.certName} id={`${m.address}-name`}>
            {m.name}
          </h2>
        </div>
        <div className={styles.chips}>
          <span className={`chip ${STATUS_CHIP[m.status]}`}>{m.status}</span>
          <span className={`chip ${!ok ? "" : firing ? "bad" : "ok"}`}>{!ok ? "no reading" : firing ? "firing" : "below line"}</span>
        </div>
      </header>

      <p className={styles.reads}>{reads.text}</p>

      <div className="micro" aria-hidden>
        {ribbon.repeat(24)}
      </div>

      <ReadingLine market={m} />

      <div className={styles.columns}>
        <section>
          <h3 className="label">Terms</h3>
          <dl className="kv">
            <dt>Fires at</dt>
            <dd>{bps(m.thresholdBps)} loss</dd>
            <dt>Confirm delay</dt>
            <dd>{dur(m.confirmDelay)}</dd>
            <dt>Claim window</dt>
            <dd>{dur(m.claimWindow)}</dd>
            <dt>Term</dt>
            <dd>
              {dur(m.minDuration)} – {dur(m.maxDuration)}
            </dd>
            <dt>Base APR</dt>
            <dd>{bps(m.baseRateBps)}</dd>
            <dt>Slope</dt>
            <dd>+{bps(m.slopeBps)} at full use</dd>
            <dt>Cover size</dt>
            <dd>
              {usdc(m.minCoverage, 2)} – {usdc(m.maxCoverage, 2)}
            </dd>
          </dl>
        </section>

        <section>
          <h3 className="label">Book</h3>
          <dl className="kv">
            <dt>Cover live</dt>
            <dd>{usdc(m.activeCoverage)}</dd>
            <dt>Room left</dt>
            <dd>{usdc(m.capacity)}</dd>
            <dt>Locked</dt>
            <dd>{usdc(m.lockedCoverage)}</dd>
            <dt>Unearned</dt>
            <dd>{usdc(m.unearnedPremium)}</dd>
            <dt>Ref high</dt>
            <dd>{formatReading(m.kind, BigInt(m.refHigh))}</dd>
            <dt>Generation</dt>
            <dd>{m.generation}</dd>
          </dl>
          <p className={styles.note}>
            USDC. Ref high in {unitOf(m.kind)}: the highest reference seen this generation, and the point losses are measured from.
          </p>
        </section>

        <section>
          <h3 className="label">On Arc</h3>
          <ul className={styles.addrs}>
            {reads.sources.map((s) => (
              <li key={`${s.label}-${s.address}`}>
                <span>{s.label}</span>
                <a className={styles.addr} href={explorerAddress(s.address)} target="_blank" rel="noreferrer">
                  {shortAddr(s.address)} ↗
                </a>
              </li>
            ))}
            <li>
              <span>Trigger</span>
              <a className={styles.addr} href={explorerAddress(m.trigger)} target="_blank" rel="noreferrer">
                {shortAddr(m.trigger)} ↗
              </a>
            </li>
            <li>
              <span>Market</span>
              <a className={styles.addr} href={explorerAddress(m.address)} target="_blank" rel="noreferrer">
                {shortAddr(m.address)} ↗
              </a>
            </li>
            <li>
              <span>Pool</span>
              <a className={styles.addr} href={explorerAddress(m.pool)} target="_blank" rel="noreferrer">
                {shortAddr(m.pool)} ↗
              </a>
            </li>
          </ul>
        </section>
      </div>

      <IncidentRecord market={m} now={now} />

      <footer className={styles.certFoot}>
        <Link className="btn" href={`/protect?market=${m.address}`}>
          {vault ? "Protect a deposit" : "Buy cover"}
        </Link>
        <p className={styles.sales}>
          {selling
            ? `Sales open: up to ${usdc(m.capacity, 2)} USDC of cover, fully backed by free pool capital.`
            : !ok
              ? "Sales closed: no trusted reading."
              : firing
                ? "Sales closed: the trigger is past its line."
                : m.status !== "active"
                  ? `Sales closed while the market is ${m.status}.`
                  : "Sales closed: no free capital left to back new cover."}
        </p>
      </footer>
    </article>
  );
}

function IncidentRecord({ market: m, now }: { market: ApiMarket; now: number }) {
  const inc = m.incident;
  if (!inc.openedAt) {
    return (
      <p className={styles.noIncident}>
        <span className="label">Incident record</span> None. This market has never fired.
      </p>
    );
  }

  const live = m.status === "pending" || m.status === "triggered";
  const dismissed = inc.resolvedAt > 0 && inc.claimDeadline === 0;
  const readyAt = inc.openedAt + m.confirmDelay;
  let headline: string;
  if (m.status === "pending") {
    headline =
      now < readyAt
        ? `Open, waiting for confirmation: can be resolved from ${utc(readyAt)}.`
        : "Open, and the confirmation delay has passed: anyone can resolve it now.";
  } else if (m.status === "triggered") {
    headline =
      now <= inc.claimDeadline
        ? `Confirmed. Claims are paid until ${utc(inc.claimDeadline)}; anyone can push them.`
        : "Confirmed, and the claim window has closed: anyone can settle it.";
  } else if (dismissed) {
    headline = "Dismissed: the reading had recovered by the time it was resolved, so nothing was paid.";
  } else {
    headline = m.status === "settled" ? "Settled: waiting to be rearmed." : "Last incident, settled. The market has been rearmed since.";
  }

  return (
    <section className={`${styles.incident} ${live ? styles.incidentLive : ""}`}>
      <div className={styles.incidentHead}>
        <span className="label">{live ? "Incident open" : "Last incident"}</span>
        <p>{headline}</p>
      </div>
      <dl className={`kv ${styles.incidentKv}`}>
        <dt>Opened</dt>
        <dd>{utc(inc.openedAt)}</dd>
        <dt>Resolved</dt>
        <dd>{inc.resolvedAt ? utc(inc.resolvedAt) : "not yet"}</dd>
        <dt>Claim deadline</dt>
        <dd>{inc.claimDeadline ? utc(inc.claimDeadline) : "—"}</dd>
        <dt>Loss</dt>
        <dd>{bps(inc.lossBps)}</dd>
        <dt>Reading at open</dt>
        <dd>{formatReading(m.kind, BigInt(inc.observedAtOpen))}</dd>
        <dt>Reading priced</dt>
        <dd>{inc.observed !== "0" ? formatReading(m.kind, BigInt(inc.observed)) : "—"}</dd>
        <dt>Exposure</dt>
        <dd>{usdc(inc.exposure)} USDC</dd>
        <dt>Claimed cover</dt>
        <dd>{usdc(inc.claimedCoverage)} USDC</dd>
        <dt>Paid</dt>
        <dd className={inc.paid !== "0" ? "fluo" : undefined}>{usdc(inc.paid)} USDC</dd>
      </dl>
    </section>
  );
}
