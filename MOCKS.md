# What is real and what is not

| Part | Real or simulated | Detail |
|---|---|---|
| USDC, EURC, cirBTC | Real | Circle's contracts on Arc mainnet. Premiums, deposits and payouts move real USDC. |
| Galaxy USDC and Keyrock Prime USDC vaults | Real | Morpho Vault V2 vaults listed by Circle's Earn Kit, with about $165M between them in October 2026. Rider only reads their share price; the protected deposit put real USDC into Galaxy's vault. |
| Chainlink EURC/USD, EUR/USD, cirBTC Proof-of-Reserve | Real | Read directly by the triggers on every check. |
| Multicall3From | Real | Arc's own predeployed batching contract, built on the CallFrom precompile. |
| The four live markets and the underwriting pool | Real | Fully collateralised with real USDC (a small amount). They have not fired. |
| **Canary vault** | **Simulated risk, real money** | An ERC-4626 vault Rider controls. Its operator can move USDC out ("impair") and back ("restore"), which is how the drill makes a real loss happen on demand. It exists only so the claims path can be shown end to end on mainnet. |
| Canary market and drill pool | Real contracts, fenced | The canary market sells only to the drill runner (`restrictedBuyer`), and only the deployer can fund the drill pool (`restrictedDepositor`). Real underwriting capital never backs the canary. |
| Drill relayer | Real, rate limited | A server key with about 1 USDC for gas sends each drill step. New rounds are capped per day and stop below a balance floor. |
| Unit tests | Simulated | Mock USDC and mock Chainlink feeds, so time, prices and blocklists can be controlled. The fork tests run against real Arc mainnet state instead. |
