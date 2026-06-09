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
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
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
const allowBackendMismatch = flags.has("--allow-backend-mismatch");
const backendBase = (
  readArg("--backend") ||
  process.env.AUTOMATION_API_BASE_URL ||
  "https://p01--somnibountyai--yrnf5wlhj7v8.code.run"
).replace(/\/$/, "");
const repoUrl =
  readArg("--repo") || "https://github.com/Blavi-xyz/Vulnerable_Solidity_Smart_Contract";
const timeoutMs = Number(readArg("--timeout-ms") ?? 10 * 60 * 1000);
const pollMs = Number(readArg("--poll-ms") ?? 15_000);
const fetchTimeoutMs = Number(readArg("--fetch-timeout-ms") ?? 20_000);
const rpcTimeoutMs = Number(readArg("--rpc-timeout-ms") ?? 20_000);
const txTimeoutMs = Number(readArg("--tx-timeout-ms") ?? 180_000);
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

function log(step, value = "") {
  console.log(value ? `[${new Date().toISOString()}] ${step}: ${value}` : `[${new Date().toISOString()}] ${step}`);
}

function stt(value) {
  return `${Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 6 })} STT`;
}

function mustAddress(value, name) {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value ?? "")) throw new Error(`${name} missing or invalid`);
  return value.toLowerCase();
}

function privateKeyFromEnv() {
  const raw = process.env.PRIVATE_KEY || process.env.SOMNIA_PRIVATE_KEY;
  if (!raw) throw new Error("PRIVATE_KEY missing");
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) throw new Error("PRIVATE_KEY must be 32-byte hex");
  return normalized;
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), fetchTimeoutMs);
  const response = await fetch(url, { ...options, signal: controller.signal });
  clearTimeout(timer);
  const text = await response.text();
  try {
    return { ok: response.ok, status: response.status, body: JSON.parse(text) };
  } catch {
    return { ok: response.ok, status: response.status, body: text };
  }
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
  "function requiredAutomationFee() view returns (uint256)",
  "function getScanJob(uint256 scanJobId) view returns ((uint256 projectId,address sponsor,uint96 criticalBounty,uint96 highBounty,uint96 mediumBounty,uint64 requestedAt,uint8 status,uint256 incidentId,uint256 fixId,uint256 agentFeeReserve,uint256 latestRequestId,uint8 candidateSeverity,string snapshotURI,bytes32 resultHash,string resultURI))",
  "event ProjectRegistered(uint256 indexed projectId,address indexed owner,address indexed agentPayoutWallet,bytes32 metadataHash)",
  "event BountyTiersFunded(uint256 indexed projectId,uint256 indexed scanJobId,uint256 critical,uint256 high,uint256 medium)",
  "event SnapshotRequested(uint256 indexed requestId,uint256 indexed projectId,uint256 indexed scanJobId,uint64 requestedAt)",
  "event LLMScanRequested(uint256 indexed requestId,uint256 indexed projectId,uint256 indexed scanJobId,uint64 requestedAt)",
  "event ScanCompleted(uint256 indexed requestId,uint256 indexed scanJobId,uint8 status,uint256 incidentId,bytes32 resultHash)",
  "event AgentLog(uint256 indexed projectId,uint256 indexed scanJobId,string step,string detail)",
]);

async function waitForReceipt(publicClient, hash) {
  log("tx sent", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: txTimeoutMs });
  log("tx confirmed", `${receipt.status} block=${receipt.blockNumber}`);
  if (receipt.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return receipt;
}

