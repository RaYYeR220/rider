// Copies a Foundry deployment file into the SDK so every package reads the same addresses.
//   node scripts/sync-deployment.mjs arc-mainnet
import { readFileSync, writeFileSync } from "node:fs";

const network = process.argv[2] ?? "arc-mainnet";
const path = (p) => new URL(p, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const d = JSON.parse(readFileSync(path(`../contracts/deployments/${network}.json`), "utf8"));
const body = Object.entries(d)
  .map(([k, v]) => `  ${k}: ${typeof v === "number" ? v : JSON.stringify(v)},`)
  .join("\n");
writeFileSync(
  path("../packages/sdk/src/deployments.ts"),
  `import type { Deployment } from "./addresses.js";\n\n/** Rider on Arc mainnet, synced from contracts/deployments/${network}.json. */\nexport const arcMainnet: Deployment = {\n${body}\n};\n`,
);
console.log(`synced ${network} into packages/sdk/src/deployments.ts`);

// The web app shows the proof ledger; keep a copy next to it so it ships with the build.
import { mkdirSync, existsSync } from "node:fs";
const ledger = path(`../proof/${network}.json`);
if (existsSync(ledger)) {
  mkdirSync(path("../apps/web/src/data"), { recursive: true });
  writeFileSync(path(`../apps/web/src/data/proof.json`), readFileSync(ledger, "utf8"));
  console.log("copied proof ledger into apps/web/src/data/proof.json");
}
