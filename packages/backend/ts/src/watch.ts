import * as dotenv from "dotenv";
import * as winston from "winston";
import chalk from "chalk";
import { createNonceManager } from 'viem/nonce'

const { combine, timestamp, printf, json, colorize, align } = winston.format;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: combine(
    colorize({ all: true }),
    timestamp({
      format: "YYYY-MM-DD hh:mm:ss.SSS A",
    }),
    align(),
    printf((info) => `[${info.timestamp}] ${info.level}: ${info.message}`)
  ),
  transports: [new winston.transports.Console()],
});

import {
  createWalletClient,
  createPublicClient,
  http,
  keccak256,
  bytesToHex,
} from "viem";
import { anvil } from "viem/chains";
import { privateKeyToAccount, nonceManager } from 'viem/accounts'
import { randomBytes } from "crypto";

import ky from "ky";

import DrandOracleABIJson from "../../../contracts/DrandOracle/out/DrandOracle.sol/DrandOracle.json" with { type: "json" }; // This import style requires "esModuleInterop", see "side notes"
import SequencerRandomOracleABIJson from "../../../contracts/DrandOracle/out/SequencerRandomOracle.sol/SequencerRandomOracle.json" with { type: "json" }; // This import style requires "esModuleInterop", see "side notes"
import randomnessOracleABIJson from "../../../contracts/DrandOracle/out/RandomnessOracle.sol/RandomnessOracle.json" with { type: "json" }; // This import style requires "esModuleInterop", see "side notes"

// Deal with variables
dotenv.config();

const DRAND_URL = "https://api.drand.sh";
const DRAND_CHAIN = process.env.DRAND_CHAIN;

const SEQUENCER_COMMIT_DELAY = 10;
const DRAND_TIMEOUT = 10;

const drandOracleAddress = process.env.DRAND_ORACLE_ADDRESS as `0x${string}`;
const sequencerRandomOracleAddress = process.env
  .SEQUENCER_RANDOM_ORACLE_ADDRESS as `0x${string}`;
const randomnessOracleAddress = process.env
  .RANDOMNESS_ORACLE_ADDRESS as `0x${string}`;

const drandOracleAbi = DrandOracleABIJson.abi;
const sequencerRandomOracleAbi = SequencerRandomOracleABIJson.abi;
const randomnessOracleAbi = randomnessOracleABIJson.abi;

// Interfaces
interface DrandResponse {
  round: number;
  randomness: string;
  signature: string;
}

// GET THIS FROM ENV
const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",{ nonceManager }
);

