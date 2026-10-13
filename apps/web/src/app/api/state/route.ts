import { connection } from "next/server";
import { liveMarkets } from "@rider/sdk";
import { deployment, json, publicClient, rider } from "@/lib/server";

/** Pools and markets as one snapshot, read straight from Arc. */
export async function GET() {
  await connection();
  const [block, pool, drillPool, markets, canary] = await Promise.all([
    publicClient.getBlock(),
    rider.pool(deployment.pool),
    rider.pool(deployment.drillPool),
    Promise.all(liveMarkets(deployment).map(rider.market)),
    rider.market(deployment.canaryMarket),
  ]);
  return json({
    block: block.number,
    timestamp: Number(block.timestamp),
    deployment,
    pool,
    drillPool,
    markets,
    canary,
  });
}
