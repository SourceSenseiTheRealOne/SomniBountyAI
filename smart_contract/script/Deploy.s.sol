// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SomniBountyAI } from "../src/SomniBountyAI.sol";
import { VulnerabilityRegistry } from "../src/VulnerabilityRegistry.sol";
import { MockAgentPlatform } from "../test/mocks/MockAgentPlatform.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envString(string calldata key) external view returns (string memory);
    function envAddress(string calldata key) external view returns (address);
    function envUint(string calldata key) external view returns (uint256);
}

contract Deploy {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public constant SOMNIA_TESTNET_AGENT_PLATFORM =
        0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;
    uint256 public constant DEFAULT_LLM_AGENT_ID = 12847293847561029384;
    uint256 public constant DEFAULT_AGENT_FEE_PER_VALIDATOR = 0.07 ether;
    uint256 public constant DEFAULT_JSON_API_FEE_PER_VALIDATOR = 0.03 ether;
    uint8 public constant DEFAULT_SUBCOMMITTEE_SIZE = 3;

    function run() external returns (VulnerabilityRegistry registry, SomniBountyAI escrow) {
        address agentPlatform = vm.envAddress("SOMNIA_AGENT_PLATFORM");
        uint256 llmAgentId = vm.envUint("SOMNIA_LLM_AGENT_ID");
        uint256 llmFee = vm.envUint("SOMNIA_AGENT_FEE_PER_VALIDATOR");
        uint256 jsonAgentId = vm.envUint("SOMNIA_JSON_API_AGENT_ID");
        uint256 jsonFee = vm.envUint("SOMNIA_JSON_API_FEE_PER_VALIDATOR");
        uint8 subcommitteeSize = uint8(vm.envUint("SOMNIA_SUBCOMMITTEE_SIZE"));
        string memory automationApiBase = vm.envString("AUTOMATION_API_BASE_URL");
        vm.startBroadcast();
        registry = new VulnerabilityRegistry();
        _seedRegistry(registry);
        escrow = new SomniBountyAI(
            agentPlatform,
            address(registry),
            llmAgentId,
            llmFee,
            jsonAgentId,
            jsonFee,
            subcommitteeSize,
            automationApiBase
        );
        vm.stopBroadcast();
    }

    function deploy(
        address agentPlatform,
        uint256 agentId,
        uint256 agentFeePerValidator,
        uint256 jsonApiAgentId,
        uint256 jsonApiFeePerValidator,
        uint8 subcommitteeSize,
        string memory automationApiBase
    ) external returns (VulnerabilityRegistry registry, SomniBountyAI escrow) {
        registry = new VulnerabilityRegistry();
        _seedRegistry(registry);
        escrow = new SomniBountyAI(
            agentPlatform,
            address(registry),
            agentId,
            agentFeePerValidator,
            jsonApiAgentId,
            jsonApiFeePerValidator,
            subcommitteeSize,
            automationApiBase
        );
    }

    function deployWithDefaults(
        address agentPlatform,
        uint256 jsonApiAgentId,
        string memory automationApiBase
    ) external returns (VulnerabilityRegistry registry, SomniBountyAI escrow) {
        registry = new VulnerabilityRegistry();
        _seedRegistry(registry);
        escrow = new SomniBountyAI(
            agentPlatform,
            address(registry),
            DEFAULT_LLM_AGENT_ID,
            DEFAULT_AGENT_FEE_PER_VALIDATOR,
            jsonApiAgentId,
            DEFAULT_JSON_API_FEE_PER_VALIDATOR,
            DEFAULT_SUBCOMMITTEE_SIZE,
            automationApiBase
        );
    }

    function deployLocalMock()
        external
        returns (MockAgentPlatform platform, VulnerabilityRegistry registry, SomniBountyAI escrow)
    {
        (platform, registry, escrow) = _deployLocalMock();
    }

    function _deployLocalMock()
        internal
        returns (MockAgentPlatform platform, VulnerabilityRegistry registry, SomniBountyAI escrow)
    {
        platform = new MockAgentPlatform();
        registry = new VulnerabilityRegistry();
        _seedRegistry(registry);
        escrow = new SomniBountyAI(
            address(platform),
            address(registry),
            DEFAULT_LLM_AGENT_ID,
            DEFAULT_AGENT_FEE_PER_VALIDATOR,
            9001,
            DEFAULT_JSON_API_FEE_PER_VALIDATOR,
            DEFAULT_SUBCOMMITTEE_SIZE,
            "https://somnibounty.example"
        );
    }

    function _seedRegistry(VulnerabilityRegistry registry) internal {
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Critical,
            "Reentrancy",
            "External control flow can re-enter before state is finalized.",
            "Look for call/value/transfer hooks before balance, debt, share, or nonce updates; comments may mark reentrancy.",
            "State mutation after external call; missing nonReentrant guard around withdraw/claim/execute.",
            "Apply checks-effects-interactions, update accounting before calls, add reentrancy guard where needed.",
            "Funds can be drained or accounting corrupted.",
            "ipfs://somnibounty/reentrancy"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Critical,
            "Access control bypass",
            "Privileged function can be called by unauthorized account.",
            "Look for admin setters, mint, withdraw, upgrade, pause, sweep, or config functions missing role checks.",
            "Sensitive function lacks onlyOwner/role check or validates wrong address.",
            "Add explicit role/owner authorization and tests for unauthorized callers.",
            "Attacker can steal funds, mint assets, change config, or disable protocol.",
            "ipfs://somnibounty/access-control"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.High,
            "Unchecked external call",
            "Low-level call result ignored or external call assumes success.",
            "Look for .call/.delegatecall/.staticcall returns unused, or ERC20 transfer return ignored.",
            "Function continues after failed external interaction.",
            "Check success boolean, validate returned data, revert on failed required calls.",
            "Funds or state can desync silently.",
            "ipfs://somnibounty/unchecked-call"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.High,
            "Signature replay",
            "Signed authorization can be reused across chains, contracts, or nonces.",
            "Look for ecrecover/permit/meta-tx without nonce, deadline, chainId, or contract domain.",
            "Hash omits nonce/deadline/domain separator or nonce not consumed before action.",
            "Use EIP-712 domain, chainId, contract address, deadline, and monotonic nonce.",
            "Attacker can repeat approvals/orders/claims.",
            "ipfs://somnibounty/signature-replay"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Critical,
            "Oracle manipulation",
            "Protocol trusts manipulable spot price or stale oracle data.",
            "Look for DEX spot reads, single block reserves, missing staleness checks, or no bounds.",
            "Price from AMM reserves or oracle used directly for mint, borrow, redeem, or liquidate.",
            "Use TWAP, trusted oracle, staleness checks, sanity bounds, and circuit breakers.",
            "Attacker can drain collateral or manipulate settlement.",
            "ipfs://somnibounty/oracle-manipulation"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.High,
            "Price or slippage manipulation",
            "Swap or valuation accepts attacker-controlled price movement.",
            "Look for minOut zero, deadline missing, user slippage ignored, or path controlled by caller.",
            "Function swaps without minimum output or validates against current manipulated reserves.",
            "Require minOut/deadline, validate route, bound price impact, and use safe router patterns.",
            "Attacker can sandwich, drain value, or force bad execution.",
            "ipfs://somnibounty/price-slippage"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Medium,
            "Unsafe ERC20 transfer",
            "Token transfer assumes standard boolean behavior.",
            "Look for IERC20.transfer/transferFrom not wrapped in SafeERC20.",
            "Non-standard tokens can return false or no data and break assumptions.",
            "Use SafeERC20 and validate balance deltas when required.",
            "Funds can be stuck, unpaid, or accounting can desync.",
            "ipfs://somnibounty/unsafe-erc20"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Critical,
            "Delegatecall or proxy storage collision",
            "Delegatecall/proxy pattern can overwrite privileged storage.",
            "Look for delegatecall to user-controlled target, unstructured proxy storage, or changed layout.",
            "Implementation and proxy storage slots collide, or target not allowlisted.",
            "Use EIP-1967/UUPS patterns, fixed storage gaps, allowlisted implementations, and upgrade tests.",
            "Attacker can seize ownership or brick protocol.",
            "ipfs://somnibounty/proxy-storage"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.High,
            "tx.origin authentication",
            "Authorization depends on tx.origin instead of msg.sender.",
            "Look for require(tx.origin == owner) or mixed origin/sender checks.",
            "Phishing contract can make victim originate transaction and pass auth.",
            "Use msg.sender and role checks; never use tx.origin for authorization.",
            "Victim can be tricked into executing privileged actions.",
            "ipfs://somnibounty/tx-origin"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Medium,
            "Denial of service",
            "Function can be permanently or cheaply blocked.",
            "Look for unbounded loops, push payments, external calls inside loops, or griefable state.",
            "Any failing recipient/caller blocks progress for all users.",
            "Use pull payments, bounded loops, pagination, and failure isolation.",
            "Protocol operations can be frozen or made too expensive.",
            "ipfs://somnibounty/denial-of-service"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.Medium,
            "Precision or rounding loss",
            "Math order or rounding direction gives unfair value transfer.",
            "Look for division before multiplication, inconsistent share math, or down-rounding in mint/redeem.",
            "Small deposits/withdrawals exploit truncation or accumulate dust.",
            "Use mulDiv, consistent rounding, minimum amounts, and invariant tests.",
            "Users or protocol lose value over repeated operations.",
            "ipfs://somnibounty/precision-loss"
        );
        registry.registerTemplate(
            VulnerabilityRegistry.Category.High,
            "Upgradeability or admin risk",
            "Admin/upgrade pathway can bypass security assumptions.",
            "Look for unprotected initializer, missing disableInitializers, unguarded upgrade, or owner sweep.",
            "Implementation can be initialized by attacker or upgrade executed without controls.",
            "Protect initializers, require timelock/multisig/roles, and test upgrade authorization.",
            "Attacker can upgrade to malicious implementation or steal funds.",
            "ipfs://somnibounty/admin-risk"
        );
    }
}
