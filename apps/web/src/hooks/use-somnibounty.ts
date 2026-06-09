"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  formatEther,
  http,
  keccak256,
  parseAbiItem,
  parseEther,
  toBytes,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { somniaExplorerUrl, somniaTestnet } from "@/lib/somnia";
import { somniBountyAbi } from "@/lib/somnibounty-abi";

export type UiIncident = {
  id: string;
  name: string;
  project: string;
  severity: "Critical" | "High" | "Medium";
  bounty: string;
  status: "Open" | "Verification Pending" | "Fix Validated" | "Needs Review" | "Expired";
  confidence: number;
  proof: string;
  vector: string;
  numericIncidentId?: bigint;
  fixId?: bigint;
  onchain?: boolean;
};

export type UiProject = {
  id: string;
  numericProjectId: bigint;
  name: string;
  description: string;
  owner: string;
  ownerAddress: Address;
  socialUrl: string;
  imageUrl: string;
  githubRepo: string;
  agentPayoutWallet: Address;
  hash: Hex;
  tiers: {
    critical: bigint;
    high: bigint;
    medium: bigint;
  };
  onchain: boolean;
};

export type UiScanJob = {
  id: string;
  numericScanJobId: bigint;
  projectId: bigint;
  project: string;
  status: "Pending" | "Candidate Found" | "No Finding" | "Needs Review" | "Failed";
  result: string;
  snapshot: string;
  resultHash: Hex;
  incidentId: bigint;
  fixId: bigint;
  totalFunded: bigint;
  requestedAt: bigint;
};

export type UiAgentLog = {
  id: string;
  projectId: bigint;
  scanJobId?: bigint;
  step: string;
  detail: string;
  status: "complete" | "pending" | "failed";
};

export type UiPaidBounty = {
  fixId: bigint;
  incidentId: bigint;
  projectId: bigint;
  project: string;
  proofURI: string;
  fixer: Address;
  payoutRecipient: Address;
  amount: string;
  verifierResult: "VALID";
  resultHash: Hex;
  explorerUrl: string;
};

type ContractProject = {
  owner: Address;
  active: boolean;
  metadataHash: Hex;
  name: string;
  description: string;
  socialUrl: string;
  imageUrl: string;
  githubRepo: string;
  agentPayoutWallet: Address;
};

type ContractScanJob = {
  projectId: bigint;
  sponsor: Address;
  criticalBounty: bigint;
  highBounty: bigint;
  mediumBounty: bigint;
  requestedAt: bigint;
  status: number;
  incidentId: bigint;
  fixId: bigint;
  agentFeeReserve: bigint;
  candidateSeverity: number;
  snapshotURI: string;
  resultHash: Hex;
  resultURI: string;
};

type ContractIncident = {
  projectId: bigint;
  sponsor: Address;
  reporter: Address;
  bounty: bigint;
  deadline: bigint;
  severity: number;
  status: number;
  evidenceHash: Hex;
  metadataURI: string;
  winningFixId: bigint;
};

type ContractFix = {
  incidentId: bigint;
  fixer: Address;
  payoutRecipient: Address;
  proofURI: string;
  proofHash: Hex;
  decision: number;
  scoreBps: number;
  resultHash: Hex;
  paid: boolean;
  paidAmount: bigint;
};

const configuredAddress = process.env.NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS;
const rpcUrl =
  process.env.NEXT_PUBLIC_SOMNIA_RPC_URL ?? "https://api.infra.testnet.somnia.network/";

function isAddress(value: string | undefined): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value ?? "");
}

export function hashText(value: string): Hex {
  return keccak256(toBytes(value.trim() || "somnibounty-ai"));
}

function severityLabel(severity: number): UiIncident["severity"] {
  if (severity >= 5) return "Critical";
  if (severity >= 3) return "High";
  return "Medium";
}

function statusLabel(status: number, fixDecision?: number): UiIncident["status"] {
  if (status === 1) return "Verification Pending";
  if (status === 2) return "Fix Validated";
  if (status === 4) return "Expired";
  if (fixDecision === 3) return "Needs Review";
  return "Open";
}

function scanStatusLabel(status: number): UiScanJob["status"] {
  if (status === 1) return "Pending";
  if (status === 2) return "Candidate Found";
  if (status === 3) return "No Finding";
  if (status === 4) return "Needs Review";
  return "Failed";
}

