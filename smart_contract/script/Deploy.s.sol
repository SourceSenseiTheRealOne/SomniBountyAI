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
}
