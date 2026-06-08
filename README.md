# SomniBounty AI

Somnia-agent-first security bounty automation.

```text
Matrix loader -> Register Project -> Configure Bounty Tiers -> Dashboard -> Agent Logs -> Paid History
```

![SomniBounty AI logo banner](docs/assets/somnibounty-readme-banner.svg)

## What It Does

SomniBounty AI lets a company wallet publish a project, fund severity-based bounty tiers, and start an autonomous Somnia Agent security loop.

The intended production loop:

```text
Publisher registers project onchain
Publisher funds Critical, High, and Medium bounty tiers
Somnia Agents scan the GitHub repo
Somnia Agents compare findings against VulnerabilityRegistry
Second Somnia Agent validates the candidate
Backend creates an idempotent GitHub App PR when asked by the agent
Proof is pinned to IPFS
Somnia verifier returns VALID, INVALID, or NEEDS_REVIEW
Contract releases STT only on VALID
Paid bounty appears in /bounties/paid
```

Backend services support the agents, but they are not payout authority.

## Repository Layout

```text
.
|-- apps/web                 Next.js app
|-- docs                     Product, architecture, testing, security notes
|-- scripts/agent            Agent prompt and helper notes
|-- smart_contract           Foundry project
|   |-- src/SomniBountyAI.sol
|   |-- src/VulnerabilityRegistry.sol
|   |-- test
|   `-- script
|-- AGENTS.md
|-- CLAUDE.md
|-- TASKS.md
`-- memory.md
```

## Current Contracts

`VulnerabilityRegistry`

- Stores known Solidity/EVM vulnerability templates.
- Initial templates include reentrancy, access control bypass, unchecked external call, signature replay, oracle manipulation, slippage manipulation, unsafe ERC20 transfer, proxy storage collision, `tx.origin` auth, denial of service, rounding loss, and upgradeability/admin risk.

`SomniBountyAI`

- Registers project name, description, optional social URL, optional image URL, GitHub repo URL, metadata hash, publisher, and agent payout wallet.
- Funds three bounty tiers in one transaction:
  - Critical minimum: `0.05 STT`
  - High minimum: `0.02 STT`
  - Medium minimum: `0.01 STT`
- Funding creates a Somnia Agent scan request.
- Valid scan results open onchain incidents with reserved tier bounty.
- Fix submission pays the configured agent payout wallet, not arbitrary `msg.sender`.
- Callback security checks `msg.sender == agentPlatform`, validates request IDs, deletes pending requests before payout, handles failed/timed-out status, and blocks double payout.

## Backend API

Runtime-supported endpoints:

- `GET /api/repo/snapshot?projectId=...`
  - Reads the project GitHub URL from the contract.
  - Fetches repo tree and Solidity file contents through GitHub App auth.
  - Read-only.
- `GET /api/fix-pr?jobId=...`
  - Reads scan job and project from contract.
  - Creates branch `somnibounty/<projectId>-<jobId>`.
  - Uses OpenAI/Codex only to generate constrained file replacements.
  - Idempotent: duplicate validator calls return the same PR.
- `POST /api/ipfs/project`
  - Pins project metadata to IPFS with Pinata.
- `POST /api/ipfs/proof`
  - Pins fix proof/report JSON to IPFS.

Deprecated legacy routes under `/api/agents/*` return `410`.

## Frontend

- Next.js App Router.
- TypeScript.
- Tailwind CSS v4.
- Motion.
- `viem`.
- React Hook Form plus Zod for all forms.
- Matrix-style 4 second loader.
- First real screen is project registration, not a dashboard.
- Dashboard uses live contract data only.
- Primary action is `Set Up Bounty`.
- Logs view derives status from live projects, scan jobs, incidents, fixes, and paid bounties.
- Paid history page: `/bounties/paid`.

## Somnia Testnet

```text
Chain ID: 50312
RPC: https://api.infra.testnet.somnia.network/
WSS: wss://api.infra.testnet.somnia.network/ws
Explorer: https://shannon-explorer.somnia.network/
Known Agent platform from research: 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
```

Agent ABI, IDs, fees, and pricing are volatile. Re-check Somnia docs before deploy.

## Setup

Install frontend dependencies:

```powershell
cd apps/web
npm install
```

Create frontend env:

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
```

Required live env after deployment:

```text
NEXT_PUBLIC_SOMNIA_RPC_URL=https://api.infra.testnet.somnia.network/
NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS=
NEXT_PUBLIC_VULNERABILITY_REGISTRY_ADDRESS=
SOMNIBOUNTY_ADDRESS=
VULNERABILITY_REGISTRY_ADDRESS=
PINATA_JWT=
GITHUB_APP_ID=
GITHUB_APP_INSTALLATION_ID=
GITHUB_APP_PRIVATE_KEY=
OPENAI_API_KEY=
OPENAI_CODE_MODEL=gpt-5.2-codex
```

No current deployment is included in the env by default. Deploy after faucet funding.

## Smart Contract Commands

Run Foundry through WSL:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc 'cd /mnt/c/Users/sourc/Documents/Dev/Hackathons/Somnia_Hackathon/smart_contract && ~/.foundry/bin/forge test'
```

Format:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc 'cd /mnt/c/Users/sourc/Documents/Dev/Hackathons/Somnia_Hackathon/smart_contract && ~/.foundry/bin/forge fmt --check'
```

Build:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc 'cd /mnt/c/Users/sourc/Documents/Dev/Hackathons/Somnia_Hackathon/smart_contract && ~/.foundry/bin/forge build'
```

## Frontend Commands

```powershell
cd apps/web
npm run lint
npm run build
npm run dev
```

## Docker

Build and run web container locally:

```powershell
docker compose --env-file apps/web/.env up --build
```

Health check:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/health
```

Northflank:

```text
Dockerfile path: apps/web/Dockerfile
Build context: repository root
Port: 3000
Health path: /api/health
```

Set `NEXT_PUBLIC_*` as build arguments and runtime variables. Set secrets as runtime variables only.

After Northflank deploy, use public service URL in:

```text
AUTOMATION_API_BASE_URL=https://your-northflank-domain
```

More detail: `docs/06-docker-northflank.md`.

## Current Verification

- Foundry: `17 passed, 0 failed`.
- Frontend lint: passed.
- Frontend production build: passed.

## Deployment Status

The current two-contract implementation is not deployed yet because faucet funding is pending.

Older mock/demo deployments may exist in memory/docs, but they are ABI-incompatible with the current `VulnerabilityRegistry + SomniBountyAI` source and should not be used for this flow.

## References

- Somnia Agents guide: https://blog.somnia.network/p/building-on-the-agentic-l1-a-developers
- Somnia Agents overview: https://somnia.network/agents
- OpenAI code generation: https://platform.openai.com/docs/guides/code-generation
- OpenAI Responses API: https://platform.openai.com/docs/api-reference/responses
