import type { Address } from "viem";

/** Arc mainnet contracts Rider builds on. */
export const ARC = {
  chainId: 5042,
  rpc: "https://rpc.mainnet.arc.io",
  explorer: "https://explorer.arc.io",
  usdc: "0x3600000000000000000000000000000000000000",
  eurc: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
  cirbtc: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0",
  /** Batches calls while keeping the sending EOA as msg.sender for every call. */
  multicall3From: "0x522fAf9A91c41c443c66765030741e4AaCe147D0",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  vaults: {
    galaxyUsdc: "0x8E357432CC12ff425c36432F312968aEb16112AF",
    keyrockUsdc: "0x5bEfAb92a5A3D60F578Cb51EEb4e4FD50a1e3123",
  },
  feeds: {
    eurcUsd: "0x361b95c10b76Ca3f35C686d423e43A951755Bf23",
    eurUsd: "0xDd5B15443cd733D3966a50a3E48cB7DF9Fb5DE0D",
    cirbtcReserves: "0xEB0884a871ea1f6483B5FC10fd3D7dC5806411fc",
  },
} as const satisfies Record<string, unknown>;

/** Addresses produced by contracts/script/Deploy.s.sol. */
export interface Deployment {
  chainId: number;
  block: number;
  deployer: Address;
  drillOperator: Address;
  usdc: Address;
  multicall3From: Address;
  policy: Address;
  factory: Address;
  pool: Address;
  drillPool: Address;
  canary: Address;
  galaxyMarket: Address;
  keyrockMarket: Address;
  eurcMarket: Address;
  cirbtcMarket: Address;
  canaryMarket: Address;
}

/** The four live markets backed by the underwriting pool, in display order. */
export function liveMarkets(d: Deployment): Address[] {
  return [d.galaxyMarket, d.keyrockMarket, d.eurcMarket, d.cirbtcMarket];
}

export function explorerTx(hash: string): string {
  return `${ARC.explorer}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${ARC.explorer}/address/${address}`;
}
