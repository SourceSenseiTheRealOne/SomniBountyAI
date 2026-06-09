#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  formatEther,
  http,
  keccak256,
  parseAbi,
  toBytes,
} from "viem";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const appDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appDir, "..", "..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (process.env[key]) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadEnvFile(path.join(appDir, ".env.local"));
loadEnvFile(path.join(appDir, ".env"));
loadEnvFile(path.join(repoRoot, "smart_contract", ".env"));

const argv = process.argv.slice(2);
const args = new Set(argv);
const mutatePr = args.has("--mutate-pr");
const fetchTimeoutMs = Number(readArg("--fetch-timeout-ms") ?? 20_000);
const rpcTimeoutMs = Number(readArg("--rpc-timeout-ms") ?? 20_000);
const fromBlockArg = readArg("--from-block");
const backendBase = (
  readArg("--backend") ||
  process.env.AUTOMATION_API_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://p01--somnibountyai--yrnf5wlhj7v8.code.run"
).replace(/\/$/, "");
const rpcUrl =
  process.env.SOMNIA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOMNIA_RPC_URL ||
  "https://api.infra.testnet.somnia.network/";
const contractAddress =
  process.env.SOMNIBOUNTY_ADDRESS || process.env.NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS;
const registryAddress =
  process.env.VULNERABILITY_REGISTRY_ADDRESS ||
  process.env.NEXT_PUBLIC_VULNERABILITY_REGISTRY_ADDRESS;

