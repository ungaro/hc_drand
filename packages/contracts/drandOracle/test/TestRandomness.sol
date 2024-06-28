// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import "forge-std/console.sol";

import "../src/DrandOracle.sol";
import "../src/SequencerRandomOracle.sol";
import "../src/RandomnessOracle.sol";

contract TestRandomness is Test {
    DrandOracle drandOracle;
    SequencerRandomOracle sequencerRandomOracle;
    RandomnessOracle randomnessOracle;

    function setUp() public {
        drandOracle = new DrandOracle();
        sequencerRandomOracle = new SequencerRandomOracle();
        randomnessOracle = new RandomnessOracle(address(drandOracle), address(sequencerRandomOracle));
    }

    function testDrandValue() public {
        uint256 timestamp = block.timestamp;
        uint256 drandValue = 12345;
        
        vm.warp(timestamp);
        drandOracle.setDrand(timestamp, drandValue);

        assertEq(drandOracle.getDrand(timestamp), drandValue);
        assertEq(drandOracle.unsafeGetDrand(timestamp), drandValue);
    }

    function testDrandTimeout() public {
        uint256 timestamp = block.timestamp;
        uint256 drandValue = 12345;
        
        vm.warp(timestamp + drandOracle.DRAND_TIMEOUT() + 1);
        vm.expectRevert("Drand backfill timeout expired");
        drandOracle.setDrand(timestamp, drandValue);
    }

    function testSequencerCommitmentAndReveal() public {
        //vm.warp(20);
        uint256 currentTimestamp = block.timestamp;
        uint256 futureTimestamp1 = currentTimestamp + sequencerRandomOracle.PRECOMMIT_DELAY() + 1;
        uint256 futureTimestamp2 = futureTimestamp1 + 1;
        uint256 futureTimestamp3 = futureTimestamp2 + 1;
        uint256 randomValue = 67890;
        bytes32 commitment1 = keccak256(abi.encodePacked(randomValue));
        bytes32 commitment2 = keccak256(abi.encodePacked(randomValue + 1));
        bytes32 commitment3 = keccak256(abi.encodePacked(randomValue + 2));

        sequencerRandomOracle.postCommitment(futureTimestamp1, commitment1);
        sequencerRandomOracle.postCommitment(futureTimestamp2, commitment2);
        sequencerRandomOracle.postCommitment(futureTimestamp3, commitment3);


        vm.expectRevert("No commitment posted");
        sequencerRandomOracle.reveal(futureTimestamp1 - 1, randomValue);

        vm.warp(futureTimestamp1);
        sequencerRandomOracle.reveal(futureTimestamp1, randomValue);
        assertEq(sequencerRandomOracle.getSequencerRandom(futureTimestamp1), randomValue);

        vm.expectRevert("Already revealed");
        sequencerRandomOracle.reveal(futureTimestamp1, randomValue);

        vm.warp(futureTimestamp3);
        
        vm.expectRevert("Must reveal in order");
        sequencerRandomOracle.reveal(futureTimestamp2, randomValue + 2);
        sequencerRandomOracle.reveal(futureTimestamp3, randomValue + 2);

   

    }
    function testSequencerTimeout() public {
        uint256 currentTimestamp = block.timestamp;
        uint256 futureTimestamp = currentTimestamp + sequencerRandomOracle.PRECOMMIT_DELAY() + 1;
        uint256 randomValue = 67890;
        bytes32 commitment = keccak256(abi.encodePacked(randomValue));

        sequencerRandomOracle.postCommitment(futureTimestamp, commitment);

        vm.warp(futureTimestamp + sequencerRandomOracle.SEQUENCER_TIMEOUT() + 1);
        vm.expectRevert("Reveal timeout expired");
        sequencerRandomOracle.reveal(futureTimestamp, randomValue);
    }

 function testRandomnessOracle() public {
        uint256 currentTimestamp = block.timestamp;
        uint256 futureTimestamp = currentTimestamp + randomnessOracle.DELAY() + sequencerRandomOracle.PRECOMMIT_DELAY() + 1;
        uint256 drandValue = 12345;
        uint256 sequencerValue = 67890;
        bytes32 commitment = keccak256(abi.encodePacked(sequencerValue));

        drandOracle.setDrand(futureTimestamp - randomnessOracle.DELAY(), drandValue);
        sequencerRandomOracle.postCommitment(futureTimestamp, commitment);
        
        vm.warp(futureTimestamp);
        sequencerRandomOracle.reveal(futureTimestamp, sequencerValue);

        uint256 expectedRandomness = uint256(keccak256(abi.encodePacked(drandValue, sequencerValue)));
        assertEq(randomnessOracle.getRandomness(futureTimestamp), expectedRandomness);
    }

    function testRandomnessNotAvailable() public {
        vm.warp(20);
        uint256 timestamp = block.timestamp;

        vm.expectRevert("Randomness not available");
        uint256 rand = randomnessOracle.getRandomness(timestamp);
        //console.log("rand",rand);

        assertEq(randomnessOracle.unsafeGetRandomness(timestamp), 0);
    }


    function testIsRandomnessAvailable() public {
        uint256 currentTimestamp = block.timestamp;
        uint256 futureTimestamp = currentTimestamp + sequencerRandomOracle.PRECOMMIT_DELAY() + 1;
        uint256 drandValue = 12345;
        uint256 sequencerValue = 67890;
        bytes32 commitment = keccak256(abi.encodePacked(sequencerValue));

        assertFalse(randomnessOracle.isRandomnessAvailable(futureTimestamp));

        drandOracle.setDrand(futureTimestamp - randomnessOracle.DELAY(), drandValue);
        assertFalse(randomnessOracle.isRandomnessAvailable(futureTimestamp));

        sequencerRandomOracle.postCommitment(futureTimestamp, commitment);
        assertTrue(randomnessOracle.isRandomnessAvailable(futureTimestamp));

        vm.warp(futureTimestamp);
        sequencerRandomOracle.reveal(futureTimestamp, sequencerValue);
        assertTrue(randomnessOracle.isRandomnessAvailable(futureTimestamp));
    }
}