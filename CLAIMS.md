# Claims

Every statement Rider makes, with the strongest evidence behind it.

- **VERIFIED-LIVE**: happened on Arc mainnet; there is a transaction or contract you can open.
- **REPRODUCIBLE**: a test or script in this repo shows it; run it yourself.
- **MODELLED**: a design property argued from the code, not observed in a real incident.
- **NOT CLAIMED**: listed so nobody has to guess.

## Product

| Claim | Evidence | Where |
|---|---|---|
| Rider is deployed on Arc mainnet, and all 15 contracts are verified on Sourcify | VERIFIED-LIVE | [PROOF.md › Contracts](PROOF.md#contracts) |
| A USDC deposit into Galaxy's Morpho Vault V2 and the cover on it happened in **one** transaction, through Arc's Multicall3From, with the depositor as `msg.sender` for every call | VERIFIED-LIVE | [PROOF.md › Real cover](PROOF.md#real-cover-on-the-live-markets) · `test_protectInOneTransaction_viaMulticall3From` |
| Cover has been sold on all four live markets: Galaxy USDC, Keyrock Prime USDC, EURC/euro peg, cirBTC reserves | VERIFIED-LIVE | [PROOF.md › Real cover](PROOF.md#real-cover-on-the-live-markets) |
| A claim has been paid end to end on mainnet: cover bought, trigger past its line, incident opened, confirmed after the delay, USDC paid to the policy holder, round settled, market rearmed | VERIFIED-LIVE | [PROOF.md › Live drill](PROOF.md#live-drill-the-whole-claims-path-on-mainnet) |
| Each of the refusals below was mined on mainnet as a reverted transaction with the stated custom error | VERIFIED-LIVE | [PROOF.md › Refused on-chain](PROOF.md#refused-on-chain-mined-reverted-on-purpose) |
| The four live triggers read real Arc data: Morpho Vault V2 share prices, Chainlink EURC/USD and EUR/USD, the Chainlink cirBTC Proof-of-Reserve feed and cirBTC supply | VERIFIED-LIVE | `test_liveTriggersReadHealthy` on a mainnet fork; `/markets` reads them every few seconds |

## Safety properties

| Claim | Evidence | Where |
|---|---|---|
| Every unit of cover is backed by a unit of free pool capital, even if every market fires at once | REPRODUCIBLE | `invariant_poolHoldsEveryCommitment`, `invariant_lockedNeverExceedsAssets` (128 runs × 64 calls) |
| No policy is ever paid twice, and no payout exceeds the cover it was sold for | REPRODUCIBLE | `invariant_noPolicyPaidTwice`, `invariant_paidNeverExceedsCoverage`, `test_incident_*` |
| The invariant run actually reaches paid claims (it is not checking an empty pool) | REPRODUCIBLE | `test_handlerReachesPaidClaims` (shrunk from a deliberately failing "no payouts ever" invariant) |
| No cover is sold while a trigger is firing, or while its data is stale or invalid | REPRODUCIBLE + VERIFIED-LIVE | `test_refuse_coverOnABurningHouse`, `test_refuse_staleFeed`, `test_refuse_brokenFeed`; drill refusal `TriggerFiring(2000)` |
| An incident needs the loss to persist through a confirmation delay; claims are priced at the healthier of the two readings | REPRODUCIBLE | `test_incident_dismissedWhenReadingRecovers`, `test_incident_pricedAtTheHealthierReading` |
| Peg and reserve cover pays for the slide since purchase, not for a discount visible at purchase | REPRODUCIBLE | `test_peg_paysOnlyTheSlideSincePurchase`, `test_reserve_paysOnlyTheFallSincePurchase` |
| Underwriters cannot leave ahead of a loss: exits and deposits close the moment a trigger fires, before anyone opens the incident | REPRODUCIBLE + VERIFIED-LIVE | `test_audit_poolFreezesAsSoonAsATriggerFires`; drill refusal `PoolFrozen()` |
| Premiums vest linearly, so a deposit made right before a large premium cannot skim it | REPRODUCIBLE | `test_premium_noSnipingByLateUnderwriter`, `test_premium_vestsLinearlyToUnderwriters` |
| Nobody can restart another underwriter's exit cooldown | REPRODUCIBLE | `test_audit_cannotRestartSomeoneElsesCooldown` |
| A market added after underwriters have joined waits 4 days before it can sell, longer than the 3-day exit, so an underwriter who objects can leave first | REPRODUCIBLE | `test_audit_newMarketWaitsOutTheNoticePeriod` |
| The owner can pause sales; it cannot stop an incident, a claim, a settlement or a withdrawal, and has no function that moves pool funds | MODELLED | `RiderPool.sol`, `RiderMarket.sol`: the only owner functions are `setRegistrar` (once) and `setSalesPaused` |
| An agent using the MCP server cannot exceed its premium and coverage limits, cannot send cover or vault shares to another address, and signs nothing if a limit is missing | REPRODUCIBLE | `packages/mcp/src/budget.test.ts` (7 tests); `resolveHolder` in `packages/mcp/src/index.ts` |

## Not claimed

- **Not insurance.** Rider is experimental software paying parametric cover; it is not a regulated insurance contract and makes no promise beyond what the contracts enforce.
- **No real incident has happened.** The live markets have never fired. The paid claim on mainnet is on the canary vault, which Rider controls and breaks on purpose (see [MOCKS.md](MOCKS.md)).
- **Not decentralised governance.** One key owns the factory and the pools during the grant period. It can add markets (after notice) and pause sales.
- **No price discovery.** Premiums come from a fixed utilisation curve per market, not from a market of underwriters bidding.
- **Small capital.** The pools hold what was needed to prove the mechanism: 1.5 USDC underwriting and 0.5 USDC in the drill pool.
- **Incident timing is chosen by callers.** Anyone may open and resolve an incident, so the two sampling moments are picked by whoever calls; the confirmation delay and pricing at the healthier reading limit, but do not remove, that freedom.
- **Feeds can go quiet.** Chainlink feeds on Arc have a 24-hour heartbeat. A stale feed stops sales and incidents; it does not pay. A real depeg during a feed outage would not be claimable until the feed resumes.
- **Independent review, not an audit.** The contracts were reviewed adversarially before deployment and every finding was fixed with a regression test; no professional audit firm has reviewed them.
