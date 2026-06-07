# SomniBounty AI

Autonomous security triage and bounty escrow for Somnia.

SomniBounty AI, internally called ProofGuard, demonstrates a full agent loop:

```text
Observe -> investigate -> reason -> act -> verify -> pay
```

Agents detect vulnerabilities, open onchain incidents, verify fixes, and release bounty payouts automatically.

![SomniBounty AI logo banner](docs/assets/somnibounty-readme-banner.svg)

## Why It Exists

Bug bounty workflows often rely on manual intake, subjective triage, and slow payout approval. SomniBounty AI turns that loop into an auditable Somnia-native workflow:

- protocols register projects and fund incidents
- researchers submit vulnerability or fix evidence
- agent verification gates bounty release
- contract state records hashes, deadlines, decisions, and payouts
- frontend shows incident flow from evidence to escrow release

Long reports and rationales stay offchain. Immutable references, hashes, and payout state stay onchain.

## Repository Layout

```text
.
|-- apps/
|   `-- web/                 Next.js security operations console
|-- docs/                    Product, architecture, test, and security notes
|-- scripts/
|   `-- agent/               Prompt fixtures and review request helper
|-- smart_contract/          Foundry project
|   |-- src/                 Solidity contracts
|   |-- test/                Foundry tests and mocks
|   |-- script/              Foundry deployment script
|   |-- foundry.toml         Foundry config
|   |-- .env.example         Contract deployment env template
|   |-- out/                 Ignored build artifacts
|   |-- cache/               Ignored Foundry cache
|   `-- broadcast/           Ignored deployment broadcasts
|-- TASKS.md                 Hackathon task tracker
`-- memory.md                Project memory and decisions
```

## Product Flow

```text
1. Protocol registers project metadata.
2. Reporter or agent opens funded security incident.
3. Builder submits fix proof URI and hash.
4. Contract requests agent verification.
5. Agent callback returns VALID, INVALID, or NEEDS_REVIEW.
6. VALID releases escrowed STT to fixer.
7. INVALID reopens incident.
8. Timeout path lets sponsor reclaim unresolved bounty.
```

## Current MVP

Smart contract:

- native STT bounty escrow
- project registration
- funded incident opening
- fix proof submission
- Somnia-style async agent request/callback shape
- raw verdict parsing: `VALID`, `INVALID`, `NEEDS_REVIEW`
- payout only on `VALID`
- stale review cancellation
- sponsor reclaim after expiry
- callback authentication and repeated-callback protection
- read helpers for frontend

Frontend:

- `apps/web`
- Next.js App Router
- TypeScript
- Tailwind CSS v4
- Motion animation
- React Hook Form + Zod for publish form validation
- server-side Pinata JSON pinning for project metadata
- direct `viem` wallet and contract integration
- polished demo fallback when no contract address is configured
- live polling against deployed escrow contract
- explorer links for transactions and addresses

Agent artifacts:

- `scripts/agent/verify-fix-prompt.md`
- `scripts/agent/sample-verdicts.json`
- `scripts/agent/request-review.ts`

## Somnia Network

Current Somnia docs list:

```text
Testnet chain ID: 50312
Testnet token: STT
Testnet RPC: https://dream-rpc.somnia.network/
Testnet explorer: https://shannon-explorer.somnia.network/
```

Known testnet Agent platform values remain volatile and must be rechecked before real agent integration:

```text
Agent platform: 0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776
LLM agent ID: 12847293847561029384
Default LLM fee per validator: 0.07 STT
Default subcommittee size: 3
```

## Deployed Testnet Demo

Mock demo contracts on Somnia testnet:

```text
MockAgentPlatform: 0xc885105D28F4E291FCa24Cf4aCEC6d3Ef921Eb31
SomniBountyAI:     0x839F69B13F005cbd09E4A141e66267Af67C95c40
Verification:      Pass - Verified on Somnia Blockscout
```

Explorer:

- https://shannon-explorer.somnia.network/address/0xc885105D28F4E291FCa24Cf4aCEC6d3Ef921Eb31
- https://shannon-explorer.somnia.network/address/0x839F69B13F005cbd09E4A141e66267Af67C95c40

## Prerequisites

- Windows with WSL Ubuntu-24.04
- Foundry installed in WSL at `~/.foundry/bin/forge`
- Node.js 20+
- npm
- funded Somnia testnet wallet for live transactions
- injected browser wallet for frontend live mode

