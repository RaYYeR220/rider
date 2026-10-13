"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAddress, isAddress, type Address } from "viem";
import { useConnection } from "wagmi";
import { short } from "@/components/Connect";
import { DEMO_HOLDER } from "@/components/tx/useBatch";
import { usdc } from "@/components/tx/format";
import { PolicyCertificate, type ApiPolicy } from "./PolicyCertificate";
import styles from "./policies.module.css";

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

function parseHolder(v: string | undefined): Address | null {
  const t = v?.trim();
  return t && isAddress(t, { strict: false }) ? getAddress(t) : null;
}

export function PolicyLedger({ initialHolder }: { initialHolder?: string }) {
  const { address } = useConnection();
  const queryClient = useQueryClient();
  const [typed, setTyped] = useState<Address | null>(() => parseHolder(initialHolder));
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);

  const holder: Address = typed ?? address ?? DEMO_HOLDER;
  const isDemo = same(holder, DEMO_HOLDER);
  const isMine = same(holder, address);

  const list = useQuery({
    queryKey: ["policies", holder.toLowerCase()],
    queryFn: async (): Promise<ApiPolicy[]> => {
      const res = await fetch(`/api/policies/${holder}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`policies ${res.status}`);
      const body = (await res.json()) as { policies: ApiPolicy[] };
      return body.policies;
    },
    refetchInterval: 30_000,
  });

  const show = (next: Address | null) => {
    setTyped(next);
    setDraft(null);
    setInvalid(false);
    const url = next ? `?holder=${next}` : window.location.pathname;
    window.history.replaceState(null, "", url);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = parseHolder(draft ?? holder);
    if (!next) {
      setInvalid(true);
      return;
    }
    show(next);
  };

  const policies = list.data ?? [];
  const live = policies.filter((p) => p.state === "live").reduce((s, p) => s + BigInt(p.coverage), 0n);
  const paid = policies.reduce((s, p) => s + (p.state === "paid" ? BigInt(p.payout) : 0n), 0n);
  const claimable = policies.filter((p) => p.state === "claimable").length;

  return (
    <div className={styles.ledger}>
      <form className={`${styles.lookup} rv d2`} onSubmit={submit} aria-label="Look up a holder">
        <label htmlFor="holder" className="label">
          Holder address
        </label>
        <div className={styles.lookupRow}>
          <input
            id="holder"
            className="input"
            spellCheck={false}
            autoComplete="off"
            value={draft ?? holder}
            onChange={(e) => {
              setDraft(e.target.value);
              setInvalid(false);
            }}
            aria-invalid={invalid}
            aria-describedby="holder-note"
          />
          <button type="submit" className="btn">
            Show policies
          </button>
        </div>
        <div id="holder-note" className={styles.holderNote}>
          {invalid ? (
            <span className="alarm">That is not an address. Paste a 0x… address of 40 hex characters.</span>
          ) : isDemo ? (
            <>
              <span className="chip">demo holder</span>
              <span>
                This address owns real mainnet policies, bought in the proof run, including one the contract has already paid.
                {address ? "" : " Connect a wallet to see yours."}
              </span>
            </>
          ) : isMine ? (
            <>
              <span className="chip ok">your wallet</span>
              <span>Policies held by the connected address.</span>
            </>
          ) : (
            <span>Policies held by {short(holder)}. Any address can be looked up; the chain is public.</span>
          )}
        </div>
        <div className={styles.switches}>
          {address && !isMine && (
            <button type="button" className={styles.textBtn} onClick={() => show(null)}>
              Show my wallet
            </button>
          )}
          {!isDemo && (
            <button type="button" className={styles.textBtn} onClick={() => show(DEMO_HOLDER)}>
              Show the demo holder
            </button>
          )}
        </div>
      </form>

      {list.isPending ? (
        <div className={styles.grid} aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className={`panel ${styles.skeleton}`}>
              <span className="label">Reading policies from Arc…</span>
            </div>
          ))}
        </div>
      ) : list.isError ? (
        <div className="refusal" role="alert">
          Could not read the policies from Arc right now.{" "}
          <button className="btn ghost small" onClick={() => list.refetch()}>
            Try again
          </button>
        </div>
      ) : policies.length === 0 ? (
        <div className={`panel ${styles.empty}`}>
          <span className="label">No policies</span>
          <h2 className="h3">{short(holder)} holds no Rider policy.</h2>
          <p className="muted">
            A policy is an NFT minted to its holder when cover is bought. It can be bought on its own, or in the same transaction as
            a vault deposit. If you sent one to another address, look that address up instead.
          </p>
          <div className="row">
            <Link className="btn" href="/protect">
              Protect a deposit
            </Link>
            {!isDemo && (
              <button type="button" className={styles.textBtn} onClick={() => show(DEMO_HOLDER)}>
                See the demo holder&apos;s policies
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <dl className={`${styles.summary} rv d3`}>
            <div>
              <dt>Policies</dt>
              <dd>{policies.length}</dd>
            </div>
            <div>
              <dt>Cover live</dt>
              <dd>{usdc(live)} USDC</dd>
            </div>
            <div>
              <dt>Paid by the contract</dt>
              <dd className={paid > 0n ? "fluo" : undefined}>{usdc(paid)} USDC</dd>
            </div>
            <div>
              <dt>Claimable now</dt>
              <dd className={claimable > 0 ? styles.due : undefined}>{claimable}</dd>
            </div>
          </dl>
          <div className={styles.grid}>
            {policies.map((p) => (
              <PolicyCertificate
                key={p.id}
                policy={p}
                onPaid={() => void queryClient.invalidateQueries({ queryKey: ["policies", holder.toLowerCase()] })}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
