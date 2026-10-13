"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { erc20Abi } from "viem";
import { useReadContract } from "wagmi";
import { ARC, arc, explorerAddress, type DrillStep } from "@rider/sdk";
import { PoolBand } from "@/components/markets/PoolBand";
import { ReadingLine } from "@/components/markets/ReadingLine";
import { dur, shortAddr, shortHash, usdc, utc } from "@/components/markets/format";
import { useArcState, type ApiMarket } from "@/lib/state";
import { clock, countdown, DRILL_HOLDER, ORDER, STEP, type DrillPlanJson, type DrillSentJson } from "./steps";
import styles from "./Drill.module.css";

type Phase = "idle" | "running" | "done" | "error" | "stopped";

type Activity = { kind: "reading" } | { kind: "waiting"; step: DrillStep; readyAt: number } | { kind: "sending"; step: DrillStep };

interface Entry {
  id: number;
  step: DrillStep;
  note: string;
  at: number;
  hash?: string;
  url?: string;
  status?: "success" | "reverted";
  readyAt?: number;
  waited?: boolean;
  info?: boolean;
}

interface Failure {
  message: string;
  detail?: string;
  status?: number;
}

interface Payout {
  before?: bigint;
  after?: bigint;
  url: string;
}

class DrillFailure extends Error {
  constructor(
    message: string,
    readonly detail?: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function fetchPlan(): Promise<DrillPlanJson> {
  const res = await fetch("/api/drill", { cache: "no-store" });
  if (!res.ok) throw new DrillFailure(`The drill state could not be read (HTTP ${res.status}).`, undefined, res.status);
  return res.json();
}

function sleep(ms: number, signal: { aborted: boolean }) {
  return new Promise<void>((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (signal.aborted || Date.now() - start >= ms) {
        clearInterval(timer);
        resolve();
      }
    }, 200);
  });
}

/**
 * The live drill: one button walks the canary market through the whole claims path on mainnet,
 * one relayed transaction per step, and prints each step with its explorer link as it lands.
 */
