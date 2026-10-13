import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { Address } from "viem";
import { arcMainnet, explorerAddress, formatBps, formatUsdc, riderMarketAbi } from "@rider/sdk";
import { proof, type ProofEntry } from "@/lib/proof";
import { publicClient } from "@/lib/server";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Proof",
  description:
    "Every Arc mainnet transaction of Rider's proof run, the refusals included, every deployed contract with its Sourcify verification, the test suite and the honest limits.",
};

const SOURCIFY = "https://repo.sourcify.dev/5042";

type GroupKey = "seeding" | "cover" | "refused" | "drill";

const GROUPS: { key: GroupKey; title: string; lede: string }[] = [
  {
    key: "seeding",
    title: "Seeding",
    lede: "Underwriting capital in, the drill accounts funded, the canary vault seeded, and one underwriter exit queued so its cooldown could be tested.",
  },
  {
    key: "cover",
    title: "Real cover on live markets",
    lede: "Cover sold on all four live markets. The first row is a deposit into Galaxy's Morpho vault and its cover in one Multicall3From transaction, with the depositor as the sender of every call.",
  },
  {
    key: "refused",
    title: "Refused on-chain",
    lede: "Sent on purpose, expected to revert, and mined as reverted. Each one hit the custom error printed next to it.",
  },
  {
    key: "drill",
    title: "Live drill",
    lede: "The whole claims path on the canary market: buy, break, open, confirm, pay, settle, repair, rearm. An underwriter's exit during the open incident is refused in the same run.",
  },
];

function groupOf(e: ProofEntry): GroupKey {
  if (e.expected === "reverted") return "refused";
  if (/^Drill(:|-pool)/.test(e.label)) return "drill";
  if (/^(Protected deposit|Cover:)/.test(e.label)) return "cover";
  return "seeding";
}

/** Plain words for the custom errors the proof run hit. */
function explain(reason: string): string | undefined {
  const m = /^(\w+)\((.*)\)$/.exec(reason);
  if (!m) return undefined;
  const [, name, rawArgs] = m;
  const args = rawArgs ? rawArgs.split(",").map((a) => a.trim()) : [];
  const usdc = (i: number) => `${formatUsdc(BigInt(args[i] ?? "0"))} USDC`;
  switch (name) {
    case "CapacityExceeded":
      return `Asked for ${usdc(0)} of cover; the market could back ${usdc(1)} more.`;
    case "PremiumAboveMax":
      return `The premium came to ${usdc(0)}, above the buyer's limit of ${usdc(1)}.`;
    case "NotFiring":
      return `The trigger read a ${formatBps(Number(args[0] ?? 0))} loss, below its line. There was nothing to open.`;
    case "WrongStatus":
      return "The market was active. Claims exist only after a confirmed incident.";
    case "NotClaimable":
      return "None of the requested shares were past the 3-day cooldown.";
    case "BuyerNotAllowed":
      return "The drill market sells only to its drill runner; this address is not it.";
    case "TriggerFiring":
      return `The canary already read a ${formatBps(Number(args[0] ?? 0))} loss. No cover is sold on a burning house.`;
    case "PoolFrozen":
      return "Exits close while an incident is open, so no underwriter leaves ahead of a loss.";
    default:
      return undefined;
  }
}

