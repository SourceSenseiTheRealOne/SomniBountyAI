import { createSign } from "crypto";
import { createPublicClient, http, keccak256, toBytes, type Address } from "viem";
import { somniaTestnet } from "@/lib/somnia";
import { somniBountyAbi } from "@/lib/somnibounty-abi";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export type GitHubRepo = {
  owner: string;
  repo: string;
};

export type OnchainProject = {
  owner: Address;
  active: boolean;
  metadataHash: `0x${string}`;
  name: string;
  description: string;
  socialUrl: string;
  imageUrl: string;
  githubRepo: string;
  agentPayoutWallet: Address;
};

export type OnchainScanJob = {
  projectId: bigint;
  sponsor: Address;
  criticalBounty: bigint;
  highBounty: bigint;
  mediumBounty: bigint;
  requestedAt: bigint;
  status: number;
  incidentId: bigint;
  resultHash: `0x${string}`;
  resultURI: string;
};

export function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "Request failed";
  const code = error instanceof ConfigError ? 412 : status;
  return Response.json({ error: message }, { status: code });
}

export function requireEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new ConfigError(`${name} is required`);
  return value;
}

export function contractAddress(): Address {
  const value = process.env.SOMNIBOUNTY_ADDRESS ?? process.env.NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS;
  if (!/^0x[a-fA-F0-9]{40}$/.test(value ?? "")) {
    throw new ConfigError("SOMNIBOUNTY_ADDRESS or NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS is required");
  }
  return value as Address;
}

export function parseGitHubRepo(input: string): GitHubRepo {
  const trimmed = input.trim();
  const match = trimmed.match(/^https:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)\/?$/);
  if (!match) throw new Error("githubRepo must be a GitHub repository URL");
  return { owner: match[1], repo: match[2].replace(/\.git$/, "") };
}

function base64Url(value: string | Buffer) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function githubPrivateKey() {
  return requireEnv("GITHUB_APP_PRIVATE_KEY").replace(/\\n/g, "\n");
}

export function proofHash(value: string) {
  return keccak256(toBytes(value));
}

export async function githubInstallationToken() {
  const appId = requireEnv("GITHUB_APP_ID");
  const installationId = requireEnv("GITHUB_APP_INSTALLATION_ID");
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(
    JSON.stringify({
      iat: now - 60,
      exp: now + 9 * 60,
      iss: appId,
    }),
  );
  const body = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(body);
  signer.end();
  const signature = signer.sign(githubPrivateKey());
  const jwt = `${body}.${base64Url(signature)}`;

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`GitHub App token failed: ${response.status}`);
  }

  const data = (await response.json()) as { token?: string };
  if (!data.token) throw new Error("GitHub App token response missing token");
  return data.token;
}

export async function githubRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await githubInstallationToken();
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub request failed ${response.status}: ${text.slice(0, 240)}`);
  }

  return (await response.json()) as T;
}

export async function githubRequestOrNull<T>(
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  try {
    return await githubRequest<T>(path, init);
  } catch (error) {
    if (error instanceof Error && error.message.includes("GitHub request failed 404")) {
      return null;
    }
    throw error;
  }
}

export const somniaPublicClient = createPublicClient({
  chain: somniaTestnet,
  transport: http(process.env.NEXT_PUBLIC_SOMNIA_RPC_URL ?? "https://api.infra.testnet.somnia.network/"),
});

export async function readProject(projectId: bigint) {
  return somniaPublicClient.readContract({
    address: contractAddress(),
    abi: somniBountyAbi,
    functionName: "getProject",
    args: [projectId],
  }) as Promise<OnchainProject>;
}

export async function readScanJob(jobId: bigint) {
  return somniaPublicClient.readContract({
    address: contractAddress(),
    abi: somniBountyAbi,
    functionName: "getScanJob",
    args: [jobId],
  }) as Promise<OnchainScanJob>;
}

function extractOpenAiText(data: unknown): string {
  if (typeof data !== "object" || data === null) return "";
  const record = data as Record<string, unknown>;
  if (typeof record.output_text === "string") return record.output_text;
  const output = Array.isArray(record.output) ? record.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (typeof block !== "object" || block === null) continue;
      const text = (block as Record<string, unknown>).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n");
}

export async function runOpenAiJson<T>(input: string): Promise<T> {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const model = process.env.OPENAI_CODE_MODEL ?? "gpt-5.2-codex";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
      reasoning: { effort: "high" },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI response failed ${response.status}: ${text.slice(0, 240)}`);
  }

  const text = extractOpenAiText(await response.json());
  const jsonStart = text.indexOf("{");
  const jsonEnd = text.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("OpenAI response did not contain JSON");
  }
  return JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as T;
}

export async function pinJson(name: string, payload: unknown) {
  const jwt = requireEnv("PINATA_JWT");
  const response = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      pinataMetadata: { name },
      pinataContent: payload,
    }),
  });

  const data = (await response.json().catch(() => null)) as { IpfsHash?: string; error?: string } | null;
  if (!response.ok || !data?.IpfsHash) {
    throw new Error(data?.error ?? "Pinata proof pin failed");
  }
  return `ipfs://${data.IpfsHash}`;
}
