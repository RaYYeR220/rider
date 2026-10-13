import type { Refusal } from "@/lib/refusals";
import styles from "./tx.module.css";

interface Props {
  refusal: Refusal;
  /** The receipt line that refused, e.g. "Call 04 · buyCover". */
  where?: string;
  /** Stamp text; defaults to the pre-signing wording. */
  stamp?: string;
}

/** Errors raised by contracts outside Rider (the Earn Kit vaults), keyed by selector. */
const FOREIGN: Record<string, [raw: string, message: string]> = {
  "0xe65b7a77": ["TransferFromReverted()", "The vault could not pull the USDC from this wallet, usually because the balance is too small."],
};

function rawOf(r: Refusal): string {
  return r.name === "Reverted" && FOREIGN[r.raw.slice(0, 10)] ? FOREIGN[r.raw.slice(0, 10)][0] : r.raw;
}

/** Arc's USDC interface reverts with plain strings rather than custom errors; read the common ones. */
function plain(r: Refusal): string {
  if (r.name === "Reverted" && FOREIGN[r.raw.slice(0, 10)]) return FOREIGN[r.raw.slice(0, 10)][1];
  if (r.name !== "Error") return r.message;
  const reason = r.raw.replace(/^Error\(/, "").replace(/\)$/, "");
  if (/exceeds balance|insufficient balance/i.test(reason)) return "Not enough USDC in this wallet.";
  if (/exceeds allowance|insufficient allowance/i.test(reason)) return "The USDC approval is too small.";
  return `The contract refused: ${reason}.`;
}

/** What the contract said no to, before anything was signed: the stamp, the plain reason, the raw error. */
export function RefusalBox({ refusal, where, stamp = "Refused before you sign" }: Props) {
  return (
    <div className={`refusal ${styles.refusal}`} role="alert">
      <div className={styles.refusalHead}>
        <span className={styles.stamp}>{stamp}</span>
        {where && <span className={styles.where}>{where}</span>}
      </div>
      <p className={styles.plain}>{plain(refusal)}</p>
      <code className={styles.raw}>{rawOf(refusal)}</code>
    </div>
  );
}
