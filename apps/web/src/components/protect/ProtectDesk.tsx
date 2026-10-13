"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { erc20Abi, type Address } from "viem";
import { arc } from "viem/chains";
import { useReadContract } from "wagmi";
import { ARC, arcMainnet, coverCalls, formatBps, formatDuration, protectCalls, riderMarketAbi } from "@rider/sdk";
import { Gauge } from "@/components/Gauge";
import { short } from "@/components/Connect";
import { describeReading, useArcState, type ApiMarket } from "@/lib/state";
import { Receipt, type ReceiptLine } from "@/components/tx/Receipt";
import { TxAction } from "@/components/tx/TxAction";
import { DEMO_HOLDER, useBatch, useSimulation } from "@/components/tx/useBatch";
import { parseAmount, usdc, utc } from "@/components/tx/format";
import styles from "./protect.module.css";

const DAY = 86_400;
const PRESETS = [7, 30, 60, 90];
const SLUGS: Record<string, Address> = {
  galaxy: arcMainnet.galaxyMarket,
  keyrock: arcMainnet.keyrockMarket,
  eurc: arcMainnet.eurcMarket,
  cirbtc: arcMainnet.cirbtcMarket,
};

const same = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The ERC-4626 vault a market watches, when it is one of the Arc vaults Rider can deposit into. */
function vaultOf(m: ApiMarket | undefined): Address | undefined {
  if (!m || m.kind !== "vault-drawdown") return undefined;
  return Object.values(ARC.vaults).find((v) => same(v, m.subject));
}

function stateChip(m: ApiMarket) {
  if (!m.health.ok) return { cls: "", word: "no reading" };
  if (m.health.firing) return { cls: "bad", word: "firing" };
  if (m.status !== "active") return { cls: "warn", word: m.status };
  return { cls: "ok", word: "healthy" };
}

const TRIGGER: Record<string, string> = {
  "vault-drawdown": "Share price drawdown from its recent high",
  peg: "EURC against the euro, Chainlink cross-rate",
  reserve: "cirBTC supply against Chainlink Proof-of-Reserve",
};