function confidenceFor(status: number, decision?: number, score?: number): number {
  if (score && score > 0) return Math.round(score / 100);
  if (status === 2 || decision === 1) return 100;
  if (status === 1) return 92;
  if (decision === 3) return 50;
  return 0;
}

function shortAddress(address: Address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatStt(value: bigint) {
  return `${Number(formatEther(value)).toLocaleString(undefined, {
    maximumFractionDigits: 3,
  })} STT`;
}

function buildAgentLogs(
  projects: UiProject[],
  scanJobs: UiScanJob[],
  incidents: UiIncident[],
  paidBounties: UiPaidBounty[],
) {
  const logs: UiAgentLog[] = [];
  for (const project of projects) {
    logs.push({
      id: `project-${project.numericProjectId}`,
      projectId: project.numericProjectId,
      step: "project registered",
      detail: project.githubRepo,
      status: "complete",
    });
  }
  for (const job of scanJobs) {
    logs.push({
      id: `scan-${job.numericScanJobId}`,
      projectId: job.projectId,
      scanJobId: job.numericScanJobId,
      step: "bounty funded and scan requested",
      detail: formatStt(job.totalFunded),
      status: job.status === "Failed" ? "failed" : "complete",
    });
    if (job.status === "Pending") {
      logs.push({
        id: `scan-pending-${job.numericScanJobId}`,
        projectId: job.projectId,
        scanJobId: job.numericScanJobId,
        step: "somnia discovery agent running",
        detail: "Repo snapshot and vulnerability registry comparison pending",
        status: "pending",
      });
    }
    if (job.status === "Candidate Found") {
      logs.push({
        id: `candidate-${job.numericScanJobId}`,
        projectId: job.projectId,
        scanJobId: job.numericScanJobId,
        step: "vulnerability candidate found",
        detail: job.result || job.resultHash,
        status: "complete",
      });
    }
    if (job.status === "No Finding" || job.status === "Needs Review" || job.status === "Failed") {
      logs.push({
        id: `result-${job.numericScanJobId}`,
        projectId: job.projectId,
        scanJobId: job.numericScanJobId,
        step: `scan ${job.status.toLowerCase()}`,
        detail: job.result || job.resultHash,
        status: job.status === "Failed" ? "failed" : "complete",
      });
    }
  }
  for (const incident of incidents) {
    if (incident.status === "Verification Pending") {
      logs.push({
        id: `review-${incident.numericIncidentId}`,
        projectId: 0n,
        step: "second agent review started",
        detail: incident.proof,
        status: "pending",
      });
    }
  }
  for (const bounty of paidBounties) {
    logs.push({
      id: `paid-${bounty.fixId}`,
      projectId: bounty.projectId,
      step: "bounty paid",
      detail: `${bounty.amount} to ${shortAddress(bounty.payoutRecipient)}`,
      status: "complete",
    });
  }
  return logs;
}

const agentLogEvent = parseAbiItem(
  "event AgentLog(uint256 indexed projectId,uint256 indexed scanJobId,string step,string detail)",
);

function statusFromStep(step: string): UiAgentLog["status"] {
  const lowered = step.toLowerCase();
  if (lowered.includes("failed")) return "failed";
  if (lowered.includes("requested") || lowered.includes("started") || lowered.includes("running")) {
    return "pending";
  }
  return "complete";
}

export function useSomniBounty(walletClient: WalletClient | null, account: Address | null) {
  const contractAddress = isAddress(configuredAddress) ? configuredAddress : null;
  const publicClient = useMemo(
    () => createPublicClient({ chain: somniaTestnet, transport: http(rpcUrl) }),
    [],
  );
  const [projects, setProjects] = useState<UiProject[]>([]);
  const [scanJobs, setScanJobs] = useState<UiScanJob[]>([]);
  const [incidents, setIncidents] = useState<UiIncident[]>([]);
  const [agentLogs, setAgentLogs] = useState<UiAgentLog[]>([]);
  const [paidBounties, setPaidBounties] = useState<UiPaidBounty[]>([]);
  const [status, setStatus] = useState(
    contractAddress
      ? "Ready to sync live Somnia testnet data"
      : "Live mode unavailable: no contract address configured",
  );
  const [lastTx, setLastTx] = useState<Hex | null>(null);

  const refresh = useCallback(async () => {
    if (!contractAddress) return;

    try {
      const [[projectCount, incidentCount, fixCount], scanCount] = await Promise.all([
        publicClient.readContract({
          address: contractAddress,
          abi: somniBountyAbi,
          functionName: "totalCounts",
        }),
        publicClient.readContract({
          address: contractAddress,
          abi: somniBountyAbi,
          functionName: "scanJobCount",
        }),
      ]);

      const nextProjects: UiProject[] = [];
      const projectNames = new Map<bigint, string>();
      for (let i = 1n; i <= projectCount; i += 1n) {
        try {
          const [project, tiers] = await Promise.all([
            publicClient.readContract({
              address: contractAddress,
              abi: somniBountyAbi,
              functionName: "getProject",
              args: [i],
            }) as Promise<ContractProject>,
            publicClient.readContract({
              address: contractAddress,
              abi: somniBountyAbi,
              functionName: "projectBountyTiers",
              args: [i],
            }) as Promise<readonly [bigint, bigint, bigint]>,
          ]);

          projectNames.set(i, project.name);
          nextProjects.push({
            id: `PRJ-${String(i).padStart(3, "0")}`,
            numericProjectId: i,
            name: project.name,
            description: project.description,
            owner: shortAddress(project.owner),
            ownerAddress: project.owner,
            socialUrl: project.socialUrl,
            imageUrl: project.imageUrl,
            githubRepo: project.githubRepo,
            agentPayoutWallet: project.agentPayoutWallet,
            hash: project.metadataHash,
            tiers: {
              critical: tiers[0],
              high: tiers[1],
              medium: tiers[2],
            },
            onchain: true,
          });
        } catch {
          // Skip ids that revert.
        }
      }

      const nextScanJobs: UiScanJob[] = [];
      for (let i = 1n; i <= scanCount; i += 1n) {
        try {
          const job = (await publicClient.readContract({
            address: contractAddress,
            abi: somniBountyAbi,
            functionName: "getScanJob",
            args: [i],
          })) as ContractScanJob;
          nextScanJobs.push({
            id: `JOB-${String(i).padStart(3, "0")}`,
            numericScanJobId: i,
            projectId: job.projectId,
            project: projectNames.get(job.projectId) ?? `Project #${job.projectId}`,
            status: scanStatusLabel(job.status),
            result: job.resultURI,
            snapshot: job.snapshotURI,
            resultHash: job.resultHash,
            incidentId: job.incidentId,
            fixId: job.fixId,
            totalFunded: job.criticalBounty + job.highBounty + job.mediumBounty,
            requestedAt: job.requestedAt,
          });
        } catch {
          // Skip ids that revert.
        }
      }

      const loadedFixes = new Map<bigint, ContractFix>();
      for (let i = 1n; i <= fixCount; i += 1n) {
        try {
          const fix = (await publicClient.readContract({
            address: contractAddress,
            abi: somniBountyAbi,
            functionName: "getFix",
            args: [i],
          })) as ContractFix;
          loadedFixes.set(i, fix);
        } catch {
          // Skip ids that revert.
        }
      }

      const nextIncidents: UiIncident[] = [];
      const nextPaidBounties: UiPaidBounty[] = [];
      for (let i = 1n; i <= incidentCount; i += 1n) {
        try {
          const incident = (await publicClient.readContract({
            address: contractAddress,
            abi: somniBountyAbi,
            functionName: "getIncident",
            args: [i],
          })) as ContractIncident;
          const matchingFix = [...loadedFixes.entries()].find(([, fix]) => fix.incidentId === i);
          const fixId = matchingFix?.[0];
          const fix = matchingFix?.[1];
          const projectName = projectNames.get(incident.projectId) ?? `Project #${incident.projectId}`;
          const displayBounty = fix?.paid ? fix.paidAmount : incident.bounty;

          nextIncidents.push({
            id: `INC-${String(i).padStart(3, "0")}`,
            name: `${severityLabel(incident.severity)} Vulnerability`,
            project: projectName,
            severity: severityLabel(incident.severity),
            bounty: formatStt(displayBounty),
            status: statusLabel(incident.status, fix?.decision),
            confidence: confidenceFor(incident.status, fix?.decision, fix?.scoreBps),
            proof: fix?.proofURI || "No fix submitted",
            vector: incident.metadataURI || "Onchain incident metadata",
            numericIncidentId: i,
            fixId,
            onchain: true,
          });

          if (fixId && fix?.paid && incident.status === 2) {
            nextPaidBounties.push({
              fixId,
              incidentId: i,
              projectId: incident.projectId,
              project: projectName,
              proofURI: fix.proofURI,
              fixer: fix.fixer,
              payoutRecipient: fix.payoutRecipient,
              amount: formatStt(fix.paidAmount),
              verifierResult: "VALID",
              resultHash: fix.resultHash,
              explorerUrl: `${somniaExplorerUrl}/address/${contractAddress}`,
            });
          }
        } catch {
          // Skip ids that revert.
        }
      }

      setProjects(nextProjects);
      setScanJobs(nextScanJobs);
      setIncidents(nextIncidents);
      setPaidBounties(nextPaidBounties);
      let liveLogs = buildAgentLogs(nextProjects, nextScanJobs, nextIncidents, nextPaidBounties);
      try {
        const logs = await publicClient.getLogs({
          address: contractAddress,
          event: agentLogEvent,
          fromBlock: 0n,
          toBlock: "latest",
        });
        if (logs.length > 0) {
          liveLogs = logs.map((log, index) => ({
            id: `${log.transactionHash}-${log.logIndex ?? index}`,
            projectId: log.args.projectId ?? 0n,
            scanJobId: log.args.scanJobId && log.args.scanJobId > 0n ? log.args.scanJobId : undefined,
            step: log.args.step ?? "agent log",
            detail: log.args.detail ?? "",
            status: statusFromStep(log.args.step ?? ""),
          }));
        }
      } catch {
        // Derived state logs remain available if event indexing is not supported by RPC.
      }
      setAgentLogs(liveLogs);
      setStatus(
        `Synced ${nextProjects.length} project(s), ${nextScanJobs.length} scan job(s), ${nextIncidents.length} incident(s)`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to sync contract");
    }
  }, [contractAddress, publicClient]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const id = window.setInterval(() => void refresh(), 8_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(id);
    };
  }, [refresh]);

  const write = useCallback(
    async (
      functionName:
        | "registerProject"
        | "setupBountyTiers"
        | "submitFix"
        | "reclaimExpired",
      args: readonly unknown[],
      value?: bigint,
    ) => {
      if (!contractAddress) throw new Error("Set NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS first");
      if (!walletClient || !account) throw new Error("Connect wallet first");

      setStatus(`Sending ${functionName} transaction`);
      const request = {
        address: contractAddress,
        abi: somniBountyAbi,
        functionName,
        args: args as never,
        value,
        account,
        chain: somniaTestnet,
      } as unknown as Parameters<WalletClient["writeContract"]>[0];
      const hash = await walletClient.writeContract(request);
      setLastTx(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh();
      setStatus(`${functionName} confirmed`);
      return hash;
    },
    [account, contractAddress, publicClient, refresh, walletClient],
  );

  const actions = {
    registerProject: (
      name: string,
      description: string,
      socialUrl: string,
      imageUrl: string,
      githubRepo: string,
      metadataHash: Hex,
      agentPayoutWallet: Address,
    ) =>
      write("registerProject", [
        name,
        description,
        socialUrl,
        imageUrl,
        githubRepo,
        metadataHash,
        agentPayoutWallet,
      ]),
    setupBountyTiers: async (
      projectId: bigint,
      criticalStt: string,
      highStt: string,
      mediumStt: string,
    ) => {
      if (!contractAddress) throw new Error("Set NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS first");
      const critical = parseEther(criticalStt);
      const high = parseEther(highStt);
      const medium = parseEther(mediumStt);
      const value = await publicClient.readContract({
        address: contractAddress,
        abi: somniBountyAbi,
        functionName: "quoteSetupBountyTiers",
        args: [critical, high, medium],
      });
      return write("setupBountyTiers", [projectId, critical, high, medium], value);
    },
    submitFix: (incidentId: bigint, proofURI: string, proofHash: Hex) =>
      write("submitFix", [incidentId, proofURI, proofHash]),
    reclaimExpired: (incidentId: bigint) => write("reclaimExpired", [incidentId]),
  };

  return {
    actions,
    agentLogs,
    contractAddress,
    explorerBase: somniaExplorerUrl,
    incidents,
    lastTx,
    paidBounties,
    projects,
    refresh,
    scanJobs,
    status,
  };
}
