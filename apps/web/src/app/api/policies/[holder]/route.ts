import { isAddress } from "viem";
import { json, rider } from "@/lib/server";

export async function GET(_: Request, ctx: RouteContext<"/api/policies/[holder]">) {
  const { holder } = await ctx.params;
  if (!isAddress(holder)) return json({ error: "not an address" }, { status: 400 });
  return json({ holder, policies: await rider.policiesOf(holder) });
}
