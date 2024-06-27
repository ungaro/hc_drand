// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import "../src/DrandOracle.sol";
import "../src/SequencerRandomOracle.sol";
import "../src/RandomnessOracle.sol";

contract Deploy is Script {
    function run() external {
        // Retrieve private key and deployer address from environment variables
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        // Start broadcasting transactions
        vm.startBroadcast(deployerPrivateKey);

        // Deploy DrandOracle contract
        DrandOracle drandOracle = new DrandOracle();
        console.log("DrandOracle deployed at:", address(drandOracle));

        // Deploy SequencerRandomOracle contract
        SequencerRandomOracle sequencerRandomOracle = new SequencerRandomOracle();
        console.log("SequencerRandomOracle deployed at:", address(sequencerRandomOracle));

        // Deploy RandomnessOracle contract with addresses of DrandOracle and SequencerRandomOracle
        RandomnessOracle randomnessOracle = new RandomnessOracle(address(drandOracle), address(sequencerRandomOracle));
        console.log("RandomnessOracle deployed at:", address(randomnessOracle));

        // Stop broadcasting transactions
        vm.stopBroadcast();
    }
}