async function writeContract(publicClient, walletClient, account, functionName, args, value) {
  const address = mustAddress(contractAddress, "SOMNIBOUNTY_ADDRESS");
  await publicClient.simulateContract({ address, abi, functionName, args, value, account });
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

async function main() {
  if (!writeMode) throw new Error("Pass --write to spend STT and invoke Somnia agent.");

  const address = mustAddress(contractAddress, "SOMNIBOUNTY_ADDRESS");
  const publicClient = createPublicClient({
    chain: somniaTestnet,
    transport: http(rpcUrl, { timeout: rpcTimeoutMs }),
  });
  const account = privateKeyToAccount(privateKeyFromEnv());
  const walletClient = createWalletClient({
    account,
    chain: somniaTestnet,
    transport: http(rpcUrl, { timeout: rpcTimeoutMs }),
  });

  log("smoke start", `contract=${address}`);
  log("account", account.address);
  log("backend", backendBase);

  const health = await fetchJson(`${backendBase}/api/health`);
  log("backend health", `${health.status} ${health.ok ? "ok" : "failed"}`);
  if (!health.ok) throw new Error(`Backend health failed: ${JSON.stringify(health.body)}`);

  const config = await fetchJson(`${backendBase}/api/config`);
  log("backend config", `${config.status} ${config.ok ? "ok" : "failed"}`);
  if (!config.ok) throw new Error(`Backend config failed: ${JSON.stringify(config.body)}`);
  const backendContract = (config.body.somniBountyAddress || "").toLowerCase();
  log("backend contract", backendContract || "<empty>");
  if (backendContract !== address && !allowBackendMismatch) {
    throw new Error(
      `Backend contract mismatch. Backend=${backendContract || "<empty>"} local=${address}. Update Northflank env/build args and redeploy, or pass --allow-backend-mismatch for unsafe debug.`,
    );
  }

  const balance = await publicClient.getBalance({ address: account.address });
  log("balance", stt(balance));

  const critical = parseEther("0.05");
  const high = parseEther("0.02");
  const medium = parseEther("0.01");
  const quote = await publicClient.readContract({
    address,
    abi,
    functionName: "quoteSetupBountyTiers",
    args: [critical, high, medium],
  });
  const automationFee = await publicClient.readContract({
    address,
    abi,
    functionName: "requiredAutomationFee",
  });
  log("quote", `${stt(quote)} total, automation=${stt(automationFee)}`);
  if (balance < quote) throw new Error(`Insufficient balance. Need ${stt(quote)} plus gas.`);

  const timestamp = new Date().toISOString();
  const metadata = {
    name: `SomniBounty smoke ${timestamp}`,
    description: "Somnia JSON API agent smoke test.",
    socialUrl: "https://x.com/BlaviXyz",
    imageUrl: "",
    githubRepo: repoUrl,
  };
  const pinned = await fetchJson(`${backendBase}/api/ipfs/project`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(metadata),
  });
  log("ipfs", `${pinned.status} ${pinned.ok ? "ok" : "failed"}`);
  if (!pinned.ok) throw new Error(`IPFS pin failed: ${JSON.stringify(pinned.body)}`);
  const metadataHash = keccak256(toBytes(pinned.body.metadataJson || pinned.body.ipfsUri));

  const registerReceipt = await writeContract(
    publicClient,
    walletClient,
    account,
    "registerProject",
    [
      metadata.name,
      metadata.description,
      metadata.socialUrl,
      metadata.imageUrl,
      metadata.githubRepo,
      metadataHash,
      account.address,
    ],
  );
  const projectLog = parseEventLogs({
    abi,
    logs: registerReceipt.logs,
    eventName: "ProjectRegistered",
  })[0];
  const projectId = projectLog.args.projectId;
  log("project", `#${projectId}`);

  const snapshot = await fetchJson(`${backendBase}/api/repo/snapshot?projectId=${projectId}&scanJobId=0`);
  log("snapshot api precheck", `${snapshot.status} ${snapshot.ok ? "ok" : "failed"}`);
  if (!snapshot.ok) throw new Error(`Snapshot precheck failed: ${JSON.stringify(snapshot.body)}`);
  log("snapshot files", `${snapshot.body.files?.length ?? 0}`);

  const bountyReceipt = await writeContract(
    publicClient,
    walletClient,
    account,
    "setupBountyTiers",
    [projectId, critical, high, medium],
    quote,
  );
  const fundedLog = parseEventLogs({
    abi,
    logs: bountyReceipt.logs,
    eventName: "BountyTiersFunded",
  })[0];
  const requestLog = parseEventLogs({
    abi,
    logs: bountyReceipt.logs,
    eventName: "SnapshotRequested",
  })[0];
  const scanJobId = fundedLog.args.scanJobId;
  log("snapshot requested", `job=#${scanJobId} request=#${requestLog.args.requestId}`);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await publicClient.readContract({
      address,
      abi,
      functionName: "getScanJob",
      args: [scanJobId],
    });
    log(
      "job",
      `status=${job.status} latestRequest=${job.latestRequestId} snapshot=${job.snapshotURI ? "yes" : "no"} result=${job.resultURI || "<empty>"}`,
    );
    if (job.snapshotURI) {
      log("smoke success", job.snapshotURI.slice(0, 240));
      return;
    }
    if (Number(job.status) === 5) throw new Error("Snapshot agent failed onchain.");
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error("Timed out waiting for snapshotURI callback.");
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
