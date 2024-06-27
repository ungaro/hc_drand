// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./DrandOracle.sol";
import "./SequencerRandomOracle.sol";

contract RandomnessOracle {
    uint256 public constant DELAY = 10;

    DrandOracle public drandOracle;
    SequencerRandomOracle public sequencerRandomOracle;

    constructor(address _drandOracle, address _sequencerRandomOracle) {
        drandOracle = DrandOracle(_drandOracle);
        sequencerRandomOracle = SequencerRandomOracle(_sequencerRandomOracle);
    }

    function unsafeGetRandomness(uint256 T) public view returns (uint256) {
        
        //Timestamp would be always greater than DELAY so we don't need this 
        //if (T <= DELAY) return 0;

        uint256 drandValue = drandOracle.unsafeGetDrand(T - DELAY);
        uint256 sequencerValue = sequencerRandomOracle.unsafeGetSequencerRandom(T);

        if (drandValue == 0 || sequencerValue == 0) {
            return 0;
        }

        return uint256(keccak256(abi.encodePacked(drandValue, sequencerValue)));
    }

    function getRandomness(uint256 T) public view returns (uint256) {
        uint256 randomness = unsafeGetRandomness(T);
        require(randomness != 0, "Randomness not available");
        return randomness;
    }

    function isRandomnessAvailable(uint256 T) public view returns (bool) {
        
        //Timestamp would be always greater than DELAY so we don't need this 
        //if (T <= DELAY) return false;

        return drandOracle.isDrandAvailable(T - DELAY) && sequencerRandomOracle.isSequencerRandomAvailable(T);
    }
}