// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    IAgentRequester,
    IAgentRequesterHandler,
    IJsonApiAgent,
    Request,
    Response,
    ResponseStatus
} from "./interfaces/IAgentPlatform.sol";

contract BtcPriceOracleGuide is IAgentRequesterHandler {
    IAgentRequester public immutable platform;
    uint256 public constant JSON_API_AGENT_ID = 13174292974160097713;
    uint256 public constant SUBCOMMITTEE_SIZE = 3;
    uint256 public constant PRICE_PER_AGENT = 0.03 ether;

    uint256 public latestPrice;
    uint256 public latestRequestId;
    ResponseStatus public latestStatus;
    mapping(uint256 requestId => bool pending) public pendingRequests;

    event PriceRequested(uint256 indexed requestId);
    event PriceReceived(uint256 indexed requestId, uint256 price);
    event PriceFinalized(uint256 indexed requestId, ResponseStatus status, uint256 responseCount);

    constructor(address platform_) {
        platform = IAgentRequester(platform_);
    }

    function requiredFee() public view returns (uint256) {
        return platform.getRequestDeposit() + PRICE_PER_AGENT * SUBCOMMITTEE_SIZE;
    }

    function requestBitcoinPrice() external payable returns (uint256 requestId) {
        bytes memory payload = abi.encodeWithSelector(
            IJsonApiAgent.fetchUint.selector,
            "https://api.coinbase.com/v2/prices/ETH-USD/spot",
            "data.amount",
            uint8(18)
        );

        uint256 deposit = requiredFee();
        require(msg.value >= deposit, "Underfunded");

        requestId = platform.createRequest{ value: deposit }(
            JSON_API_AGENT_ID,
            address(this),
            this.handleResponse.selector,
            payload
        );
        pendingRequests[requestId] = true;
        latestRequestId = requestId;
        emit PriceRequested(requestId);
    }

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external override {
        require(msg.sender == address(platform), "Only platform");
        require(pendingRequests[requestId], "Unknown request");
        delete pendingRequests[requestId];

        latestStatus = status;
        emit PriceFinalized(requestId, status, responses.length);

        if (status == ResponseStatus.Success && responses.length > 0) {
            latestPrice = abi.decode(responses[0].result, (uint256));
            emit PriceReceived(requestId, latestPrice);
        }
    }

    receive() external payable { }
}
