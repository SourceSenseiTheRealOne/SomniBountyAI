// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {
    IAgentRequester,
    IAgentRequesterHandler,
    IJsonApiAgent,
    ILLMAgent,
    Request,
    Response,
    ResponseStatus
} from "./interfaces/IAgentPlatform.sol";
import { VulnerabilityRegistry } from "./VulnerabilityRegistry.sol";

contract SomniBountyAI is IAgentRequesterHandler {
    address public constant PLATFORM_PAYOUT_WALLET = 0xeE59b12EB683A346b3D8A4CB43d5aFa8AD3303F3;

    enum IncidentStatus {
        Open,
        ReviewPending,
        Paid,
        Cancelled,
        Expired
    }

    enum FixDecision {
        None,
        Valid,
        Invalid,
        NeedsReview
    }

    enum ScanStatus {
        None,
        Pending,
        CandidateFound,
        NoFinding,
        NeedsReview,
        Failed
    }

    enum SeverityTier {
        None,
        Critical,
        High,
        Medium
    }

    enum AgentRequestKind {
        None,
        Snapshot,
        Scan,
        SecondReview,
        PullRequest,
        FinalReview
    }

    struct Project {
        address owner;
        bool active;
        bytes32 metadataHash;
        string name;
        string description;
        string socialUrl;
        string imageUrl;
        string githubRepo;
        address agentPayoutWallet;
    }

    struct BountyTiers {
        uint96 critical;
        uint96 high;
        uint96 medium;
    }

    struct ScanJob {
        uint256 projectId;
        address sponsor;
        uint96 criticalBounty;
        uint96 highBounty;
        uint96 mediumBounty;
        uint64 requestedAt;
        ScanStatus status;
        uint256 incidentId;
        uint256 fixId;
        uint256 agentFeeReserve;
        uint256 latestRequestId;
        uint8 candidateSeverity;
        string snapshotURI;
        bytes32 resultHash;
        string resultURI;
    }

    struct Incident {
        uint256 projectId;
        address sponsor;
        address reporter;
        uint96 bounty;
        uint64 deadline;
        uint8 severity;
        IncidentStatus status;
        bytes32 evidenceHash;
        string metadataURI;
        uint256 winningFixId;
    }

    struct FixSubmission {
        uint256 incidentId;
        address fixer;
        address payoutRecipient;
        string proofURI;
        bytes32 proofHash;
        FixDecision decision;
        uint16 scoreBps;
        bytes32 resultHash;
        bool paid;
        uint96 paidAmount;
    }

    struct PendingAgentRequest {
        AgentRequestKind kind;
        uint256 scanJobId;
        uint256 incidentId;
        uint256 fixId;
        bool exists;
    }

    uint16 internal constant MAX_SCORE_BPS = 10_000;
    uint64 public constant DEFAULT_INCIDENT_DEADLINE = 7 days;
    uint96 public constant MIN_CRITICAL_BOUNTY = 0.05 ether;
    uint96 public constant MIN_HIGH_BOUNTY = 0.02 ether;
    uint96 public constant MIN_MEDIUM_BOUNTY = 0.01 ether;
    bytes4 public constant RAW_AGENT_CALLBACK_SELECTOR = 0x12345678;
    uint256 internal constant RAW_AGENT_SUCCESS_STATUS = 2;

    IAgentRequester public immutable agentPlatform;
    VulnerabilityRegistry public immutable vulnerabilityRegistry;
    uint256 public immutable agentId;
    uint256 public immutable agentFeePerValidator;
    uint256 public immutable jsonApiAgentId;
    uint256 public immutable jsonApiFeePerValidator;
    uint8 public immutable subcommitteeSize;
    string public automationApiBase;

    uint256 public nextProjectId = 1;
    uint256 public nextScanJobId = 1;
    uint256 public nextIncidentId = 1;
    uint256 public nextFixId = 1;

    mapping(uint256 projectId => Project project) private projectStore;
    mapping(uint256 projectId => BountyTiers tiers) public projectBountyTiers;
    mapping(uint256 scanJobId => ScanJob job) private scanJobStore;
    mapping(uint256 requestId => PendingAgentRequest request) public pendingAgentRequests;
    mapping(uint256 incidentId => Incident incident) private incidentStore;
    mapping(uint256 fixId => FixSubmission fixSubmission) private fixStore;

    bool private locked;

    event ProjectRegistered(
        uint256 indexed projectId,
        address indexed owner,
        address indexed agentPayoutWallet,
        bytes32 metadataHash
    );
    event BountyTiersFunded(
        uint256 indexed projectId,
        uint256 indexed scanJobId,
        uint256 critical,
        uint256 high,
        uint256 medium
    );
    event AgentLog(
        uint256 indexed projectId, uint256 indexed scanJobId, string step, string detail
    );
    event SnapshotRequested(
        uint256 indexed requestId,
        uint256 indexed projectId,
        uint256 indexed scanJobId,
        uint64 requestedAt
    );
    event LLMScanRequested(
        uint256 indexed requestId,
        uint256 indexed projectId,
        uint256 indexed scanJobId,
        uint64 requestedAt
    );
    event SecondReviewRequested(
        uint256 indexed requestId,
        uint256 indexed projectId,
        uint256 indexed scanJobId,
        uint64 requestedAt
    );
    event PRRequested(
        uint256 indexed requestId,
        uint256 indexed projectId,
        uint256 indexed scanJobId,
        uint256 incidentId,
        uint64 requestedAt
    );
    event FinalReviewRequested(
        uint256 indexed requestId,
        uint256 indexed incidentId,
        uint256 indexed fixId,
        uint256 scanJobId,
        uint64 requestedAt
    );
    event ScanCompleted(
        uint256 indexed requestId,
        uint256 indexed scanJobId,
        ScanStatus status,
        uint256 incidentId,
        bytes32 resultHash
    );
    event IncidentOpened(
        uint256 indexed incidentId,
        uint256 indexed projectId,
        address indexed sponsor,
        address reporter,
        uint256 bounty,
        uint64 deadline,
        uint8 severity,
        bytes32 evidenceHash,
        string metadataURI
    );
    event FixSubmitted(
        uint256 indexed fixId,
        uint256 indexed incidentId,
        address indexed fixer,
        address payoutRecipient,
        string proofURI,
        bytes32 proofHash
    );
    event FixVerified(
        uint256 indexed requestId,
        uint256 indexed fixId,
        FixDecision decision,
        uint16 scoreBps,
        bytes32 resultHash
    );
    event BountyPaid(
        uint256 indexed incidentId,
        uint256 indexed fixId,
        address indexed payoutRecipient,
        uint256 amount
    );
    event BountyReclaimed(uint256 indexed incidentId, address indexed sponsor, uint256 amount);

    error InvalidAgentPlatform();
    error InvalidAgentConfig();
    error InvalidProject();
    error InvalidMetadata();
    error InvalidBounty();
    error InvalidDeadline();
    error InvalidIncident();
    error InvalidFix();
    error InvalidPayoutRecipient();
    error InvalidRequest();
    error UnauthorizedCallback();
    error UnauthorizedSponsor();
    error IncidentNotOpen();
    error IncidentExpired();
    error PayoutFailed();
    error ReclaimFailed();
    error InsufficientAgentFee();
    error ReentrantCall();

    modifier nonReentrant() {
        if (locked) revert ReentrantCall();
        locked = true;
        _;
        locked = false;
    }

    constructor(
        address agentPlatform_,
        address vulnerabilityRegistry_,
        uint256 agentId_,
        uint256 agentFeePerValidator_,
        uint256 jsonApiAgentId_,
        uint256 jsonApiFeePerValidator_,
        uint8 subcommitteeSize_,
        string memory automationApiBase_
    ) {
        if (agentPlatform_ == address(0)) revert InvalidAgentPlatform();
        if (vulnerabilityRegistry_ == address(0)) revert InvalidProject();
        if (agentId_ == 0 || jsonApiAgentId_ == 0 || subcommitteeSize_ == 0) {
            revert InvalidAgentConfig();
        }
        if (bytes(automationApiBase_).length == 0) revert InvalidAgentConfig();

        agentPlatform = IAgentRequester(agentPlatform_);
        vulnerabilityRegistry = VulnerabilityRegistry(vulnerabilityRegistry_);
        agentId = agentId_;
        agentFeePerValidator = agentFeePerValidator_;
        jsonApiAgentId = jsonApiAgentId_;
        jsonApiFeePerValidator = jsonApiFeePerValidator_;
        subcommitteeSize = subcommitteeSize_;
        automationApiBase = automationApiBase_;
    }

    receive() external payable { }

    function registerProject(
        string calldata name,
        string calldata description,
        string calldata socialUrl,
        string calldata imageUrl,
        string calldata githubRepo,
        bytes32 metadataHash,
        address
    ) external returns (uint256 projectId) {
        if (bytes(name).length == 0 || bytes(description).length == 0) {
            revert InvalidMetadata();
        }
        if (bytes(githubRepo).length == 0) revert InvalidMetadata();

        projectId = nextProjectId++;
        projectStore[projectId] = Project({
            owner: msg.sender,
            active: true,
            metadataHash: metadataHash,
            name: name,
            description: description,
            socialUrl: socialUrl,
            imageUrl: imageUrl,
            githubRepo: githubRepo,
            agentPayoutWallet: PLATFORM_PAYOUT_WALLET
        });

        emit ProjectRegistered(projectId, msg.sender, PLATFORM_PAYOUT_WALLET, metadataHash);
        emit AgentLog(projectId, 0, "project registered", githubRepo);
    }

    function setupBountyTiers(uint256 projectId, uint96 critical, uint96 high, uint96 medium)
        external
        payable
        nonReentrant
        returns (uint256 scanJobId, uint256 requestId)
    {
        Project storage project = projectStore[projectId];
        if (!project.active) revert InvalidProject();
        if (msg.sender != project.owner) revert UnauthorizedSponsor();
        _validateTierAmounts(critical, high, medium);

        uint256 bountyTotal = uint256(critical) + uint256(high) + uint256(medium);
        uint256 fee = requiredAutomationFee();
        if (msg.value < bountyTotal + fee) revert InsufficientAgentFee();

        BountyTiers storage tiers = projectBountyTiers[projectId];
        tiers.critical += critical;
        tiers.high += high;
        tiers.medium += medium;

        scanJobId = nextScanJobId++;
        scanJobStore[scanJobId] = ScanJob({
            projectId: projectId,
            sponsor: msg.sender,
            criticalBounty: critical,
            highBounty: high,
            mediumBounty: medium,
            requestedAt: uint64(block.timestamp),
            status: ScanStatus.Pending,
            incidentId: 0,
            fixId: 0,
            agentFeeReserve: fee,
            latestRequestId: 0,
            candidateSeverity: 0,
            snapshotURI: "",
            resultHash: bytes32(0),
            resultURI: ""
        });

        requestId = _requestSnapshot(scanJobId);

        if (msg.value > bountyTotal + fee) {
            (bool refunded,) = msg.sender.call{ value: msg.value - bountyTotal - fee }("");
            if (!refunded) revert ReclaimFailed();
        }

        emit BountyTiersFunded(projectId, scanJobId, critical, high, medium);
        emit AgentLog(projectId, scanJobId, "bounty funded", project.githubRepo);
    }

    function retrySnapshot(uint256 scanJobId)
        external
        payable
        nonReentrant
        returns (uint256 requestId)
    {
        ScanJob storage job = scanJobStore[scanJobId];
        if (job.projectId == 0) revert InvalidRequest();
        Project storage project = projectStore[job.projectId];
        if (!project.active) revert InvalidProject();
        if (msg.sender != job.sponsor && msg.sender != project.owner) revert UnauthorizedSponsor();
        if (job.status != ScanStatus.Pending) revert InvalidRequest();
        if (bytes(job.snapshotURI).length != 0) revert InvalidRequest();
        if (job.incidentId != 0 || job.fixId != 0) revert InvalidRequest();

        uint256 fee = requiredJsonApiFee();
        if (msg.value < fee) revert InsufficientAgentFee();
        requestId = _requestSnapshotWithFee(scanJobId, fee);

        if (msg.value > fee) {
            (bool refunded,) = msg.sender.call{ value: msg.value - fee }("");
            if (!refunded) revert ReclaimFailed();
        }
    }

    function submitFix(uint256 incidentId, string calldata proofURI, bytes32 proofHash)
        external
        returns (uint256 fixId)
    {
        Incident storage incident = incidentStore[incidentId];
        if (incident.sponsor == address(0)) revert InvalidIncident();
        if (incident.status != IncidentStatus.Open) revert IncidentNotOpen();
        if (block.timestamp >= incident.deadline) revert IncidentExpired();
        if (bytes(proofURI).length == 0) revert InvalidFix();

        Project storage project = projectStore[incident.projectId];
        address payoutRecipient = project.agentPayoutWallet;
        if (payoutRecipient == address(0)) revert InvalidPayoutRecipient();

        fixId = nextFixId++;
        fixStore[fixId] = FixSubmission({
            incidentId: incidentId,
            fixer: msg.sender,
            payoutRecipient: payoutRecipient,
            proofURI: proofURI,
            proofHash: proofHash,
            decision: FixDecision.None,
            scoreBps: 0,
            resultHash: bytes32(0),
            paid: false,
            paidAmount: 0
        });

        emit FixSubmitted(fixId, incidentId, msg.sender, payoutRecipient, proofURI, proofHash);
        emit AgentLog(incident.projectId, 0, "fix submitted", proofURI);
    }

    function handleResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory
    ) external override nonReentrant {
        if (msg.sender != address(agentPlatform)) {
            revert UnauthorizedCallback();
        }

        PendingAgentRequest memory agentRequest = pendingAgentRequests[requestId];
        if (agentRequest.exists) {
            delete pendingAgentRequests[requestId];
            _handleAgentResponse(requestId, agentRequest, responses, status);
            return;
        }

        revert InvalidRequest();
    }

    fallback() external payable nonReentrant {
        if (msg.sender != address(agentPlatform)) {
            revert UnauthorizedCallback();
        }
        if (msg.sig != RAW_AGENT_CALLBACK_SELECTOR) {
            revert InvalidRequest();
        }

        (uint256 requestId, bool success, bytes memory result) = _decodeRawAgentCallback();
        PendingAgentRequest memory agentRequest = pendingAgentRequests[requestId];
        if (!agentRequest.exists) revert InvalidRequest();

        delete pendingAgentRequests[requestId];
        _handleRawAgentResponse(requestId, agentRequest, success, result);
    }

    function reclaimExpired(uint256 incidentId) external nonReentrant {
        Incident storage incident = incidentStore[incidentId];
        if (incident.sponsor == address(0)) revert InvalidIncident();
        if (msg.sender != incident.sponsor) revert UnauthorizedSponsor();
        if (incident.status == IncidentStatus.ReviewPending) revert InvalidIncident();
        if (block.timestamp < incident.deadline) revert InvalidDeadline();
        if (incident.status == IncidentStatus.Paid) revert InvalidIncident();

        uint256 amount = incident.bounty;
        if (amount == 0) revert InvalidBounty();

        incident.bounty = 0;
        incident.status = IncidentStatus.Expired;

        (bool sent,) = msg.sender.call{ value: amount }("");
        if (!sent) revert ReclaimFailed();

        emit BountyReclaimed(incidentId, msg.sender, amount);
    }

    function totalCounts()
        external
        view
        returns (uint256 projectCount, uint256 incidentCount, uint256 fixCount)
    {
        return (nextProjectId - 1, nextIncidentId - 1, nextFixId - 1);
    }

    function scanJobCount() external view returns (uint256) {
        return nextScanJobId - 1;
    }

    function getProject(uint256 projectId) external view returns (Project memory) {
        Project memory project = projectStore[projectId];
        if (!project.active) revert InvalidProject();
        return project;
    }

    function getScanJob(uint256 scanJobId) external view returns (ScanJob memory) {
        ScanJob memory job = scanJobStore[scanJobId];
        if (job.projectId == 0) revert InvalidRequest();
        return job;
    }

    function getIncident(uint256 incidentId) external view returns (Incident memory) {
        Incident memory incident = incidentStore[incidentId];
        if (incident.sponsor == address(0)) revert InvalidIncident();
        return incident;
    }

    function getFix(uint256 fixId) external view returns (FixSubmission memory) {
        FixSubmission memory fixSubmission = fixStore[fixId];
        if (fixSubmission.fixer == address(0)) revert InvalidFix();
        return fixSubmission;
    }

    function requiredAgentFee() public view returns (uint256) {
        return agentPlatform.getRequestDeposit() + agentFeePerValidator * subcommitteeSize;
    }

    function requiredJsonApiFee() public view returns (uint256) {
        return agentPlatform.getRequestDeposit() + jsonApiFeePerValidator * subcommitteeSize;
    }

    function requiredAutomationFee() public view returns (uint256) {
        return requiredJsonApiFee() * 2 + requiredAgentFee() * 3;
    }

    function quoteSetupBountyTiers(uint96 critical, uint96 high, uint96 medium)
        external
        view
        returns (uint256)
    {
        _validateTierAmounts(critical, high, medium);
        return uint256(critical) + uint256(high) + uint256(medium) + requiredAutomationFee();
    }

    function buildScanPayload(uint256 projectId, uint256 scanJobId)
        public
        view
        returns (bytes memory)
    {
        Project storage project = projectStore[projectId];
        ScanJob storage job = scanJobStore[scanJobId];
        if (!project.active || job.projectId != projectId) revert InvalidProject();

        string memory prompt = string.concat(
            "Scan Solidity evidence. Output CRITICAL,HIGH,MEDIUM,NONE,NEEDS_REVIEW. ",
            "Use registry templates. Severity guide: reentrancy draining funds, missing access control on public fund/admin action, oracle drain = CRITICAL; ",
            "tx.origin authorization, signature replay, unchecked call, admin/upgrade risk = HIGH; unsafe token transfer, DoS, rounding = MEDIUM. ",
            "If evidence shows require(tx.origin == owner), classify HIGH unless no privileged action exists. Registry:",
            vulnerabilityRegistry.agentTemplatePack(),
            " Snapshot:",
            job.snapshotURI,
            " Repo:",
            project.githubRepo,
            " P:",
            _uintToString(projectId),
            " J:",
            _uintToString(scanJobId)
        );
        string[] memory allowedValues = new string[](5);
        allowedValues[0] = "CRITICAL";
        allowedValues[1] = "HIGH";
        allowedValues[2] = "MEDIUM";
        allowedValues[3] = "NONE";
        allowedValues[4] = "NEEDS_REVIEW";

        return abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            prompt,
            "One allowed severity only.",
            false,
            allowedValues
        );
    }

    function buildSnapshotPayload(uint256 projectId, uint256 scanJobId)
        public
        view
        returns (bytes memory)
    {
        Project storage project = projectStore[projectId];
        ScanJob storage job = scanJobStore[scanJobId];
        if (!project.active || job.projectId != projectId) revert InvalidProject();
        return abi.encodeWithSelector(
            IJsonApiAgent.fetchString.selector,
            string.concat(
                automationApiBase,
                "/api/repo/snapshot?projectId=",
                _uintToString(projectId),
                "&scanJobId=",
                _uintToString(scanJobId)
            ),
            "agentInput"
        );
    }

    function buildSecondReviewPayload(uint256 scanJobId) public view returns (bytes memory) {
        ScanJob storage job = scanJobStore[scanJobId];
        Project storage project = projectStore[job.projectId];
        if (!project.active || job.projectId == 0) revert InvalidProject();

        string memory prompt = string.concat(
            "Validate candidate Solidity vulnerability. Output only VALID, INVALID, or NEEDS_REVIEW. ",
            "Candidate severity: ",
            _severityName(SeverityTier(job.candidateSeverity)),
            ". Evidence: ",
            job.snapshotURI,
            ". Decision rules: VALID if evidence contains require(tx.origin == owner) in withdraw/admin/fund movement code; ",
            "VALID if privileged action uses tx.origin for authorization; ",
            "INVALID only if no vulnerable code pattern appears; NEEDS_REVIEW only if evidence is too incomplete. ",
            "Do not reject because severity could be HIGH instead of CRITICAL. Evidence text: ",
            job.snapshotURI
        );
        string[] memory allowedValues = new string[](3);
        allowedValues[0] = "VALID";
        allowedValues[1] = "INVALID";
        allowedValues[2] = "NEEDS_REVIEW";

        return abi.encodeWithSelector(
            ILLMAgent.inferString.selector, prompt, "One verdict only.", false, allowedValues
        );
    }

    function buildPullRequestPayload(uint256 scanJobId) public view returns (bytes memory) {
        ScanJob storage job = scanJobStore[scanJobId];
        if (job.projectId == 0) revert InvalidRequest();
        return abi.encodeWithSelector(
            IJsonApiAgent.fetchString.selector,
            string.concat(automationApiBase, "/api/fix-pr?jobId=", _uintToString(scanJobId)),
            "pullRequest.url"
        );
    }

    function buildReviewPayload(uint256 incidentId, uint256 fixId)
        public
        view
        returns (bytes memory)
    {
        Incident storage incident = incidentStore[incidentId];
        FixSubmission storage fixSubmission = fixStore[fixId];
        if (incident.sponsor == address(0)) revert InvalidIncident();
        if (fixSubmission.fixer == address(0) || fixSubmission.incidentId != incidentId) {
            revert InvalidFix();
        }

        Project storage project = projectStore[incident.projectId];
        string memory prompt = string.concat(
            "Verify PR. Output VALID,INVALID,NEEDS_REVIEW. Repo:",
            project.githubRepo,
            " Incident:",
            incident.metadataURI,
            " Proof:",
            fixSubmission.proofURI
        );
        string[] memory allowedValues = new string[](3);
        allowedValues[0] = "VALID";
        allowedValues[1] = "INVALID";
        allowedValues[2] = "NEEDS_REVIEW";

        return abi.encodeWithSelector(
            ILLMAgent.inferString.selector, prompt, "One verdict only.", false, allowedValues
        );
    }

    function _requestSnapshot(uint256 scanJobId) internal returns (uint256 requestId) {
        ScanJob storage job = scanJobStore[scanJobId];
        uint256 fee = requiredJsonApiFee();
        _consumeAgentReserve(job, fee);
        requestId = _requestSnapshotWithFee(scanJobId, fee);
    }

    function _requestSnapshotWithFee(uint256 scanJobId, uint256 fee)
        internal
        returns (uint256 requestId)
    {
        ScanJob storage job = scanJobStore[scanJobId];
        requestId = agentPlatform.createRequest{ value: fee }(
            jsonApiAgentId,
            address(this),
            RAW_AGENT_CALLBACK_SELECTOR,
            buildSnapshotPayload(job.projectId, scanJobId)
        );
        pendingAgentRequests[requestId] = PendingAgentRequest({
            kind: AgentRequestKind.Snapshot,
            scanJobId: scanJobId,
            incidentId: 0,
            fixId: 0,
            exists: true
        });
        job.latestRequestId = requestId;
        emit SnapshotRequested(requestId, job.projectId, scanJobId, uint64(block.timestamp));
        emit AgentLog(job.projectId, scanJobId, "snapshot requested", automationApiBase);
    }

    function _requestScan(uint256 scanJobId) internal returns (uint256 requestId) {
        ScanJob storage job = scanJobStore[scanJobId];
        uint256 fee = requiredAgentFee();
        _consumeAgentReserve(job, fee);
        requestId = agentPlatform.createRequest{ value: fee }(
            agentId,
            address(this),
            RAW_AGENT_CALLBACK_SELECTOR,
            buildScanPayload(job.projectId, scanJobId)
        );
        pendingAgentRequests[requestId] = PendingAgentRequest({
            kind: AgentRequestKind.Scan, scanJobId: scanJobId, incidentId: 0, fixId: 0, exists: true
        });
        job.latestRequestId = requestId;
        emit LLMScanRequested(requestId, job.projectId, scanJobId, uint64(block.timestamp));
        emit AgentLog(job.projectId, scanJobId, "llm requested", job.snapshotURI);
    }

    function _requestSecondReview(uint256 scanJobId) internal returns (uint256 requestId) {
        ScanJob storage job = scanJobStore[scanJobId];
        uint256 fee = requiredAgentFee();
        _consumeAgentReserve(job, fee);
        requestId = agentPlatform.createRequest{ value: fee }(
            agentId,
            address(this),
            RAW_AGENT_CALLBACK_SELECTOR,
            buildSecondReviewPayload(scanJobId)
        );
        pendingAgentRequests[requestId] = PendingAgentRequest({
            kind: AgentRequestKind.SecondReview,
            scanJobId: scanJobId,
            incidentId: 0,
            fixId: 0,
            exists: true
        });
        job.latestRequestId = requestId;
        emit SecondReviewRequested(requestId, job.projectId, scanJobId, uint64(block.timestamp));
        emit AgentLog(job.projectId, scanJobId, "review requested", job.resultURI);
    }

    function _requestPullRequest(uint256 scanJobId, uint256 incidentId)
        internal
        returns (uint256 requestId)
    {
        ScanJob storage job = scanJobStore[scanJobId];
        uint256 fee = requiredJsonApiFee();
        _consumeAgentReserve(job, fee);
        requestId = agentPlatform.createRequest{ value: fee }(
            jsonApiAgentId,
            address(this),
            RAW_AGENT_CALLBACK_SELECTOR,
            buildPullRequestPayload(scanJobId)
        );
        pendingAgentRequests[requestId] = PendingAgentRequest({
            kind: AgentRequestKind.PullRequest,
            scanJobId: scanJobId,
            incidentId: incidentId,
            fixId: 0,
            exists: true
        });
        job.latestRequestId = requestId;
        emit PRRequested(
            requestId, job.projectId, scanJobId, incidentId, uint64(block.timestamp)
        );
        emit AgentLog(job.projectId, scanJobId, "pr requested", automationApiBase);
    }

    function _requestFinalReview(uint256 scanJobId, uint256 incidentId, uint256 fixId)
        internal
        returns (uint256 requestId)
    {
        ScanJob storage job = scanJobStore[scanJobId];
        uint256 fee = requiredAgentFee();
        _consumeAgentReserve(job, fee);
        requestId = agentPlatform.createRequest{ value: fee }(
            agentId,
            address(this),
            RAW_AGENT_CALLBACK_SELECTOR,
            buildReviewPayload(incidentId, fixId)
        );
        pendingAgentRequests[requestId] = PendingAgentRequest({
            kind: AgentRequestKind.FinalReview,
            scanJobId: scanJobId,
            incidentId: incidentId,
            fixId: fixId,
            exists: true
        });
        job.latestRequestId = requestId;
        incidentStore[incidentId].status = IncidentStatus.ReviewPending;
        emit FinalReviewRequested(
            requestId, incidentId, fixId, scanJobId, uint64(block.timestamp)
        );
        emit AgentLog(job.projectId, scanJobId, "final requested", fixStore[fixId].proofURI);
    }

    function _handleAgentResponse(
        uint256 requestId,
        PendingAgentRequest memory agentRequest,
        Response[] memory responses,
        ResponseStatus status
    ) internal {
        if (agentRequest.kind == AgentRequestKind.Snapshot) {
            _handleSnapshotResponse(requestId, agentRequest.scanJobId, responses, status);
            return;
        }
        if (agentRequest.kind == AgentRequestKind.Scan) {
            _handleScanResponse(requestId, agentRequest.scanJobId, responses, status);
            return;
        }
        if (agentRequest.kind == AgentRequestKind.SecondReview) {
            _handleSecondReviewResponse(requestId, agentRequest.scanJobId, responses, status);
            return;
        }
        if (agentRequest.kind == AgentRequestKind.PullRequest) {
            _handlePullRequestResponse(
                requestId, agentRequest.scanJobId, agentRequest.incidentId, responses, status
            );
            return;
        }
        if (agentRequest.kind == AgentRequestKind.FinalReview) {
            _handleReviewResponse(
                requestId, agentRequest.incidentId, agentRequest.fixId, responses, status
            );
            return;
        }
        revert InvalidRequest();
    }

    function _handleRawAgentResponse(
        uint256 requestId,
        PendingAgentRequest memory agentRequest,
        bool success,
        bytes memory result
    ) internal {
        Response[] memory responses;
        ResponseStatus status = success ? ResponseStatus.Success : ResponseStatus.Failed;

        if (success && result.length > 0) {
            responses = new Response[](1);
            responses[0] = Response({ result: result });
        } else {
            responses = new Response[](0);
        }

        _handleAgentResponse(requestId, agentRequest, responses, status);
    }

    function _decodeRawAgentCallback()
        internal
        pure
        returns (uint256 requestId, bool success, bytes memory result)
    {
        uint256 responsesOffset;
        uint256 statusWord;
        assembly {
            requestId := calldataload(4)
            responsesOffset := calldataload(36)
            statusWord := calldataload(68)
        }

        success = statusWord == RAW_AGENT_SUCCESS_STATUS;
        if (!success) return (requestId, false, "");

        uint256 responsesStart = 4 + responsesOffset;
        uint256 responseCount;
        assembly {
            responseCount := calldataload(responsesStart)
        }
        if (responseCount == 0) return (requestId, false, "");

        uint256 firstResponseOffset;
        assembly {
            firstResponseOffset := calldataload(add(responsesStart, 32))
        }

        uint256 firstResponseStart = responsesStart + 32 + firstResponseOffset;
        uint256 resultOffset;
        assembly {
            resultOffset := calldataload(add(firstResponseStart, 32))
        }

        uint256 resultLengthPosition = firstResponseStart + resultOffset;
        uint256 resultLength;
        assembly {
            resultLength := calldataload(resultLengthPosition)
        }

        result = new bytes(resultLength);
        uint256 resultDataPosition = resultLengthPosition + 32;
        for (uint256 i; i < resultLength; i += 32) {
            bytes32 chunk;
            assembly {
                chunk := calldataload(add(resultDataPosition, i))
            }
            assembly {
                mstore(add(add(result, 32), i), chunk)
            }
        }
    }

    function _handleSnapshotResponse(
        uint256 requestId,
        uint256 scanJobId,
        Response[] memory responses,
        ResponseStatus status
    ) internal {
        ScanJob storage job = scanJobStore[scanJobId];
        if (status != ResponseStatus.Success || responses.length == 0) {
            job.status = ScanStatus.Failed;
            job.resultHash = keccak256("SNAPSHOT_FAILED");
            emit AgentLog(job.projectId, scanJobId, "snapshot failed", "");
            emit ScanCompleted(requestId, scanJobId, job.status, 0, job.resultHash);
            return;
        }

        job.snapshotURI = abi.decode(responses[0].result, (string));
        emit AgentLog(job.projectId, scanJobId, "snapshot fetched", job.snapshotURI);
        _requestScan(scanJobId);
    }

    function _handleScanResponse(
        uint256 requestId,
        uint256 scanJobId,
        Response[] memory responses,
        ResponseStatus status
    ) internal {
        ScanJob storage job = scanJobStore[scanJobId];
        Project storage project = projectStore[job.projectId];

        if (status != ResponseStatus.Success || responses.length == 0) {
            job.status = ScanStatus.Failed;
            job.resultHash = keccak256("SCAN_FAILED");
            emit AgentLog(job.projectId, scanJobId, "scan failed", project.githubRepo);
            emit ScanCompleted(requestId, scanJobId, job.status, 0, job.resultHash);
            return;
        }

        string memory rawResult = abi.decode(responses[0].result, (string));
        bytes32 resultHash = keccak256(bytes(rawResult));
        SeverityTier tier = _parseSeverity(rawResult);
        job.resultHash = resultHash;
        job.resultURI = rawResult;

        if (resultHash == keccak256("NEEDS_REVIEW")) {
            job.status = ScanStatus.NeedsReview;
            emit AgentLog(job.projectId, scanJobId, "scan needs review", rawResult);
            emit ScanCompleted(requestId, scanJobId, job.status, 0, resultHash);
            return;
        }

        if (tier == SeverityTier.None) {
            job.status = ScanStatus.NoFinding;
            emit AgentLog(job.projectId, scanJobId, "scan completed", "no finding");
            emit ScanCompleted(requestId, scanJobId, job.status, 0, resultHash);
            return;
        }

        if (
            tier == SeverityTier.Critical || tier == SeverityTier.High
                || tier == SeverityTier.Medium
        ) {
            job.candidateSeverity = uint8(tier);
            job.status = ScanStatus.Pending;
            emit AgentLog(job.projectId, scanJobId, "candidate found", rawResult);
            _requestSecondReview(scanJobId);
            return;
        }

        job.status = ScanStatus.NeedsReview;
        emit AgentLog(job.projectId, scanJobId, "scan needs review", rawResult);
        emit ScanCompleted(requestId, scanJobId, job.status, 0, resultHash);
    }

    function _handleSecondReviewResponse(
        uint256 requestId,
        uint256 scanJobId,
        Response[] memory responses,
        ResponseStatus status
    ) internal {
        ScanJob storage job = scanJobStore[scanJobId];
        if (status != ResponseStatus.Success || responses.length == 0) {
            job.status = ScanStatus.NeedsReview;
            job.resultHash = keccak256("SECOND_REVIEW_FAILED");
            emit AgentLog(job.projectId, scanJobId, "second review failed", "");
            emit ScanCompleted(requestId, scanJobId, job.status, 0, job.resultHash);
            return;
        }

        string memory rawDecision = abi.decode(responses[0].result, (string));
        FixDecision decision = _parseDecision(rawDecision);
        if (decision != FixDecision.Valid) {
            job.status =
                decision == FixDecision.Invalid ? ScanStatus.NoFinding : ScanStatus.NeedsReview;
            job.resultHash = keccak256(bytes(rawDecision));
            emit AgentLog(job.projectId, scanJobId, "second review result", rawDecision);
            emit ScanCompleted(requestId, scanJobId, job.status, 0, job.resultHash);
            return;
        }

        SeverityTier tier = SeverityTier(job.candidateSeverity);
        uint96 bounty = _reserveTierBounty(job.projectId, tier);
        uint8 severity =
            uint8(tier == SeverityTier.Critical ? 5 : tier == SeverityTier.High ? 3 : 1);
        uint256 incidentId = nextIncidentId++;
        incidentStore[incidentId] = Incident({
            projectId: job.projectId,
            sponsor: job.sponsor,
            reporter: address(this),
            bounty: bounty,
            deadline: uint64(block.timestamp + DEFAULT_INCIDENT_DEADLINE),
            severity: severity,
            status: IncidentStatus.Open,
            evidenceHash: job.resultHash,
            metadataURI: job.resultURI,
            winningFixId: 0
        });
        job.status = ScanStatus.CandidateFound;
        job.incidentId = incidentId;

        emit AgentLog(job.projectId, scanJobId, "candidate validated", rawDecision);
        emit IncidentOpened(
            incidentId,
            job.projectId,
            job.sponsor,
            address(this),
            bounty,
            uint64(block.timestamp + DEFAULT_INCIDENT_DEADLINE),
            severity,
            job.resultHash,
            job.resultURI
        );
        emit ScanCompleted(requestId, scanJobId, job.status, incidentId, job.resultHash);
        _requestPullRequest(scanJobId, incidentId);
    }

    function _handlePullRequestResponse(
        uint256,
        uint256 scanJobId,
        uint256 incidentId,
        Response[] memory responses,
        ResponseStatus status
    ) internal {
        ScanJob storage job = scanJobStore[scanJobId];
        Incident storage incident = incidentStore[incidentId];
        if (status != ResponseStatus.Success || responses.length == 0) {
            emit AgentLog(job.projectId, scanJobId, "pr creation failed", "");
            return;
        }

        string memory prUrl = abi.decode(responses[0].result, (string));
        if (bytes(prUrl).length == 0) {
            emit AgentLog(job.projectId, scanJobId, "pr creation failed", "empty pr url");
            return;
        }

        Project storage project = projectStore[incident.projectId];
        uint256 fixId = nextFixId++;
        bytes32 proofHash = keccak256(bytes(prUrl));
        fixStore[fixId] = FixSubmission({
            incidentId: incidentId,
            fixer: address(this),
            payoutRecipient: project.agentPayoutWallet,
            proofURI: prUrl,
            proofHash: proofHash,
            decision: FixDecision.None,
            scoreBps: 0,
            resultHash: bytes32(0),
            paid: false,
            paidAmount: 0
        });
        job.fixId = fixId;

        emit FixSubmitted(
            fixId, incidentId, address(this), project.agentPayoutWallet, prUrl, proofHash
        );
        emit AgentLog(job.projectId, scanJobId, "pr created", prUrl);
        _requestFinalReview(scanJobId, incidentId, fixId);
    }

    function _handleReviewResponse(
        uint256 requestId,
        uint256 incidentId,
        uint256 fixId,
        Response[] memory responses,
        ResponseStatus status
    ) internal {
        Incident storage incident = incidentStore[incidentId];
        FixSubmission storage fixSubmission = fixStore[fixId];

        if (status != ResponseStatus.Success || responses.length == 0) {
            _recordNonValidDecision(
                requestId, fixId, incident, fixSubmission, FixDecision.NeedsReview, ""
            );
            return;
        }

        string memory rawDecision = abi.decode(responses[0].result, (string));
        FixDecision decision = _parseDecision(rawDecision);
        bytes32 resultHash = keccak256(bytes(rawDecision));
        uint16 scoreBps = decision == FixDecision.Valid ? MAX_SCORE_BPS : 0;

        fixSubmission.decision = decision;
        fixSubmission.scoreBps = scoreBps;
        fixSubmission.resultHash = resultHash;

        if (decision == FixDecision.Valid) {
            _releaseBounty(incidentId, fixId, incident, fixSubmission);
        } else {
            _reopenOrExpire(incident);
        }

        emit AgentLog(incident.projectId, 0, "somnia verifier result", rawDecision);
        emit FixVerified(requestId, fixId, decision, scoreBps, resultHash);
    }

    function _validateTierAmounts(uint96 critical, uint96 high, uint96 medium) internal pure {
        if (critical < MIN_CRITICAL_BOUNTY) revert InvalidBounty();
        if (high < MIN_HIGH_BOUNTY) revert InvalidBounty();
        if (medium < MIN_MEDIUM_BOUNTY) revert InvalidBounty();
    }

    function _consumeAgentReserve(ScanJob storage job, uint256 fee) internal {
        if (job.agentFeeReserve < fee) revert InsufficientAgentFee();
        job.agentFeeReserve -= fee;
    }

    function _reserveTierBounty(uint256 projectId, SeverityTier tier) internal returns (uint96) {
        BountyTiers storage tiers = projectBountyTiers[projectId];
        if (tier == SeverityTier.Critical) {
            uint96 amount = tiers.critical;
            if (amount == 0) revert InvalidBounty();
            tiers.critical = 0;
            return amount;
        }
        if (tier == SeverityTier.High) {
            uint96 amount = tiers.high;
            if (amount == 0) revert InvalidBounty();
            tiers.high = 0;
            return amount;
        }
        uint96 medium = tiers.medium;
        if (medium == 0) revert InvalidBounty();
        tiers.medium = 0;
        return medium;
    }

    function _recordNonValidDecision(
        uint256 requestId,
        uint256 fixId,
        Incident storage incident,
        FixSubmission storage fixSubmission,
        FixDecision decision,
        string memory rawDecision
    ) internal {
        fixSubmission.decision = decision;
        fixSubmission.scoreBps = 0;
        fixSubmission.resultHash = keccak256(bytes(rawDecision));
        _reopenOrExpire(incident);
        emit FixVerified(requestId, fixId, decision, 0, fixSubmission.resultHash);
    }

    function _parseDecision(string memory rawDecision) internal pure returns (FixDecision) {
        bytes32 decisionHash = keccak256(bytes(rawDecision));
        if (decisionHash == keccak256("VALID")) return FixDecision.Valid;
        if (decisionHash == keccak256("INVALID")) return FixDecision.Invalid;
        if (decisionHash == keccak256("NEEDS_REVIEW")) return FixDecision.NeedsReview;
        return FixDecision.NeedsReview;
    }

    function _parseSeverity(string memory rawResult) internal pure returns (SeverityTier) {
        bytes32 resultHash = keccak256(bytes(rawResult));
        if (resultHash == keccak256("CRITICAL")) return SeverityTier.Critical;
        if (resultHash == keccak256("HIGH")) return SeverityTier.High;
        if (resultHash == keccak256("MEDIUM")) return SeverityTier.Medium;
        if (resultHash == keccak256("NONE")) return SeverityTier.None;
        return SeverityTier.None;
    }

    function _severityName(SeverityTier tier) internal pure returns (string memory) {
        if (tier == SeverityTier.Critical) return "CRITICAL";
        if (tier == SeverityTier.High) return "HIGH";
        if (tier == SeverityTier.Medium) return "MEDIUM";
        return "NONE";
    }

    function _releaseBounty(
        uint256 incidentId,
        uint256 fixId,
        Incident storage incident,
        FixSubmission storage fixSubmission
    ) internal {
        uint256 amount = incident.bounty;
        if (amount == 0 || fixSubmission.paid) revert InvalidBounty();

        incident.bounty = 0;
        incident.status = IncidentStatus.Paid;
        incident.winningFixId = fixId;
        fixSubmission.paid = true;
        fixSubmission.paidAmount = uint96(amount);

        (bool sent,) = fixSubmission.payoutRecipient.call{ value: amount }("");
        if (!sent) revert PayoutFailed();

        emit BountyPaid(incidentId, fixId, fixSubmission.payoutRecipient, amount);
    }

    function _reopenOrExpire(Incident storage incident) internal {
        incident.status =
            block.timestamp >= incident.deadline ? IncidentStatus.Expired : IncidentStatus.Open;
    }

    function _uintToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}
