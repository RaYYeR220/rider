import Link from "next/link";
import { connection } from "next/server";
import { formatBps, formatUsdc, liveMarkets } from "@rider/sdk";
import { Guilloche } from "@/components/Guilloche";
import { Gauge } from "@/components/Gauge";
import { deployment, rider } from "@/lib/server";
import { find, refusals } from "@/lib/proof";
import styles from "./page.module.css";

async function readings() {
  try {
    return await Promise.all(liveMarkets(deployment).map(rider.market));
  } catch {
    return [];
  }
}

function readingText(m: Awaited<ReturnType<typeof readings>>[number]) {
  if (!m.health.ok) return "NO READING";
  if (m.kind === "vault-drawdown") return `${(Number(m.health.observed) / 1e6).toFixed(6)} USDC/SHARE`;
  if (m.kind === "peg") return `${(Number(m.health.observed / 10n ** 12n) / 1e6).toFixed(5)} EURC/EUR`;
  return `${(Number(m.health.observed / 10n ** 14n) / 100).toFixed(1)}% BACKED`;
}

export default async function Home() {
  await connection();
  const markets = await readings();
  const uv = markets
    .map((m) => `${m.name.toUpperCase()} ${readingText(m)}  TRIGGER ${formatBps(m.thresholdBps)}  LOSS ${formatBps(m.health.lossBps)}`)
    .join("   ");
  const payout = find("Drill: pay the policyholder");
  const oneTx = find("Protected deposit");

  return (
    <>
      <Guilloche lamp readings={uv} />

      <section className={styles.hero}>
        <div className="micro rv d1" aria-hidden>
          {"RIDERPOLICYVERIFIEDONARCMAINNET".repeat(12)}
        </div>
        <h1 className={`display ${styles.claim} rv d1`}>
          Deposit with cover. <span>Paid on proof, not on request.</span>
        </h1>
        <p className={`${styles.sub} rv d2`}>
          Choose a vault and a term. If the vault loses value, EURC slips from the euro or cirBTC reserves fall short, the contract
          checks and pays in USDC.
        </p>
        <div className={`${styles.ctas} rv d3`}>
          <Link className="btn" href="/protect">
            Protect a deposit
          </Link>
          <Link className="link" href="/drill">
            Run the live drill
          </Link>
        </div>
        <div className="micro rv d4" aria-hidden>
          {"RIDERPOLICYVERIFIEDONARCMAINNET".repeat(12)}
        </div>
        <p className={`${styles.hint} rv d4`} aria-hidden>
          Move the lamp over the page: the <b>live readings</b> are printed in ink that only shows under UV
        </p>
      </section>

      <main className={styles.body}>
        <section className={styles.how}>
          <span className="label">How a claim is paid</span>
          <h2 className="h2">Nobody files a claim. The chain proves it.</h2>
          <ol className={styles.steps}>
            <li>
              <span className={styles.num}>01</span>
              <h3>Deposit and cover in one transaction</h3>
              <p>
                Your wallet sends four calls through Arc&apos;s Multicall3From: approve, deposit into the vault, approve, buy cover. Each
                call keeps your address as the sender, so no router ever holds your USDC.
              </p>
            </li>
            <li>
              <span className={styles.num}>02</span>
              <h3>The trigger is read on-chain</h3>
              <p>
                The vault&apos;s share price, the Chainlink euro cross-rate or the cirBTC Proof-of-Reserve feed. A loss past the line opens
                an incident; it must still be there after the confirmation delay before it counts.
              </p>
            </li>
            <li>
              <span className={styles.num}>03</span>
              <h3>The contract pays the holder</h3>
              <p>
                Cover × loss since you bought, in USDC, to whoever holds the policy NFT. Anyone can push the payout; the money only ever goes
                to the holder.
              </p>
            </li>
          </ol>
        </section>

        <section className={styles.markets}>
          <div className={styles.sectionHead}>
            <div>
              <span className="label">Four risks, read live from Arc</span>
              <h2 className="h2">Each reading against its printed line.</h2>
            </div>
            <Link className="btn ghost" href="/markets">
              Open the markets
            </Link>
          </div>
          <div className={styles.notes}>
            {markets.map((m) => (
              <article key={m.address} className={`panel ${styles.note}`}>
                <div className={styles.noteHead}>
                  <h3 className="h3">{m.name}</h3>
                  <span className={`chip ${!m.health.ok ? "" : m.health.firing ? "bad" : "ok"}`}>
                    {!m.health.ok ? "no reading" : m.health.firing ? "firing" : "healthy"}
                  </span>
                </div>
                <p className={`mono ${styles.reading}`}>{readingText(m).toLowerCase()}</p>
                <Gauge ok={m.health.ok} lossBps={m.health.lossBps} thresholdBps={m.thresholdBps} />
                <dl className="kv">
                  <dt>Cover live</dt>
                  <dd>{formatUsdc(m.activeCoverage)} USDC</dd>
                  <dt>Room left</dt>
                  <dd>{formatUsdc(m.capacity)} USDC</dd>
                </dl>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.refusals}>
          <div>
            <span className="label">The refusal is the product</span>
            <h2 className="h2">Every &ldquo;no&rdquo; is enforced by code, and every one of these happened on mainnet.</h2>
            <p className="lede">
              Cover beyond the capital that backs it, cover on a vault that is already falling, an underwriter leaving while a claim is
              open: the contracts refuse them, and the refusals are mined transactions you can open.
            </p>
            {payout && oneTx && (
              <div className={styles.proofLinks}>
                <a className="verified" href={oneTx.url} target="_blank" rel="noreferrer">
                  Deposit + cover in one transaction ↗
                </a>
                <a className="verified" href={payout.url} target="_blank" rel="noreferrer">
                  A claim paid by the contract ↗
                </a>
              </div>
            )}
          </div>
          <ul className={styles.refusalList}>
            {refusals.map((r) => (
              <li key={r.hash}>
                <a href={r.url} target="_blank" rel="noreferrer" className="refusal">
                  <span>{r.label.replace("Refused: ", "")}</span>
                  <code>{r.reason}</code>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.arc}>
          <span className="label">What Rider uses Arc for</span>
          <div className={styles.arcGrid}>
            <div>
              <h3 className="h3">USDC is the gas</h3>
              <p className="muted">
                A policy costs a fraction of a cent to buy and to pay out, so a 0.10 USDC policy is worth writing and every claim can be
                pushed to its holder.
              </p>
            </div>
            <div>
              <h3 className="h3">Sender-preserving batches</h3>
              <p className="muted">Multicall3From routes each call through Arc&apos;s CallFrom precompile: deposit and cover land together, custody never moves.</p>
            </div>
            <div>
              <h3 className="h3">Final in half a second</h3>
              <p className="muted">Deterministic finality means an incident&apos;s timestamps cannot be reorganised away; the confirmation window is exact.</p>
            </div>
            <div>
              <h3 className="h3">Circle&apos;s own risks</h3>
              <p className="muted">Earn Kit&apos;s Morpho vaults, EURC against the euro, and cirBTC against its Chainlink Proof-of-Reserve, all native to Arc.</p>
            </div>
          </div>
        </section>

        <section className={styles.close}>
          <h2 className="display">If the vault breaks, the contract pays.</h2>
          <div className={styles.ctas}>
            <Link className="btn" href="/protect">
              Protect a deposit
            </Link>
            <Link className="link" href="/underwrite">
              Underwrite the pool
            </Link>
          </div>
        </section>
      </main>
    </>
  );
}
