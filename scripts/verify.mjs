// Verifies every contract from the latest Arc mainnet broadcast on Sourcify, including the markets
// the factory created internally.
//   node scripts/verify.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const dir = new URL("../contracts/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const broadcast = JSON.parse(readFileSync(`${dir}broadcast/Deploy.s.sol/5042/run-latest.json`, "utf8"));
const PARAMS =
  "(address,string,uint16,uint16,uint16,uint16,uint32,uint32,uint32,uint32,uint32,uint128,uint128,address)";

const signatures = {
  RiderPolicy: ["src/RiderPolicy.sol:RiderPolicy", "f(address)"],
  RiderFactory: ["src/RiderFactory.sol:RiderFactory", "f(address,address)"],
  RiderPool: ["src/RiderPool.sol:RiderPool", "f(address,string,string,uint256,uint256,address,address)"],
  VaultDrawdownTrigger: ["src/triggers/VaultDrawdownTrigger.sol:VaultDrawdownTrigger", "f(address)"],
  PegTrigger: ["src/triggers/PegTrigger.sol:PegTrigger", "f(address,address,uint256)"],
  ReserveTrigger: ["src/triggers/ReserveTrigger.sol:ReserveTrigger", "f(address,address,uint256)"],
  CanaryVault: ["src/drill/CanaryVault.sol:CanaryVault", "f(address,address)"],
};

const run = (cmd, args) => execFileSync(cmd, args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const jobs = [];
for (const tx of broadcast.transactions) {
  if (tx.transactionType === "CREATE" && signatures[tx.contractName]) {
    const [id, sig] = signatures[tx.contractName];
    jobs.push({ name: tx.contractName, address: tx.contractAddress, id, args: run("cast", ["abi-encode", sig, ...tx.arguments]).trim() });
  }
  if (tx.transactionType === "CALL" && tx.contractName === "RiderFactory" && tx.function?.startsWith("createMarket")) {
    const [pool, params] = tx.arguments;
    const market = tx.additionalContracts[0].address;
    // Arguments come back as "(0xabc, Galaxy USDC vault, 100, ...)"; re-split them for cast.
    const fields = params.slice(1, -1).split(", ");
    const tuple = `(${fields.map((f, i) => (i === 1 ? `"${f}"` : f)).join(",")})`;
    const args = run("cast", [
      "abi-encode",
      `f(address,address,${PARAMS})`,
      pool,
      broadcast.transactions[0].contractAddress,
      tuple,
    ]).trim();
    jobs.push({ name: `RiderMarket (${fields[1]})`, address: market, id: "src/RiderMarket.sol:RiderMarket", args });
  }
}

for (const job of jobs) {
  try {
    const out = run("forge", [
      "verify-contract",
      job.address,
      job.id,
      "--verifier",
      "sourcify",
      "--chain-id",
      "5042",
      "--constructor-args",
      job.args,
      "--watch",
    ]);
    const status = /successfully verified|Status: `match`/.test(out) ? "match" : out.includes("already verified") ? "already verified" : "submitted";
    console.log(`${job.name.padEnd(40)} ${job.address} ${status}`);
  } catch (e) {
    const msg = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    console.log(`${job.name.padEnd(40)} ${job.address} ${msg.includes("already") ? "already verified" : `FAILED ${msg.split("\n").filter(Boolean).slice(-2).join(" ")}`}`);
  }
}
