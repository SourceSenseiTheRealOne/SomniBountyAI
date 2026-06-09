#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  keccak256,
  parseAbi,
  parseEther,
  parseEventLogs,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

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
const flags = new Set(argv);
const writeMode = flags.has("--write");
const createPr = !flags.has("--no-pr");
const retrySnapshotFlag = flags.has("--retry-snapshot");
const allowBackendMismatch = flags.has("--allow-backend-mismatch");
const timeoutMs = Number(readArg("--timeout-ms") ?? 15 * 60 * 1000);
const pollMs = Number(readArg("--poll-ms") ?? 15_000);
const fetchTimeoutMs = Number(readArg("--fetch-timeout-ms") ?? 20_000);
const rpcTimeoutMs = Number(readArg("--rpc-timeout-ms") ?? 20_000);
const txTimeoutMs = Number(readArg("--tx-timeout-ms") ?? 120_000);
const dummyRepo =
  readArg("--repo") || "https://github.com/Blavi-xyz/Vulnerable_Solidity_Smart_Contract";
const resumeProjectId = readArg("--resume-project-id");
const resumeScanJobId = readArg("--resume-scan-job-id");
const resumeMode = Boolean(resumeProjectId && resumeScanJobId);
const backendBase = (
  readArg("--backend") ||
  process.env.AUTOMATION_API_BASE_URL ||
  "https://p01--somnibountyai--yrnf5wlhj7v8.code.run"
).replace(/\/$/, "");
const rpcUrl =
  process.env.SOMNIA_RPC_URL ||
  process.env.NEXT_PUBLIC_SOMNIA_RPC_URL ||
  "https://api.infra.testnet.somnia.network/";
const contractAddress =
  process.env.SOMNIBOUNTY_ADDRESS || process.env.NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS;

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

const abi = parseAbi([
  "function registerProject(string name,string description,string socialUrl,string imageUrl,string githubRepo,bytes32 metadataHash,address agentPayoutWallet) returns (uint256)",
  "function setupBountyTiers(uint256 projectId,uint96 critical,uint96 high,uint96 medium) payable returns (uint256 scanJobId,uint256 requestId)",
  "function quoteSetupBountyTiers(uint96 critical,uint96 high,uint96 medium) view returns (uint256)",
  "function requiredJsonApiFee() view returns (uint256)",
  "function retrySnapshot(uint256 scanJobId) payable returns (uint256 requestId)",
  "function requiredAutomationFee() view returns (uint256)",
  "function totalCounts() view returns (uint256 projectCount,uint256 incidentCount,uint256 fixCount)",
  "function scanJobCount() view returns (uint256)",
  "function getProject(uint256 projectId) view returns ((address owner,bool active,bytes32 metadataHash,string name,string description,string socialUrl,string imageUrl,string githubRepo,address agentPayoutWallet))",
  "function getScanJob(uint256 scanJobId) view returns ((uint256 projectId,address sponsor,uint96 criticalBounty,uint96 highBounty,uint96 mediumBounty,uint64 requestedAt,uint8 status,uint256 incidentId,uint256 fixId,uint256 agentFeeReserve,uint256 latestRequestId,uint8 candidateSeverity,string snapshotURI,bytes32 resultHash,string resultURI))",
  "function getIncident(uint256 incidentId) view returns ((uint256 projectId,address sponsor,address reporter,uint96 bounty,uint64 deadline,uint8 severity,uint8 status,bytes32 evidenceHash,string metadataURI,uint256 winningFixId))",
  "function getFix(uint256 fixId) view returns ((uint256 incidentId,address fixer,address payoutRecipient,string proofURI,bytes32 proofHash,uint8 decision,uint16 scoreBps,bytes32 resultHash,bool paid,uint96 paidAmount))",
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

const scanStatuses = ["None", "Pending", "CandidateFound", "NoFinding", "NeedsReview", "Failed"];
const incidentStatuses = ["Open", "ReviewPending", "Paid", "Cancelled", "Expired"];
const fixDecisions = ["None", "Valid", "Invalid", "NeedsReview"];

function stt(value) {
  return `${Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  })} STT`;
}

function log(step, value = "") {
  console.log(value ? `[${new Date().toISOString()}] ${step}: ${value}` : `[${new Date().toISOString()}] ${step}`);
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), fetchTimeoutMs);
  const response = await fetch(url, { ...options, signal: controller.signal });
  clearTimeout(timeout);
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    // keep raw text
  }
  return { ok: response.ok, status: response.status, body };
}

