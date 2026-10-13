import type { Metadata } from "next";
import { ProtectDesk } from "@/components/protect/ProtectDesk";

export const metadata: Metadata = {
  title: "Protect a deposit",
  description: "Deposit USDC into an Arc vault and buy parametric cover in the same transaction. Simulated before you sign.",
};

export default async function ProtectPage({ searchParams }: PageProps<"/protect">) {
  const { market } = await searchParams;
  return (
    <main className="page">
      <header className="page-head">
        <span className="label rv d1">Protect a deposit</span>
        <h1 className="display rv d1">Deposit and cover, signed once.</h1>
        <p className="lede rv d2">
          Choose a market, an amount and a term. For a vault, your wallet deposits and buys cover in one transaction. If the trigger
          proves a loss while the policy is live, the contract pays cover × loss to whoever holds the policy.
        </p>
      </header>
      <ProtectDesk initialMarket={typeof market === "string" ? market : undefined} />
    </main>
  );
}
