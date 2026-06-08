// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct Response {
    bytes result;
}

enum ResponseStatus {
    Success,
    Failed,
    TimedOut
}

struct Request {
    uint256 agentId;
    address requester;
    address callback;
    bytes4 callbackSelector;
    bytes payload;
}

interface IAgentRequesterHandler {
    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory details
    ) external;
}

interface IAgentRequester {
    function getRequestDeposit() external view returns (uint256);

    function createRequest(
        uint256 agentId,
        address callback,
        bytes4 callbackSelector,
        bytes calldata payload
    ) external payable returns (uint256 requestId);
}

interface ILLMAgent {
    function inferString(
        string calldata prompt,
        string calldata systemPrompt,
        bool chainOfThought,
        string[] calldata allowedValues
    ) external returns (string memory);
}

interface IJsonApiAgent {
    function fetchString(string calldata url, string calldata selector)
        external
        returns (string memory);
}