function mustAddress(value, name) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value ?? "")) {
    throw new Error(`${name} missing or invalid`);
  }
  return value;
}

function privateKeyFromEnv() {
  const raw = process.env.PRIVATE_KEY || process.env.SOMNIA_PRIVATE_KEY;
  if (!raw) throw new Error("PRIVATE_KEY missing in smart_contract/.env or process env");
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error("PRIVATE_KEY must be 32-byte hex");
  }
  return normalized;
}

async function readLatestEvents(publicClient, fromBlock) {
  return publicClient.getLogs({
    address: mustAddress(contractAddress, "SOMNIBOUNTY_ADDRESS"),
    fromBlock,
    toBlock: "latest",
  });
}

async function waitForReceipt(publicClient, hash) {
  log("tx sent", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: txTimeoutMs });
  log("tx confirmed", `${hash} block=${receipt.blockNumber}`);
  return receipt;
}

async function writeContract({ publicClient, walletClient, account, functionName, args, value }) {
  const address = mustAddress(contractAddress, "SOMNIBOUNTY_ADDRESS");
  await publicClient.simulateContract({
    address,
    abi,
    functionName,
    args,
    value,
    account,
  });
  const hash = await walletClient.writeContract({
    address,
    abi,
    functionName,
    args,
    value,
    account,
    chain: somniaTestnet,
  });
  return waitForReceipt(publicClient, hash);
}

async function printState(publicClient, projectId, scanJobId) {
  const job = await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: "getScanJob",
    args: [scanJobId],
  });
  log(
    "scan job",
    `#${scanJobId} status=${scanStatuses[Number(job.status)]} incident=${job.incidentId} fix=${job.fixId} reserve=${stt(job.agentFeeReserve)} latestRequest=${job.latestRequestId}`,
  );
  log("snapshot", job.snapshotURI || "<empty>");
  log("result", job.resultURI || "<empty>");

  if (job.incidentId > 0n) {
    const incident = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: "getIncident",
      args: [job.incidentId],
    });
    log(
      "incident",
      `#${job.incidentId} status=${incidentStatuses[Number(incident.status)]} bounty=${stt(incident.bounty)} metadata=${incident.metadataURI}`,
    );
  }

  if (job.fixId > 0n) {
    const fix = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: "getFix",
      args: [job.fixId],
    });
    log(
      "fix",
      `#${job.fixId} decision=${fixDecisions[Number(fix.decision)]} paid=${fix.paid} amount=${stt(fix.paidAmount)} proof=${fix.proofURI}`,
    );
  }

  const project = await publicClient.readContract({
    address: contractAddress,
    abi,
    functionName: "getProject",
    args: [projectId],
  });
  log("project", `${project.name} ${project.githubRepo}`);
  return job;
}

