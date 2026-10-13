"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { arc } from "viem/chains";
import { useReadContract } from "wagmi";
import { ARC, arcMainnet, explorerAddress, formatDuration, riderPolicyAbi } from "@rider/sdk";
import { short } from "@/components/Connect";
import { usdc, utc } from "@/components/tx/format";
import { PushPayout } from "./PushPayout";
import styles from "./policies.module.css";

/** A policy as served by /api/policies/[holder]: every bigint arrives as a decimal string. */
export interface ApiPolicy {
  id: string;
  market: Address;
  marketName: string;
  kind: string;
  holder: Address;
  coverage: string;
  premium: string;
  start: number;
  end: number;
  generation: string;
  claimed: boolean;
  ref: string;
  state: "live" | "expired" | "claimable" | "paid" | "retired";
  payout: string;
}

interface Metadata {
  name?: string;
  description?: string;
  image?: string;
}

/** Decode the policy NFT's data: URI into its JSON metadata. */
function decodeTokenUri(uri: string | undefined): Metadata | null {
  if (!uri) return null;
  try {
    const comma = uri.indexOf(",");
    const head = uri.slice(0, comma);
    const body = uri.slice(comma + 1);
    const json = head.endsWith(";base64")
      ? new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)))
      : decodeURIComponent(body);
    return JSON.parse(json) as Metadata;
  } catch {
    return null;
  }
}

const CHIP: Record<ApiPolicy["state"], { cls: string; word: string }> = {
  live: { cls: "ok", word: "live" },
  claimable: { cls: "warn", word: "claimable" },
  paid: { cls: "ok", word: "paid" },
  expired: { cls: "", word: "expired" },
  retired: { cls: "", word: "retired" },
};

const TRIGGER: Record<string, string> = {
  "vault-drawdown": "vault drawdown",
  peg: "peg to the euro",
  reserve: "reserve backing",
};

export function PolicyCertificate({ policy: p, onPaid }: { policy: ApiPolicy; onPaid: () => void }) {
  const uri = useReadContract({
    address: arcMainnet.policy,
    abi: riderPolicyAbi,
    functionName: "tokenURI",
    args: [BigInt(p.id)],
    chainId: arc.id,
    query: { staleTime: 60_000 },
  });
  const meta = useMemo(() => decodeTokenUri(uri.data), [uri.data]);
  const chip = CHIP[p.state] ?? CHIP.live;
  const drill = p.market.toLowerCase() === arcMainnet.canaryMarket.toLowerCase();

  return (
    <article className={`panel ${styles.cert}`} aria-labelledby={`policy-${p.id}`}>
      <header className={styles.certHead}>
        <div>
          <span className="label">Policy No. {p.id}</span>
          <h2 id={`policy-${p.id}`} className={styles.certTitle}>
            {p.marketName}
          </h2>
        </div>
        <span className={`chip ${chip.cls}`}>{chip.word}</span>
      </header>

      <div className={styles.art}>
        {meta?.image ? (
          // The artwork is an SVG data URI rendered by the policy contract itself.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={meta.image} alt={`${meta.name ?? `Rider Policy #${p.id}`}: on-chain certificate`} width={600} height={380} />
        ) : (
          <span className={styles.artWait}>{uri.isError ? "tokenURI could not be read" : "Reading tokenURI from Arc…"}</span>
        )}
      </div>

      <dl className={`kv ${styles.certKv}`}>
        <dt>Cover</dt>
        <dd>{usdc(p.coverage)} USDC</dd>
        <dt>Premium</dt>
        <dd>{usdc(p.premium)} USDC</dd>
        <dt>Trigger</dt>
        <dd>{TRIGGER[p.kind] ?? p.kind}</dd>
        <dt>Term</dt>
        <dd>{formatDuration(Math.max(0, p.end - p.start))}</dd>
        <dt>Bought</dt>
        <dd>{utc(p.start)}</dd>
        <dt>{p.state === "live" ? "Expires" : "Expiry"}</dt>
        <dd>{utc(p.end)}</dd>
        <dt>Holder</dt>
        <dd>{short(p.holder)}</dd>
      </dl>

      {p.state === "paid" ? (
        <div className={`verified ${styles.payout}`}>
          <span>Paid by the contract</span>
          <strong>{usdc(p.payout)} USDC</strong>
        </div>
      ) : p.state === "claimable" ? (
        <PushPayout policy={p} onPaid={onPaid} />
      ) : (
        <p className={styles.payNote}>
          {p.state === "live"
            ? "Pays cover × loss since purchase if the trigger proves a loss before expiry."
            : p.state === "expired"
              ? "Ran its term without a proven loss. Nothing is owed."
              : "Retired with its round after settlement."}
        </p>
      )}

      {drill && (
        <p className={styles.drill}>
          Drill market: its vault is broken on purpose, so the payout path can be proved on mainnet.
        </p>
      )}

      <footer className={styles.certFoot}>
        <a href={`${ARC.explorer}/token/${arcMainnet.policy}/instance/${p.id}`} target="_blank" rel="noreferrer">
          NFT on the explorer ↗
        </a>
        <a href={explorerAddress(p.market)} target="_blank" rel="noreferrer">
          Market contract ↗
        </a>
      </footer>
    </article>
  );
}
