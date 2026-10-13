import ledger from "@/data/proof.json";

export interface ProofEntry {
  label: string;
  hash: string;
  status: "success" | "reverted";
  expected: "success" | "reverted";
  from: string;
  to: string;
  block: string;
  gasUsed: string;
  url: string;
  note?: string;
  reason?: string;
}

/** Every transaction of the Arc mainnet proof run, in the order it was sent. */
export const proof = ledger as ProofEntry[];

export const refusals = proof.filter((e) => e.expected === "reverted");

export function find(label: string): ProofEntry | undefined {
  return proof.find((e) => e.label.startsWith(label));
}
