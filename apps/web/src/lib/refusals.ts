import { BaseError, decodeErrorResult, erc20Abi, type Hex } from "viem";
import { canaryVaultAbi, formatBps, formatUsdc, riderMarketAbi, riderPoolAbi } from "@rider/sdk";

const ERRORS = [...riderMarketAbi, ...riderPoolAbi, ...canaryVaultAbi, ...erc20Abi].filter((x) => x.type === "error");

export interface Refusal {
  /** Custom error name, e.g. "CapacityExceeded". */
  name: string;
  /** Decoded call, e.g. "CapacityExceeded(1000000, 500000)". */
  raw: string;
  /** What the contract refused, in plain words. */
  message: string;
}

const usdc = (v: unknown) => `${formatUsdc(BigInt(String(v)))} USDC`;

/** Plain-language reasons for every refusal the contracts can give. */
function explain(name: string, args: readonly unknown[]): string {
  switch (name) {
    case "CapacityExceeded":
      return `This market can back at most ${usdc(args[1])} more cover right now.`;
    case "InsufficientCapital":
      return `Only ${usdc(args[1])} of pool capital is free to back new cover. Every policy is fully collateralised.`;
    case "TriggerFiring":
      return `The trigger already reads a ${formatBps(Number(args[0]))} loss. No cover is sold on a burning house.`;
    case "TriggerUnavailable":
      return "The trigger's data cannot be trusted right now (stale or invalid), so the market neither sells nor pays.";
    case "SalesClosed":
      return "Sales are closed: the market is paused, or it is new and still inside its notice period for underwriters.";
    case "WrongStatus":
      return "The market is not in a state that allows this (an incident may be open or settling).";
    case "PremiumAboveMax":
      return `The premium came out at ${usdc(args[0])}, above your limit of ${usdc(args[1])}. Utilisation moved; quote again.`;
    case "DurationOutOfRange":
      return "That term is outside the market's minimum and maximum.";
    case "CoverageBelowMinimum":
      return "That cover is below the market's minimum.";
    case "BuyerNotAllowed":
      return "This market only sells to its drill runner: its trigger is broken on purpose.";
    case "NotFiring":
      return `The trigger reads ${formatBps(Number(args[0]))}, below its line. There is nothing to open.`;
    case "ConfirmTooEarly":
      return "The loss has to persist through the confirmation delay before the incident can be confirmed.";
    case "ClaimWindowClosed":
      return "The claim window for this incident has closed.";
    case "ClaimWindowOpen":
      return "The claim window is still open; the incident can be settled after it closes.";
    case "NotEligible":
      return "This policy was not live when the incident opened.";
    case "AlreadyClaimed":
      return "This policy has already been paid.";
    case "UnknownPolicy":
      return "No such policy in this market.";
    case "PoolFrozen":
      return "Underwriter exits are closed while a trigger fires or an incident is open, so nobody can leave ahead of a loss.";
    case "NotClaimable":
      return `Only ${String(args[1])} shares are past their cooldown.`;
    case "ExceedsFreeAssets":
      return `Only ${usdc(args[1])} is free; the rest backs live cover.`;
    case "NotAuthorized":
      return "Only the request's controller or its approved operator can do that.";
    case "DepositorNotAllowed":
      return "This pool only accepts deposits from its operator.";
    case "ERC4626ExceededMaxDeposit":
      return "Deposits are closed right now (a trigger is firing or an incident is open).";
    case "ERC20InsufficientBalance":
      return "Not enough USDC in this wallet.";
    case "ERC20InsufficientAllowance":
      return "The USDC approval is too small.";
    default:
      return "The contract refused this transaction.";
  }
}

/** Turn a failed simulation or transaction into a readable refusal, if it carries revert data. */
export function readRefusal(error: unknown): Refusal | undefined {
  if (!(error instanceof BaseError)) return undefined;
  const carrier = error.walk((e) => typeof (e as { data?: unknown }).data === "string") as { data?: Hex } | null;
  if (!carrier?.data || carrier.data === "0x") {
    return { name: "Reverted", raw: error.shortMessage, message: error.shortMessage };
  }
  try {
    const decoded = decodeErrorResult({ abi: ERRORS, data: carrier.data });
    const args = (decoded.args ?? []) as readonly unknown[];
    return {
      name: decoded.errorName,
      raw: `${decoded.errorName}(${args.map(String).join(", ")})`,
      message: explain(decoded.errorName, args),
    };
  } catch {
    return { name: "Reverted", raw: carrier.data, message: "The contract refused this transaction." };
  }
}
