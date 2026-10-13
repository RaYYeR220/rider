import type { Metadata } from "next";
import type { ReactNode } from "react";
import { arcMainnet } from "@rider/sdk";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Build",
  description:
    "Build on Rider: a TypeScript SDK for one-transaction protected deposits, an MCP server for agents, a permissionless keeper and an open trigger interface.",
};

const REPO = "https://github.com/RaYYeR220/rider";
const tree = (path: string) => `${REPO}/tree/HEAD/${path}`;
const blob = (path: string) => `${REPO}/blob/HEAD/${path}`;

/* ───────────────────────────────────────────── snippets */

const SDK_READ = `import { createPublicClient, http, type PublicClient } from "viem";
import { arc, arcMainnet, createRiderClient, formatBps, formatUsdc, liveMarkets } from "@rider/sdk";

const client = createPublicClient({ chain: arc, transport: http("https://rpc.mainnet.arc.io") }) as PublicClient;
const rider = createRiderClient(client, arcMainnet);

// Every live market: its reading against its line, and how much cover it can still back.
for (const address of liveMarkets(arcMainnet)) {
  const m = await rider.market(address);
  console.log(
    m.name,
    m.status,
    m.health.ok ? \`loss \${formatBps(m.health.lossBps)} of \${formatBps(m.thresholdBps)}\` : "no trusted reading",
    \`\${formatUsdc(m.capacity)} USDC of room\`,
  );
}`;

const SDK_PROTECT = `// continues from read.ts: arc, arcMainnet and rider are in scope
import { createWalletClient, custom } from "viem";
import { ARC, asCalls, liveMarkets, multicall3FromTx, parseUsdc, protectCalls } from "@rider/sdk";

const wallet = createWalletClient({ chain: arc, transport: custom(window.ethereum!) });
const [account] = await wallet.requestAddresses();

// Find the market whose trigger watches the vault, then price the cover.
const vault = ARC.vaults.galaxyUsdc;
const market = await rider.marketForVault(vault, liveMarkets(arcMainnet));
if (!market) throw new Error("no Rider market watches this vault");

const amount = parseUsdc("250");
const duration = 30n * 86_400n;
const { premium } = await rider.quote(market, amount, duration);

// approve → deposit → approve → buyCover
const calls = protectCalls({
  vault,
  market,
  amount,
  coverage: amount,
  duration,
  holder: account, // receives the vault shares and the policy NFT
  maxPremium: premium + premium / 10n + 1n, // headroom; the market refuses anything above it
});

// From an EOA: one Multicall3From transaction. Every call keeps the depositor as msg.sender,
// so no router ever holds the USDC.
await wallet.sendTransaction({ account, ...multicall3FromTx(calls) });

// Or, from a smart account (Circle SCA / MSCA, ERC-4337, EIP-7702): the same four calls, batched natively.
await wallet.sendCalls({ account, calls: asCalls(calls) });`;

const MCP_SHELL = `git clone https://github.com/RaYYeR220/rider && cd rider
pnpm install && pnpm --filter @rider/sdk build

# unsigned mode: returns calls for the agent's own wallet
npx tsx packages/mcp/src/index.ts`;

const MCP_CONFIG = `{
  "mcpServers": {
    "rider": {
      "command": "npx",
      "args": ["tsx", "/path/to/rider/packages/mcp/src/index.ts"],
      "env": {
        "RPC_URL": "https://rpc.mainnet.arc.io",
        "RIDER_AGENT_KEY": "0x…",
        "RIDER_MAX_PREMIUM_USDC": "1",
        "RIDER_DAILY_PREMIUM_USDC": "5",
        "RIDER_MAX_COVERAGE_USDC": "500"
      }
    }
  }
}`;

const KEEPER = `# watch the four live markets and act whenever the contracts allow it
RPC_URL=https://rpc.mainnet.arc.io KEEPER_KEY=0x… pnpm --filter @rider/keeper start

# dry run: no key, prints what it would send and exits
pnpm --filter @rider/keeper once`;

