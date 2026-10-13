import type { Metadata } from "next";
import { PolicyLedger } from "@/components/policies/PolicyLedger";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Policies",
  description: "Rider policies are NFTs drawn on-chain. See any holder's certificates, their terms and what has been paid.",
};

export default async function PoliciesPage({ searchParams }: PageProps<"/policies">) {
  const { holder } = await searchParams;
  return (
    <main className="page">
      <header className="page-head">
        <span className="label rv d1">Policies</span>
        <h1 className="display rv d1">
          Certificates, drawn <span className={styles.nowrap}>on-chain.</span>
        </h1>
        <p className="lede rv d2">
          Every policy is an NFT whose artwork the contract renders itself. Whoever holds it is paid when the trigger proves a loss,
          and anyone can push that payment; the USDC only ever goes to the holder.
        </p>
      </header>
      <PolicyLedger initialHolder={typeof holder === "string" ? holder : undefined} />
    </main>
  );
}
