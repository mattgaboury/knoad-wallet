// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Execution} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {KnoadAccount} from "../src/KnoadAccount.sol";
import {KnoadHarness} from "./Knoad.t.sol";

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @dev Minimal ERC-721. Seaport calls transferFrom, not the safe variant.
contract OfferNft {
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => address) public getApproved;

    function mint(address to, uint256 id) external {
        ownerOf[id] = to;
    }

    function approve(address to, uint256 id) external {
        require(msg.sender == ownerOf[id], "owner");
        getApproved[id] = to;
    }

    function transferFrom(address from, address to, uint256 id) external {
        require(from == ownerOf[id], "from");
        require(msg.sender == from || getApproved[id] == msg.sender, "auth");
        delete getApproved[id];
        ownerOf[id] = to;
    }
}

interface ISeaport {
    enum ItemType {
        NATIVE,
        ERC20,
        ERC721,
        ERC1155,
        ERC721_WITH_CRITERIA,
        ERC1155_WITH_CRITERIA
    }

    enum OrderType {
        FULL_OPEN,
        PARTIAL_OPEN,
        FULL_RESTRICTED,
        PARTIAL_RESTRICTED,
        CONTRACT
    }

    struct OfferItem {
        ItemType itemType;
        address token;
        uint256 identifierOrCriteria;
        uint256 startAmount;
        uint256 endAmount;
    }

    struct ConsiderationItem {
        ItemType itemType;
        address token;
        uint256 identifierOrCriteria;
        uint256 startAmount;
        uint256 endAmount;
        address payable recipient;
    }

    struct OrderComponents {
        address offerer;
        address zone;
        OfferItem[] offer;
        ConsiderationItem[] consideration;
        OrderType orderType;
        uint256 startTime;
        uint256 endTime;
        bytes32 zoneHash;
        uint256 salt;
        bytes32 conduitKey;
        uint256 counter;
    }

    struct OrderParameters {
        address offerer;
        address zone;
        OfferItem[] offer;
        ConsiderationItem[] consideration;
        OrderType orderType;
        uint256 startTime;
        uint256 endTime;
        bytes32 zoneHash;
        uint256 salt;
        bytes32 conduitKey;
        uint256 totalOriginalConsiderationItems;
    }

    struct Order {
        OrderParameters parameters;
        bytes signature;
    }

    function getCounter(address offerer) external view returns (uint256);
    function getOrderHash(OrderComponents calldata order) external view returns (bytes32);
    function information() external view returns (string memory version, bytes32 domainSeparator, address conduitController);
    function fulfillOrder(Order calldata order, bytes32 fulfillerConduitKey) external payable returns (bool);
}

/// @notice A real Seaport fill on a mainnet fork. Skipped when MAINNET_RPC_URL is unset.
contract SeaportOfferForkTest is KnoadHarness {
    address internal constant SEAPORT = 0x0000000000000068F116a894984e2DB1123eB395;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    function setUp() public override {
        string memory url = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(url).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(url);
        vm.deal(address(this), 100 ether);
        super.setUp();
    }

    function test_wethOfferFillsAfterTwoRotations() public {
        (ISeaport.Order memory order, bytes32 digest, address seller, OfferNft nft) = _openBid();
        address first = vm.addr(0xA11CE);
        _rotate("", 0x222, 1);
        _rotate("", 0x333, 1);
        assertTrue(account.hotSigner() != first);

        assertEq(account.isValidSignature(digest, ""), bytes4(0xffffffff));
        vm.prank(SEAPORT);
        assertEq(account.isValidSignature(digest, ""), ERC1271_MAGIC);

        vm.prank(seller);
        assertTrue(ISeaport(SEAPORT).fulfillOrder(order, bytes32(0)));
        assertEq(nft.ownerOf(1), address(account));
        assertEq(IERC20(WETH).balanceOf(seller), 1 ether);
        assertEq(IERC20(WETH).balanceOf(address(account)), 0);
    }

    function test_revokedWethOfferDoesNotFill() public {
        (ISeaport.Order memory order, bytes32 digest, address seller, OfferNft nft) = _openBid();
        _rotate(
            _batch(address(account), 0, abi.encodeCall(KnoadAccount.revokeOrderDigest, (digest))),
            0x222,
            1
        );
        vm.prank(SEAPORT);
        assertEq(account.isValidSignature(digest, ""), bytes4(0xffffffff));

        vm.prank(seller);
        vm.expectRevert();
        ISeaport(SEAPORT).fulfillOrder(order, bytes32(0));
        assertEq(nft.ownerOf(1), seller);
        assertEq(IERC20(WETH).balanceOf(address(account)), 1 ether);
    }

    function _openBid() internal returns (ISeaport.Order memory order, bytes32 digest, address seller, OfferNft nft) {
        ISeaport seaport = ISeaport(SEAPORT);
        deal(WETH, address(account), 1 ether);
        seller = makeAddr("seller");
        nft = new OfferNft();
        nft.mint(seller, 1);
        vm.prank(seller);
        nft.approve(SEAPORT, 1);

        ISeaport.OfferItem[] memory offer = new ISeaport.OfferItem[](1);
        offer[0] = ISeaport.OfferItem({
            itemType: ISeaport.ItemType.ERC20,
            token: WETH,
            identifierOrCriteria: 0,
            startAmount: 1 ether,
            endAmount: 1 ether
        });
        ISeaport.ConsiderationItem[] memory consideration = new ISeaport.ConsiderationItem[](1);
        consideration[0] = ISeaport.ConsiderationItem({
            itemType: ISeaport.ItemType.ERC721,
            token: address(nft),
            identifierOrCriteria: 1,
            startAmount: 1,
            endAmount: 1,
            recipient: payable(address(account))
        });
        uint256 endTime = block.timestamp + 1 days;
        ISeaport.OrderComponents memory components = ISeaport.OrderComponents({
            offerer: address(account),
            zone: address(0),
            offer: offer,
            consideration: consideration,
            orderType: ISeaport.OrderType.FULL_OPEN,
            startTime: block.timestamp,
            endTime: endTime,
            zoneHash: bytes32(0),
            salt: 1,
            conduitKey: bytes32(0),
            counter: seaport.getCounter(address(account))
        });
        bytes32 orderHash = seaport.getOrderHash(components);
        (, bytes32 domainSeparator,) = seaport.information();
        // getOrderHash is only the struct hash. Seaport asks isValidSignature for the EIP-712 digest.
        digest = keccak256(abi.encodePacked(bytes2(0x1901), domainSeparator, orderHash));
        _rotate(
            _two(
                WETH,
                abi.encodeCall(IERC20.approve, (SEAPORT, 1 ether)),
                address(account),
                abi.encodeCall(KnoadAccount.approveOrderDigest, (digest, SEAPORT, uint64(endTime)))
            ),
            0x111,
            1
        );
        order = ISeaport.Order({
            parameters: ISeaport.OrderParameters({
                offerer: components.offerer,
                zone: components.zone,
                offer: offer,
                consideration: consideration,
                orderType: components.orderType,
                startTime: components.startTime,
                endTime: components.endTime,
                zoneHash: components.zoneHash,
                salt: components.salt,
                conduitKey: components.conduitKey,
                totalOriginalConsiderationItems: 1
            }),
            signature: ""
        });
    }

    function _two(address first, bytes memory firstData, address second, bytes memory secondData)
        internal
        pure
        returns (bytes memory)
    {
        Execution[] memory calls = new Execution[](2);
        calls[0] = Execution({target: first, value: 0, callData: firstData});
        calls[1] = Execution({target: second, value: 0, callData: secondData});
        return abi.encode(calls);
    }
}