const TRIGGER = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice A parametric trigger turns an on-chain reading into a loss ratio.
/// @dev Every reading is "higher is healthier" (share price, peg ratio, reserve backing), so a
///      conservative observation is always the larger of two readings.
interface IRiderTrigger {
    /// @notice Value recorded on a policy at purchase. Vault triggers return the current share price;
    ///         triggers measured against a fixed target return that target (1e18).
    function referenceValue() external view returns (uint256);

    /// @notice Current reading and the loss it implies relative to \`ref\`.
    /// @return ok      false when the data cannot be trusted (stale, non-positive, call reverted).
    ///                 Callers must fail closed on \`ok == false\`: no sales and no incidents.
    /// @return lossBps loss in basis points, 0..10_000.
    /// @return observed the raw reading the loss was computed from.
    function read(uint256 ref) external view returns (bool ok, uint256 lossBps, uint256 observed);

    /// @notice Loss implied by a past reading, used to price claims at the confirmed observation.
    function lossOf(uint256 ref, uint256 observed) external view returns (uint256 lossBps);

    /// @notice Short machine-readable kind: "vault-drawdown", "peg", "reserve".
    function kind() external view returns (string memory);

    /// @notice The asset, vault or feed the trigger watches.
    function subject() external view returns (address);
}`;

const ADDRESSES = `// import { arcMainnet } from "@rider/sdk"
{
${Object.entries({
  policy: arcMainnet.policy,
  factory: arcMainnet.factory,
  pool: arcMainnet.pool,
  galaxyMarket: arcMainnet.galaxyMarket,
  keyrockMarket: arcMainnet.keyrockMarket,
  eurcMarket: arcMainnet.eurcMarket,
  cirbtcMarket: arcMainnet.cirbtcMarket,
  drillPool: arcMainnet.drillPool,
  canary: arcMainnet.canary,
  canaryMarket: arcMainnet.canaryMarket,
})
  .map(([k, v]) => `  ${`${k}:`.padEnd(15)}"${v}",`)
  .join(String.fromCharCode(10))}
}`;

const TOOLS: { name: string; args: string; does: string }[] = [
  { name: "list_markets", args: "—", does: "Live markets with readings, capacity and pricing, plus the pool's free capital." },
  { name: "quote_cover", args: "market, coverage_usdc, days", does: "Premium in USDC and the exact expiry." },
  {
    name: "protect_deposit",
    args: "vault, amount_usdc, days, holder?",
    does: "Deposit into a covered vault and buy matching cover in one transaction.",
  },
  { name: "buy_cover", args: "market, coverage_usdc, days, holder?", does: "Cover for a position the holder already has." },
  { name: "my_policies", args: "holder?", does: "Policies held, with state and any payout owed." },
  { name: "incident_status", args: "market", does: "When an incident opened, whether it is confirmed, and the claim deadline." },
  { name: "claim", args: "policy_id", does: "Push a payout. Anyone can; the money always goes to the policy holder." },
];

const KEEPER_ACTIONS: { when: string; does: string }[] = [
  { when: "Active, reading past the line", does: "openIncident()" },
  { when: "Pending, confirmation delay over", does: "resolveIncident()" },
  { when: "Triggered, claim window open", does: "claimMany(claimable ids)" },
  { when: "Triggered, claim window closed", does: "settle()" },
  { when: "Settled, reading trusted again", does: "rearm()" },
];

/* ───────────────────────────────────────────── page */

function Code({ title, lang, children }: { title: string; lang: string; children: string }) {
  return (
    <figure className={styles.code}>
      <figcaption className={styles.codeHead}>
        <span>{title}</span>
        <span>{lang}</span>
      </figcaption>
      <pre tabIndex={0}>
        <code>{renderCode(children)}</code>
      </pre>
    </figure>
  );
}

/** Dim comments; everything else prints plain. No highlighter dependency. */
function renderCode(src: string): ReactNode[] {
  return src.split("\n").map((line, i) => {
    const at = line.search(/(^|\s)(\/\/|#)/);
    const nl = i > 0 ? "\n" : "";
    if (at < 0) return <span key={i}>{nl + line}</span>;
    const cut = line[at] === "/" || line[at] === "#" ? at : at + 1;
    return (
      <span key={i}>
        {nl + line.slice(0, cut)}
        <span className={styles.comment}>{line.slice(cut)}</span>
      </span>
    );
  });
}

function Section({ id, n, label, title, children }: { id: string; n: string; label: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className={styles.section} aria-labelledby={`${id}-h`}>
      <div className={styles.sectionHead}>
        <span className={styles.n}>{n}</span>
        <span className="label">{label}</span>
        <h2 className="h2" id={`${id}-h`}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

export default function BuildPage() {
  return (
    <main className="page">
      <header className="page-head">
        <span className="label">Build · SDK, MCP, keeper, triggers</span>
        <h1 className="display">Put cover inside your own deposit flow.</h1>
        <p className="lede">
          Everything Rider&apos;s app does is open to integrators: read the markets, build a protected deposit in one transaction, let an
          agent buy cover under a hard budget, run the keeper, or propose a new trigger. MIT licensed.
        </p>
        <div className={styles.headLinks}>
          <a className="btn" href={REPO} target="_blank" rel="noreferrer">
            Source on GitHub ↗
          </a>
          <nav className={styles.toc} aria-label="On this page">
            <a href="#sdk">SDK</a>
            <a href="#mcp">MCP</a>
            <a href="#keeper">Keeper</a>
            <a href="#contracts">Triggers</a>
          </nav>
        </div>
      </header>

      <Section id="sdk" n="01" label="TypeScript SDK · viem" title="Read the markets, then deposit with cover in one transaction.">
        <div className={styles.prose}>
          <p>
            <a className="link" href={tree("packages/sdk")} target="_blank" rel="noreferrer">
              packages/sdk
            </a>{" "}
            depends only on viem. <code>createRiderClient</code> reads a market or a pool in one multicall round trip;{" "}
            <code>protectCalls</code> builds the four calls of a protected deposit; <code>multicall3FromTx</code> wraps them for an EOA, and{" "}
            <code>asCalls</code> hands the same calls to a smart account.
          </p>
        </div>
        <Code title="read.ts" lang="TypeScript">
          {SDK_READ}
        </Code>
        <Code title="protect.ts" lang="TypeScript">
          {SDK_PROTECT}
        </Code>
        <ul className={styles.facts}>
          <li>
            <b>Custody never moves.</b> Arc&apos;s Multicall3From runs each call through the CallFrom precompile, so the vault and the
            market both see the depositor as the sender.
          </li>
          <li>
            <b>The contract has the last word.</b> If the quote moves past <code>maxPremium</code>, the trigger is firing or the pool cannot
            back the cover, the whole batch reverts: no deposit without its cover.
          </li>
          <li>
            <b>Also in the SDK:</b> <code>coverCalls</code> for an existing position, <code>marketCalls</code> and <code>poolCalls</code>{" "}
            encoders, <code>policiesOf</code>, <code>claimableIds</code>, and <code>planDrill</code>, which drives the live drill.
          </li>
          <li>
            <b>Typed from the ABIs.</b> <code>riderMarketAbi</code>, <code>riderPoolAbi</code>, <code>riderPolicyAbi</code> and{" "}
            <code>canaryVaultAbi</code> are exported as const, so viem infers every read and write; <code>arcMainnet</code> carries every
            deployed address.
          </li>
        </ul>
      </Section>

      <Section
        id="mcp"
        n="02"
        label="MCP server · for agents"
        title="An agent can protect its own deposits, inside a budget it cannot raise."
      >
        <div className={styles.prose}>
          <p>
            <a className="link" href={blob("packages/mcp/src/index.ts")} target="_blank" rel="noreferrer">
              packages/mcp
            </a>{" "}
            speaks MCP over stdio. It only ever touches the four live markets; the drill market and any other address are refused.
          </p>
        </div>
        <div className={styles.tools}>
          {TOOLS.map((t) => (
            <div key={t.name} className={styles.tool}>
              <code className={styles.toolName}>{t.name}</code>
              <span className={styles.toolArgs}>{t.args}</span>
              <span className={styles.toolDoes}>{t.does}</span>
            </div>
          ))}
        </div>
        <div className={styles.pair}>
          <Code title="terminal" lang="sh">
            {MCP_SHELL}
          </Code>
          <Code title="mcp client config" lang="JSON">
            {MCP_CONFIG}
          </Code>
        </div>
        <ul className={styles.facts}>
          <li>
            <b>Signing is optional.</b> Without <code>RIDER_AGENT_KEY</code> the server signs nothing and returns the batch, both as a
            Multicall3From transaction and as plain calls, for the agent&apos;s own wallet to send.
          </li>
          <li>
            <b>Budget-capped, fail-closed.</b> With a key, every purchase is checked against <code>RIDER_MAX_PREMIUM_USDC</code>,{" "}
            <code>RIDER_DAILY_PREMIUM_USDC</code> (rolling 24 hours) and <code>RIDER_MAX_COVERAGE_USDC</code> before anything is signed. If
            any limit is missing or malformed, it signs nothing. Spend is reserved before sending, so two calls cannot share the same
            headroom; <code>RIDER_BUDGET_FILE</code> keeps the tally across restarts.
          </li>
          <li>
            <b>The holder is pinned.</b> When the server signs, shares and policies always go to the signing wallet. A tool call, or an
            instruction injected into one, cannot send the agent&apos;s money anywhere else.
          </li>
          <li>
            <b>Simulated first.</b> Every signed batch is simulated against Arc before it is sent; a batch that would revert is refused and
            its budget released.
          </li>
        </ul>
      </Section>

      <Section id="keeper" n="03" label="Keeper · permissionless" title="Anyone can run the keeper. The contracts decide what it may do.">
        <div className={styles.prose}>
          <p>
            <a className="link" href={blob("packages/keeper/src/index.ts")} target="_blank" rel="noreferrer">
              packages/keeper
            </a>{" "}
            reads every live market every few seconds and sends the one action each one needs. Every action is permissionless and simulated
            first; without <code>KEEPER_KEY</code> it only reports what it would send.
          </p>
        </div>
        <Code title="terminal" lang="sh">
          {KEEPER}
        </Code>
        <dl className={styles.actions}>
          {KEEPER_ACTIONS.map((a) => (
            <div key={a.when}>
              <dt>{a.when}</dt>
              <dd>
                <code>{a.does}</code>
              </dd>
            </div>
          ))}
        </dl>
        <p className={styles.small}>
          Options: <code>KEEPER_INTERVAL_MS</code> (default 5000), <code>KEEPER_INCLUDE_DRILL=1</code> to also drive the canary market,{" "}
          <code>RIDER_DEPLOYMENT_FILE</code> to point at another deployment. Claims are pushed to the policy holder; the keeper cannot
          redirect them.
        </p>
      </Section>

      <Section id="contracts" n="04" label="Contracts · the trigger interface" title="A new risk is one small contract.">
        <div className={styles.prose}>
          <p>
            A market is generic; what makes it cover a vault, a peg or a reserve is its trigger. Implement{" "}
            <a className="link" href={blob("contracts/src/interfaces/IRiderTrigger.sol")} target="_blank" rel="noreferrer">
              IRiderTrigger
            </a>
            , add tests beside{" "}
            <a className="link" href={blob("contracts/test/Triggers.t.sol")} target="_blank" rel="noreferrer">
              Triggers.t.sol
            </a>{" "}
            and open a pull request.
          </p>
        </div>
        <Code title="IRiderTrigger.sol" lang="Solidity">
          {TRIGGER}
        </Code>
        <ul className={styles.facts}>
          <li>
            <b>Higher is healthier.</b> Share price, peg ratio, reserve backing: losses are measured down from a reference, and claims are
            priced at the healthier of two readings.
          </li>
          <li>
            <b>Fail closed.</b> When <code>read</code> returns <code>ok == false</code> the market neither sells nor opens incidents. A
            broken feed must never look like a loss.
          </li>
          <li>
            <b>Notice before it sells.</b> Markets are created through the factory. One added to a pool that already has underwriters waits
            a 4-day notice, longer than the 3-day exit, so capital that disagrees can leave first.
          </li>
          <li>
            <b>Self-describing.</b> <code>kind()</code> and <code>subject()</code> let the app, indexers and agents describe a market
            without knowing its trigger in advance; the SDK&apos;s <code>marketForVault</code> finds cover for a vault by its subject.
          </li>
        </ul>
        <Code title="deployed on Arc mainnet" lang="TypeScript">
          {ADDRESSES}
        </Code>
      </Section>
    </main>
  );
}
