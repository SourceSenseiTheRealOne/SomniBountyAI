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
        _seedRegistry();
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
        require(job.latestRequestId == requestId, "latest request mismatch");
        require(critical == CRITICAL && high == HIGH && medium == MEDIUM, "tiers mismatch");
        (, uint256 pendingScanJobId,,,) = escrow.pendingAgentRequests(requestId);
        require(pendingScanJobId == scanJobId, "pending mismatch");
        require(platform.requestFees(requestId) == expectedFee, "fee mismatch");
        require(publisher.balance == publisherBalanceBefore - value, "publisher did not pay");
    }

    function testRetrySnapshotUsesCallerPaidJsonFeeAndStoresLatestRequest() public {
        uint256 projectId = _registerProject();
        uint256 value = escrow.quoteSetupBountyTiers(CRITICAL, HIGH, MEDIUM);
        vm.prank(publisher);
        (uint256 scanJobId, uint256 firstRequestId) =
            escrow.setupBountyTiers{ value: value }(projectId, CRITICAL, HIGH, MEDIUM);

        uint256 retryFee = escrow.requiredJsonApiFee();
        uint256 reserveBefore = escrow.getScanJob(scanJobId).agentFeeReserve;
        vm.prank(publisher);
        uint256 retryRequestId = escrow.retrySnapshot{ value: retryFee }(scanJobId);

        SomniBountyAI.ScanJob memory job = escrow.getScanJob(scanJobId);
        require(retryRequestId != firstRequestId, "same request");
        require(job.latestRequestId == retryRequestId, "latest retry mismatch");
        require(job.agentFeeReserve == reserveBefore, "reserve consumed");
        (, uint256 pendingScanJobId,,,) = escrow.pendingAgentRequests(retryRequestId);
        require(pendingScanJobId == scanJobId, "retry pending mismatch");
        require(platform.requestFees(retryRequestId) == retryFee, "retry fee mismatch");
    }

    function testRetrySnapshotRejectsUnauthorizedCaller() public {
        uint256 projectId = _registerProject();
        uint256 value = escrow.quoteSetupBountyTiers(CRITICAL, HIGH, MEDIUM);
        vm.prank(publisher);
        (uint256 scanJobId,) =
            escrow.setupBountyTiers{ value: value }(projectId, CRITICAL, HIGH, MEDIUM);

        uint256 retryFee = escrow.requiredJsonApiFee();
        vm.prank(fixer);
        vm.expectRevert(SomniBountyAI.UnauthorizedSponsor.selector);
        escrow.retrySnapshot{ value: retryFee }(scanJobId);
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

    function testSecondReviewPromptValidatesTxOriginEvidence() public {
        (, uint256 requestId) = _fundAndRequestScan();

        platform.fulfillString(
            requestId,
            ResponseStatus.Success,
            "file=src/VulnerableVault.sol evidence=require(tx.origin == owner) around withdraw"
        );
        platform.fulfillString(2, ResponseStatus.Success, "HIGH");

        bytes memory payload = escrow.buildSecondReviewPayload(1);
        require(bytes4(payload) == ILLMAgent.inferString.selector, "wrong llm selector");
        (string memory prompt,,,) =
            abi.decode(_withoutSelector(payload), (string, string, bool, string[]));
        require(_contains(prompt, "require(tx.origin == owner)"), "missing tx.origin rule");
        require(_contains(prompt, "severity could be HIGH instead of CRITICAL"), "missing severity rule");
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

    function _seedRegistry() internal {
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Critical,
            "Reentrancy",
            "External control flow can re-enter before state is finalized.",
            "Look for call/value/transfer hooks before balance, debt, share, or nonce updates; comments may mark reentrancy.",
            "State mutation after external call; missing nonReentrant guard around withdraw/claim/execute.",
            "Apply checks-effects-interactions, update accounting before calls, add reentrancy guard where needed.",
            "Funds can be drained or accounting corrupted.",
            "ipfs://somnibounty/reentrancy"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Critical,
            "Access control bypass",
            "Privileged function can be called by unauthorized account.",
            "Look for admin setters, mint, withdraw, upgrade, pause, sweep, or config functions missing role checks.",
            "Sensitive function lacks onlyOwner/role check or validates wrong address.",
            "Add explicit role/owner authorization and tests for unauthorized callers.",
            "Attacker can steal funds, mint assets, change config, or disable protocol.",
            "ipfs://somnibounty/access-control"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.High,
            "Unchecked external call",
            "Low-level call result ignored or external call assumes success.",
            "Look for .call/.delegatecall/.staticcall returns unused, or ERC20 transfer return ignored.",
            "Function continues after failed external interaction.",
            "Check success boolean, validate returned data, revert on failed required calls.",
            "Funds or state can desync silently.",
            "ipfs://somnibounty/unchecked-call"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.High,
            "Signature replay",
            "Signed authorization can be reused across chains, contracts, or nonces.",
            "Look for ecrecover/permit/meta-tx without nonce, deadline, chainId, or contract domain.",
            "Hash omits nonce/deadline/domain separator or nonce not consumed before action.",
            "Use EIP-712 domain, chainId, contract address, deadline, and monotonic nonce.",
            "Attacker can repeat approvals/orders/claims.",
            "ipfs://somnibounty/signature-replay"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Critical,
            "Oracle manipulation",
            "Protocol trusts manipulable spot price or stale oracle data.",
            "Look for DEX spot reads, single block reserves, missing staleness checks, or no bounds.",
            "Price from AMM reserves or oracle used directly for mint, borrow, redeem, or liquidate.",
            "Use TWAP, trusted oracle, staleness checks, sanity bounds, and circuit breakers.",
            "Attacker can drain collateral or manipulate settlement.",
            "ipfs://somnibounty/oracle-manipulation"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.High,
            "Price or slippage manipulation",
            "Swap or valuation accepts attacker-controlled price movement.",
            "Look for minOut zero, deadline missing, user slippage ignored, or path controlled by caller.",
            "Function swaps without minimum output or validates against current manipulated reserves.",
            "Require minOut/deadline, validate route, bound price impact, and use safe router patterns.",
            "Attacker can sandwich, drain value, or force bad execution.",
            "ipfs://somnibounty/price-slippage"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Medium,
            "Unsafe ERC20 transfer",
            "Token transfer assumes standard boolean behavior.",
            "Look for IERC20.transfer/transferFrom not wrapped in SafeERC20.",
            "Non-standard tokens can return false or no data and break assumptions.",
            "Use SafeERC20 and validate balance deltas when required.",
            "Funds can be stuck, unpaid, or accounting can desync.",
            "ipfs://somnibounty/unsafe-erc20"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Critical,
            "Delegatecall or proxy storage collision",
            "Delegatecall/proxy pattern can overwrite privileged storage.",
            "Look for delegatecall to user-controlled target, unstructured proxy storage, or changed layout.",
            "Implementation and proxy storage slots collide, or target not allowlisted.",
            "Use EIP-1967/UUPS patterns, fixed storage gaps, allowlisted implementations, and upgrade tests.",
            "Attacker can seize ownership or brick protocol.",
            "ipfs://somnibounty/proxy-storage"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.High,
            "tx.origin authentication",
            "Authorization depends on tx.origin instead of msg.sender.",
            "Look for require(tx.origin == owner) or mixed origin/sender checks.",
            "Phishing contract can make victim originate transaction and pass auth.",
            "Use msg.sender and role checks; never use tx.origin for authorization.",
            "Victim can be tricked into executing privileged actions.",
            "ipfs://somnibounty/tx-origin"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Medium,
            "Denial of service",
            "Function can be permanently or cheaply blocked.",
            "Look for unbounded loops, push payments, external calls inside loops, or griefable state.",
            "Any failing recipient/caller blocks progress for all users.",
            "Use pull payments, bounded loops, pagination, and failure isolation.",
            "Protocol operations can be frozen or made too expensive.",
            "ipfs://somnibounty/denial-of-service"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Medium,
            "Precision or rounding loss",
            "Math order or rounding direction gives unfair value transfer.",
            "Look for division before multiplication, inconsistent share math, or down-rounding in mint/redeem.",
            "Small deposits/withdrawals exploit truncation or accumulate dust.",
            "Use mulDiv, consistent rounding, minimum amounts, and invariant tests.",
            "Users or protocol lose value over repeated operations.",
            "ipfs://somnibounty/precision-loss"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.High,
            "Upgradeability or admin risk",
            "Admin/upgrade pathway can bypass security assumptions.",
            "Look for unprotected initializer, missing disableInitializers, unguarded upgrade, or owner sweep.",
            "Implementation can be initialized by attacker or upgrade executed without controls.",
            "Protect initializers, require timelock/multisig/roles, and test upgrade authorization.",
            "Attacker can upgrade to malicious implementation or steal funds.",
            "ipfs://somnibounty/admin-risk"
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

    function _withoutSelector(bytes memory payload) internal pure returns (bytes memory result) {
        result = new bytes(payload.length - 4);
        for (uint256 i; i < result.length; i++) {
            result[i] = payload[i + 4];
        }
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory haystackBytes = bytes(haystack);
        bytes memory needleBytes = bytes(needle);
        if (needleBytes.length == 0 || needleBytes.length > haystackBytes.length) {
            return false;
        }
        for (uint256 i; i <= haystackBytes.length - needleBytes.length; i++) {
            bool matched = true;
            for (uint256 j; j < needleBytes.length; j++) {
                if (haystackBytes[i + j] != needleBytes[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) return true;
        }
        return false;
    }
}
