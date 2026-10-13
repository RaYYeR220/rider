// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PolicyArt} from "./libraries/PolicyArt.sol";

interface IPolicyCardSource {
    function policyCard(uint256 policyId)
        external
        view
        returns (
            string memory marketName,
            string memory kind,
            uint256 coverage,
            uint256 premium,
            uint256 start,
            uint256 end,
            uint8 state,
            uint256 payout
        );
}

/// @title RiderPolicy
/// @notice One ERC-721 per policy, across every Rider market. The NFT is the claim: payouts go to
///         whoever holds it when the claim is paid, so cover can travel with the position it protects.
/// @dev Minted with `_mint`, not `_safeMint`, so a receiving contract cannot re-enter a purchase.
contract RiderPolicy is ERC721, Ownable {
    address public registrar;
    uint256 public nextId = 1;
    mapping(address market => bool) public isMinter;
    mapping(uint256 policyId => address) public marketOf;

    event RegistrarSet(address registrar);
    event MinterAdded(address indexed market);

    error NotRegistrar();
    error NotMinter();
    error RegistrarAlreadySet();

    constructor(address owner_) ERC721("Rider Policy", "RIDE") Ownable(owner_) {}

    /// @notice One-time wiring of the factory that registers markets.
    function setRegistrar(address registrar_) external onlyOwner {
        if (registrar != address(0)) revert RegistrarAlreadySet();
        registrar = registrar_;
        emit RegistrarSet(registrar_);
    }

    function addMinter(address market) external {
        if (msg.sender != registrar) revert NotRegistrar();
        isMinter[market] = true;
        emit MinterAdded(market);
    }

    function mint(address to) external returns (uint256 policyId) {
        if (!isMinter[msg.sender]) revert NotMinter();
        policyId = nextId++;
        marketOf[policyId] = msg.sender;
        _mint(to, policyId);
    }

    function tokenURI(uint256 policyId) public view override returns (string memory) {
        _requireOwned(policyId);
        (
            string memory marketName,
            string memory kind,
            uint256 coverage,
            uint256 premium,
            uint256 start,
            uint256 end,
            uint8 state,
            uint256 payout
        ) = IPolicyCardSource(marketOf[policyId]).policyCard(policyId);
        return PolicyArt.tokenURI(
            PolicyArt.Card({
                id: policyId,
                market: marketOf[policyId],
                marketName: marketName,
                kind: kind,
                coverage: coverage,
                premium: premium,
                start: start,
                end: end,
                state: state,
                payout: payout
            })
        );
    }
}
