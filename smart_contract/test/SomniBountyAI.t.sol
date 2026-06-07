// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SomniBountyAI } from "../src/SomniBountyAI.sol";
import { ILLMAgent, Request, Response, ResponseStatus } from "../src/interfaces/IAgentPlatform.sol";
import { MockAgentPlatform } from "./mocks/MockAgentPlatform.sol";

interface Vm {
    function deal(address who, uint256 newBalance) external;
    function expectRevert(bytes4 selector) external;
    function prank(address msgSender) external;
    function warp(uint256 newTimestamp) external;
}

contract SomniBountyAITest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant AGENT_ID = 12847293847561029384;
    uint256 internal constant PRICE_PER_VALIDATOR = 0.07 ether;
    uint8 internal constant SUBCOMMITTEE_SIZE = 3;

    address internal sponsor = address(0xA11CE);
    address internal reporter = address(0xB0B);
    address internal fixer = address(0xCAFE);

    MockAgentPlatform internal platform;
    SomniBountyAI internal escrow;

    function setUp() public {
        platform = new MockAgentPlatform();
        escrow = new SomniBountyAI(
            address(platform), AGENT_ID, PRICE_PER_VALIDATOR, SUBCOMMITTEE_SIZE
        );
        vm.deal(sponsor, 100 ether);
        vm.deal(fixer, 100 ether);
        vm.warp(1_000);
    }

    function testConstructorStoresConfig() public view {
        require(address(escrow.agentPlatform()) == address(platform), "platform mismatch");
        require(escrow.agentId() == AGENT_ID, "agent mismatch");
        require(escrow.agentFeePerValidator() == PRICE_PER_VALIDATOR, "fee mismatch");
        require(escrow.subcommitteeSize() == SUBCOMMITTEE_SIZE, "subcommittee mismatch");
        require(escrow.nextProjectId() == 1, "unexpected next project id");
        require(escrow.nextIncidentId() == 1, "unexpected next incident id");
        require(escrow.nextFixId() == 1, "unexpected next fix id");
    }

    function testRegisterProject() public {
        uint256 projectId = escrow.registerProject("ipfs://project", bytes32("project"));
        SomniBountyAI.Project memory project = escrow.getProject(projectId);
        require(project.owner == address(this), "owner mismatch");
        require(project.active, "inactive project");
        require(project.metadataHash == bytes32("project"), "hash mismatch");
    }

    function testRegisterProjectRejectsEmptyMetadata() public {
        vm.expectRevert(SomniBountyAI.InvalidMetadataURI.selector);
        escrow.registerProject("", bytes32("project"));
    }

    function testOpenIncident() public {
        uint256 projectId = escrow.registerProject("ipfs://project", bytes32("project"));

        vm.prank(sponsor);
        uint256 incidentId = escrow.openIncident{ value: 1 ether }(
            projectId,
            reporter,
            uint64(block.timestamp + 1 days),
            5,
            bytes32("evidence"),
            "ipfs://incident"
        );

        SomniBountyAI.Incident memory incident = escrow.getIncident(incidentId);
        require(incident.projectId == projectId, "project mismatch");
        require(incident.sponsor == sponsor, "sponsor mismatch");
        require(incident.reporter == reporter, "reporter mismatch");
        require(incident.bounty == 1 ether, "bounty mismatch");
        require(uint8(incident.status) == uint8(SomniBountyAI.IncidentStatus.Open), "bad status");
    }

    function testOpenIncidentRejectsInvalidInputs() public {
        uint256 projectId = escrow.registerProject("ipfs://project", bytes32("project"));

        vm.expectRevert(SomniBountyAI.InvalidProject.selector);
        escrow.openIncident{ value: 1 ether }(
            404,
            reporter,
            uint64(block.timestamp + 1 days),
            5,
            bytes32("evidence"),
            "ipfs://incident"
        );

        vm.expectRevert(SomniBountyAI.InvalidBounty.selector);
        escrow.openIncident(
            projectId,
            reporter,
            uint64(block.timestamp + 1 days),
            5,
            bytes32("evidence"),
            "ipfs://incident"
        );

        vm.expectRevert(SomniBountyAI.InvalidDeadline.selector);
        escrow.openIncident{ value: 1 ether }(
            projectId, reporter, uint64(block.timestamp), 5, bytes32("evidence"), "ipfs://incident"
        );
    }

    function testSubmitFix() public {
        (uint256 incidentId,) = _openIncidentAndFix();
        SomniBountyAI.FixSubmission memory submittedFix = escrow.getFix(1);
        require(submittedFix.incidentId == incidentId, "incident mismatch");
        require(submittedFix.fixer == fixer, "fixer mismatch");
    }

    function testSubmitFixRejectsInvalidStates() public {
        uint256 projectId = escrow.registerProject("ipfs://project", bytes32("project"));
        vm.prank(sponsor);
        uint256 incidentId = escrow.openIncident{ value: 1 ether }(
            projectId,
            reporter,
            uint64(block.timestamp + 1 days),
            5,
            bytes32("evidence"),
            "ipfs://incident"
        );

        vm.expectRevert(SomniBountyAI.InvalidIncident.selector);
        escrow.submitFix(404, "https://github.com/demo/pr/128", bytes32("proof"));

        vm.expectRevert(SomniBountyAI.InvalidProofURI.selector);
        escrow.submitFix(incidentId, "", bytes32("proof"));

        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(SomniBountyAI.IncidentExpired.selector);
        escrow.submitFix(incidentId, "https://github.com/demo/pr/128", bytes32("proof"));
    }

    function testRequestReviewStoresPendingAndPaysFee() public {
        (, uint256 fixId) = _openIncidentAndFix();
        uint256 expectedFee = escrow.requiredReviewFee();

        vm.prank(fixer);
        uint256 requestId = escrow.requestFixReview{ value: expectedFee }(fixId);

        (, uint256 pendingFixId,, bool exists) = escrow.pendingReviews(requestId);
        require(exists, "missing review");
        require(pendingFixId == fixId, "fix mismatch");
        require(platform.requestFees(requestId) == expectedFee, "fee mismatch");
    }

    function testReviewPayloadUsesRealLlmInferStringSelector() public {
        (uint256 incidentId, uint256 fixId) = _openIncidentAndFix();
        bytes memory payload = escrow.buildReviewPayload(incidentId, fixId);
        require(bytes4(payload) == ILLMAgent.inferString.selector, "wrong llm selector");
    }

    function testRequestReviewRejectsUnderfundedAndDuplicatePending() public {
        (, uint256 fixId) = _openIncidentAndFix();
        uint256 expectedFee = escrow.requiredReviewFee();

        vm.prank(fixer);
        vm.expectRevert(SomniBountyAI.InsufficientReviewFee.selector);
        escrow.requestFixReview{ value: expectedFee - 1 }(fixId);

        vm.prank(fixer);
        escrow.requestFixReview{ value: expectedFee }(fixId);

        vm.prank(fixer);
        vm.expectRevert(SomniBountyAI.IncidentNotOpen.selector);
        escrow.requestFixReview{ value: expectedFee }(fixId);
    }

    function testValidCallbackPaysFixer() public {
        (uint256 incidentId, uint256 fixId) = _openIncidentAndFix();
        uint256 requestId = _requestReview(fixId);

        uint256 balanceBefore = fixer.balance;
        platform.fulfillString(requestId, ResponseStatus.Success, "VALID");

        SomniBountyAI.Incident memory incident = escrow.getIncident(incidentId);
        SomniBountyAI.FixSubmission memory submittedFix = escrow.getFix(fixId);
        require(uint8(incident.status) == uint8(SomniBountyAI.IncidentStatus.Paid), "not paid");
        require(incident.winningFixId == fixId, "wrong fix");
        require(submittedFix.paid, "fix not paid");
        require(fixer.balance == balanceBefore + 1 ether, "bad payout");
    }

    function testInvalidCallbackReopensIncident() public {
        (uint256 incidentId, uint256 fixId) = _openIncidentAndFix();
        uint256 requestId = _requestReview(fixId);

        platform.fulfillString(requestId, ResponseStatus.Success, "INVALID");

        SomniBountyAI.Incident memory incident = escrow.getIncident(incidentId);
        SomniBountyAI.FixSubmission memory submittedFix = escrow.getFix(fixId);
        require(uint8(incident.status) == uint8(SomniBountyAI.IncidentStatus.Open), "not open");
        require(
            uint8(submittedFix.decision) == uint8(SomniBountyAI.FixDecision.Invalid), "not invalid"
        );
    }

    function testPlatformFailureMapsToNeedsReview() public {
        (uint256 incidentId, uint256 fixId) = _openIncidentAndFix();
        uint256 requestId = _requestReview(fixId);

        platform.fulfillString(requestId, ResponseStatus.Failed, "");

        SomniBountyAI.Incident memory incident = escrow.getIncident(incidentId);
        SomniBountyAI.FixSubmission memory submittedFix = escrow.getFix(fixId);
        require(uint8(incident.status) == uint8(SomniBountyAI.IncidentStatus.Open), "not open");
        require(
            uint8(submittedFix.decision) == uint8(SomniBountyAI.FixDecision.NeedsReview),
            "not needs review"
        );
    }

    function testUnauthorizedAndRepeatedCallbacksReject() public {
        (, uint256 fixId) = _openIncidentAndFix();
        uint256 requestId = _requestReview(fixId);

        vm.expectRevert(SomniBountyAI.UnauthorizedCallback.selector);
        escrow.handleResponse(requestId, new Response[](0), ResponseStatus.Failed, _emptyRequest());

        platform.fulfillString(requestId, ResponseStatus.Success, "VALID");

        vm.expectRevert(SomniBountyAI.InvalidRequest.selector);
        platform.fulfillString(requestId, ResponseStatus.Success, "VALID");
    }

    function testReclaimExpired() public {
        (uint256 incidentId,) = _openIncidentAndFix();

        vm.warp(block.timestamp + 2 days);
        uint256 balanceBefore = sponsor.balance;
        vm.prank(sponsor);
        escrow.reclaimExpired(incidentId);

        SomniBountyAI.Incident memory incident = escrow.getIncident(incidentId);
        require(
            uint8(incident.status) == uint8(SomniBountyAI.IncidentStatus.Expired), "not expired"
        );
        require(sponsor.balance == balanceBefore + 1 ether, "bad reclaim");
    }

    function testReclaimBlockedBeforeDeadlineAfterPayoutAndWhilePending() public {
        (uint256 incidentId, uint256 fixId) = _openIncidentAndFix();

        vm.prank(sponsor);
        vm.expectRevert(SomniBountyAI.InvalidDeadline.selector);
        escrow.reclaimExpired(incidentId);

        uint256 requestId = _requestReview(fixId);

        vm.warp(block.timestamp + 2 days);
        vm.prank(sponsor);
        vm.expectRevert(SomniBountyAI.ReviewPending.selector);
        escrow.reclaimExpired(incidentId);

        platform.fulfillString(requestId, ResponseStatus.Success, "VALID");

        vm.prank(sponsor);
        vm.expectRevert(SomniBountyAI.InvalidIncident.selector);
        escrow.reclaimExpired(incidentId);
    }

    function testCancelStaleReview() public {
        (uint256 incidentId, uint256 fixId) = _openIncidentAndFix();
        uint256 requestId = _requestReview(fixId);

        vm.expectRevert(SomniBountyAI.ReviewNotStale.selector);
        escrow.cancelStaleReview(requestId);

        vm.warp(block.timestamp + escrow.REVIEW_TIMEOUT() + 1);
        escrow.cancelStaleReview(requestId);

        SomniBountyAI.Incident memory incident = escrow.getIncident(incidentId);
        SomniBountyAI.FixSubmission memory submittedFix = escrow.getFix(fixId);
        require(uint8(incident.status) == uint8(SomniBountyAI.IncidentStatus.Open), "not open");
        require(
            uint8(submittedFix.decision) == uint8(SomniBountyAI.FixDecision.NeedsReview),
            "not needs review"
        );
    }

    function _openIncidentAndFix() internal returns (uint256 incidentId, uint256 fixId) {
        uint256 projectId = escrow.registerProject("ipfs://project", bytes32("project"));

        vm.prank(sponsor);
        incidentId = escrow.openIncident{ value: 1 ether }(
            projectId,
            reporter,
            uint64(block.timestamp + 1 days),
            5,
            bytes32("evidence"),
            "ipfs://incident"
        );

        vm.prank(fixer);
        fixId = escrow.submitFix(incidentId, "https://github.com/demo/pr/128", bytes32("proof"));
    }

    function _requestReview(uint256 fixId) internal returns (uint256 requestId) {
        uint256 fee = escrow.requiredReviewFee();
        vm.prank(fixer);
        requestId = escrow.requestFixReview{ value: fee }(fixId);
    }

    function _emptyRequest() internal pure returns (Request memory request) {
        request = Request({
            agentId: 0,
            requester: address(0),
            callback: address(0),
            callbackSelector: bytes4(0),
            payload: ""
        });
    }
}