const short = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`;
const num = (s: string) => Number(s).toLocaleString("en-US");

const MARKETS: { name: string; address: Address; trigger: string }[] = [
  { name: "Galaxy USDC vault", address: arcMainnet.galaxyMarket, trigger: "VaultDrawdownTrigger" },
  { name: "Keyrock Prime USDC vault", address: arcMainnet.keyrockMarket, trigger: "VaultDrawdownTrigger" },
  { name: "EURC peg to the euro", address: arcMainnet.eurcMarket, trigger: "PegTrigger" },
  { name: "cirBTC reserve backing", address: arcMainnet.cirbtcMarket, trigger: "ReserveTrigger" },
  { name: "Canary drill vault", address: arcMainnet.canaryMarket, trigger: "VaultDrawdownTrigger" },
];

/** Each market's trigger, read from the market itself: the triggers are not listed in the deployment file. */
async function readTriggers(): Promise<(Address | undefined)[]> {
  try {
    const res = await publicClient.multicall({
      allowFailure: true,
      contracts: MARKETS.map((m) => ({ address: m.address, abi: riderMarketAbi, functionName: "trigger" as const })),
    });
    return res.map((r) => (r.status === "success" ? (r.result as Address) : undefined));
  } catch {
    return MARKETS.map(() => undefined);
  }
}

interface ContractRow {
  name: string;
  role: string;
  address?: Address;
}

const TESTS: { n: string; what: string }[] = [
  { n: "39", what: "market tests: buying, refusals, incidents, claims, premium vesting" },
  { n: "17", what: "pool tests: async redemptions, freezing, operators, fencing" },
  { n: "12", what: "trigger tests: vault drawdown, peg cross-rate, reserve backing, stale and broken feeds" },
  { n: "2", what: "handler tests, including one proving the invariant run reaches paid claims" },
  { n: "5", what: "solvency invariants, 128 runs × 64 calls each" },
  { n: "3", what: "fork tests against live Arc mainnet state" },
];

const LIMITS: { title: string; body: string }[] = [
  {
    title: "One key owns the protocol during the grant period.",
    body: "It can pause sales and add markets. A new market waits a 4-day notice before it can sell, longer than the 3-day underwriter exit, so an underwriter who objects can leave first. It can never block a claim or move pool funds.",
  },
  {
    title: "Callers choose when incidents are sampled.",
    body: "Anyone may open and resolve an incident, so the two moments the trigger is read are picked by whoever calls. The confirmation delay and pricing claims at the healthier of the two readings limit that freedom; they do not remove it.",
  },
  {
    title: "The canary is controlled by Rider.",
    body: "The paid claim on mainnet is on a vault Rider breaks on purpose. No live market has fired yet.",
  },
  {
    title: "A quiet feed stops, it does not pay.",
    body: "Chainlink feeds on Arc have a 24-hour heartbeat. A stale feed closes sales and incidents rather than paying; a real depeg during a feed outage is not claimable until the feed resumes.",
  },
  {
    title: "Pool capital is small.",
    body: "The pools hold what was needed to prove the mechanism: 1.50 USDC of underwriting and 0.50 USDC in the drill pool at seeding.",
  },
  {
    title: "Reviewed, not audited; experimental, not insurance.",
    body: "The contracts had an independent adversarial review, not a professional audit. Rider pays parametric cover by code; it is not a regulated insurance contract.",
  },
];

export default async function ProofPage() {
  await connection();
  const triggers = await readTriggers();

  const grouped = new Map<GroupKey, { entry: ProofEntry; n: number }[]>();
  proof.forEach((entry, i) => {
    const key = groupOf(entry);
    grouped.set(key, [...(grouped.get(key) ?? []), { entry, n: i + 1 }]);
  });
  const matched = proof.filter((e) => e.status === e.expected).length;
  const refused = proof.filter((e) => e.status === "reverted").length;

  const contracts: ContractRow[] = [
    { name: "RiderPolicy", role: "One ERC-721 per policy, with on-chain art. The token is the claim.", address: arcMainnet.policy },
    { name: "RiderFactory", role: "Deploys markets and wires them into a pool and the policy NFT.", address: arcMainnet.factory },
    { name: "RiderPool · rUSDC", role: "Underwriting capital for the four live markets.", address: arcMainnet.pool },
    { name: "RiderPool · rDRILL", role: "The drill pool, fenced off from underwriting capital.", address: arcMainnet.drillPool },
    { name: "CanaryVault", role: "The vault the live drill breaks on purpose.", address: arcMainnet.canary },
    ...MARKETS.map((m) => ({
      name: `RiderMarket · ${m.name}`,
      role: "Sells the cover, runs the incident, pays the claims.",
      address: m.address,
    })),
    ...MARKETS.map((m, i) => ({
      name: `${m.trigger} · ${m.name}`,
      role: "Turns the reading into a loss. Read from the market's trigger().",
      address: triggers[i],
    })),
  ];

  return (
    <main className="page">
      <header className="page-head">
        <span className="label">Proof · Arc mainnet, chain 5042</span>
        <h1 className="display">Every transaction, including the ones the contracts refused.</h1>
        <p className="lede">
          The proof run, in the order it was sent. Each row prints what was expected next to what happened, and links to the explorer so you
          can check it yourself.
        </p>
      </header>

      <dl className={styles.summary}>
        <div>
          <dt className="label">Transactions</dt>
          <dd>{proof.length}</dd>
        </div>
        <div>
          <dt className="label">Mined as intended</dt>
          <dd>{proof.length - refused}</dd>
        </div>
        <div>
          <dt className="label">Refused as intended</dt>
          <dd className="alarm">{refused}</dd>
        </div>
        <div>
          <dt className="label">Matched expectation</dt>
          <dd className={matched === proof.length ? "fluo" : "alarm"}>
            {matched}/{proof.length}
          </dd>
        </div>
        <div>
          <dt className="label">Contracts verified</dt>
          <dd>{contracts.length}</dd>
        </div>
      </dl>

      <nav className={styles.toc} aria-label="On this page">
        {GROUPS.map((g) => (
          <a key={g.key} href={`#${g.key}`}>
            {g.title}
          </a>
        ))}
        <a href="#contracts">Contracts</a>
        <a href="#tested">Tested</a>
        <a href="#limits">Honest limits</a>
      </nav>

      {GROUPS.map((g) => {
        const rows = grouped.get(g.key) ?? [];
        return (
          <section key={g.key} id={g.key} className={styles.group} aria-labelledby={`${g.key}-h`}>
            <div className={styles.groupHead}>
              <h2 className="h2" id={`${g.key}-h`}>
                {g.title}
              </h2>
              <p className="muted">{g.lede}</p>
            </div>
            <ol className={styles.ledger}>
              {rows.map(({ entry: e, n }) => {
                const asExpected = e.status === e.expected;
                const why = e.reason ? explain(e.reason) : undefined;
                return (
                  <li key={e.hash} className={styles.row} data-refused={e.status === "reverted" || undefined}>
                    <span className={styles.n}>{String(n).padStart(2, "0")}</span>
                    <div className={styles.what}>
                      <span className={styles.label}>{e.label}</span>
                      {e.reason && <code className={styles.reason}>{e.reason}</code>}
                      {why && <span className={styles.why}>{why}</span>}
                      {e.note && <span className={styles.why}>{e.note}</span>}
                    </div>
                    <div className={styles.meta}>
                      <span>block {num(e.block)}</span>
                      <span>gas {num(e.gasUsed)}</span>
                    </div>
                    <div className={styles.status}>
                      <span className={`chip ${!asExpected ? "bad" : e.status === "success" ? "ok" : "bad"}`}>
                        {!asExpected ? "unexpected" : e.status === "success" ? "mined" : "refused"}
                      </span>
                      <a className={styles.hash} href={e.url} target="_blank" rel="noreferrer">
                        {short(e.hash)} ↗
                      </a>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}

      <section id="contracts" className={styles.group} aria-labelledby="contracts-h">
        <div className={styles.groupHead}>
          <h2 className="h2" id="contracts-h">
            Contracts
          </h2>
          <p className="muted">
            All {contracts.length} contracts are verified on Sourcify, so the source behind every address can be read and recompiled. The
            contracts are immutable: there is no proxy and no upgrade path.
          </p>
        </div>
        <ul className={styles.contracts}>
          {contracts.map((c) => (
            <li key={c.name}>
              <div className={styles.cName}>
                <b>{c.name}</b>
                <span>{c.role}</span>
              </div>
              {c.address ? (
                <>
                  <code className={styles.cAddr}>{c.address}</code>
                  <div className={styles.cLinks}>
                    <a className="link" href={explorerAddress(c.address)} target="_blank" rel="noreferrer">
                      Explorer ↗
                    </a>
                    <a className="link" href={`${SOURCIFY}/${c.address}`} target="_blank" rel="noreferrer">
                      Sourcify ↗
                    </a>
                  </div>
                </>
              ) : (
                <span className={`faint ${styles.cAddr}`}>Could not read the trigger address just now; refresh to retry.</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section id="tested" className={styles.group} aria-labelledby="tested-h">
        <div className={styles.groupHead}>
          <h2 className="h2" id="tested-h">
            Tested
          </h2>
          <p className="muted">Foundry tests in the repository. The fork tests run against live Arc mainnet state through Arc Foundry.</p>
        </div>
        <ul className={styles.tests}>
          {TESTS.map((t) => (
            <li key={t.what}>
              <span className={styles.testN}>{t.n}</span>
              <span>{t.what}</span>
            </li>
          ))}
        </ul>
        <p className={`verified ${styles.review}`}>
          An independent review found 2 high and 5 medium issues before deployment. Each was fixed with a regression test, except
          caller-chosen sampling, which cannot be closed in code and is mitigated and listed below.
        </p>
      </section>

      <section id="limits" className={styles.group} aria-labelledby="limits-h">
        <div className={styles.groupHead}>
          <h2 className="h2" id="limits-h">
            Honest limits
          </h2>
          <p className="muted">What Rider does not claim, so nobody has to guess.</p>
        </div>
        <ol className={styles.limits}>
          {LIMITS.map((l) => (
            <li key={l.title}>
              <b>{l.title}</b>
              <p>{l.body}</p>
            </li>
          ))}
        </ol>
        <div className={styles.close}>
          <Link className="btn" href="/drill">
            Run the claims path yourself
          </Link>
          <a className="link" href="https://github.com/RaYYeR220/rider" target="_blank" rel="noreferrer">
            Source on GitHub
          </a>
        </div>
      </section>
    </main>
  );
}
