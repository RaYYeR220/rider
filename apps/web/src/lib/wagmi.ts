import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { arc } from "viem/chains";

export const ARC_RPC = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.mainnet.arc.io";

/** Injected wallets only; every EIP-6963 wallet in the browser is discovered automatically. */
export const wagmiConfig = createConfig({
  chains: [arc],
  connectors: [injected()],
  transports: { [arc.id]: http(ARC_RPC) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
