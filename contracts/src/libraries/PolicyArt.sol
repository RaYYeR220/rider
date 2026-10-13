// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title PolicyArt
/// @notice Renders a policy as a fully on-chain SVG certificate plus ERC-721 metadata.
library PolicyArt {
    using Strings for uint256;
    using Strings for address;

    struct Card {
        uint256 id;
        address market;
        string marketName;
        string kind;
        uint256 coverage;
        uint256 premium;
        uint256 start;
        uint256 end;
        uint8 state;
        uint256 payout;
    }

    function tokenURI(Card memory c) internal pure returns (string memory) {
        string memory json = string.concat(
            '{"name":"Rider Policy #',
            c.id.toString(),
            '","description":"Parametric cover on Arc. Pays its holder when the trigger is proven on-chain.","image":"data:image/svg+xml;base64,',
            Base64.encode(bytes(svg(c))),
            '","attributes":[',
            _attr("Market", c.marketName, false),
            _attr("Trigger", c.kind, false),
            _attr("Coverage (USDC)", _usdc(c.coverage), false),
            _attr("Premium (USDC)", _usdc(c.premium), false),
            _attr("Status", _state(c.state), false),
            '{"trait_type":"Expires","display_type":"date","value":',
            c.end.toString(),
            "}]}"
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function svg(Card memory c) internal pure returns (string memory) {
        return string.concat(_head(c), _figures(c), _foot(c));
    }

    function _head(Card memory c) private pure returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 380" font-family="ui-monospace,Menlo,monospace">',
            '<rect width="600" height="380" fill="#f1efe9"/>',
            '<rect x="16.5" y="16.5" width="567" height="347" fill="none" stroke="#14130f" stroke-opacity=".14"/>',
            _grid(),
            '<text x="40" y="66" font-family="Georgia,serif" font-size="30" letter-spacing="-1" fill="#14130f">Rider</text>',
            '<text x="560" y="66" text-anchor="end" font-size="13" fill="#14130f" fill-opacity=".55">POLICY No. ',
            c.id.toString(),
            '</text><text x="40" y="118" font-size="15" fill="#14130f">',
            c.marketName,
            '</text><text x="40" y="140" font-size="11" fill="#14130f" fill-opacity=".55">TRIGGER ',
            c.kind,
            " / MARKET ",
            Strings.toHexString(uint160(c.market) >> 128, 4),
            "</text>"
        );
    }

    function _figures(Card memory c) private pure returns (string memory) {
        string memory paid =
            c.state == 3 || c.state == 2 ? _row(230, 262, "PAYOUT", string.concat(_usdc(c.payout), " USDC")) : "";
        return string.concat(
            _row(40, 200, "COVERAGE", string.concat(_usdc(c.coverage), " USDC")),
            _row(230, 200, "PREMIUM", string.concat(_usdc(c.premium), " USDC")),
            _row(420, 200, "TERM", _term(c.end - c.start)),
            _row(40, 262, "STATUS", _state(c.state)),
            paid,
            _row(420, 262, "EXPIRES", string.concat("t=", c.end.toString()))
        );
    }

    function _foot(Card memory c) private pure returns (string memory) {
        return string.concat(
            '<path d="M40 318 H560" stroke="#14130f" stroke-opacity=".14"/>',
            '<text x="40" y="344" font-size="10" fill="#14130f" fill-opacity=".5">PAYS THE HOLDER OF THIS TOKEN WHEN THE TRIGGER IS PROVEN ON ARC</text>',
            '<circle cx="552" cy="340" r="6" fill="',
            _dot(c.state),
            '"/></svg>'
        );
    }

    function _grid() private pure returns (string memory) {
        return string.concat(
            '<g stroke="#14130f" stroke-opacity=".05">',
            '<path d="M40 160 H560 M40 222 H560 M40 284 H560"/>',
            '<path d="M220 160 V284 M410 160 V284"/></g>'
        );
    }

    function _row(uint256 x, uint256 y, string memory label, string memory value) private pure returns (string memory) {
        return string.concat(
            '<text x="',
            x.toString(),
            '" y="',
            (y - 20).toString(),
            '" font-size="10" fill="#14130f" fill-opacity=".5">',
            label,
            '</text><text x="',
            x.toString(),
            '" y="',
            y.toString(),
            '" font-size="16" fill="#14130f">',
            value,
            "</text>"
        );
    }

    function _attr(string memory k, string memory v, bool last) private pure returns (string memory) {
        return string.concat('{"trait_type":"', k, '","value":"', v, last ? '"}' : '"},');
    }

    function _state(uint8 s) private pure returns (string memory) {
        if (s == 0) return "LIVE";
        if (s == 1) return "EXPIRED";
        if (s == 2) return "CLAIMABLE";
        if (s == 3) return "PAID";
        return "RETIRED";
    }

    function _dot(uint8 s) private pure returns (string memory) {
        if (s == 0) return "#2f6b4f";
        if (s == 2 || s == 3) return "#c2410c";
        return "#8a877f";
    }

    function _term(uint256 secs) private pure returns (string memory) {
        if (secs >= 1 days) return string.concat((secs / 1 days).toString(), "d ", ((secs % 1 days) / 1 hours).toString(), "h");
        if (secs >= 1 hours) return string.concat((secs / 1 hours).toString(), "h ", ((secs % 1 hours) / 1 minutes).toString(), "m");
        return string.concat((secs / 1 minutes).toString(), "m ", (secs % 1 minutes).toString(), "s");
    }

    /// @dev 6-decimal amount with trailing zeros trimmed, keeping at least two decimals.
    function _usdc(uint256 amount) private pure returns (string memory) {
        uint256 whole = amount / 1e6;
        uint256 frac = amount % 1e6;
        bytes memory digits = bytes(frac.toString());
        bytes memory padded = new bytes(6);
        for (uint256 i; i < 6; ++i) {
            padded[i] = i < 6 - digits.length ? bytes1("0") : digits[i - (6 - digits.length)];
        }
        uint256 len = 6;
        while (len > 2 && padded[len - 1] == "0") --len;
        bytes memory out = new bytes(len);
        for (uint256 i; i < len; ++i) {
            out[i] = padded[i];
        }
        return string.concat(whole.toString(), ".", string(out));
    }
}
