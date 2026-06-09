// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAgentRequester, IJsonApiAgent} from "./interfaces/IAgentPlatform.sol";

contract AgentRawCallbackSmoke {
    IAgentRequester public immutable platform;
    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant PRICE_PER_AGENT = 0.03 ether;
    bytes4 public constant RAW_CALLBACK_SELECTOR = 0x12345678;

    uint256 public latestRequestId;
    uint256 public latestCallbackRequestId;
    uint256 public latestStatusWord;
    uint256 public latestCalldataLength;
    bytes4 public latestSelector;

    mapping(uint256 requestId => bool pending) public pendingRequests;

    event RawRequested(uint256 indexed requestId);
    event RawCallback(bytes4 indexed selector, uint256 indexed requestId, uint256 status, uint256 dataLength);

    constructor(address platform_) {
        platform = IAgentRequester(platform_);
    }

    function requiredFee() public view returns (uint256) {
        return platform.getRequestDeposit() + PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
    }

    function requestPrice() external payable returns (uint256 requestId) {
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
            "bitcoin.usd",
            uint8(8)
        );

        uint256 deposit = requiredFee();
        require(msg.value >= deposit, "Underfunded");
        requestId = platform.createRequest{value: deposit}(
            JSON_API_AGENT_ID,
            address(this),
            RAW_CALLBACK_SELECTOR,
            payload
        );
        pendingRequests[requestId] = true;
        latestRequestId = requestId;
        emit RawRequested(requestId);
    }

    fallback() external payable {
        require(msg.sender == address(platform), "Only platform");

        bytes4 selector;
        uint256 requestId;
        uint256 status;
        assembly {
            selector := shr(224, calldataload(0))
            requestId := calldataload(4)
            status := calldataload(68)
        }

        latestSelector = selector;
        latestCallbackRequestId = requestId;
        latestStatusWord = status;
        latestCalldataLength = msg.data.length;
        if (pendingRequests[requestId]) {
            delete pendingRequests[requestId];
        }
        emit RawCallback(selector, requestId, status, msg.data.length);
    }

    receive() external payable { }
}
