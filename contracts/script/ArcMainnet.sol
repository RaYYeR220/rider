// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Arc mainnet (chain 5042) addresses Rider builds on. Each one was checked on-chain.
library ArcMainnet {
    uint256 internal constant CHAIN_ID = 5042;

    // Circle
    address internal constant USDC = 0x3600000000000000000000000000000000000000;
    address internal constant EURC = 0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1;
    address internal constant CIRBTC = 0x171A4217b86A807A64eB94757Db6849fb4bDbAA0;
    address internal constant GATEWAY_WALLET = 0x77777777Dcc4d5A8B6E418Fd04D8997ef11000eE;

    // Arc transaction extensions
    address internal constant MULTICALL3_FROM = 0x522fAf9A91c41c443c66765030741e4AaCe147D0;
    address internal constant MEMO = 0x5294E9927c3306DcBaDb03fe70b92e01cCede505;

    // Morpho Vault V2 vaults listed by Circle's Earn Kit
    address internal constant GALAXY_USDC = 0x8E357432CC12ff425c36432F312968aEb16112AF;
    address internal constant KEYROCK_USDC = 0x5bEfAb92a5A3D60F578Cb51EEb4e4FD50a1e3123;

    // Chainlink on Arc
    address internal constant FEED_EURC_USD = 0x361b95c10b76Ca3f35C686d423e43A951755Bf23;
    address internal constant FEED_EUR_USD = 0xDd5B15443cd733D3966a50a3E48cB7DF9Fb5DE0D;
    address internal constant FEED_USDC_USD = 0x84EA90AC252Dc437031461836DB5164219147905;
    address internal constant FEED_CIRBTC_POR = 0xEB0884a871ea1f6483B5FC10fd3D7dC5806411fc;
}
