// Renders PROOF.md from the deployment file and the mainnet proof ledger.
//   node scripts/proof-md.mjs
import { readFileSync, writeFileSync } from "node:fs";

const path = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const d = JSON.parse(readFileSync(path("../contracts/deployments/arc-mainnet.json"), "utf8"));
const ledger = JSON.parse(readFileSync(path("../proof/arc-mainnet.json"), "utf8"));
const broadcast = JSON.parse(readFileSync(path("../contracts/broadcast/Deploy.s.sol/5042/run-latest.json"), "utf8"));

const ex = "https://explorer.arc.io";
const addr = (a) => `[\`${a}\`](${ex}/address/${a})`;
const src = (a) => `[source](https://repo.sourcify.dev/5042/${a})`;
const tx = (h) => `[\`${h.slice(0, 10)}…${h.slice(-6)}\`](${ex}/tx/${h})`;

const contracts = [
  ["Policy NFT (ERC-721, on-chain SVG)", d.policy],
  ["Market factory", d.factory],
  ["Underwriting pool (ERC-4626 + ERC-7540)", d.pool],
  ["Drill pool (fenced)", d.drillPool],
  ["Market · Galaxy USDC vault", d.galaxyMarket],
  ["Market · Keyrock Prime USDC vault", d.keyrockMarket],
  ["Market · EURC peg to the euro", d.eurcMarket],
  ["Market · cirBTC reserve backing", d.cirbtcMarket],
  ["Market · Canary drill vault", d.canaryMarket],
  ["Canary vault (drill only)", d.canary],
];
for (const t of broadcast.transactions) {
  if (t.transactionType === "CREATE" && /Trigger$/.test(t.contractName)) {
    contracts.push([`Trigger · ${t.contractName} (${t.arguments[0].slice(0, 10)}…)`, t.contractAddress]);
  }
}

const groups = [
  ["Seeding", (e) => /^(Underwriter (approves|deposits)|Fund the|Drill operator)/.test(e.label)],
  ["Real cover on the live markets", (e) => /^(Protected deposit|Cover:)/.test(e.label)],
  ["Refused on-chain (mined, reverted on purpose)", (e) => e.expected === "reverted"],
  ["Live drill: the whole claims path on mainnet", (e) => e.label.startsWith("Drill") && e.expected === "success"],
  ["Underwriter exit", (e) => e.label.includes("requests a redemption") || e.label.includes("queues an exit")],
];

let out = `# Proof\n\nEverything below is on Arc mainnet (chain 5042) and can be opened in the explorer. This file is generated from\n[\`contracts/deployments/arc-mainnet.json\`](contracts/deployments/arc-mainnet.json) and the transaction ledger\n[\`proof/arc-mainnet.json\`](proof/arc-mainnet.json), which the ops scripts write as they send each transaction.\n\nDeployed at block ${d.block} by ${addr(d.deployer)}.\n\n## Contracts\n\nAll contracts are immutable and verified on Sourcify (\`match\`).\n\n| Contract | Address | Source |\n|---|---|---|\n`;
for (const [name, a] of contracts) out += `| ${name} | ${addr(a)} | ${src(a)} |\n`;

for (const [title, test] of groups) {
  const rows = ledger.filter(test);
  if (!rows.length) continue;
  out += `\n## ${title}\n\n| | Transaction | Status | Block |${title.startsWith("Refused") ? " Contract said |" : ""}\n|---|---|---|---|${title.startsWith("Refused") ? "---|" : ""}\n`;
  for (const e of rows) {
    out += `| ${e.label.replace(/^Refused: /, "")} | ${tx(e.hash)} | ${e.status} | ${e.block} |${title.startsWith("Refused") ? ` \`${e.reason}\` |` : ""}\n`;
  }
}

out += `\n## Reproduce\n\n\`\`\`sh\n# read every live trigger, deposit into Galaxy's Morpho vault and buy cover in one Multicall3From\n# transaction, and run a paid drill, all against a fork of current Arc mainnet state\ncd contracts\narc-forge test --match-path "test/fork/*" --fork-url https://rpc.mainnet.arc.io -vv\n\`\`\`\n\nArc's USDC lives behind protocol precompiles, so fork tests need [Arc Foundry](https://github.com/circlefin/arc-foundry)\n(\`arc-forge\`); stock Foundry cannot move USDC on a fork.\n`;

writeFileSync(path("../PROOF.md"), out);
console.log(`PROOF.md: ${contracts.length} contracts, ${ledger.length} transactions`);
