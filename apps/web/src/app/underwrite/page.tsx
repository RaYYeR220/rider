import type { Metadata } from "next";
import { UnderwriteDesk } from "@/components/underwrite/UnderwriteDesk";

export const metadata: Metadata = {
  title: "Underwrite",
  description: "Back Rider's cover with USDC. A fully collateralised pool with linearly vesting premiums and ERC-7540 asynchronous exits.",
};

export default function UnderwritePage() {
  return (
    <main className="page">
      <header className="page-head">
        <span className="label rv d1">Underwrite the pool</span>
        <h1 className="display rv d1">Back the cover. Earn the premium.</h1>
        <p className="lede rv d2">
          One pool of USDC stands behind every Rider market. Premiums flow in as policies run; claims are paid out of it when a
          trigger proves a loss. Deposit in one transaction, leave in two steps.
        </p>
      </header>
      <UnderwriteDesk />
    </main>
  );
}
