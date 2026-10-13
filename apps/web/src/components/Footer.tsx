import Link from "next/link";
import { arcMainnet, explorerAddress } from "@rider/sdk";
import styles from "./Footer.module.css";

const REPO = "https://github.com/RaYYeR220/rider";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className="micro" aria-hidden>
        {"RIDERPOLICYVERIFIEDONARCMAINNET".repeat(20)}
      </div>
      <div className={styles.cols}>
        <div className={styles.brand}>
          <span className={styles.mark}>Rider</span>
          <p className="faint">Parametric cover for USDC deposits on Arc. Paid on proof, not on request.</p>
        </div>
        <div className={styles.col}>
          <span className="label">Protocol</span>
          <a href={explorerAddress(arcMainnet.pool)} target="_blank" rel="noreferrer">Underwriting pool</a>
          <a href={explorerAddress(arcMainnet.factory)} target="_blank" rel="noreferrer">Market factory</a>
          <a href={explorerAddress(arcMainnet.policy)} target="_blank" rel="noreferrer">Policy NFT</a>
          <Link href="/proof">Every transaction</Link>
        </div>
        <div className={styles.col}>
          <span className="label">Build</span>
          <a href={REPO} target="_blank" rel="noreferrer">Source on GitHub</a>
          <Link href="/build">SDK, MCP and keeper</Link>
          <a href="https://docs.arc.io" target="_blank" rel="noreferrer">Arc docs</a>
        </div>
      </div>
      <p className={styles.small}>
        Live on Arc mainnet (chain 5042). Contracts are immutable and verified on Sourcify. Cover is experimental software, not an
        insurance contract.
      </p>
    </footer>
  );
}
