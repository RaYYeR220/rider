import type { Metadata } from "next";
import Link from "next/link";
import { arcMainnet, explorerAddress } from "@rider/sdk";
import { DrillBackdrop } from "@/components/drill/DrillBackdrop";
import { DrillRunner } from "@/components/drill/DrillRunner";
import { find } from "@/lib/proof";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Live drill",
  description:
    "Run Rider's whole claims path on Arc mainnet without a wallet: buy cover, break a vault, open and confirm the incident, and watch the contract pay.",
};

const FIRST_ROUND = [
  "Drill: buy canary cover",
  "Drill: break the canary vault",
  "Drill: open incident",
  "Drill: confirm incident after the delay",
  "Drill: pay the policyholder",
];

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function DrillPage() {
  const outsider = find("Refused: outsider buys cover on the drill market");
  const round = FIRST_ROUND.map((label) => find(label)).filter((e) => e !== undefined);

  return (
    <>
      <DrillBackdrop />
      <main className="page">
        <header className="page-head">
          <span className="label">Live drill · Arc mainnet · no wallet needed</span>
          <h1 className="display">Break a vault on mainnet. Watch the contract pay.</h1>
          <p className="lede">
            One button runs the whole claims path against a vault Rider breaks on purpose: buy cover, push the vault 20% down, open the
            incident, wait out the confirmation delay, confirm it and pay the policyholder. Every step is a mainnet transaction you can
            open.
          </p>
        </header>

        <DrillRunner />

        <section className={styles.honest} aria-labelledby="staged">
          <div className={styles.honestHead}>
            <span className="label">What is staged, and what is not</span>
            <h2 className="h2" id="staged">
              The vault is a prop. The claim path is the real one.
            </h2>
          </div>
          <div className={styles.grid}>
            <div>
              <h3 className="h3">The canary breaks on purpose</h3>
              <p>
                The{" "}
                <a className="link" href={explorerAddress(arcMainnet.canary)} target="_blank" rel="noreferrer">
                  canary vault
                </a>{" "}
                is a vault Rider controls. The drill moves 20% of its USDC out, and its trigger reads the share-price drop exactly as the
                live triggers read a Morpho vault.
              </p>
            </div>
            <div>
              <h3 className="h3">It sells to the drill runner only</h3>
              <p>
                The canary market refuses every other buyer on-chain, so nobody can buy cover on a vault that is about to be broken.
                {outsider && (
                  <>
                    {" "}
                    <a className="link" href={outsider.url} target="_blank" rel="noreferrer">
                      The refusal, mined ↗
                    </a>
                  </>
                )}
              </p>
            </div>
            <div>
              <h3 className="h3">A separate pool pays</h3>
              <p>
                Drill claims come out of the drill pool, fenced off from the{" "}
                <Link className="link" href="/markets">
                  underwriting pool
                </Link>
                . No underwriter&apos;s capital ever pays for a drill, and only Rider&apos;s deployer can fund it.
              </p>
            </div>
            <div>
              <h3 className="h3">Rounds are rate-limited</h3>
              <p>
                A relayer pays the gas in USDC so nobody needs a wallet. New rounds are capped per day and pause if the relayer runs low. A
                round that has started can always finish, so anyone can pick up a half-run one.
              </p>
            </div>
          </div>
          <p className={styles.same}>
            Everything else is production: the same market contract, the same policy NFT and the same claim code as the four live markets.
            Which step comes next is read from chain state, not from a database, so every visitor sees the same drill.
          </p>
        </section>

        {round.length > 0 && (
          <section className={styles.receipts} aria-labelledby="first-round">
            <span className="label" id="first-round">
              The first round, from the proof run
            </span>
            <ol>
              {round.map((e) => (
                <li key={e.hash}>
                  <span>{capitalise(e.label.replace("Drill: ", ""))}</span>
                  <a className="link" href={e.url} target="_blank" rel="noreferrer">
                    {e.hash.slice(0, 10)}…{e.hash.slice(-6)} ↗
                  </a>
                </li>
              ))}
            </ol>
            <Link className="link" href="/proof#drill">
              Every transaction of the proof run
            </Link>
          </section>
        )}
      </main>
    </>
  );
}