export function ProtectDesk({ initialMarket }: { initialMarket?: string }) {
  const state = useArcState();
  const queryClient = useQueryClient();
  const markets = state.data?.markets ?? [];
  const pool = state.data?.pool;

  const [picked, setPicked] = useState<string | undefined>(() => {
    if (!initialMarket) return undefined;
    return SLUGS[initialMarket.toLowerCase()] ?? initialMarket;
  });
  const market = markets.find((m) => same(m.address, picked)) ?? markets[0];
  const vault = vaultOf(market);

  const [amountText, setAmountText] = useState("0.10");
  const [daysText, setDaysText] = useState("30");

  const amount = parseAmount(amountText);
  const minDays = market ? Math.max(1, Math.ceil(market.minDuration / DAY)) : 1;
  const maxDays = market ? Math.floor(market.maxDuration / DAY) : 90;
  const daysNum = /^\d+$/.test(daysText) ? Number(daysText) : NaN;
  const termOk = Number.isInteger(daysNum) && daysNum >= minDays && daysNum <= maxDays;
  const duration = BigInt(termOk ? daysNum * DAY : 0);

  const batch = useBatch(() => {
    void queryClient.invalidateQueries({ queryKey: ["arc-state"] });
  });
  const holder: Address = batch.address ?? DEMO_HOLDER;

  const quote = useReadContract({
    address: market?.address,
    abi: riderMarketAbi,
    functionName: "quote",
    args: [amount ?? 0n, duration],
    chainId: arc.id,
    query: {
      enabled: !!market && !!amount && amount > 0n && termOk,
      refetchInterval: 15_000,
      placeholderData: (prev) => prev,
    },
  });
  const [premium, end, rateBps] = quote.data ?? [];
  const maxPremium = premium !== undefined ? premium + premium / 10n + 1n : undefined;

  const balance = useReadContract({
    address: ARC.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [batch.address ?? DEMO_HOLDER],
    chainId: arc.id,
    query: { enabled: batch.connected, refetchInterval: 12_000 },
  });

  const calls = useMemo(() => {
    if (!market || !amount || amount <= 0n || !termOk || maxPremium === undefined) return null;
    return vault
      ? protectCalls({ vault, market: market.address, amount, coverage: amount, duration, holder, maxPremium })
      : coverCalls(market.address, amount, duration, holder, maxPremium);
  }, [market, vault, amount, termOk, duration, holder, maxPremium]);

  const sim = useSimulation(calls, holder);

  if (state.isPending) {
    return (
      <div className={`panel ${styles.loading}`}>
        <span className="label">Reading the markets from Arc…</span>
      </div>
    );
  }
  if (!market || !pool) {
    return (
      <div className="refusal" role="alert">
        Could not read the markets from Arc right now.{" "}
        <button className="btn ghost small" onClick={() => state.refetch()}>
          Try again
        </button>
      </div>
    );
  }

  const amountLabel = amount !== undefined ? `${usdc(amount)} USDC` : "—";
  const lines: ReceiptLine[] = calls
    ? vault
      ? [
          { fn: "approve", target: "USDC", note: `lets ${market.name} take the deposit`, amount: amountLabel, call: calls[0] },
          { fn: "deposit", target: market.name, note: `vault shares to ${short(holder)}`, amount: amountLabel, call: calls[1] },
          { fn: "approve", target: "USDC", note: "lets the market take the premium, capped", amount: `≤ ${usdc(maxPremium)}`, call: calls[2] },
          {
            fn: "buyCover",
            target: `Rider · ${market.name}`,
            note: `cover ${usdc(amount)} for ${daysNum}d, policy NFT to ${short(holder)}`,
            amount: `${usdc(premium)} USDC`,
            call: calls[3],
          },
        ]
      : [
          { fn: "approve", target: "USDC", note: "lets the market take the premium, capped", amount: `≤ ${usdc(maxPremium)}`, call: calls[0] },
          {
            fn: "buyCover",
            target: `Rider · ${market.name}`,
            note: `cover ${usdc(amount)} for ${daysNum}d, policy NFT to ${short(holder)}`,
            amount: `${usdc(premium)} USDC`,
            call: calls[1],
          },
        ]
    : [];

  const totals: [string, string][] = [];
  if (vault) totals.push(["Deposit", amountLabel]);
  totals.push(["Premium, quoted", premium !== undefined ? `${usdc(premium)} USDC` : "—"]);
  totals.push(["Premium limit (+10%)", maxPremium !== undefined ? `${usdc(maxPremium)} USDC` : "—"]);
  if (amount !== undefined && maxPremium !== undefined) {
    totals.push(["Most that leaves the wallet", `${usdc((vault ? amount : 0n) + maxPremium)} USDC`]);
  }

  const blocked =
    amount === undefined || amount === 0n
      ? "Enter an amount to build the batch."
      : !termOk
        ? `Choose a term between ${minDays} and ${maxDays} days.`
        : quote.isError
          ? "The quote could not be read from Arc."
          : !calls
            ? "Reading the quote…"
            : undefined;

  const refused = sim.data && !sim.data.ok;
  const payAt = (bps: number) => (amount ? usdc((amount * BigInt(bps)) / 10_000n) : "—");
  const reading = describeReading(market);
  const chip = stateChip(market);
  const now = state.data?.timestamp;
  const lowGas =
    batch.connected && balance.data !== undefined && amount !== undefined && maxPremium !== undefined
      ? balance.data < (vault ? amount : 0n) + maxPremium
      : false;

  return (
    <div className={styles.desk}>
      <section aria-labelledby="pick-market" className="rv d2">
        <div className={styles.stepHead}>
          <span className={styles.stepNo}>01</span>
          <h2 id="pick-market" className={styles.stepTitle}>
            Market
          </h2>
        </div>
        <div className={styles.markets} role="radiogroup" aria-label="Market">
          {markets.map((m) => {
            const c = stateChip(m);
            const active = same(m.address, market.address);
            return (
              <button
                key={m.address}
                role="radio"
                aria-checked={active}
                className={`${styles.market} ${active ? styles.marketOn : ""}`}
                onClick={() => {
                  setPicked(m.address);
                  batch.reset();
                }}
              >
                <span className={styles.marketTop}>
                  <span className={styles.mode}>{vaultOf(m) ? "Deposit + cover" : "Cover only"}</span>
                  <span className={`chip ${c.cls}`}>{c.word}</span>
                </span>
                <span className={styles.marketName}>{m.name}</span>
                <Gauge compact ok={m.health.ok} lossBps={m.health.lossBps} thresholdBps={m.thresholdBps} />
                <span className={styles.marketMeta}>
                  <span>fires at {formatBps(m.thresholdBps)}</span>
                  <span>room {usdc(m.capacity)} USDC</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div className="split">
        <div className={styles.main}>
          <section aria-labelledby="terms" className={`panel ${styles.terms} rv d3`}>
            <div className={styles.stepHead}>
              <span className={styles.stepNo}>02</span>
              <h2 id="terms" className={styles.stepTitle}>
                Terms
              </h2>
            </div>

            <div className={styles.field}>
              <label htmlFor="amount" className="label">
                {vault ? "Deposit and cover" : "Cover"}
              </label>
              <div className={styles.inputWrap}>
                <input
                  id="amount"
                  className="input"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amountText}
                  onChange={(e) => {
                    setAmountText(e.target.value.replace(",", "."));
                    batch.reset();
                  }}
                  aria-invalid={amount === undefined}
                />
                <span className={styles.unit}>USDC</span>
              </div>
              <p className={styles.help}>
                {vault ? (
                  <>
                    Deposited into the {market.name} and covered in full. Vault shares and the policy NFT go to{" "}
                    {batch.connected ? "your address" : "the connected address"}.
                  </>
                ) : (
                  <>Cover only: nothing is deposited. The policy pays if the trigger proves a loss on a position you hold elsewhere.</>
                )}{" "}
                Minimum {usdc(market.minCoverage)} USDC.
                {batch.connected && balance.data !== undefined && <> Wallet: {usdc(balance.data)} USDC.</>}
              </p>
            </div>

            <div className={styles.field}>
              <label htmlFor="days" className="label">
                Term, days
              </label>
              <div className={styles.termRow}>
                <div className="seg" role="group" aria-label="Term presets">
                  {PRESETS.filter((d) => d >= minDays && d <= maxDays).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={daysText === String(d)}
                      onClick={() => {
                        setDaysText(String(d));
                        batch.reset();
                      }}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
                <input
                  id="days"
                  className={`input ${styles.days}`}
                  inputMode="numeric"
                  autoComplete="off"
                  value={daysText}
                  onChange={(e) => {
                    setDaysText(e.target.value.replace(/\D/g, ""));
                    batch.reset();
                  }}
                  aria-invalid={!termOk}
                  aria-describedby="days-help"
                />
              </div>
              <p id="days-help" className={styles.help}>
                {minDays} to {maxDays} days. Policies end on a day boundary, 00:00 UTC, so cover runs to the first midnight after
                the term.
              </p>
            </div>

            <dl className={`kv ${styles.quote}`} aria-live="polite">
              <dt>Premium</dt>
              <dd>{premium !== undefined && !blocked ? `${usdc(premium)} USDC` : "—"}</dd>
              <dt>Rate, APR</dt>
              <dd>{rateBps !== undefined && !blocked ? formatBps(Number(rateBps)) : "—"}</dd>
              <dt>Covered until</dt>
              <dd>
                {end !== undefined && !blocked ? (
                  <>
                    {utc(Number(end))}
                    {now ? <span className={styles.sub}>{formatDuration(Number(end) - now)} from the last block</span> : null}
                  </>
                ) : (
                  "—"
                )}
              </dd>
            </dl>
            <div className={styles.pays}>
              <span className="label">Paid on a loss</span>
              <p>
                Cover × loss since purchase, measured from the reading when you buy, sent in USDC to the policy holder. At the{" "}
                {formatBps(market.thresholdBps)} line that is <b className="mono">{payAt(market.thresholdBps)} USDC</b>; a 10% loss
                pays <b className="mono">{payAt(1_000)} USDC</b>.
              </p>
            </div>
          </section>

          <div className="rv d4">
            <div className={styles.stepHead}>
              <span className={styles.stepNo}>03</span>
              <h2 className={styles.stepTitle}>Check and sign</h2>
            </div>
            <Receipt
              lines={lines}
              sender={holder}
              totals={totals}
              sim={blocked ? undefined : sim.data}
              simulating={sim.isFetching}
              simError={sim.isError && !sim.data}
              dryRun={!batch.connected}
              blocked={blocked}
            >
              <TxAction
                batch={batch}
                calls={lines.length}
                label={vault ? "Sign once: deposit and cover" : "Sign once: buy cover"}
                onSend={() => calls && batch.send(calls)}
                disabled={
                  blocked
                    ? false
                    : refused
                      ? "The contracts would refuse this batch. Change the terms above."
                      : lowGas
                        ? "Not enough USDC for this batch and its gas."
                        : !sim.data
                          ? "Waiting for the simulation."
                          : false
                }
                after={
                  <>
                    <Link href={`/policies?holder=${batch.address ?? ""}`}>See the policy certificate →</Link>
                    {vault && <span>The vault shares are in your wallet; the policy NFT rides with them.</span>}
                  </>
                }
              />
            </Receipt>
          </div>
        </div>

        <aside className={`panel ${styles.side} rv d3`} aria-label="Selected market">
          <div className={styles.sideHead}>
            <span className="label">Live reading</span>
            <span className={`chip ${chip.cls}`}>{chip.word}</span>
          </div>
          <h2 className="h3">{market.name}</h2>
          <p className={styles.trigger}>{TRIGGER[market.kind] ?? market.kind}</p>
          <p className={styles.reading}>
            <span className="mono">{reading.value}</span> <span className="faint">{reading.unit}</span>
          </p>
          <Gauge ok={market.health.ok} lossBps={market.health.lossBps} thresholdBps={market.thresholdBps} />
          <dl className="kv">
            <dt>Room left</dt>
            <dd>{usdc(market.capacity)} USDC</dd>
            <dt>Cover live</dt>
            <dd>{usdc(market.activeCoverage)} USDC</dd>
            <dt>Pool free</dt>
            <dd>{usdc(pool.freeAssets)} USDC</dd>
            <dt>Confirm delay</dt>
            <dd>{formatDuration(market.confirmDelay)}</dd>
            <dt>Claim window</dt>
            <dd>{formatDuration(market.claimWindow)}</dd>
            <dt>Watches</dt>
            <dd>{short(market.subject)}</dd>
          </dl>
          <hr className="rule" />
          <p className={styles.note}>
            <b>USDC pays the gas.</b> Arc has no other gas token, so the batch&apos;s fee comes out of the same USDC balance, a fraction
            of a cent. Leave a little beside the deposit.
          </p>
          <p className={styles.note}>
            Cover is fully collateralised: every unit sold is backed by free pool capital. A market refuses cover past its room, on a
            trigger already firing, or when its reading cannot be trusted.
          </p>
          {state.data && <p className={styles.block}>Block {Number(state.data.block).toLocaleString("en-US")}</p>}
        </aside>
      </div>
    </div>
  );
}