// CREATE CLIENTS
const publicClient = createPublicClient({
  chain: anvil,
  transport: http(process.env.RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: anvil,
  transport: http(process.env.RPC_URL),
});

const fetchDrandValue = async () => {
  try {
    const response: DrandResponse = await ky
      .get(`${DRAND_URL}/${DRAND_CHAIN}/public/latest`)
      .json();
    //console.log("RANDOMNESS",response.randomness);
    logger.info("Randomness Value from dRand API", {
      message: response.randomness,
    });

    return response.randomness;
  } catch (error) {
    //console.error("Error fetching Drand value:", error);
    logger.error("Error fetching Drand value:", { message: error });

    return null;
  }
};

// Helper function to convert hex string to bytes32
const hexToBytes32 = (hex: string): `0x${string}` => {
  if (hex.length !== 64) {
    throw new Error("Invalid hex length");
  }
  return `0x${hex}` as `0x${string}`;
};

const postDrandValue = async (timestamp: number, drandValue: string, nonce: number) => {
    try {
    const drandValueBytes32 = hexToBytes32(drandValue);
    const { request } = await publicClient.simulateContract({
      account,
      address: drandOracleAddress,
      abi: drandOracleAbi,
      functionName: "updateDrandValue",
      args: [timestamp, drandValueBytes32],
    });

    const drandTX: string = await walletClient.writeContract({
      address: drandOracleAddress,
      abi: drandOracleAbi,
      functionName: "updateDrandValue",
      args: [timestamp, drandValueBytes32],
    });

    logger.info(`Posted Drand value for ${timestamp}:`, {
      message: drandValue,
    });
  } catch (error) {
    logger.error(`Error posting Drand value:`, { message: error });
  }
};

// Function to post commitments
const postCommitment = async (timestamp: number, commitment: string, nonce: number) => {
    try {
    const result = await walletClient.sendTransaction({
      to: sequencerRandomOracleAddress,
      abi: sequencerRandomOracleAbi,
      functionName: "postCommitment",
      args: [timestamp, commitment],
      gas: 500000n,
//      nonce
    });
    //console.log(`Posted commitment for ${timestamp}:`, result);
    logger.info(`Posted commitment for ${timestamp}:`, { message: result });
  } catch (error) {
    logger.error("Error posting commitment:", error);
  }
};

// Function to reveal values
const revealValue = async (timestamp: number, value: string, nonce: number) => {
    try {
    const result = await walletClient.sendTransaction({
      to: sequencerRandomOracleAddress,
      abi: sequencerRandomOracleAbi,
      functionName: "revealValue",
      args: [timestamp, value],
      gas: 500000n,
      //nonce
    });

    logger.info(chalk.white(`Revealed value for ${timestamp}:`, result));
  } catch (error) {
    logger.error(`Error revealing value:`, { message: error });
  }
};

/*
// Generate and post commitments
const generateAndPostCommitments = async () => {
  const timestamp = Math.floor(Date.now() / 1000);

  const randomBytes = crypto.getRandomValues(new Uint8Array(32));

  const randomValue = bytesToHex(randomBytes);

  const commitment = keccak256(randomValue);

  // Post the commitment
  await postCommitment(timestamp, commitment);

  // Reveal the value after a delay (for example, 10 seconds)
  setTimeout(async () => {
    await revealValue(timestamp, randomValue);
  }, 10000);
};


const generateAndPostCommitments = async () => {
    setInterval(async () => {
      const block = await publicClient.getBlock();
      const timestamp = Number(block.timestamp) + SEQUENCER_COMMIT_DELAY;
      const randomValue = bytesToHex(randomBytes(32));
      const commitment = keccak256(randomValue);
  

          // Get the current nonce
    //const nonce = await publicClient.getTransactionCount(account.address  as `0x${string}`);
    const nonce = await publicClient.getTransactionCount({  
        address: account.address  as `0x${string}`
      })



    // Post the commitment
    await postCommitment(timestamp, commitment, nonce);

  
      // Reveal the value after a delay (for example, 10 seconds)
      setTimeout(async () => {
        await revealValue(timestamp, randomValue, nonce + 1);
      }, SEQUENCER_COMMIT_DELAY * 1000);
    }, 2000);
  };

*/

  const generateAndPostCommitments = async () => {
    setInterval(async () => {
      const block = await publicClient.getBlock();
      const timestamp = Number(block.timestamp) + SEQUENCER_COMMIT_DELAY;
      const randomValue = bytesToHex(randomBytes(32));
      const commitment = keccak256(randomValue);
  
      // Get the current nonce
      const nonce = await walletClient.getTransactionCount(account.address);
  
      logger.info(`Generated commitment for ${timestamp}:`, { message: commitment });
      logger.info(`Generated random value for ${timestamp}:`, { message: randomValue });
  
      // Post the commitment
      await postCommitment(timestamp, commitment, nonce);
  
      // Reveal the value after a delay (for example, 10 seconds)
      setTimeout(async () => {
        await revealValue(timestamp, randomValue, nonce + 1n);
      }, SEQUENCER_COMMIT_DELAY * 1000);
    }, 2000);
  };




// Function to retrieve randomness
const getRandomness = async (timestamp: number): Promise<void> => {
  try {
    const randomness = await publicClient.readContract({
      address: randomnessOracleAddress,
      abi: randomnessOracleAbi,
      functionName: "unsafeGetRandomness",
      args: [timestamp],
    });
    logger.info(`Randomness for  ${timestamp}:`, { message: randomness });
  } catch (error) {
    console.error("Error getting randomness value:", error);
  }
};

// Integrate everything into the service
const runService = async () => {
  // Fetch and post Drand values
  setInterval(async () => {
    const drandValue = await fetchDrandValue();
    const block = await publicClient.getBlock();

    const timestamp_new = Number(block.timestamp);
    if (drandValue) {
        const nonce = await publicClient.getTransactionCount({  
            address: account.address  as `0x${string}`
          })


        await postDrandValue(timestamp_new, drandValue, nonce);
      }
  }, 3000);

  // Generate and post commitments
  generateAndPostCommitments();

  const unwatch = publicClient.watchBlocks({
    emitMissed: true, 
    onBlock: async (block) => {
      logger.info(
        chalk.magenta("================NEW BLOCK STARTED================")
      );
      logger.info("BLOCK NUMBER", { message: block.number });
      logger.info("BLOCK TIMESTAMP", { message: block.timestamp });
      await getRandomness(Number(block.timestamp));
    },
  });
};

// Start the service
runService();
