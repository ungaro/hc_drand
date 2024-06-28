// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract DrandOracle is Ownable {
  constructor() Ownable(msg.sender) {}


    uint256 public immutable DRAND_TIMEOUT = 10;

    mapping(uint256 => uint256) private drandValues;

    function unsafeGetDrand(uint256 T) public view returns (uint256) {
        return drandValues[T];
    }

    function getDrand(uint256 T) public view returns (uint256) {
        uint256 value = drandValues[T];
        require(value != 0, "Drand value not available");
        return value;
    }

    function isDrandAvailable(uint256 T) public view returns (bool) {
        unchecked {
            return drandValues[T] != 0 || block.timestamp <= T + DRAND_TIMEOUT;
        }
    }

    function setDrand(uint256 T, uint256 value) public onlyOwner {
        require(
            block.timestamp <= T + DRAND_TIMEOUT,
            "Drand backfill timeout expired"
        );
        require(drandValues[T] == 0, "Drand value already set");
        drandValues[T] = value;
    }
}