export function DrillRunner() {
  const { data: state, dataUpdatedAt } = useArcState();
  const [phase, setPhase] = useState<Phase>("idle");
  const [activity, setActivity] = useState<Activity>();
  const [loopPlan, setLoopPlan] = useState<DrillPlanJson>();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [failure, setFailure] = useState<Failure>();
  const [payout, setPayout] = useState<Payout>();
  const [, setTick] = useState(0);

  const running = phase === "running";
  const planQ = useQuery({ queryKey: ["drill-plan"], queryFn: fetchPlan, refetchInterval: running ? false : 12_000 });
  const plan = running ? (loopPlan ?? planQ.data) : planQ.data;
  const holder = plan?.holder ?? planQ.data?.holder ?? DRILL_HOLDER;

  const balanceQ = useReadContract({
    address: ARC.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [holder],
    chainId: arc.id,
    query: { refetchInterval: 4_000 },
  });

  // Mutable handles for the async loop.
  const ctl = useRef<{ running: boolean; signal: { aborted: boolean } }>({ running: false, signal: { aborted: false } });
  const nextId = useRef(1);
  const offset = useRef(0);
  const refetchBalance = useRef(balanceQ.refetch);
  const refetchPlan = useRef(planQ.refetch);
  const phaseRef = useRef(phase);
  useEffect(() => {
    refetchBalance.current = balanceQ.refetch;
    refetchPlan.current = planQ.refetch;
    phaseRef.current = phase;
  });

  // Chain time ≈ local time + offset, from the block timestamp of the last state read.
  useEffect(() => {
    if (state) offset.current = state.timestamp - dataUpdatedAt / 1000;
  }, [state, dataUpdatedAt]);

  useEffect(() => {
    if (activity?.kind !== "waiting") return;
    const t = setInterval(() => setTick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [activity]);

  useEffect(
    () => () => {
      ctl.current.signal.aborted = true;
    },
    [],
  );

  const chainNow = () => Date.now() / 1000 + offset.current;

  const append = useCallback((e: Omit<Entry, "id" | "at">) => {
    const id = nextId.current++;
    setEntries((list) => [...list, { ...e, id, at: Date.now() }]);
    return id;
  }, []);

  const readBalance = useCallback(async () => {
    const r = await refetchBalance.current();
    return r.data as bigint | undefined;
  }, []);

  const run = useCallback(async () => {
    if (ctl.current.running) return;
    const signal = { aborted: false };
    ctl.current = { running: true, signal };
    if (phaseRef.current === "done") setEntries([]);
    setPhase("running");
    setFailure(undefined);
    setPayout(undefined);

    let sawClaim = false;
    let rearms = 0;
    let retries = 0;
    let finished = false;
    let lastWait: { step: DrillStep; readyAt: number; id: number } | undefined;

    try {
      while (!signal.aborted) {
        setActivity({ kind: "reading" });
        const next = await fetchPlan();
        setLoopPlan(next);
        if (next.step === "unavailable") throw new DrillFailure(next.note);

        if (!next.tx) {
          if (next.readyAt) {
            if (!lastWait || lastWait.step !== next.step || lastWait.readyAt !== next.readyAt) {
              const id = append({ step: next.step, note: next.note, readyAt: next.readyAt });
              lastWait = { step: next.step, readyAt: next.readyAt, id };
            }
            setActivity({ kind: "waiting", step: next.step, readyAt: next.readyAt });
            await sleep(Math.max(1_500, (next.readyAt - chainNow() + 1) * 1000), signal);
            const done = lastWait.id;
            if (!signal.aborted) setEntries((list) => list.map((e) => (e.id === done ? { ...e, waited: true } : e)));
          } else {
            await sleep(3_000, signal);
          }
          continue;
        }

        let before: bigint | undefined;
        if (next.step === "claim") before = await readBalance();
        setActivity({ kind: "sending", step: next.step });
        const res = await fetch("/api/drill", { method: "POST" });
        const body = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as
          | (DrillSentJson & { error?: undefined })
          | (DrillPlanJson & { error?: undefined; hash?: undefined })
          | { error: string; detail?: string; hash?: undefined };

        if (!res.ok || body.error !== undefined) {
          const error = body.error ?? `The step was refused (HTTP ${res.status}).`;
          // Someone else moved the drill on at the same moment: read the chain again and carry on.
          const raced = res.status === 409 || (res.status === 429 && /already being sent/i.test(error));
          if (raced && retries < 3) {
            retries++;
            append({ step: next.step, note: "Another visitor moved the drill at the same moment. Reading the chain again.", info: true });
            await sleep(2_500, signal);
            continue;
          }
          throw new DrillFailure(error, "detail" in body ? body.detail : undefined, res.status);
        }
        retries = 0;

        if (!body.hash) {
          // The server answered with a plan instead (nothing to send yet).
          await sleep(1_500, signal);
          continue;
        }

        const sent = body as DrillSentJson;
        append({ step: sent.step, note: sent.note, hash: sent.hash, url: sent.url, status: sent.status });
        if (sent.status !== "success") throw new DrillFailure(`${STEP[sent.step].title} reverted on-chain.`, sent.url);

        if (sent.step === "claim") {
          sawClaim = true;
          setPayout({ before, url: sent.url });
          await sleep(900, signal);
          const after = await readBalance();
          setPayout({ before, after, url: sent.url });
        }
        if (sent.step === "rearm") {
          rearms++;
          // A run that joined during clean-up goes on into a fresh round, so every visitor sees a payout.
          if (sawClaim || rearms >= 2) {
            finished = true;
            break;
          }
        }
        await sleep(1_600, signal);
      }
      setPhase(finished ? "done" : "stopped");
    } catch (e) {
      const f = e instanceof DrillFailure ? e : new DrillFailure("The drill could not reach the server.", (e as Error).message);
      setFailure({ message: f.message, detail: f.detail, status: f.status });
      setPhase("error");
    } finally {
      ctl.current.running = false;
      setActivity(undefined);
      setLoopPlan(undefined);
      void refetchPlan.current();
    }
  }, [append, readBalance]);

  const stop = () => {
    ctl.current.signal.aborted = true;
  };

  const canary = state?.canary;
  const current: DrillStep | undefined = activity && activity.kind !== "reading" ? activity.step : plan?.step;
  const curIndex = current ? ORDER.indexOf(current) : -1;
  const midRound = !running && plan && plan.step !== "buy" && plan.step !== "unavailable";
  const live = balanceQ.data as bigint | undefined;
  // The later of the post-claim read and the live poll, in case the first read raced the RPC.
  const after = payout
    ? [payout.after, live].reduce<bigint | undefined>((m, v) => (v === undefined ? m : m === undefined || v > m ? v : m), undefined)
    : undefined;
  const received = payout?.before !== undefined && after !== undefined ? after - payout.before : undefined;

  return (
    <>
      <div className={styles.stage}>
        <section className={`panel ${styles.console}`} aria-label="Drill run">
          <div className={styles.consoleHead}>
            <span className="label">The run · one mainnet transaction per step</span>
            {typeof plan?.rounds === "number" && (
              <span className={styles.rounds}>
                {plan.rounds}
                {typeof plan.dailyLimit === "number" ? ` of ${plan.dailyLimit}` : ""} round{plan.rounds === 1 && !plan.dailyLimit ? "" : "s"}{" "}
                in the last 24 h
              </span>
            )}
          </div>

          <ol className={styles.path} aria-label="Claims path">
            {ORDER.map((s, i) => {
              const st = phase === "done" ? "done" : curIndex < 0 ? "next" : i < curIndex ? "done" : i === curIndex ? "now" : "next";
              return (
                <li key={s} data-state={st} data-cleanup={STEP[s].cleanup || undefined}>
                  <span className={styles.pathNum}>{String(i + 1).padStart(2, "0")}</span>
                  <span className={styles.pathName}>{STEP[s].title}</span>
                </li>
              );
            })}
          </ol>

          <Now phase={phase} activity={activity} plan={plan} loading={planQ.isPending} chainNow={chainNow} received={received} />

          <div className={styles.actions}>
            <button className={`btn ${styles.run}`} onClick={run} disabled={running}>
              {running ? "Running…" : phase === "done" ? "Run it again" : midRound ? "Continue the live drill" : "Run the live drill"}
            </button>
            {running && (
              <button className="btn ghost small" onClick={stop}>
                Stop after this step
              </button>
            )}
          </div>
          {midRound && phase !== "error" && (
            <p className={styles.hint}>
              A round is already under way. The button picks it up at “{STEP[plan.step].title}” and carries it through.
            </p>
          )}

          {running && payout && (
            <p className={`verified ${styles.landed}`} role="status">
              Payout landed{received !== undefined && received > 0n ? `: +${usdc(received)} USDC to the policyholder` : ""}.{" "}
              <a href={payout.url} target="_blank" rel="noreferrer">
                Open the transaction ↗
              </a>{" "}
              Now resetting the stage for the next visitor.
            </p>
          )}

          {failure && (
            <div className={`refusal ${styles.failure}`} role="alert">
              <b>Stopped: {failure.message}</b>
              {failure.detail && <code>{failure.detail}</code>}
              <span>
                Nothing further was sent. Steps already taken are final on-chain, and the button picks up from wherever the chain is now.
              </span>
            </div>
          )}

          {entries.length > 0 && (
            <ol className={styles.log} aria-label="Printed timeline" aria-live="polite">
              {entries.map((e, i) => (
                <TimelineEntry key={e.id} entry={e} n={entries.slice(0, i + 1).filter((x) => !x.info).length} chainNow={chainNow} />
              ))}
            </ol>
          )}
        </section>

        <aside className={styles.side}>
          <CanaryPanel canary={canary} />
          <HolderPanel holder={holder} balance={live} payout={payout} after={after} received={received} canary={canary} />
        </aside>
      </div>

      {state && (
        <PoolBand
          pool={state.drillPool}
          markets={[state.canary]}
          role="Separate from the underwriting pool, and it pays drill claims only. Its share price falls with each payout: that is the money the policyholder receives."
        />
      )}
    </>
  );
}

function Now({
  phase,
  activity,
  plan,
  loading,
  chainNow,
  received,
}: {
  phase: Phase;
  activity?: Activity;
  plan?: DrillPlanJson;
  loading: boolean;
  chainNow: () => number;
  received?: bigint;
}) {
  if (phase === "done") {
    return (
      <div className={styles.now}>
        <span className="label fluo">Round complete</span>
        <h2 className={styles.nowTitle}>Paid on proof.</h2>
        <p className={styles.nowWhat}>
          {received !== undefined && received > 0n
            ? `The policyholder received ${usdc(received)} USDC, and the stage is reset for the next visitor.`
            : "The claim was paid and the stage is reset for the next visitor."}
        </p>
      </div>
    );
  }
  if (activity?.kind === "waiting") {
    const left = activity.readyAt - chainNow();
    return (
      <div className={styles.now}>
        <span className="label">Waiting on the chain</span>
        <h2 className={styles.nowTitle}>{STEP[activity.step].title}</h2>
        <p className={styles.count} aria-live="off">
          {left > 0 ? countdown(left) : "0:00"}
        </p>
        <p className={styles.nowWhat}>{STEP[activity.step].what}</p>
      </div>
    );
  }
  if (activity?.kind === "sending") {
    return (
      <div className={styles.now}>
        <span className="label">Sending to Arc</span>
        <h2 className={styles.nowTitle}>{STEP[activity.step].title}</h2>
        <p className={styles.nowWhat}>{STEP[activity.step].what}</p>
      </div>
    );
  }
  if (activity?.kind === "reading" && phase === "running") {
    return (
      <div className={styles.now}>
        <span className="label">Reading the chain</span>
        <h2 className={styles.nowTitle}>{plan ? STEP[plan.step].title : "…"}</h2>
        <p className={styles.nowWhat}>
          Which step comes next is decided by chain state alone, so anyone pressing the button gets the same answer.
        </p>
      </div>
    );
  }
  if (!plan) {
    return (
      <div className={styles.now}>
        <span className="label">Next step</span>
        <h2 className={styles.nowTitle}>{loading ? "Reading the chain…" : "Unknown"}</h2>
      </div>
    );
  }
  return (
    <div className={styles.now}>
      <span className="label">Next step</span>
      <h2 className={styles.nowTitle}>{STEP[plan.step].title}</h2>
      <p className={styles.nowWhat}>{plan.step === "unavailable" ? plan.note : STEP[plan.step].what}</p>
      {plan.readyAt && plan.readyAt > chainNow() && <p className={styles.nowNote}>Ready at {utc(plan.readyAt)}.</p>}
    </div>
  );
}

function TimelineEntry({ entry: e, n, chainNow }: { entry: Entry; n: number; chainNow: () => number }) {
  const meta = STEP[e.step];
  const waiting = e.readyAt !== undefined;
  return (
    <li className={styles.entry} data-cleanup={meta.cleanup || undefined} data-info={e.info || undefined}>
      <span className={styles.entryNum}>{e.info ? "··" : String(n).padStart(2, "0")}</span>
      <div className={styles.entryBody}>
        <div className={styles.entryTop}>
          <b>{e.info ? "Retrying" : meta.title}</b>
          <span className={styles.entryTime}>{clock(e.at)}</span>
        </div>
        <p>{e.info ? e.note : waiting ? meta.what : e.note}</p>
        {e.hash && e.url && (
          <div className={styles.entryTx}>
            <span className={`chip ${e.status === "success" ? "ok" : "bad"}`}>{e.status === "success" ? "mined" : "reverted"}</span>
            <a className={styles.txLink} href={e.url} target="_blank" rel="noreferrer">
              {shortHash(e.hash)} ↗
            </a>
          </div>
        )}
        {waiting && (
          <div className={styles.entryTx}>
            <span className={`chip ${e.waited ? "" : "warn"}`}>{e.waited ? "elapsed" : "waiting"}</span>
            <span className={styles.entryTime}>{e.waited ? `until ${utc(e.readyAt!)}` : `${countdown(e.readyAt! - chainNow())} left`}</span>
          </div>
        )}
      </div>
    </li>
  );
}

function CanaryPanel({ canary }: { canary?: ApiMarket }) {
  if (!canary) {
    return (
      <section className={`panel ${styles.card}`}>
        <span className="label">Canary market</span>
        <p className="faint">Reading Arc…</p>
      </section>
    );
  }
  const ok = canary.health.ok;
  const firing = ok && canary.health.firing;
  return (
    <section className={`panel ${styles.card}`} aria-label="Canary market">
      <div className={styles.cardHead}>
        <div>
          <span className="label">Canary market · live</span>
          <h2 className="h3">{canary.name}</h2>
        </div>
        <div className={styles.chips}>
          <span className={`chip ${canary.status === "pending" ? "warn" : canary.status === "triggered" ? "bad" : ""}`}>
            {canary.status}
          </span>
          <span className={`chip ${!ok ? "" : firing ? "bad" : "ok"}`}>{!ok ? "no reading" : firing ? "firing" : "below line"}</span>
        </div>
      </div>
      <ReadingLine market={canary} size="medium" />
      <dl className="kv">
        <dt>Cover live</dt>
        <dd>{usdc(canary.activeCoverage)} USDC</dd>
        <dt>Confirm delay</dt>
        <dd>{dur(canary.confirmDelay)}</dd>
        <dt>Claim window</dt>
        <dd>{dur(canary.claimWindow)}</dd>
        <dt>Round</dt>
        <dd>generation {canary.generation}</dd>
        <dt>Canary vault</dt>
        <dd>
          <a className={styles.txLink} href={explorerAddress(canary.subject)} target="_blank" rel="noreferrer">
            {shortAddr(canary.subject)} ↗
          </a>
        </dd>
        <dt>Market</dt>
        <dd>
          <a className={styles.txLink} href={explorerAddress(canary.address)} target="_blank" rel="noreferrer">
            {shortAddr(canary.address)} ↗
          </a>
        </dd>
      </dl>
    </section>
  );
}

function HolderPanel({
  holder,
  balance,
  payout,
  after,
  received,
  canary,
}: {
  holder: string;
  balance?: bigint;
  payout?: Payout;
  after?: bigint;
  received?: bigint;
  canary?: ApiMarket;
}) {
  const lastPaid = canary && canary.incident.paid !== "0" ? canary.incident : undefined;
  return (
    <section className={`panel ${styles.card}`} aria-label="Drill policyholder">
      <div className={styles.cardHead}>
        <div>
          <span className="label">Drill policyholder · USDC balance</span>
          <a className={styles.txLink} href={explorerAddress(holder)} target="_blank" rel="noreferrer">
            {shortAddr(holder)} ↗
          </a>
        </div>
      </div>
      <p className={styles.balance}>
        {balance !== undefined ? usdc(balance) : "—"} <small>USDC</small>
      </p>
      {payout ? (
        <dl className={`kv ${styles.payout}`}>
          <dt>Before the claim</dt>
          <dd>{payout.before !== undefined ? `${usdc(payout.before)} USDC` : "—"}</dd>
          <dt>After the claim</dt>
          <dd>{after !== undefined ? `${usdc(after)} USDC` : "reading…"}</dd>
          <dt>Received</dt>
          <dd className={received !== undefined && received > 0n ? styles.received : undefined}>
            {received !== undefined ? `+${usdc(received)} USDC` : "—"}
          </dd>
          <dt>Payout tx</dt>
          <dd>
            <a className={styles.txLink} href={payout.url} target="_blank" rel="noreferrer">
              open ↗
            </a>
          </dd>
        </dl>
      ) : (
        <p className={styles.cardNote}>
          Read straight from the USDC contract every few seconds. This wallet never sends a transaction: the payout arrives because the
          market pushes it.
          {lastPaid && (
            <>
              {" "}
              The last round, opened {utc(lastPaid.openedAt)}, paid it <b className="fluo">{usdc(lastPaid.paid)} USDC</b>.
            </>
          )}
        </p>
      )}
    </section>
  );
}
