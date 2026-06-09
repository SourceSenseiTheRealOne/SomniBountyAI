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

contract AgentJsonSmoke is IAgentRequesterHandler {
    error InvalidPlatform();
    error InvalidRequest();
    error Underfunded();
    error RefundFailed();

    IAgentRequester public immutable platform;
    uint256 public immutable jsonAgentId;
    uint256 public immutable pricePerValidator;
    uint8 public immutable subcommitteeSize;

    uint256 public latestRequestId;
    ResponseStatus public latestStatus;
    string public latestResult;
    uint256 public latestUintResult;

    mapping(uint256 requestId => bool pending) public pendingRequests;

    event SmokeRequested(uint256 indexed requestId, string url, string selector, uint256 fee);
    event SmokeReceived(uint256 indexed requestId, ResponseStatus status, string result);
    event SmokeUintReceived(uint256 indexed requestId, ResponseStatus status, uint256 result);

    constructor(
        address platform_,
        uint256 jsonAgentId_,
        uint256 pricePerValidator_,
        uint8 subcommitteeSize_
    ) {
        if (platform_ == address(0)) revert InvalidPlatform();
        platform = IAgentRequester(platform_);
        jsonAgentId = jsonAgentId_;
        pricePerValidator = pricePerValidator_;
        subcommitteeSize = subcommitteeSize_;
    }

    receive() external payable { }

    function requiredFee() public view returns (uint256) {
        return platform.getRequestDeposit() + pricePerValidator * subcommitteeSize;
    }

    function requestString(string calldata url, string calldata selector)
        external
        payable
        returns (uint256 requestId)
    {
        uint256 fee = requiredFee();
        if (msg.value < fee) revert Underfunded();

        bytes memory payload = abi.encodeWithSelector(IJsonApiAgent.fetchString.selector, url, selector);
        requestId = platform.createRequest{ value: fee }(
            jsonAgentId, address(this), this.handleResponse.selector, payload
        );

        pendingRequests[requestId] = true;
        latestRequestId = requestId;
        emit SmokeRequested(requestId, url, selector, fee);

        if (msg.value > fee) {
            (bool refunded,) = msg.sender.call{ value: msg.value - fee }("");
            if (!refunded) revert RefundFailed();
        }
    }

    function requestUint(string calldata url, string calldata selector, uint8 decimals)
        external
        payable
        returns (uint256 requestId)
    {
        uint256 fee = requiredFee();
        if (msg.value < fee) revert Underfunded();

        bytes memory payload =
            abi.encodeWithSelector(IJsonApiAgent.fetchUint.selector, url, selector, decimals);
        requestId = platform.createRequest{ value: fee }(
            jsonAgentId, address(this), this.handleResponse.selector, payload
        );

        pendingRequests[requestId] = true;
        latestRequestId = requestId;
        emit SmokeRequested(requestId, url, selector, fee);

        if (msg.value > fee) {
            (bool refunded,) = msg.sender.call{ value: msg.value - fee }("");
            if (!refunded) revert RefundFailed();
        }
    }

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external override {
        if (msg.sender != address(platform)) revert InvalidPlatform();
        if (!pendingRequests[requestId]) revert InvalidRequest();
        delete pendingRequests[requestId];

        latestStatus = status;
        string memory result = "";
        if (status == ResponseStatus.Success && responses.length > 0) {
            (bool stringOk, string memory stringResult) = _tryDecodeString(responses[0].result);
            if (stringOk) {
                result = stringResult;
                latestResult = result;
            } else {
                uint256 uintResult = abi.decode(responses[0].result, (uint256));
                latestUintResult = uintResult;
                emit SmokeUintReceived(requestId, status, uintResult);
                return;
            }
        }

        emit SmokeReceived(requestId, status, result);
    }

    function _tryDecodeString(bytes memory result) internal view returns (bool ok, string memory value) {
        if (result.length < 64) return (false, "");
        uint256 offset;
        assembly {
            offset := mload(add(result, 32))
        }
        if (offset != 32) return (false, "");
        try this.decodeStringForSmoke(result) returns (string memory decoded) {
            return (true, decoded);
        } catch {
            return (false, "");
        }
    }

    function decodeStringForSmoke(bytes memory result) external pure returns (string memory) {
        return abi.decode(result, (string));
    }
}
