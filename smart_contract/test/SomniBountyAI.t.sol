// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SomniBountyAI } from "../src/SomniBountyAI.sol";
import { VulnerabilityRegistry } from "../src/VulnerabilityRegistry.sol";
import {
    IJsonApiAgent,
    ILLMAgent,
    Request,
    Response,
    ResponseStatus
} from "../src/interfaces/IAgentPlatform.sol";
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
    uint256 internal constant JSON_AGENT_ID = 9001;
    uint256 internal constant JSON_PRICE_PER_VALIDATOR = 0.03 ether;
    uint8 internal constant SUBCOMMITTEE_SIZE = 3;
    uint96 internal constant CRITICAL = 0.05 ether;
    uint96 internal constant HIGH = 0.02 ether;
    uint96 internal constant MEDIUM = 0.01 ether;

    address internal publisher = address(0xA11CE);
    address internal fixer = address(0xCAFE);
    address internal agentWallet = address(0xF00D);
    address internal platformPayoutWallet = 0xeE59b12EB683A346b3D8A4CB43d5aFa8AD3303F3;

    MockAgentPlatform internal platform;
    VulnerabilityRegistry internal registry;
    SomniBountyAI internal escrow;

    function setUp() public {
        platform = new MockAgentPlatform();
        registry = new VulnerabilityRegistry();
        escrow = new SomniBountyAI(
            address(platform),
            address(registry),
            AGENT_ID,
            PRICE_PER_VALIDATOR,
            JSON_AGENT_ID,
            JSON_PRICE_PER_VALIDATOR,
            SUBCOMMITTEE_SIZE,
            "https://somnibounty.example"
        );
        vm.deal(publisher, 100 ether);
        vm.deal(fixer, 100 ether);
        vm.warp(1_000);
    }

    function testConstructorStoresConfig() public view {
        require(address(escrow.agentPlatform()) == address(platform), "platform mismatch");
        require(address(escrow.vulnerabilityRegistry()) == address(registry), "registry mismatch");
        require(escrow.agentId() == AGENT_ID, "agent mismatch");
        require(escrow.agentFeePerValidator() == PRICE_PER_VALIDATOR, "fee mismatch");
        require(escrow.jsonApiAgentId() == JSON_AGENT_ID, "json agent mismatch");
        require(escrow.jsonApiFeePerValidator() == JSON_PRICE_PER_VALIDATOR, "json fee mismatch");
        require(escrow.subcommitteeSize() == SUBCOMMITTEE_SIZE, "subcommittee mismatch");
        require(escrow.PLATFORM_PAYOUT_WALLET() == platformPayoutWallet, "payout wallet mismatch");
    }

    function testRegistryInitializesTemplates() public view {
        require(registry.templateCount() == 12, "template count mismatch");
        VulnerabilityRegistry.Template memory template = registry.getTemplate(1);
        require(template.active, "inactive template");
        require(template.category == VulnerabilityRegistry.Category.Critical, "bad category");
        require(bytes(template.title).length > 0, "empty title");
        require(bytes(template.description).length > 0, "empty description");
        require(bytes(registry.agentTemplatePack()).length > 1_000, "thin registry pack");
    }

    function testRegisterProjectStoresRequiredAndOptionalFields() public {
        uint256 projectId = _registerProject();
        SomniBountyAI.Project memory project = escrow.getProject(projectId);
        require(project.owner == publisher, "owner mismatch");
        require(project.active, "inactive");
        require(project.metadataHash == bytes32("project"), "hash mismatch");
        require(keccak256(bytes(project.name)) == keccak256("AstraVault"), "name mismatch");
        require(bytes(project.socialUrl).length > 0, "missing social");
        require(bytes(project.imageUrl).length > 0, "missing image");
        require(project.agentPayoutWallet == platformPayoutWallet, "wallet mismatch");
    }

    function testRegisterProjectRejectsInvalidInputs() public {
        vm.prank(publisher);
        vm.expectRevert(SomniBountyAI.InvalidMetadata.selector);
        escrow.registerProject(
            "",
            "description",
            "",
            "",
            "https://github.com/example/repo",
            bytes32("project"),
            agentWallet
        );

    }

    function testRegisterProjectIgnoresProvidedPayoutWallet() public {
        uint256 projectId = _registerProject();
        SomniBountyAI.Project memory project = escrow.getProject(projectId);
        require(project.agentPayoutWallet == platformPayoutWallet, "not platform wallet");
    }

    function testSetupBountyTiersRejectsBelowMinimum() public {
        uint256 projectId = _registerProject();
        uint256 value = escrow.quoteSetupBountyTiers(CRITICAL, HIGH, MEDIUM);

        vm.prank(publisher);
        vm.expectRevert(SomniBountyAI.InvalidBounty.selector);
        escrow.setupBountyTiers{ value: value }(projectId, CRITICAL - 1, HIGH, MEDIUM);
    }

    function testSetupBountyTiersCreatesScanRequestAndStoresTiers() public {
        uint256 projectId = _registerProject();
        uint256 expectedFee = escrow.requiredJsonApiFee();
        uint256 value = escrow.quoteSetupBountyTiers(CRITICAL, HIGH, MEDIUM);

        uint256 publisherBalanceBefore = publisher.balance;
        vm.prank(publisher);
        (uint256 scanJobId, uint256 requestId) =
            escrow.setupBountyTiers{ value: value }(projectId, CRITICAL, HIGH, MEDIUM);

        SomniBountyAI.ScanJob memory job = escrow.getScanJob(scanJobId);
        (uint96 critical, uint96 high, uint96 medium) = escrow.projectBountyTiers(projectId);
        require(job.projectId == projectId, "project mismatch");
        require(uint8(job.status) == uint8(SomniBountyAI.ScanStatus.Pending), "not pending");
        require(critical == CRITICAL && high == HIGH && medium == MEDIUM, "tiers mismatch");
        (, uint256 pendingScanJobId,,,) = escrow.pendingAgentRequests(requestId);
        require(pendingScanJobId == scanJobId, "pending mismatch");
        require(platform.requestFees(requestId) == expectedFee, "fee mismatch");
        require(publisher.balance == publisherBalanceBefore - value, "publisher did not pay");
    }

    function testScanPayloadUsesRealLlmInferStringSelector() public {
        uint256 projectId = _registerProject();
        uint256 value = escrow.quoteSetupBountyTiers(CRITICAL, HIGH, MEDIUM);

        vm.prank(publisher);
        (uint256 scanJobId,) =
            escrow.setupBountyTiers{ value: value }(projectId, CRITICAL, HIGH, MEDIUM);

        bytes memory payload = escrow.buildScanPayload(projectId, scanJobId);
        require(bytes4(payload) == ILLMAgent.inferString.selector, "wrong llm selector");
    }

    function testSnapshotPayloadUsesRealJsonApiFetchStringSelector() public {
        uint256 projectId = _registerProject();
        uint256 value = escrow.quoteSetupBountyTiers(CRITICAL, HIGH, MEDIUM);

        vm.prank(publisher);
        (uint256 scanJobId,) =
            escrow.setupBountyTiers{ value: value }(projectId, CRITICAL, HIGH, MEDIUM);

        bytes memory payload = escrow.buildSnapshotPayload(projectId, scanJobId);
        require(bytes4(payload) == IJsonApiAgent.fetchString.selector, "wrong json selector");
    }

    function testScanCallbackRejectsSpoofedPlatform() public {
        (, uint256 requestId) = _fundAndRequestScan();

        vm.expectRevert(SomniBountyAI.UnauthorizedCallback.selector);
        escrow.handleResponse(requestId, new Response[](0), ResponseStatus.Failed, _emptyRequest());
    }

    function testFullAutomationCreatesPrAndPaysPlatformPayoutWallet() public {
        (uint256 projectId, uint256 requestId) = _fundAndRequestScan();

        platform.fulfillString(requestId, ResponseStatus.Success, "contract V.sol vulnerable");
        platform.fulfillString(2, ResponseStatus.Success, "CRITICAL");
        platform.fulfillString(3, ResponseStatus.Success, "VALID");
        platform.fulfillString(4, ResponseStatus.Success, "https://github.com/example/repo/pull/1");
        uint256 walletBalanceBefore = platformPayoutWallet.balance;
        platform.fulfillString(5, ResponseStatus.Success, "VALID");

        SomniBountyAI.ScanJob memory job = escrow.getScanJob(1);
        SomniBountyAI.Incident memory incident = escrow.getIncident(job.incidentId);
        SomniBountyAI.FixSubmission memory submittedFix = escrow.getFix(job.fixId);
        (uint96 critical, uint96 high, uint96 medium) = escrow.projectBountyTiers(projectId);
        require(uint8(job.status) == uint8(SomniBountyAI.ScanStatus.CandidateFound), "bad job");
        require(uint8(incident.status) == uint8(SomniBountyAI.IncidentStatus.Paid), "not paid");
        require(submittedFix.paid, "fix not paid");
        require(submittedFix.payoutRecipient == platformPayoutWallet, "recipient mismatch");
        require(platformPayoutWallet.balance == walletBalanceBefore + CRITICAL, "wallet not paid");
        require(critical == 0 && high == HIGH && medium == MEDIUM, "bad reserves");
    }

    function testScanCallbackCriticalOpensIncidentAfterSecondReview() public {
        (uint256 projectId, uint256 requestId) = _fundAndRequestScan();

        platform.fulfillString(requestId, ResponseStatus.Success, "contract V.sol vulnerable");
        platform.fulfillString(2, ResponseStatus.Success, "CRITICAL");
        platform.fulfillString(3, ResponseStatus.Success, "VALID");

        SomniBountyAI.ScanJob memory job = escrow.getScanJob(1);
        SomniBountyAI.Incident memory incident = escrow.getIncident(job.incidentId);
        (uint96 critical, uint96 high, uint96 medium) = escrow.projectBountyTiers(projectId);
        require(uint8(job.status) == uint8(SomniBountyAI.ScanStatus.CandidateFound), "bad job");
        require(incident.bounty == CRITICAL, "bounty mismatch");
        require(incident.reporter == address(escrow), "reporter mismatch");
        require(uint8(incident.status) == uint8(SomniBountyAI.IncidentStatus.Open), "not open");
        require(critical == 0 && high == HIGH && medium == MEDIUM, "bad reserves");
    }

    function testSecondReviewInvalidMarksNoFinding() public {
        (, uint256 requestId) = _fundAndRequestScan();

        platform.fulfillString(requestId, ResponseStatus.Success, "contract V.sol vulnerable");
        platform.fulfillString(2, ResponseStatus.Success, "CRITICAL");
        platform.fulfillString(3, ResponseStatus.Success, "INVALID");

        SomniBountyAI.ScanJob memory job = escrow.getScanJob(1);
        require(uint8(job.status) == uint8(SomniBountyAI.ScanStatus.NoFinding), "bad job");
        require(job.incidentId == 0, "incident opened");
    }

    function testScanCallbackNoneAndNeedsReviewDoNotOpenIncident() public {
        (, uint256 requestId) = _fundAndRequestScan();
        platform.fulfillString(requestId, ResponseStatus.Success, "contract V.sol safe");
        platform.fulfillString(2, ResponseStatus.Success, "NONE");
        SomniBountyAI.ScanJob memory noFindingJob = escrow.getScanJob(1);
        require(uint8(noFindingJob.status) == uint8(SomniBountyAI.ScanStatus.NoFinding), "bad none");
        require(noFindingJob.incidentId == 0, "incident opened");

        (, uint256 secondRequestId) = _fundAndRequestScan();
        platform.fulfillString(secondRequestId, ResponseStatus.Success, "ambiguous");
        platform.fulfillString(4, ResponseStatus.Success, "NEEDS_REVIEW");
        SomniBountyAI.ScanJob memory needsReviewJob = escrow.getScanJob(2);
        require(
            uint8(needsReviewJob.status) == uint8(SomniBountyAI.ScanStatus.NeedsReview),
            "bad needs review"
        );
        require(needsReviewJob.incidentId == 0, "incident opened");
    }

    function testScanFailureRecordsFailedState() public {
        (, uint256 requestId) = _fundAndRequestScan();

        platform.fulfillString(requestId, ResponseStatus.Failed, "");

        SomniBountyAI.ScanJob memory job = escrow.getScanJob(1);
        require(uint8(job.status) == uint8(SomniBountyAI.ScanStatus.Failed), "not failed");
        require(job.resultHash == keccak256("SNAPSHOT_FAILED"), "hash mismatch");
    }

    function testSubmitFixUsesPlatformPayoutWallet() public {
        (uint256 incidentId,) = _openCriticalIncident();

        vm.prank(fixer);
        uint256 fixId = escrow.submitFix(incidentId, "ipfs://proof", bytes32("proof"));

        SomniBountyAI.FixSubmission memory submittedFix = escrow.getFix(fixId);
        require(submittedFix.fixer == fixer, "fixer mismatch");
        require(submittedFix.payoutRecipient == platformPayoutWallet, "recipient mismatch");
    }

    function testRepeatedCallbackCannotDoublePay() public {
        (, uint256 requestId) = _fundAndRequestScan();
        platform.fulfillString(requestId, ResponseStatus.Success, "contract V.sol vulnerable");
        platform.fulfillString(2, ResponseStatus.Success, "CRITICAL");
        platform.fulfillString(3, ResponseStatus.Success, "VALID");
        platform.fulfillString(4, ResponseStatus.Success, "https://github.com/example/repo/pull/1");
        platform.fulfillString(5, ResponseStatus.Success, "VALID");

        vm.expectRevert(SomniBountyAI.InvalidRequest.selector);
        platform.fulfillString(5, ResponseStatus.Success, "VALID");
    }

    function testReclaimExpired() public {
        (uint256 incidentId,) = _openCriticalIncident();

        vm.warp(block.timestamp + escrow.DEFAULT_INCIDENT_DEADLINE() + 1);
        uint256 balanceBefore = publisher.balance;
        vm.prank(publisher);
        escrow.reclaimExpired(incidentId);

        SomniBountyAI.Incident memory incident = escrow.getIncident(incidentId);
        require(
            uint8(incident.status) == uint8(SomniBountyAI.IncidentStatus.Expired), "not expired"
        );
        require(publisher.balance == balanceBefore + CRITICAL, "bad reclaim");
    }

    function _registerProject() internal returns (uint256 projectId) {
        vm.prank(publisher);
        projectId = escrow.registerProject(
            "AstraVault",
            "Autonomous vault security bounty.",
            "https://x.com/somnibounty",
            "https://example.com/logo.png",
            "https://github.com/example/astra-vault",
            bytes32("project"),
            agentWallet
        );
    }

    function _fundAndRequestScan() internal returns (uint256 projectId, uint256 requestId) {
        projectId = _registerProject();
        uint256 value = escrow.quoteSetupBountyTiers(CRITICAL, HIGH, MEDIUM);
        vm.prank(publisher);
        (, requestId) = escrow.setupBountyTiers{ value: value }(projectId, CRITICAL, HIGH, MEDIUM);
    }

    function _openCriticalIncident() internal returns (uint256 incidentId, uint256 requestId) {
        (, requestId) = _fundAndRequestScan();
        platform.fulfillString(requestId, ResponseStatus.Success, "contract V.sol vulnerable");
        platform.fulfillString(2, ResponseStatus.Success, "CRITICAL");
        platform.fulfillString(3, ResponseStatus.Success, "VALID");
        SomniBountyAI.ScanJob memory job = escrow.getScanJob(1);
        incidentId = job.incidentId;
    }

    function _openCriticalIncidentAndSubmitFix()
        internal
        returns (uint256 incidentId, uint256 fixId)
    {
        (incidentId,) = _openCriticalIncident();
        vm.prank(fixer);
        fixId = escrow.submitFix(incidentId, "ipfs://proof", bytes32("proof"));
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