function readArg(name) {
  const index = argv.indexOf(name);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

const somniaTestnet = {
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { decimals: 18, name: "Somnia Test Token", symbol: "STT" },
  rpcUrls: { default: { http: [rpcUrl] } },
};

const bountyAbi = parseAbi([
  "function agentPlatform() view returns (address)",
  "function vulnerabilityRegistry() view returns (address)",
  "function agentId() view returns (uint256)",
  "function jsonApiAgentId() view returns (uint256)",
  "function agentFeePerValidator() view returns (uint256)",
  "function jsonApiFeePerValidator() view returns (uint256)",
  "function subcommitteeSize() view returns (uint8)",
  "function automationApiBase() view returns (string)",
  "function requiredAgentFee() view returns (uint256)",
  "function requiredJsonApiFee() view returns (uint256)",
  "function requiredAutomationFee() view returns (uint256)",
  "function totalCounts() view returns (uint256 projectCount,uint256 incidentCount,uint256 fixCount)",
  "function scanJobCount() view returns (uint256)",
  "function getProject(uint256 projectId) view returns ((address owner,bool active,bytes32 metadataHash,string name,string description,string socialUrl,string imageUrl,string githubRepo,address agentPayoutWallet))",
  "function projectBountyTiers(uint256 projectId) view returns (uint96 critical,uint96 high,uint96 medium)",
  "function getScanJob(uint256 scanJobId) view returns ((uint256 projectId,address sponsor,uint96 criticalBounty,uint96 highBounty,uint96 mediumBounty,uint64 requestedAt,uint8 status,uint256 incidentId,uint256 fixId,uint256 agentFeeReserve,uint256 latestRequestId,uint8 candidateSeverity,string snapshotURI,bytes32 resultHash,string resultURI))",
  "function getIncident(uint256 incidentId) view returns ((uint256 projectId,address sponsor,address reporter,uint96 bounty,uint64 deadline,uint8 severity,uint8 status,bytes32 evidenceHash,string metadataURI,uint256 winningFixId))",
  "function getFix(uint256 fixId) view returns ((uint256 incidentId,address fixer,address payoutRecipient,string proofURI,bytes32 proofHash,uint8 decision,uint16 scoreBps,bytes32 resultHash,bool paid,uint96 paidAmount))",
  "function pendingAgentRequests(uint256 requestId) view returns (uint8 kind,uint256 scanJobId,uint256 incidentId,uint256 fixId,bool exists)",
  "event ProjectRegistered(uint256 indexed projectId,address indexed owner,address indexed agentPayoutWallet,bytes32 metadataHash)",
  "event BountyTiersFunded(uint256 indexed projectId,uint256 indexed scanJobId,uint256 critical,uint256 high,uint256 medium)",
  "event SnapshotRequested(uint256 indexed requestId,uint256 indexed projectId,uint256 indexed scanJobId,uint64 requestedAt)",
  "event LLMScanRequested(uint256 indexed requestId,uint256 indexed projectId,uint256 indexed scanJobId,uint64 requestedAt)",
  "event SecondReviewRequested(uint256 indexed requestId,uint256 indexed projectId,uint256 indexed scanJobId,uint64 requestedAt)",
  "event PRRequested(uint256 indexed requestId,uint256 indexed projectId,uint256 indexed scanJobId,uint256 incidentId,uint64 requestedAt)",
  "event FinalReviewRequested(uint256 indexed requestId,uint256 indexed incidentId,uint256 indexed fixId,uint256 scanJobId,uint64 requestedAt)",
  "event ScanCompleted(uint256 indexed requestId,uint256 indexed scanJobId,uint8 status,uint256 incidentId,bytes32 resultHash)",
  "event AgentLog(uint256 indexed projectId,uint256 indexed scanJobId,string step,string detail)",
  "event IncidentOpened(uint256 indexed incidentId,uint256 indexed projectId,address indexed sponsor,address reporter,uint256 bounty,uint64 deadline,uint8 severity,bytes32 evidenceHash,string metadataURI)",
  "event FixSubmitted(uint256 indexed fixId,uint256 indexed incidentId,address indexed fixer,address payoutRecipient,string proofURI,bytes32 proofHash)",
  "event FixVerified(uint256 indexed requestId,uint256 indexed fixId,uint8 decision,uint16 scoreBps,bytes32 resultHash)",
  "event BountyPaid(uint256 indexed incidentId,uint256 indexed fixId,address indexed payoutRecipient,uint256 amount)",
]);

const registryAbi = parseAbi([
  "function templateCount() view returns (uint256)",
  "function agentTemplatePack() view returns (string)",
]);

const scanStatuses = ["None", "Pending", "CandidateFound", "NoFinding", "NeedsReview", "Failed"];
const requestKinds = ["None", "Snapshot", "Scan", "SecondReview", "PullRequest", "FinalReview"];
const incidentStatuses = ["Open", "ReviewPending", "Paid", "Cancelled", "Expired"];
const fixDecisions = ["None", "Valid", "Invalid", "NeedsReview"];

function stt(value) {
  return `${Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  })} STT`;
}

function line(label, value) {
  console.log(`${label}: ${value}`);
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function getLogs(client, eventName, fromBlock) {
  const event = bountyAbi.find((item) => item.type === "event" && item.name === eventName);
  return client.getLogs({
    address: contractAddress,
    event,
    fromBlock,
    toBlock: "latest",
  });
}

function explainScanJob(job, latestLogStep, pendingRequests) {
  const status = scanStatuses[Number(job.status)] ?? `Unknown(${job.status})`;
  if (status === "Pending" && !job.snapshotURI) {
    const pendingSnapshot = pendingRequests.find(
      (request) => request.exists && Number(request.kind) === 1 && request.scanJobId === job.id,
    );
    if (pendingSnapshot) {
      return "Stuck before repo snapshot callback. Check Somnia JSON API agent request status, callback delivery, and backend /api/repo/snapshot availability.";
    }
    return "No snapshot URI and no known pending snapshot request from emitted ScanRequested events. Need agent platform request lookup or missing event IDs for later diagnosis.";
  }
  if (status === "Pending" && job.snapshotURI) {
    return "Snapshot returned. Stuck during LLM scan or second-review stage. Contract does not emit requestId for these later requests, so add request-id events for Scan/SecondReview/PR/FinalReview.";
  }
  if (status === "CandidateFound" && job.incidentId > 0n && job.fixId === 0n) {
    return "Candidate validated. PR creation likely pending or failed. Check AgentLog for 'pr requested'/'pr creation failed' and backend /api/fix-pr.";
  }
  if (status === "CandidateFound" && job.fixId > 0n) {
    return "PR fix created. Final verifier or payout may be pending.";
  }
  if (status === "Failed" || status === "NeedsReview" || status === "NoFinding") {
    return `Terminal/attention state. Latest log: ${latestLogStep || "none"}.`;
  }
  return `Current stage: ${status}.`;
}

async function main() {
  if (!contractAddress || !/^0x[a-fA-F0-9]{40}$/.test(contractAddress)) {
    throw new Error("Set SOMNIBOUNTY_ADDRESS or NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS first.");
  }

  const client = createPublicClient({
    chain: somniaTestnet,
    transport: http(rpcUrl, { timeout: rpcTimeoutMs }),
  });
  const latestBlock = await client.getBlockNumber();
  const fromBlock = fromBlockArg
    ? BigInt(fromBlockArg)
    : latestBlock > 20_000n
      ? latestBlock - 20_000n
      : 0n;

  console.log("SomniBounty live-flow diagnosis");
  line("rpc", rpcUrl);
  line("contract", contractAddress);
  line("registry", registryAddress || "not configured");
  line("backend", backendBase || "not configured");
  line("from block", fromBlock.toString());
  line("mode", mutatePr ? "PR mutation enabled" : "read-only");
  console.log("");

  const [
    agentPlatform,
    onchainRegistry,
    agentId,
    jsonApiAgentId,
    agentFee,
    jsonApiFee,
    subcommitteeSize,
    automationApiBase,
    requiredAgentFee,
    requiredJsonApiFee,
    requiredAutomationFee,
    counts,
    scanJobCount,
  ] = await Promise.all([
    client.readContract({ address: contractAddress, abi: bountyAbi, functionName: "agentPlatform" }),
    client.readContract({
      address: contractAddress,
      abi: bountyAbi,
      functionName: "vulnerabilityRegistry",
    }),
    client.readContract({ address: contractAddress, abi: bountyAbi, functionName: "agentId" }),
    client.readContract({ address: contractAddress, abi: bountyAbi, functionName: "jsonApiAgentId" }),
    client.readContract({
      address: contractAddress,
      abi: bountyAbi,
      functionName: "agentFeePerValidator",
    }),
    client.readContract({
      address: contractAddress,
      abi: bountyAbi,
      functionName: "jsonApiFeePerValidator",
    }),
    client.readContract({
      address: contractAddress,
      abi: bountyAbi,
      functionName: "subcommitteeSize",
    }),
    client.readContract({
      address: contractAddress,
      abi: bountyAbi,
      functionName: "automationApiBase",
    }),
    client.readContract({
      address: contractAddress,
      abi: bountyAbi,
      functionName: "requiredAgentFee",
    }),
    client.readContract({
      address: contractAddress,
      abi: bountyAbi,
      functionName: "requiredJsonApiFee",
    }),
    client.readContract({
      address: contractAddress,
      abi: bountyAbi,
      functionName: "requiredAutomationFee",
    }),
    client.readContract({ address: contractAddress, abi: bountyAbi, functionName: "totalCounts" }),
    client.readContract({ address: contractAddress, abi: bountyAbi, functionName: "scanJobCount" }),
  ]);

  console.log("Contract config");
  line("agent platform", agentPlatform);
  line("llm agent id", agentId.toString());
  line("json api agent id", jsonApiAgentId.toString());
  line("subcommittee", subcommitteeSize.toString());
  line("llm fee/validator", stt(agentFee));
  line("json fee/validator", stt(jsonApiFee));
  line("required llm request", stt(requiredAgentFee));
  line("required json request", stt(requiredJsonApiFee));
  line("required automation reserve", stt(requiredAutomationFee));
  line("automation api base", automationApiBase);
  console.log("");

  if (registryAddress || onchainRegistry) {
    try {
      const registry = onchainRegistry || registryAddress;
      const [templateCount, pack] = await Promise.all([
        client.readContract({ address: registry, abi: registryAbi, functionName: "templateCount" }),
        client.readContract({ address: registry, abi: registryAbi, functionName: "agentTemplatePack" }),
      ]);
      console.log("Vulnerability registry");
      line("address", registry);
      line("template count", templateCount.toString());
      line("template pack hash", keccak256(toBytes(pack)));
      line("template pack chars", pack.length.toString());
      console.log("");
    } catch (error) {
      console.log(`Registry check failed: ${error.shortMessage || error.message}`);
      console.log("");
    }
  }

  const [projectCount, incidentCount, fixCount] = counts;
  console.log("Counts");
  line("projects", projectCount.toString());
  line("scan jobs", scanJobCount.toString());
  line("incidents", incidentCount.toString());
  line("fixes", fixCount.toString());
  console.log("");

  const projects = new Map();
  for (let id = 1n; id <= projectCount; id++) {
    try {
      const [project, tiers] = await Promise.all([
        client.readContract({ address: contractAddress, abi: bountyAbi, functionName: "getProject", args: [id] }),
        client.readContract({
          address: contractAddress,
          abi: bountyAbi,
          functionName: "projectBountyTiers",
          args: [id],
        }),
      ]);
      projects.set(id.toString(), project);
      console.log(`Project #${id}`);
      line("name", project.name);
      line("owner", project.owner);
      line("repo", project.githubRepo);
      line("payout wallet", project.agentPayoutWallet);
      line("tiers", `critical=${stt(tiers[0])}, high=${stt(tiers[1])}, medium=${stt(tiers[2])}`);
      console.log("");
    } catch (error) {
      console.log(`Project #${id} read failed: ${error.shortMessage || error.message}`);
    }
  }

  const eventNames = [
    "SnapshotRequested",
    "LLMScanRequested",
    "SecondReviewRequested",
    "PRRequested",
    "FinalReviewRequested",
    "ScanCompleted",
    "AgentLog",
    "IncidentOpened",
    "FixSubmitted",
    "FixVerified",
    "BountyPaid",
  ];
  const eventResults = {};
  for (const name of eventNames) {
    try {
      eventResults[name] = await getLogs(client, name, fromBlock);
    } catch (error) {
      console.log(`Event log read failed for ${name}: ${error.shortMessage || error.message}`);
      eventResults[name] = [];
    }
  }

  const requestIds = [
    ...eventResults.SnapshotRequested.map((log) => log.args.requestId),
    ...eventResults.LLMScanRequested.map((log) => log.args.requestId),
    ...eventResults.SecondReviewRequested.map((log) => log.args.requestId),
    ...eventResults.PRRequested.map((log) => log.args.requestId),
    ...eventResults.FinalReviewRequested.map((log) => log.args.requestId),
    ...eventResults.ScanCompleted.map((log) => log.args.requestId),
    ...eventResults.FixVerified.map((log) => log.args.requestId),
  ];
  const uniqueRequestIds = [...new Set(requestIds.map((id) => id.toString()))].map(BigInt);
  const pendingRequests = [];
  for (const requestId of uniqueRequestIds) {
    try {
      const request = await client.readContract({
        address: contractAddress,
        abi: bountyAbi,
        functionName: "pendingAgentRequests",
        args: [requestId],
      });
      pendingRequests.push({
        requestId,
        kind: request[0],
        scanJobId: request[1],
        incidentId: request[2],
        fixId: request[3],
        exists: request[4],
      });
    } catch (error) {
      console.log(`Pending request #${requestId} read failed: ${error.shortMessage || error.message}`);
    }
  }

  console.log("Request events");
  for (const request of pendingRequests) {
    line(
      `request #${request.requestId}`,
      `${request.exists ? "pending" : "completed/deleted"} kind=${requestKinds[Number(request.kind)] ?? request.kind} scanJob=${request.scanJobId} incident=${request.incidentId} fix=${request.fixId}`,
    );
  }
  if (pendingRequests.length === 0) console.log("no request ids emitted yet");
  console.log("");

  console.log("Agent logs");
  for (const log of eventResults.AgentLog) {
    console.log(
      `- project=${log.args.projectId} scanJob=${log.args.scanJobId} step="${log.args.step}" detail="${log.args.detail}" tx=${log.transactionHash}`,
    );
  }
  if (eventResults.AgentLog.length === 0) console.log("no AgentLog events");
  console.log("");

  const latestLogByJob = new Map();
  for (const log of eventResults.AgentLog) {
    latestLogByJob.set(log.args.scanJobId.toString(), log.args.step);
  }

  console.log("Scan jobs");
  const jobs = [];
  for (let id = 1n; id <= scanJobCount; id++) {
    try {
      const job = await client.readContract({
        address: contractAddress,
        abi: bountyAbi,
        functionName: "getScanJob",
        args: [id],
      });
      job.id = id;
      jobs.push(job);
      console.log(`Scan job #${id}`);
      line("project", `${job.projectId} (${projects.get(job.projectId.toString())?.name || "unknown"})`);
      line("status", scanStatuses[Number(job.status)] ?? `Unknown(${job.status})`);
      line("incident", job.incidentId.toString());
      line("fix", job.fixId.toString());
      line("reserve left", stt(job.agentFeeReserve));
      line("latest request", job.latestRequestId.toString());
      line("snapshotURI", job.snapshotURI || "<empty>");
      line("resultURI", job.resultURI || "<empty>");
      line("resultHash", job.resultHash);
      line("diagnosis", explainScanJob(job, latestLogByJob.get(id.toString()), pendingRequests));
      console.log("");
    } catch (error) {
      console.log(`Scan job #${id} read failed: ${error.shortMessage || error.message}`);
    }
  }

  if (incidentCount > 0n) {
    console.log("Incidents");
    for (let id = 1n; id <= incidentCount; id++) {
      try {
        const incident = await client.readContract({
          address: contractAddress,
          abi: bountyAbi,
          functionName: "getIncident",
          args: [id],
        });
        console.log(`Incident #${id}`);
        line("project", incident.projectId.toString());
        line("status", incidentStatuses[Number(incident.status)] ?? String(incident.status));
        line("bounty", stt(incident.bounty));
        line("severity", incident.severity.toString());
        line("metadata", incident.metadataURI);
        console.log("");
      } catch (error) {
        console.log(`Incident #${id} read failed: ${error.shortMessage || error.message}`);
      }
    }
  }

  if (fixCount > 0n) {
    console.log("Fixes");
    for (let id = 1n; id <= fixCount; id++) {
      try {
        const fix = await client.readContract({
          address: contractAddress,
          abi: bountyAbi,
          functionName: "getFix",
          args: [id],
        });
        console.log(`Fix #${id}`);
        line("incident", fix.incidentId.toString());
        line("payout", fix.payoutRecipient);
        line("decision", fixDecisions[Number(fix.decision)] ?? String(fix.decision));
        line("paid", fix.paid ? stt(fix.paidAmount) : "no");
        line("proof", fix.proofURI);
        console.log("");
      } catch (error) {
        console.log(`Fix #${id} read failed: ${error.shortMessage || error.message}`);
      }
    }
  }

  const apiBase = backendBase || automationApiBase;
  if (apiBase) {
    console.log("Backend checks");
    for (const endpoint of ["/api/health", "/api/config"]) {
      const result = await fetchJson(`${apiBase}${endpoint}`);
      line(endpoint, `${result.status} ${result.ok ? "ok" : "failed"}`);
      if (!result.ok) console.log(JSON.stringify(result.body, null, 2));
    }

    for (const job of jobs) {
      const project = projects.get(job.projectId.toString());
      if (!project) continue;
      const snapshot = await fetchJson(`${apiBase}/api/repo/snapshot?projectId=${job.projectId}`);
      line(
        `/api/repo/snapshot?projectId=${job.projectId}`,
        `${snapshot.status} ${snapshot.ok ? "ok" : "failed"}`,
      );
      if (snapshot.ok) {
        line("snapshot repo", snapshot.body.repo);
        line("snapshot sol files", Array.isArray(snapshot.body.files) ? snapshot.body.files.length : "unknown");
      } else {
        console.log(JSON.stringify(snapshot.body, null, 2));
      }

      if (Number(job.status) === 2 && job.incidentId > 0n) {
        if (mutatePr) {
          const pr = await fetchJson(`${apiBase}/api/fix-pr?jobId=${job.id}`);
          line(`/api/fix-pr?jobId=${job.id}`, `${pr.status} ${pr.ok ? "ok" : "failed"}`);
          console.log(JSON.stringify(pr.body, null, 2));
        } else {
          line(`/api/fix-pr?jobId=${job.id}`, "skipped read-only; pass --mutate-pr to call");
        }
      }
    }
    console.log("");
  } else {
    console.log("Backend checks skipped: no AUTOMATION_API_BASE_URL.");
    console.log("");
  }

  console.log("Summary");
  const stuck = jobs.filter((job) => Number(job.status) === 1);
  if (stuck.length > 0) {
    for (const job of stuck) {
      line(`job #${job.id}`, explainScanJob(job, latestLogByJob.get(job.id.toString()), pendingRequests));
    }
  } else {
    console.log("No pending scan jobs.");
  }
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || error);
  process.exit(1);
});
