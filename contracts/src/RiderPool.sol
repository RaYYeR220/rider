// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

import {IRiderMarket} from "./interfaces/IRiderMarket.sol";

/// @title RiderPool
/// @notice Underwriting capital for a set of Rider markets. Underwriters deposit USDC, earn premiums
///         as they vest, and bear the claims of the markets the pool backs.
///
/// Accounting
///   totalAssets = USDC held − premium not yet earned
///   locked      = Σ coverage the markets must be able to pay
///   free        = totalAssets − locked
///
/// - Fully collateralised: markets sell cover only out of `free`, so every policy is backed even if
///   every market fires at once.
/// - Premiums vest linearly over each policy's term, so a deposit made right before a large premium
///   cannot skim it.
/// - Withdrawals are asynchronous (ERC-7540): request, wait `cooldown`, then claim at the price of the
///   day. Escrowed shares keep bearing losses while they wait, so an underwriter who sees trouble
///   coming cannot step out from under it.
/// - While any market has an incident open, deposits and withdrawals are closed.
/// - The owner can stop a market selling new cover. The owner cannot stop a claim, an incident, a
///   settlement or a withdrawal, and cannot move pool funds.
contract RiderPool is ERC4626, Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    struct Request {
        uint256 shares;
        uint64 claimableAt;
    }

    uint256 public constant MAX_MARKETS = 16;
    uint256 private constant REQUEST_ID = 0;

    uint256 public immutable cooldown;
    /// @notice How long a market added after underwriters have joined must wait before it can sell.
    ///         Longer than `cooldown`, so an underwriter who objects to a new risk can leave first.
    uint256 public immutable marketDelay;
    /// @notice If set, the only address allowed to deposit. The drill pool is fenced this way because
    ///         its markets are broken on purpose.
    address public immutable restrictedDepositor;
    address public registrar;

    address[] internal _markets;
    mapping(address market => bool) public isMarket;
    mapping(address market => bool) public salesPaused;
    mapping(address market => uint256) public activeFrom;
    mapping(address controller => Request) internal _requests;
    mapping(address controller => mapping(address operator => bool)) public isOperator;

    event RegistrarSet(address registrar);
    event MarketAdded(address indexed market, uint256 activeFrom);
    event SalesPausedSet(address indexed market, bool paused);
    event Payout(address indexed market, address indexed to, uint256 amount);
    event OperatorSet(address indexed controller, address indexed operator, bool approved);
    event RedeemRequest(
        address indexed controller, address indexed owner, uint256 indexed requestId, address sender, uint256 shares
    );

    error NotRegistrar();
    error NotMarket();
    error RegistrarAlreadySet();
    error TooManyMarkets();
    error PoolFrozen();
    error NotAuthorized();
    error ZeroShares();
    error NotClaimable(uint256 requested, uint256 claimable);
    error ExceedsFreeAssets(uint256 assets, uint256 free);
    error AsyncRedeem();
    error ZeroAddress();
    error DepositorNotAllowed(address depositor);

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        uint256 cooldown_,
        uint256 marketDelay_,
        address restrictedDepositor_,
        address owner_
    ) ERC20(name_, symbol_) ERC4626(asset_) Ownable(owner_) {
        require(marketDelay_ > cooldown_, "market delay must exceed cooldown");
        cooldown = cooldown_;
        marketDelay = marketDelay_;
        restrictedDepositor = restrictedDepositor_;
    }

    // ─────────────────────────────────────────────────────────────── wiring

    /// @notice One-time wiring of the factory allowed to register markets.
    function setRegistrar(address registrar_) external onlyOwner {
        if (registrar != address(0)) revert RegistrarAlreadySet();
        if (registrar_ == address(0)) revert ZeroAddress();
        registrar = registrar_;
        emit RegistrarSet(registrar_);
    }

    function addMarket(address market) external {
        if (msg.sender != registrar) revert NotRegistrar();
        if (_markets.length >= MAX_MARKETS) revert TooManyMarkets();
        _markets.push(market);
        isMarket[market] = true;
        // Before anyone has underwritten, there is nobody to warn. After that, a new risk waits long
        // enough for any underwriter to request an exit and leave before it can sell a policy.
        uint256 from = totalSupply() == 0 ? block.timestamp : block.timestamp + marketDelay;
        activeFrom[market] = from;
        emit MarketAdded(market, from);
    }

    /// @notice Whether `market` may sell new cover right now.
    function salesOpen(address market) external view returns (bool) {
        return isMarket[market] && !salesPaused[market] && block.timestamp >= activeFrom[market];
    }

    /// @notice Stop or resume new cover in one market. Existing policies and claims are unaffected.
    function setSalesPaused(address market, bool paused) external onlyOwner {
        if (!isMarket[market]) revert NotMarket();
        salesPaused[market] = paused;
        emit SalesPausedSet(market, paused);
    }

    /// @notice Pay a claim. Only a registered market can call this, and only for its own policies.
    function payout(address to, uint256 amount) external nonReentrant {
        if (!isMarket[msg.sender]) revert NotMarket();
        IERC20(asset()).safeTransfer(to, amount);
        emit Payout(msg.sender, to, amount);
    }

    // ─────────────────────────────────────────────────────────────── accounting

    function totalAssets() public view override returns (uint256) {
        uint256 cash = IERC20(asset()).balanceOf(address(this));
        uint256 unearned;
        for (uint256 i; i < _markets.length; ++i) {
            unearned += IRiderMarket(_markets[i]).unearnedPremium();
        }
        return cash > unearned ? cash - unearned : 0;
    }

    /// @notice Capital committed to live cover and open incidents.
    function lockedAssets() public view returns (uint256 locked) {
        for (uint256 i; i < _markets.length; ++i) {
            locked += IRiderMarket(_markets[i]).lockedCoverage();
        }
    }

    /// @notice Capital that can back new cover or be withdrawn.
    function freeAssets() public view returns (uint256) {
        uint256 assets = totalAssets();
        uint256 locked = lockedAssets();
        return assets > locked ? assets - locked : 0;
    }

    /// @notice True while any market is firing, has an incident pending, or has a claim window open.
    function frozen() public view returns (bool) {
        for (uint256 i; i < _markets.length; ++i) {
            if (IRiderMarket(_markets[i]).isFrozen()) return true;
        }
        return false;
    }

    function markets() external view returns (address[] memory) {
        return _markets;
    }

    // ─────────────────────────────────────────────────────────────── deposits (sync)

    function maxDeposit(address receiver) public view override returns (uint256) {
        return frozen() ? 0 : super.maxDeposit(receiver);
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return frozen() ? 0 : super.maxMint(receiver);
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant returns (uint256) {
        _checkDepositor();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant returns (uint256) {
        _checkDepositor();
        return super.mint(shares, receiver);
    }

    function _checkDepositor() private view {
        if (restrictedDepositor != address(0) && msg.sender != restrictedDepositor) revert DepositorNotAllowed(msg.sender);
    }

    // ─────────────────────────────────────────────────────────────── redemptions (ERC-7540, async)

    /// @notice Escrow `shares` from `owner` and start the cooldown for `controller`.
    /// @dev Requests aggregate per controller under request id 0; adding to a request restarts its
    ///      cooldown.
    function requestRedeem(uint256 shares, address controller, address owner)
        external
        nonReentrant
        returns (uint256 requestId)
    {
        if (shares == 0) revert ZeroShares();
        // Only the controller (or its operator) may add to its request: otherwise anyone could restart
        // someone else's cooldown with one share-wei, forever.
        if (controller != msg.sender && !isOperator[controller][msg.sender]) revert NotAuthorized();
        if (owner != msg.sender && !isOperator[owner][msg.sender]) {
            _spendAllowance(owner, msg.sender, shares);
        }
        _transfer(owner, address(this), shares);
        Request storage r = _requests[controller];
        r.shares += shares;
        r.claimableAt = uint64(block.timestamp + cooldown);
        emit RedeemRequest(controller, owner, REQUEST_ID, msg.sender, shares);
        return REQUEST_ID;
    }

    function pendingRedeemRequest(uint256, address controller) public view returns (uint256) {
        Request storage r = _requests[controller];
        return block.timestamp < r.claimableAt ? r.shares : 0;
    }

    function claimableRedeemRequest(uint256, address controller) public view returns (uint256) {
        Request storage r = _requests[controller];
        return block.timestamp >= r.claimableAt ? r.shares : 0;
    }

    /// @notice When a request becomes claimable, and how many shares it holds.
    function redeemRequest(address controller) external view returns (uint256 shares, uint256 claimableAt) {
        Request storage r = _requests[controller];
        return (r.shares, r.claimableAt);
    }

    function setOperator(address operator, bool approved) external returns (bool) {
        isOperator[msg.sender][operator] = approved;
        emit OperatorSet(msg.sender, operator, approved);
        return true;
    }

    function maxRedeem(address controller) public view override returns (uint256) {
        if (frozen()) return 0;
        uint256 claimable = claimableRedeemRequest(REQUEST_ID, controller);
        uint256 byCapital = _convertToShares(freeAssets(), Math.Rounding.Floor);
        return Math.min(claimable, byCapital);
    }

    function maxWithdraw(address controller) public view override returns (uint256) {
        return _convertToAssets(maxRedeem(controller), Math.Rounding.Floor);
    }

    /// @notice Claim a matured request for `shares`, paying the assets to `receiver`.
    function redeem(uint256 shares, address receiver, address controller)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        assets = _convertToAssets(shares, Math.Rounding.Floor);
        _claim(assets, shares, receiver, controller);
    }

    /// @notice Claim a matured request for exactly `assets`, paying them to `receiver`.
    function withdraw(uint256 assets, address receiver, address controller)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        shares = _convertToShares(assets, Math.Rounding.Ceil);
        _claim(assets, shares, receiver, controller);
    }

    /// @dev ERC-7540: previews are undefined for asynchronous flows and must revert.
    function previewRedeem(uint256) public pure override returns (uint256) {
        revert AsyncRedeem();
    }

    function previewWithdraw(uint256) public pure override returns (uint256) {
        revert AsyncRedeem();
    }

    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return interfaceId == type(IERC165).interfaceId // ERC-165
            || interfaceId == 0xe3bc4e65 // ERC-7540 operator methods
            || interfaceId == 0x620ee8e4 // ERC-7540 asynchronous redemption
            || interfaceId == 0x2f0a18c5; // ERC-7575
    }

    /// @notice ERC-7575: this vault is its own share token.
    function share() external view returns (address) {
        return address(this);
    }

    function _claim(uint256 assets, uint256 shares, address receiver, address controller) private {
        if (controller != msg.sender && !isOperator[controller][msg.sender]) revert NotAuthorized();
        if (frozen()) revert PoolFrozen();
        uint256 claimable = claimableRedeemRequest(REQUEST_ID, controller);
        if (shares == 0 || shares > claimable) revert NotClaimable(shares, claimable);
        uint256 free = freeAssets();
        if (assets > free) revert ExceedsFreeAssets(assets, free);

        _requests[controller].shares = claimable - shares;
        _burn(address(this), shares);
        IERC20(asset()).safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, controller, assets, shares);
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
