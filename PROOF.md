# Proof

Everything below is on Arc mainnet (chain 5042) and can be opened in the explorer. This file is generated from
[`contracts/deployments/arc-mainnet.json`](contracts/deployments/arc-mainnet.json) and the transaction ledger
[`proof/arc-mainnet.json`](proof/arc-mainnet.json), which the ops scripts write as they send each transaction.

Deployed at block 25802978 by [`0xE6123988ECA9808f2654368812760a0971Aa8926`](https://explorer.arc.io/address/0xE6123988ECA9808f2654368812760a0971Aa8926).

## Contracts

All contracts are immutable and verified on Sourcify (`match`).

| Contract | Address | Source |
|---|---|---|
| Policy NFT (ERC-721, on-chain SVG) | [`0xe1c34dC766499a379Ec7c05ee0E8F1c28C9c1AdB`](https://explorer.arc.io/address/0xe1c34dC766499a379Ec7c05ee0E8F1c28C9c1AdB) | [source](https://repo.sourcify.dev/5042/0xe1c34dC766499a379Ec7c05ee0E8F1c28C9c1AdB) |
| Market factory | [`0xcBCAF27Ce7B90c630e838D5bF47B1888487436FD`](https://explorer.arc.io/address/0xcBCAF27Ce7B90c630e838D5bF47B1888487436FD) | [source](https://repo.sourcify.dev/5042/0xcBCAF27Ce7B90c630e838D5bF47B1888487436FD) |
| Underwriting pool (ERC-4626 + ERC-7540) | [`0x0cE73d0DFB401eB62498c2a49994B40a48c2Cd52`](https://explorer.arc.io/address/0x0cE73d0DFB401eB62498c2a49994B40a48c2Cd52) | [source](https://repo.sourcify.dev/5042/0x0cE73d0DFB401eB62498c2a49994B40a48c2Cd52) |
| Drill pool (fenced) | [`0xe0c1fe5A321FD8C8b228Fe59AB84BcE07Ba21c98`](https://explorer.arc.io/address/0xe0c1fe5A321FD8C8b228Fe59AB84BcE07Ba21c98) | [source](https://repo.sourcify.dev/5042/0xe0c1fe5A321FD8C8b228Fe59AB84BcE07Ba21c98) |
| Market · Galaxy USDC vault | [`0xdFC4922A0498f97Dcd3788c701a38084847Ec2f1`](https://explorer.arc.io/address/0xdFC4922A0498f97Dcd3788c701a38084847Ec2f1) | [source](https://repo.sourcify.dev/5042/0xdFC4922A0498f97Dcd3788c701a38084847Ec2f1) |
| Market · Keyrock Prime USDC vault | [`0x00b489A45d6922FcE8fa559C2747F31a5d541743`](https://explorer.arc.io/address/0x00b489A45d6922FcE8fa559C2747F31a5d541743) | [source](https://repo.sourcify.dev/5042/0x00b489A45d6922FcE8fa559C2747F31a5d541743) |
| Market · EURC peg to the euro | [`0xeBf07458fd00cD0ecAfF5B3816975a29c18E376D`](https://explorer.arc.io/address/0xeBf07458fd00cD0ecAfF5B3816975a29c18E376D) | [source](https://repo.sourcify.dev/5042/0xeBf07458fd00cD0ecAfF5B3816975a29c18E376D) |
| Market · cirBTC reserve backing | [`0xf5E377960A9c690d85d9ab4831Edc7F88C7667f9`](https://explorer.arc.io/address/0xf5E377960A9c690d85d9ab4831Edc7F88C7667f9) | [source](https://repo.sourcify.dev/5042/0xf5E377960A9c690d85d9ab4831Edc7F88C7667f9) |
| Market · Canary drill vault | [`0x0A223bf13D5FFcA9F056af57169D88fAa34058fB`](https://explorer.arc.io/address/0x0A223bf13D5FFcA9F056af57169D88fAa34058fB) | [source](https://repo.sourcify.dev/5042/0x0A223bf13D5FFcA9F056af57169D88fAa34058fB) |
| Canary vault (drill only) | [`0x94981CddA8EFD8Aef008DfD8aF650B938613fc44`](https://explorer.arc.io/address/0x94981CddA8EFD8Aef008DfD8aF650B938613fc44) | [source](https://repo.sourcify.dev/5042/0x94981CddA8EFD8Aef008DfD8aF650B938613fc44) |
| Trigger · VaultDrawdownTrigger (0x8E357432…) | [`0xc11594072c8db5afa0991e54f4eff2951dffe349`](https://explorer.arc.io/address/0xc11594072c8db5afa0991e54f4eff2951dffe349) | [source](https://repo.sourcify.dev/5042/0xc11594072c8db5afa0991e54f4eff2951dffe349) |
| Trigger · VaultDrawdownTrigger (0x5bEfAb92…) | [`0x5cc26c4d5bcbfc1d2ff5fdc01d1defbb11183095`](https://explorer.arc.io/address/0x5cc26c4d5bcbfc1d2ff5fdc01d1defbb11183095) | [source](https://repo.sourcify.dev/5042/0x5cc26c4d5bcbfc1d2ff5fdc01d1defbb11183095) |
| Trigger · PegTrigger (0x361b95c1…) | [`0x0639f0b29408a68508e499486457fbdb574ce7bb`](https://explorer.arc.io/address/0x0639f0b29408a68508e499486457fbdb574ce7bb) | [source](https://repo.sourcify.dev/5042/0x0639f0b29408a68508e499486457fbdb574ce7bb) |
| Trigger · ReserveTrigger (0xEB0884a8…) | [`0xf13ece37519aef639bf5bc05c6417a2931df5a93`](https://explorer.arc.io/address/0xf13ece37519aef639bf5bc05c6417a2931df5a93) | [source](https://repo.sourcify.dev/5042/0xf13ece37519aef639bf5bc05c6417a2931df5a93) |
| Trigger · VaultDrawdownTrigger (0x94981Cdd…) | [`0x5e6a7b7310518a464640f85d52cfe95dfe519953`](https://explorer.arc.io/address/0x5e6a7b7310518a464640f85d52cfe95dfe519953) | [source](https://repo.sourcify.dev/5042/0x5e6a7b7310518a464640f85d52cfe95dfe519953) |

## Seeding

| | Transaction | Status | Block |
|---|---|---|---|
| Underwriter approves the Rider USDC pool | [`0xa4e62345…a55629`](https://explorer.arc.io/tx/0xa4e62345bed301438714a070f100176ec49fe53bff9b34fe923b1ee518a55629) | success | 25803438 |
| Underwriter deposits into the Rider USDC pool | [`0xc76614f0…9b6d17`](https://explorer.arc.io/tx/0xc76614f097dac13ec324f8a000e1a00170975ed2f7a087acf4435ac6119b6d17) | success | 25803440 |
| Underwriter approves the drill pool | [`0x68200ff7…8ddf24`](https://explorer.arc.io/tx/0x68200ff74680d8d68d39b5b2aab10855c8a80085281413a5b3b18bbcf18ddf24) | success | 25803449 |
| Underwriter deposits into the drill pool | [`0x3ca5b300…7e3c13`](https://explorer.arc.io/tx/0x3ca5b300a5cc133254f32b856a3dc4c77aa965a423a64ebf019a588a4c7e3c13) | success | 25803458 |
| Fund the drill relayer | [`0xe34f683f…11b902`](https://explorer.arc.io/tx/0xe34f683fd0166e591313ae927c85d50dc02f79204c9ca94b4495b4fce711b902) | success | 25803460 |
| Fund the demo policyholder | [`0x55d212d5…f2ce1c`](https://explorer.arc.io/tx/0x55d212d5644ecb7a21384a45d2d1a50aabd8cb00f1e93d488e4e9609bbf2ce1c) | success | 25803469 |
| Drill operator approves the canary vault | [`0x34d520fe…c322f1`](https://explorer.arc.io/tx/0x34d520fece97107a4f77e96a516d51c4fd76b60068ee091ce1b02954e8c322f1) | success | 25803471 |
| Drill operator seeds the canary vault | [`0x0cfd9310…eac0fe`](https://explorer.arc.io/tx/0x0cfd93100be4d6e30c529775d12e7abd72cb879b1708344832100fa572eac0fe) | success | 25803473 |

## Real cover on the live markets

| | Transaction | Status | Block |
|---|---|---|---|
| Protected deposit: Galaxy USDC vault + cover, one Multicall3From tx | [`0xa1035312…b4a7bb`](https://explorer.arc.io/tx/0xa1035312a692d0f85f8eae7072c3798cce336ea1c4e3ffa8a28e22b505b4a7bb) | success | 25803500 |
| Cover: Keyrock Prime USDC vault drawdown | [`0x3c851e22…b7c95b`](https://explorer.arc.io/tx/0x3c851e225044a007e10bde56eeb268383757790e2d3c3cbb1af4d8e65eb7c95b) | success | 25803502 |
| Cover: EURC peg to the euro | [`0x50d3cbaa…bc0676`](https://explorer.arc.io/tx/0x50d3cbaaea782897a79fe31ed3d8be15ef1241ca870d9eca936399d1e9bc0676) | success | 25803504 |
| Cover: cirBTC reserve backing | [`0xeaee70ed…feab32`](https://explorer.arc.io/tx/0xeaee70ed8cd3a7379ffd27f91d4468fd33583f7dc2c75fb357b8975924feab32) | success | 25803506 |

## Refused on-chain (mined, reverted on purpose)

| | Transaction | Status | Block | Contract said |
|---|---|---|---|---|
| cover beyond the market's capacity | [`0x00078c7d…8de8da`](https://explorer.arc.io/tx/0x00078c7d9c43ff65ca594b6a80a0fc6020444d1bf261249489e8ec823c8de8da) | reverted | 25803508 | `CapacityExceeded(1000000, 500000)` |
| premium above the buyer's limit | [`0xcd8d8506…f0b578`](https://explorer.arc.io/tx/0xcd8d850642d3cf44b173a2bc23304508a41326eb66f9c05892e60282d8f0b578) | reverted | 25803510 | `PremiumAboveMax(606, 0)` |
| incident on a healthy reading | [`0x430603b9…cf1598`](https://explorer.arc.io/tx/0x430603b9373b3c25741db0694c422da7deb0bfee615f6818647c8c670ecf1598) | reverted | 25803512 | `NotFiring(0)` |
| claim with no incident | [`0x1c4856e4…df52c3`](https://explorer.arc.io/tx/0x1c4856e4117ed960819a1a1e7987d260e507e88b99dc6345bb57534b53df52c3) | reverted | 25803516 | `WrongStatus(0)` |
| redemption before the cooldown | [`0x3107a47f…97cc27`](https://explorer.arc.io/tx/0x3107a47f0204b49393123a6da86014588a78134e004359789ebfd886bc97cc27) | reverted | 25803520 | `NotClaimable(50000000000, 0)` |
| outsider buys cover on the drill market | [`0x2d1af97b…13a072`](https://explorer.arc.io/tx/0x2d1af97bb9d8ad831735e651213ad03708a15fbab30f28f540ae1b63b513a072) | reverted | 25803560 | `BuyerNotAllowed(0x73c37EF65789B50511656F3ec4F22E21FFddc549)` |
| cover on a burning house | [`0x5d9aa379…a8309d`](https://explorer.arc.io/tx/0x5d9aa3790c727d17b42e2b75d946f291bb50517967940ee674e87ec64aa8309d) | reverted | 25803565 | `TriggerFiring(2000)` |
| underwriter exit while an incident is open | [`0xcacfe224…6206d2`](https://explorer.arc.io/tx/0xcacfe22422cacf846a399deaba1b8554e75de47d583ebcc17aa11ab9e46206d2) | reverted | 25803572 | `PoolFrozen()` |

## Live drill: the whole claims path on mainnet

| | Transaction | Status | Block |
|---|---|---|---|
| Drill operator approves the canary vault | [`0x34d520fe…c322f1`](https://explorer.arc.io/tx/0x34d520fece97107a4f77e96a516d51c4fd76b60068ee091ce1b02954e8c322f1) | success | 25803471 |
| Drill operator seeds the canary vault | [`0x0cfd9310…eac0fe`](https://explorer.arc.io/tx/0x0cfd93100be4d6e30c529775d12e7abd72cb879b1708344832100fa572eac0fe) | success | 25803473 |
| Drill: buy canary cover (approve + buy, one Multicall3From tx) | [`0x4588fea0…329c24`](https://explorer.arc.io/tx/0x4588fea0ed15800a056951dcc676aa117eaa19836af4913f880d7932c8329c24) | success | 25803551 |
| Drill: break the canary vault (-20%) | [`0xc0b9a03a…5c6e37`](https://explorer.arc.io/tx/0xc0b9a03adb90fd2abdd74d275b4b40f2bb44413e382af41977cc7ebc1c5c6e37) | success | 25803563 |
| Drill: open incident | [`0xb73f9be0…094345`](https://explorer.arc.io/tx/0xb73f9be0e8da570964715e6f353225bf867c5753fe9982d6a188986eb2094345) | success | 25803568 |
| Drill-pool underwriter queues an exit during the incident | [`0x3a29f0fd…d62d1b`](https://explorer.arc.io/tx/0x3a29f0fdbbd8c7cbbf6dda264b3be5ca5dcdb124687fc2d134a08c1c12d62d1b) | success | 25803570 |
| Drill: confirm incident after the delay | [`0x995ec5ad…4c0856`](https://explorer.arc.io/tx/0x995ec5ad01c1eb6225f7e27222f2b053db53a2f118646d56890f0c1ce84c0856) | success | 25803630 |
| Drill: pay the policyholder | [`0xf3aba7fb…a11474`](https://explorer.arc.io/tx/0xf3aba7fbaeedfb2122f852796bbe72bab07280990b00ae7e7187717517a11474) | success | 25803633 |
| Drill: settle and retire the round | [`0x2bb91c51…f9c50c`](https://explorer.arc.io/tx/0x2bb91c511c3a0f44ad4a7ce33dcaf539579966171ecdc168174c25a00cf9c50c) | success | 25803811 |
| Drill: repair the canary vault | [`0xb974bc77…e31631`](https://explorer.arc.io/tx/0xb974bc77c665e3db63579132eb0161400c013d64fd4f5e581c8a78a4a8e31631) | success | 25803820 |
| Drill: rearm the market | [`0x37531e96…128381`](https://explorer.arc.io/tx/0x37531e964b53e5e2b4697d266cbac9051998f6eac3d071c2436712647f128381) | success | 25803831 |

## Underwriter exit

| | Transaction | Status | Block |
|---|---|---|---|
| Underwriter requests a redemption (ERC-7540) | [`0xb09068fb…acf235`](https://explorer.arc.io/tx/0xb09068fb06ea9e459e030971671a2a493509e759b248536773ee95512facf235) | success | 25803518 |
| Drill-pool underwriter queues an exit during the incident | [`0x3a29f0fd…d62d1b`](https://explorer.arc.io/tx/0x3a29f0fdbbd8c7cbbf6dda264b3be5ca5dcdb124687fc2d134a08c1c12d62d1b) | success | 25803570 |

## Reproduce

```sh
# read every live trigger, deposit into Galaxy's Morpho vault and buy cover in one Multicall3From
# transaction, and run a paid drill, all against a fork of current Arc mainnet state
cd contracts
arc-forge test --match-path "test/fork/*" --fork-url https://rpc.mainnet.arc.io -vv
```

Arc's USDC lives behind protocol precompiles, so fork tests need [Arc Foundry](https://github.com/circlefin/arc-foundry)
(`arc-forge`); stock Foundry cannot move USDC on a fork.
