import type { Metadata } from "next";
import { MarketsBoard } from "@/components/markets/MarketsBoard";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Markets",
  description:
    "Rider's live cover markets on Arc: each trigger's reading against its printed line, the terms, the book and the pool behind it.",
};

export default function MarketsPage() {
  return (
    <main className="page">
      <header className="page-head">
        <span className="label">Markets · read live from Arc mainnet</span>
        <h1 className="display">Four risks, each held to a printed line.</h1>
        <p className="lede">
          Every market reads one value on-chain. Above the line it sells cover. Past the line it refuses new cover, and once the loss has
          held through the confirmation delay it pays every policy in USDC. The contract enforces each number on this page.
        </p>
      </header>
      <div className={styles.body}>
        <MarketsBoard />
      </div>
    </main>
  );
}
