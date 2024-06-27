// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract SequencerRandomOracle {
    uint256 public constant SEQUENCER_TIMEOUT = 10;
    uint256 public constant PRECOMMIT_DELAY = 10;

    struct Commitment {
        bytes32 commitment;
        bool revealed;
        uint256 value;
    }

    mapping(uint256 => Commitment) private commitments;
    uint256 public lastRevealedT;

    event CommitmentPosted(uint256 indexed T, bytes32 commitment);
    event ValueRevealed(uint256 indexed T, uint256 value);
    event RevealError(uint256 indexed T, string reason);

  function unsafeGetSequencerRandom(uint256 T) public view returns (uint256) {
        Commitment memory commitment = commitments[T];
        if (commitment.revealed) {
            return commitment.value;
        } else if (commitment.commitment != bytes32(0)) {
            return uint256(keccak256(abi.encodePacked(commitment.commitment)));
        } else {
            return 0;
        }
    }

    function isSequencerRandomAvailable(uint256 T) public view returns (bool) {
        return commitments[T].commitment != bytes32(0);
    }

    function getSequencerRandom(uint256 T) public view returns (uint256) {
        uint256 value = unsafeGetSequencerRandom(T);
        require(value != 0, "Sequencer random value not available");
        return value;
    }


    function postCommitment(uint256 T, bytes32 commitment) public {
        require(block.timestamp + PRECOMMIT_DELAY <= T, "Commitment must be posted in advance");
        require(commitments[T].commitment == bytes32(0), "Commitment already posted");
        commitments[T].commitment = commitment;
        emit CommitmentPosted(T, commitment);
    }

    function reveal(uint256 T, uint256 value) public {
        if (commitments[T].commitment == bytes32(0)) {
            emit RevealError(T, "No commitment posted");
            revert("No commitment posted");
        }
        if (commitments[T].revealed) {
            emit RevealError(T, "Already revealed");
            revert("Already revealed");
        }
        if (T != lastRevealedT + 2 && lastRevealedT != 0) {
            emit RevealError(T, "Must reveal in order");
            revert("Must reveal in order");
        }
        if (block.timestamp > T + SEQUENCER_TIMEOUT) {
            emit RevealError(T, "Reveal timeout expired");
            revert("Reveal timeout expired");
        }

        commitments[T].revealed = true;
        commitments[T].value = value;
        lastRevealedT = T;
        emit ValueRevealed(T, value);
    }

    function getLastRevealedT() public view returns (uint256) {
        return lastRevealedT;
    }

    function getCommitment(uint256 T) public view returns (bytes32, bool, uint256) {
        Commitment memory c = commitments[T];
        return (c.commitment, c.revealed, c.value);
    }
}