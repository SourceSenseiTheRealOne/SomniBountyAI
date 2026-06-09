#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  formatEther,
  getAddress,
  http,
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
    const key = line.slice(0, separator).replace(/^\uFEFF/, "").trim();
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
const existingAddress = readArg("--address");
const timeoutMs = Number(readArg("--timeout-ms") ?? 120_000);
const pollMs = Number(readArg("--poll-ms") ?? 5_000);
const rpcTimeoutMs = Number(readArg("--rpc-timeout-ms") ?? 30_000);
const txTimeoutMs = Number(readArg("--tx-timeout-ms") ?? 180_000);

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

function privateKeyFromEnv() {
  const raw = process.env.PRIVATE_KEY || process.env.SOMNIA_PRIVATE_KEY;
  if (!raw) throw new Error("PRIVATE_KEY missing");
  const normalized = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    throw new Error("PRIVATE_KEY must be 32-byte hex");
  }
  return normalized;
}

function bytecodeOf(artifact) {
  const raw = artifact.bytecode?.object || artifact.bytecode;
  if (!raw) throw new Error("Artifact missing bytecode");
  return raw.startsWith("0x") ? raw : `0x${raw}`;
}

const rpcUrl = process.env.SOMNIA_RPC_URL || "https://api.infra.testnet.somnia.network/";
const chain = {
  id: 50312,
  name: "Somnia Testnet",
  nativeCurrency: { decimals: 18, name: "Somnia Test Token", symbol: "STT" },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const account = privateKeyToAccount(privateKeyFromEnv());
const publicClient = createPublicClient({ chain, transport: http(rpcUrl, { timeout: rpcTimeoutMs }) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: rpcTimeoutMs }) });
const artifactPath = path.join(
  repoRoot,
  "smart_contract",
  "out",
  "AgentRawCallbackSmoke.sol",
  "AgentRawCallbackSmoke.json",
);
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

async function waitReceipt(hash) {
  log("tx sent", hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: txTimeoutMs });
  log("tx confirmed", `${receipt.status} block=${receipt.blockNumber} gas=${receipt.gasUsed}`);
  if (receipt.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return receipt;
}

async function deploy() {
  const platform = getAddress(
    process.env.SOMNIA_AGENT_PLATFORM || "0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776",
  );
  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: bytecodeOf(artifact),
    args: [platform],
    gas: 12_000_000n,
    type: "legacy",
  });
  const receipt = await waitReceipt(hash);
  if (!receipt.contractAddress) throw new Error("deploy receipt missing contract address");
  log("raw smoke contract", receipt.contractAddress);
  return receipt.contractAddress;
}

async function request(address) {
  const fee = await publicClient.readContract({
    address,
    abi: artifact.abi,
    functionName: "requiredFee",
  });
  log("required fee", stt(fee));
  const hash = await walletClient.writeContract({
    address,
    abi: artifact.abi,
    functionName: "requestPrice",
    value: fee,
    gas: 6_000_000n,
    chain,
    account,
  });
  const receipt = await waitReceipt(hash);
  for (const logEntry of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: artifact.abi, data: logEntry.data, topics: logEntry.topics });
      log(decoded.eventName, JSON.stringify(decoded.args, (_, value) => typeof value === "bigint" ? value.toString() : value));
    } catch {
      // Ignore platform logs.
    }
  }
}

async function poll(address) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [latestRequestId, latestCallbackRequestId, latestStatusWord, latestCalldataLength] =
      await Promise.all([
        publicClient.readContract({ address, abi: artifact.abi, functionName: "latestRequestId" }),
        publicClient.readContract({ address, abi: artifact.abi, functionName: "latestCallbackRequestId" }),
        publicClient.readContract({ address, abi: artifact.abi, functionName: "latestStatusWord" }),
        publicClient.readContract({ address, abi: artifact.abi, functionName: "latestCalldataLength" }),
      ]);
    log(
      "state",
      `request=${latestRequestId} callback=${latestCallbackRequestId} statusWord=${latestStatusWord} calldata=${latestCalldataLength}`,
    );
    if (latestCallbackRequestId > 0n) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error("Timed out waiting for raw callback");
}

async function main() {
  log("account", account.address);
  const address = existingAddress ? getAddress(existingAddress) : await deploy();
  await request(address);
  await poll(address);
}

main().catch((error) => {
  console.error(error.shortMessage || error.message);
  process.exitCode = 1;
});
