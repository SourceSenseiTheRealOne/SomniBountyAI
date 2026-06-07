"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createPublicClient,
  formatEther,
  http,
  keccak256,
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
  name: string;
  owner: string;
  metadataURI: string;
  hash: Hex;
  onchain?: boolean;
};

type ContractProject = {
  owner: Address;
  active: boolean;
  metadataHash: Hex;
  metadataURI: string;
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
  proofURI: string;
  proofHash: Hex;
  decision: number;
  scoreBps: number;
  resultHash: Hex;
  paid: boolean;
};

const configuredAddress = process.env.NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS;
const rpcUrl = process.env.NEXT_PUBLIC_SOMNIA_RPC_URL ?? "https://dream-rpc.somnia.network/";

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

function projectNameFromUri(projectId: bigint, metadataURI: string) {
  if (metadataURI.includes("AstraVault")) return "AstraVault";
  if (metadataURI.startsWith("ipfs://")) return `IPFS Project #${projectId}`;
  return `Project #${projectId}`;
}

export function useSomniBounty(walletClient: WalletClient | null, account: Address | null) {
  const contractAddress = isAddress(configuredAddress) ? configuredAddress : null;
  const publicClient = useMemo(
    () => createPublicClient({ chain: somniaTestnet, transport: http(rpcUrl) }),
    [],
  );
  const [projects, setProjects] = useState<UiProject[]>([]);
  const [incidents, setIncidents] = useState<UiIncident[]>([]);
  const [status, setStatus] = useState(
    contractAddress ? "Ready to sync onchain projects and incidents" : "Demo mode: no contract address configured",
  );
  const [lastTx, setLastTx] = useState<Hex | null>(null);

  const refresh = useCallback(async () => {
    if (!contractAddress) return;

    try {
      const [projectCount, incidentCount, fixCount] = await publicClient.readContract({
        address: contractAddress,
        abi: somniBountyAbi,
        functionName: "totalCounts",
      });

      const nextProjects: UiProject[] = [];
      for (let i = 1n; i <= projectCount; i += 1n) {
        try {
          const project = await publicClient.readContract({
            address: contractAddress,
            abi: somniBountyAbi,
            functionName: "getProject",
            args: [i],
          }) as ContractProject;

          nextProjects.push({
            id: `PRJ-${String(i).padStart(3, "0")}`,
            name: projectNameFromUri(i, project.metadataURI),
            owner: shortAddress(project.owner),
            metadataURI: project.metadataURI,
            hash: project.metadataHash,
            onchain: true,
          });
        } catch {
          // Skip ids that revert.
        }
      }

      const loadedFixes = new Map<bigint, ContractFix>();
      for (let i = 1n; i <= fixCount; i += 1n) {
        try {
          const fix = await publicClient.readContract({
            address: contractAddress,
            abi: somniBountyAbi,
            functionName: "getFix",
            args: [i],
          }) as ContractFix;
          loadedFixes.set(i, fix);
        } catch {
          // Skip missing/deleted ids.
        }
      }

      const nextIncidents: UiIncident[] = [];
      for (let i = 1n; i <= incidentCount; i += 1n) {
        try {
          const incident = await publicClient.readContract({
            address: contractAddress,
            abi: somniBountyAbi,
            functionName: "getIncident",
            args: [i],
          }) as ContractIncident;
          const matchingFix = [...loadedFixes.entries()].find(([, fix]) => fix.incidentId === i);
          const fixId = matchingFix?.[0];
          const fix = matchingFix?.[1];

          nextIncidents.push({
            id: `INC-${String(i).padStart(3, "0")}`,
            name: incident.metadataURI.includes("reentrancy")
              ? "Critical Reentrancy"
              : `Incident #${i}`,
            project: `Project #${incident.projectId}`,
            severity: severityLabel(incident.severity),
            bounty: `${Number(formatEther(incident.bounty)).toLocaleString(undefined, {
              maximumFractionDigits: 3,
            })} STT`,
            status: statusLabel(incident.status, fix?.decision),
            confidence: confidenceFor(incident.status, fix?.decision, fix?.scoreBps),
            proof: fix?.proofURI || "No fix submitted",
            vector: incident.metadataURI || "Onchain incident metadata",
            numericIncidentId: i,
            fixId,
            onchain: true,
          });
        } catch {
          // Skip ids that revert.
        }
      }

      setProjects(nextProjects);
      setIncidents(nextIncidents);
      setStatus(
        `Synced ${nextProjects.length} project(s), ${nextIncidents.length} incident(s)`,
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
        | "openIncident"
        | "submitFix"
        | "requestFixReview"
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
    registerProject: (metadataURI: string, metadataHash: Hex) =>
      write("registerProject", [metadataURI, metadataHash]),
    openIncident: (
      projectId: bigint,
      reporter: Address,
      deadline: bigint,
      severity: number,
      evidenceHash: Hex,
      metadataURI: string,
      bountyStt: string,
    ) =>
      write(
        "openIncident",
        [projectId, reporter, deadline, severity, evidenceHash, metadataURI],
        parseEther(bountyStt),
      ),
    submitFix: (incidentId: bigint, proofURI: string, proofHash: Hex) =>
      write("submitFix", [incidentId, proofURI, proofHash]),
    requestFixReview: async (fixId: bigint) => {
      if (!contractAddress) throw new Error("Set NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS first");
      const fee = await publicClient.readContract({
        address: contractAddress,
        abi: somniBountyAbi,
        functionName: "quoteFixReview",
        args: [fixId],
      });
      return write("requestFixReview", [fixId], fee);
    },
    reclaimExpired: (incidentId: bigint) => write("reclaimExpired", [incidentId]),
  };

  return {
    actions,
    contractAddress,
    explorerBase: somniaExplorerUrl,
    incidents,
    lastTx,
    projects,
    refresh,
    status,
  };
}