async function main() {
  if (!writeMode && !resumeMode) {
    throw new Error("Pass --write to execute real testnet txs. This spends STT.");
  }
  if (retrySnapshotFlag && !writeMode) {
    throw new Error("Pass --write with --retry-snapshot. Retry spends STT JSON agent fee.");
  }

  const address = mustAddress(contractAddress, "SOMNIBOUNTY_ADDRESS");
  const publicClient = createPublicClient({
    chain: somniaTestnet,
    transport: http(rpcUrl, { timeout: rpcTimeoutMs }),
  });
  const account = resumeMode && !writeMode ? null : privateKeyToAccount(privateKeyFromEnv());
  const walletClient = createWalletClient({
    account,
    chain: somniaTestnet,
    transport: http(rpcUrl, { timeout: rpcTimeoutMs }),
  });

  log(resumeMode ? "live flow resume started" : "live user flow started", `contract=${address}`);
  if (account) log("account", account.address);
  log("backend", backendBase);
  log("repo", dummyRepo);

  const balance = account ? await publicClient.getBalance({ address: account.address }) : 0n;
  if (account) {
    log("account balance", stt(balance));
  }

  const health = await fetchJson(`${backendBase}/api/health`);
  log("backend health", `${health.status} ${health.ok ? "ok" : "failed"}`);
  if (!health.ok) throw new Error(`Backend health failed: ${JSON.stringify(health.body)}`);

  const config = await fetchJson(`${backendBase}/api/config`);
  log("backend config", `${config.status} ${config.ok ? "ok" : "failed"}`);
  if (config.ok) {
    const backendContract = (config.body.somniBountyAddress || "").toLowerCase();
    log("backend contract", backendContract || "<empty>");
    if (backendContract !== address.toLowerCase() && !allowBackendMismatch) {
      throw new Error(
        `Backend contract mismatch. Backend=${backendContract || "<empty>"} local=${address.toLowerCase()}. Update Northflank env/build args and redeploy, or pass --allow-backend-mismatch for unsafe debug.`,
      );
    }
  }

  if (resumeMode) {
    await pollFlow({
      publicClient,
      walletClient,
      account,
      projectId: BigInt(resumeProjectId),
      scanJobId: BigInt(resumeScanJobId),
      startBlock: await publicClient.getBlockNumber(),
    });
    return;
  }

  const requiredAutomationFee = await publicClient.readContract({
    address,
    abi,
    functionName: "requiredAutomationFee",
  });
  const critical = parseEther(readArg("--critical") || "0.05");
  const high = parseEther(readArg("--high") || "0.02");
  const medium = parseEther(readArg("--medium") || "0.01");
  const quote = await publicClient.readContract({
    address,
    abi,
    functionName: "quoteSetupBountyTiers",
    args: [critical, high, medium],
  });
  log("bounty quote", `${stt(quote)} total, automation reserve ${stt(requiredAutomationFee)}`);
  if (balance < quote) throw new Error(`Insufficient STT. Need at least ${stt(quote)} plus gas.`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const metadata = {
    name: `SomniBounty live test ${timestamp}`,
    description:
      "Live Somnia testnet flow for vulnerable Solidity demo repository and agent automation.",
    socialUrl: "https://x.com/BlaviXyz",
    imageUrl: "",
    githubRepo: dummyRepo,
  };

  log("pin project metadata");
  const pinned = await fetchJson(`${backendBase}/api/ipfs/project`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  log("ipfs project", `${pinned.status} ${pinned.ok ? "ok" : "failed"}`);
  if (!pinned.ok) throw new Error(`IPFS pin failed: ${JSON.stringify(pinned.body)}`);
  const metadataHash = keccak256(toBytes(pinned.body.metadataJson || pinned.body.ipfsUri));
  log("metadata uri", pinned.body.ipfsUri);

  const countsBefore = await publicClient.readContract({
    address,
    abi,
    functionName: "totalCounts",
  });

  log("register project tx");
  const registerReceipt = await writeContract({
    publicClient,
    walletClient,
    account,
    functionName: "registerProject",
    args: [
      metadata.name,
      metadata.description,
      metadata.socialUrl,
      metadata.imageUrl,
      metadata.githubRepo,
      metadataHash,
      account.address,
    ],
  });
  const registeredLogs = parseEventLogs({
    abi,
    logs: registerReceipt.logs,
    eventName: "ProjectRegistered",
  });
  const projectId = registeredLogs[0]?.args.projectId ?? countsBefore[0] + 1n;
  log("project registered", `#${projectId}`);

  const snapshotCheck = await fetchJson(`${backendBase}/api/repo/snapshot?projectId=${projectId}`);
  log(
    "snapshot api before bounty",
    `${snapshotCheck.status} ${snapshotCheck.ok ? "ok" : "failed"}`,
  );
  if (snapshotCheck.ok) {
    log(
      "snapshot files",
      `${snapshotCheck.body.files?.length ?? 0} solidity files, repo=${snapshotCheck.body.repo}`,
    );
  } else {
    log("snapshot api error", JSON.stringify(snapshotCheck.body));
  }

  log("fund bounty tx");
  const bountyReceipt = await writeContract({
    publicClient,
    walletClient,
    account,
    functionName: "setupBountyTiers",
    args: [projectId, critical, high, medium],
    value: quote,
  });
  const fundedLogs = parseEventLogs({
    abi,
    logs: bountyReceipt.logs,
    eventName: "BountyTiersFunded",
  });
  const scanRequestedLogs = parseEventLogs({
    abi,
    logs: bountyReceipt.logs,
    eventName: "SnapshotRequested",
  });
  const scanJobId = fundedLogs[0]?.args.scanJobId;
  const firstRequestId = scanRequestedLogs[0]?.args.requestId;
  if (!scanJobId) throw new Error("Bounty tx confirmed but no scanJobId found.");
  log("scan requested", `job=#${scanJobId} firstRequest=#${firstRequestId ?? "unknown"}`);

  const startBlock = bountyReceipt.blockNumber;
  await pollFlow({ publicClient, walletClient, account, projectId, scanJobId, startBlock });
}

async function pollFlow({ publicClient, walletClient, account, projectId, scanJobId, startBlock }) {
  const deadline = Date.now() + timeoutMs;
  let calledPr = false;
  let retriedSnapshot = false;

  while (Date.now() < deadline) {
    const job = await printState(publicClient, projectId, scanJobId);

    if (
      retrySnapshotFlag &&
      !retriedSnapshot &&
      Number(job.status) === 1 &&
      !job.snapshotURI
    ) {
      retriedSnapshot = true;
      const jsonFee = await publicClient.readContract({
        address: contractAddress,
        abi,
        functionName: "requiredJsonApiFee",
      });
      log("retry snapshot", `using json fee ${stt(jsonFee)}`);
      await writeContract({
        publicClient,
        walletClient,
        account,
        functionName: "retrySnapshot",
        args: [scanJobId],
        value: jsonFee,
      });
    }

    if (createPr && Number(job.status) === 2 && job.incidentId > 0n && job.fixId === 0n && !calledPr) {
      calledPr = true;
      log("job ready for PR, calling backend PR endpoint");
      const pr = await fetchJson(`${backendBase}/api/fix-pr?jobId=${scanJobId}`);
      log("fix-pr", `${pr.status} ${pr.ok ? "ok" : "failed"}`);
      console.log(JSON.stringify(pr.body, null, 2));
    }

    if (job.fixId > 0n) {
      const fix = await publicClient.readContract({
        address: contractAddress,
        abi,
        functionName: "getFix",
        args: [job.fixId],
      });
      if (fix.paid || Number(fix.decision) > 0) {
        log("flow terminal", `decision=${fixDecisions[Number(fix.decision)]} paid=${fix.paid}`);
        break;
      }
    }

    const status = Number(job.status);
    if (status === 3 || status === 4 || status === 5) {
      log("scan terminal", scanStatuses[status]);
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  try {
    const logs = await readLatestEvents(publicClient, startBlock);
    const decodedLogs = parseEventLogs({ abi, logs, strict: false });
    log("events since monitor start");
    for (const event of decodedLogs) {
      if (event.eventName === "AgentLog") {
        console.log(
          `AgentLog project=${event.args.projectId} job=${event.args.scanJobId} step="${event.args.step}" detail="${event.args.detail}" tx=${event.transactionHash}`,
        );
      } else {
        console.log(`${event.eventName} ${JSON.stringify(event.args, (_, value) => typeof value === "bigint" ? value.toString() : value)} tx=${event.transactionHash}`);
      }
    }
  } catch (error) {
    log("event read failed", error.shortMessage || error.message);
  }

  const finalJob = await printState(publicClient, projectId, scanJobId);
  if (Number(finalJob.status) === 1 && !finalJob.snapshotURI) {
    log(
      "diagnosis",
      "Stuck at first Somnia JSON API agent callback. Backend snapshot works if earlier check was ok, so likely agent platform has not delivered callback, request timed out, or JSON selector/response ABI shape mismatches.",
    );
  } else if (Number(finalJob.status) === 1 && finalJob.snapshotURI) {
    log(
      "diagnosis",
      "Snapshot complete. Stuck at LLM scan or second review. Contract needs request-id events for later agent requests to diagnose exact pending request.",
    );
  } else if (Number(finalJob.status) === 2 && finalJob.incidentId > 0n && finalJob.fixId === 0n) {
    log("diagnosis", "Vulnerability validated, PR stage not completed yet.");
  } else {
    log("diagnosis", "Flow reached non-pending state. Review final logs above.");
  }
}

main().catch((error) => {
  console.error(error.shortMessage || error.message || error);
  process.exit(1);
});
