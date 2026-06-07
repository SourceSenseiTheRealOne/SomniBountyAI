// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    IAgentRequester,
    IAgentRequesterHandler,
    Request,
    Response,
    ResponseStatus
} from "../../src/interfaces/IAgentPlatform.sol";

contract MockAgentPlatform is IAgentRequester {
    uint256 public nextRequestId = 1;
    uint256 public requestDeposit = 0.03 ether;

    mapping(uint256 requestId => Request request) public requests;
    mapping(uint256 requestId => uint256 feePaid) public requestFees;

    event MockRequestCreated(
        uint256 indexed requestId,
        uint256 indexed agentId,
        address indexed callback,
        uint256 feePaid
    );

    function setRequestDeposit(uint256 requestDeposit_) external {
        requestDeposit = requestDeposit_;
    }

    function getRequestDeposit() external view override returns (uint256) {
        return requestDeposit;
    }

    function createRequest(
        uint256 agentId,
        address callback,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable override returns (uint256 requestId) {
        requestId = nextRequestId++;
        requests[requestId] = Request({
            agentId: agentId,
            requester: msg.sender,
            callback: callback,
            callbackSelector: callbackSelector,
            payload: payload
        });
        requestFees[requestId] = msg.value;
        emit MockRequestCreated(requestId, agentId, callback, msg.value);
    }

    function fulfillString(uint256 requestId, ResponseStatus status, string calldata verdict)
        external
    {
        Request memory request = requests[requestId];
        require(request.callback != address(0), "missing request");

        Response[] memory responses = new Response[](status == ResponseStatus.Success ? 1 : 0);
        if (status == ResponseStatus.Success) {
            responses[0] = Response({ result: abi.encode(verdict) });
        }

        IAgentRequesterHandler(request.callback)
            .handleResponse(requestId, responses, status, request);
    }
}

