// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SomniBountyAI } from "../src/SomniBountyAI.sol";
import { MockAgentPlatform } from "../test/mocks/MockAgentPlatform.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract Deploy {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    address public constant SOMNIA_TESTNET_AGENT_PLATFORM =
        0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776;
    uint256 public constant DEFAULT_LLM_AGENT_ID = 12847293847561029384;
    uint256 public constant DEFAULT_AGENT_FEE_PER_VALIDATOR = 0.07 ether;
    uint8 public constant DEFAULT_SUBCOMMITTEE_SIZE = 3;

    function run() external returns (SomniBountyAI escrow) {
        vm.startBroadcast();
        escrow = new SomniBountyAI(
            SOMNIA_TESTNET_AGENT_PLATFORM,
            DEFAULT_LLM_AGENT_ID,
            DEFAULT_AGENT_FEE_PER_VALIDATOR,
            DEFAULT_SUBCOMMITTEE_SIZE
        );
        vm.stopBroadcast();
    }

    function deploy(
        address agentPlatform,
        uint256 agentId,
        uint256 agentFeePerValidator,
        uint8 subcommitteeSize
    ) external returns (SomniBountyAI escrow) {
        escrow = new SomniBountyAI(agentPlatform, agentId, agentFeePerValidator, subcommitteeSize);
    }

    function deployWithDefaults(address agentPlatform) external returns (SomniBountyAI escrow) {
        escrow = new SomniBountyAI(
            agentPlatform,
            DEFAULT_LLM_AGENT_ID,
            DEFAULT_AGENT_FEE_PER_VALIDATOR,
            DEFAULT_SUBCOMMITTEE_SIZE
        );
    }

    function deployLocalMock() external returns (MockAgentPlatform platform, SomniBountyAI escrow) {
        (platform, escrow) = _deployLocalMock();
    }

    function _deployLocalMock()
        internal
        returns (MockAgentPlatform platform, SomniBountyAI escrow)
    {
        platform = new MockAgentPlatform();
        escrow = new SomniBountyAI(
            address(platform),
            DEFAULT_LLM_AGENT_ID,
            DEFAULT_AGENT_FEE_PER_VALIDATOR,
            DEFAULT_SUBCOMMITTEE_SIZE
        );
    }
}