## Setup

Install frontend dependencies:

```powershell
cd apps/web
npm install
```

Create contract env:

```powershell
Copy-Item smart_contract/.env.example smart_contract/.env
```

Create frontend env:

```powershell
Copy-Item apps/web/.env.example apps/web/.env.local
```

Minimum live frontend value:

```text
NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS=0x839F69B13F005cbd09E4A141e66267Af67C95c40
PINATA_JWT=
```

Leave `NEXT_PUBLIC_SOMNIBOUNTY_ADDRESS` empty to run frontend in demo mode.
Set `PINATA_JWT` to publish project metadata to IPFS through the server route before calling `registerProject`.

## Smart Contract Commands

Run Foundry from `smart_contract/` through WSL:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc 'cd /mnt/c/Users/sourc/Documents/Dev/Hackathons/Somnia_Hackathon/smart_contract && ~/.foundry/bin/forge test'
```

Format check:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc 'cd /mnt/c/Users/sourc/Documents/Dev/Hackathons/Somnia_Hackathon/smart_contract && ~/.foundry/bin/forge fmt --check'
```

Build:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc 'cd /mnt/c/Users/sourc/Documents/Dev/Hackathons/Somnia_Hackathon/smart_contract && ~/.foundry/bin/forge build'
```

Deploy mock platform:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc 'cd /mnt/c/Users/sourc/Documents/Dev/Hackathons/Somnia_Hackathon/smart_contract && source .env && ~/.foundry/bin/forge create test/mocks/MockAgentPlatform.sol:MockAgentPlatform --rpc-url "$SOMNIA_RPC_URL" --private-key "$PRIVATE_KEY" --legacy --broadcast'
```

Deploy escrow with mock platform:

```powershell
wsl -d Ubuntu-24.04 -- bash -lc 'cd /mnt/c/Users/sourc/Documents/Dev/Hackathons/Somnia_Hackathon/smart_contract && source .env && ~/.foundry/bin/forge create src/SomniBountyAI.sol:SomniBountyAI --rpc-url "$SOMNIA_RPC_URL" --private-key "$PRIVATE_KEY" --legacy --broadcast --constructor-args 0xMOCK_AGENT_PLATFORM "$SOMNIA_LLM_AGENT_ID" "$SOMNIA_AGENT_FEE_PER_VALIDATOR" "$SOMNIA_SUBCOMMITTEE_SIZE"'
```

## Frontend Commands

```powershell
cd apps/web
npm run dev
npm run lint
npm run build
```

Open:

```text
http://localhost:3000
```

## Agent Helper

Request verification for a fix with the helper script after env variables are loaded:

```powershell
$env:SOMNIBOUNTY_ADDRESS="0x839F69B13F005cbd09E4A141e66267Af67C95c40"
$env:PRIVATE_KEY="0x..."
$env:FIX_ID="1"
npx tsx scripts/agent/request-review.ts
```

## Security Model

Contract guardrails:

- `msg.sender` must equal configured agent platform for callbacks
- pending request must exist
- pending request is deleted before payout
- payout uses effects before interactions
- payout and reclaim paths use reentrancy guard
- no admin drain path
- invalid verdict reopens incident
- failed or timed-out agent status maps to review path
- double payout and repeated callback covered by tests

Prompt guardrails:

- evidence is treated as untrusted input
- prompt requires exact final value only
- accepted values are `VALID`, `INVALID`, `NEEDS_REVIEW`
- unexpected output maps to `NEEDS_REVIEW`

## Known Limitations

- Real Somnia Agent ABI, fees, and agent IDs must be rechecked before production integration.
- Mock agent platform remains reliable hackathon fallback.
- Current bounty asset is native STT only.
- Reactivity and Data Streams are stretch features.
- Frontend uses polling for demo reliability.
- Agent rationale is offchain; contract stores proof hashes and decision state.

## Core Docs

- [Product Brief](docs/01-product-brief.md)
- [Tech Stack](docs/02-tech-stack.md)
- [Implementation Blueprint](docs/03-implementation-blueprint.md)
- [Phased Plan](docs/04-phased-plan.md)
- [Testing and Security](docs/05-testing-security.md)
- [Task Tracker](TASKS.md)
- [Project Memory](memory.md)
