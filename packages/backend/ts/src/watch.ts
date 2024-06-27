import * as dotenv from "dotenv";
import * as winston from "winston";
import chalk from "chalk";
import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
  keccak256,
  bytesToHex,
  parseAbi,
  TransactionExecutionError,
  type GetBlockNumberErrorType 
} from "viem";
import { BaseError, ContractFunctionRevertedError } from "viem";

import { anvil } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { randomBytes } from "crypto";
import ky from "ky";
import { createNonceManager } from "./createNonceManager.js";

dotenv.config();

// Logger setup
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.colorize({ all: true }),
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
    winston.format.printf(
      ({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`
    )
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "backend.log" }),
  ],
});

import DrandOracleABIJson from "../../../contracts/DrandOracle/out/DrandOracle.sol/DrandOracle.json" with { type: "json" }; // This import style requires "esModuleInterop", see "side notes"
import SequencerRandomOracleABIJson from "../../../contracts/DrandOracle/out/SequencerRandomOracle.sol/SequencerRandomOracle.json" with { type: "json" }; // This import style requires "esModuleInterop", see "side notes"
import randomnessOracleABIJson from "../../../contracts/DrandOracle/out/RandomnessOracle.sol/RandomnessOracle.json" with { type: "json" }; // This import style requires "esModuleInterop", see "side notes"

// Constants
const DRAND_URL = process.env.DRAND_URL || "https://api.drand.sh";
const DRAND_CHAIN = process.env.DRAND_CHAIN;
const DRAND_GENESIS_TIMESTAMP = parseInt(
  process.env.DRAND_GENESIS_TIMESTAMP || "1692803367"
);
const DRAND_INTERVAL = parseInt(process.env.DRAND_INTERVAL || "3");
const BLOCK_TIME = parseInt(process.env.BLOCK_TIME || "2");
const DELAY = parseInt(process.env.DELAY || "9");
const SEQUENCER_COMMIT_DELAY = parseInt(
  process.env.SEQUENCER_COMMIT_DELAY || "10"
);
const SEQUENCER_PRECOMMIT_DELAY = 10; // Adjust this value as needed

const DRAND_TIMEOUT = parseInt(process.env.DRAND_TIMEOUT || "10");
const DRAND_DELAY = parseInt(process.env.DRAND_TIMEOUT || "6");

const SEQUENCER_TIMEOUT = parseInt(process.env.SEQUENCER_TIMEOUT || "10");
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "5");
const INITIAL_BACKOFF = parseInt(process.env.INITIAL_BACKOFF || "1000");

const drandOracleAddress = process.env.DRAND_ORACLE_ADDRESS as `0x${string}`;
const sequencerRandomOracleAddress = process.env
  .SEQUENCER_RANDOM_ORACLE_ADDRESS as `0x${string}`;
const randomnessOracleAddress = process.env
  .RANDOMNESS_ORACLE_ADDRESS as `0x${string}`;

const drandOracleAbi = DrandOracleABIJson.abi;
const sequencerRandomOracleAbi = SequencerRandomOracleABIJson.abi;
const randomnessOracleAbi = randomnessOracleABIJson.abi;

interface DrandResponse {
  round: number;
  randomness: string;
  signature: string;
}

interface PendingTransaction {
  type: "drand" | "commitment" | "reveal";
  hash: `0x${string}`;
  timestamp: number;
  nonce: number;
  submittedAt: number;
  data?: any; // Additional data needed for replacement
}
interface QueuedTransaction {
  type: "drand" | "commitment" | "reveal";
  timestamp: number;
  value: string;
  retries: number;
}

// Clients setup
const account = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  //{ nonceManager }
);

// we're going to use websockets because we want to be fast, we can failover to http if websocket is not available.
const publicClient = createPublicClient({
  chain: anvil,
  //transport: http(process.env.RPC_URL),
  transport: webSocket(process.env.RPC_URL, {
    reconnect: true,
    retryCount: 100,
  }),
});

// we're going to use websockets because we want to be fast, we can failover to http if websocket is not available.
const walletClient = createWalletClient({
  account,
  chain: anvil,
  //  transport: http(process.env.RPC_URL),
  transport: webSocket(process.env.RPC_URL, {
    reconnect: true,
    retryCount: 100,
  }),
});

// Transaction queue
let transactionQueue: QueuedTransaction[] = [];

// Pending tx queue
const pendingTransactions: PendingTransaction[] = [];

const sequencerRandomnessCache = new Map<number, string>();
const processedDrandTimestamps = new Set<number>();

const MAX_TRANSACTION_TIME = 60000; // 60 seconds
const GAS_PRICE_BUMP_PERCENTAGE = 10; // 10% increase

const nonceManager = createNonceManager({
  client: publicClient,
  address: account.address,
});

const calculateDrandRound = (timestamp: number): number => {
  return Math.floor((timestamp - DRAND_GENESIS_TIMESTAMP) / DRAND_INTERVAL);
};

const fetchDrandValue = async (round: number): Promise<string | null> => {
  try {
    const response: DrandResponse = await ky
      .get(`${DRAND_URL}/${DRAND_CHAIN}/public/${round}`)
      .json();
    logger.info(
      `Fetched Drand value for round ${round}: ${response.randomness}`
    );
    return response.randomness;
  } catch (error) {
    logger.error(`Error fetching Drand value for round ${round}: ${error}`);
    return null;
  }
};

const hexToBytes32 = (hex: string): `0x${string}` => {
  return `0x${hex.padStart(64, "0")}` as `0x${string}`;
};

const addToTransactionQueue = (transaction: QueuedTransaction) => {
  transactionQueue.push(transaction);
  processTransactionQueue();
};

const processTransactionQueue = async () => {
  if (transactionQueue.length === 0) return;
  const transaction = transactionQueue[0];
  console.log("TX_TYPE", transaction.type);

  try {
    switch (transaction.type) {
      case "drand":
        await postDrandValue(transaction.timestamp, transaction.value);
        break;
      case "commitment":
        await postCommitment(transaction.timestamp, transaction.value);
        break;
      case "reveal":
        await revealSequencerRandomness(transaction.timestamp);
        break;
    }
    transactionQueue.shift(); // Remove the processed transaction
  } catch (error) {
    if (error instanceof TransactionExecutionError) {
      logger.error(
        `Contract error for ${transaction.type} at timestamp ${transaction.timestamp}: ${error.message}`
      );
      transactionQueue.shift();
    } else {
      logger.error(`Error processing transaction: ${error}`);
      if (transaction.retries < MAX_RETRIES) {
        transaction.retries++;
        setTimeout(
          () => processTransactionQueue(),
          INITIAL_BACKOFF * Math.pow(2, transaction.retries)
        );
      } else {
        logger.error(
          `Max retries reached for transaction: ${JSON.stringify(transaction)}`
        );
        transactionQueue.shift(); // Remove the failed transaction
      }
    }
  }

  // Process next transaction in queue
  processTransactionQueue();
};

const submitTransaction = async (
  type: PendingTransaction["type"],
  timestamp: number,
  contractCall: () => Promise<`0x${string}`>,
  additionalData?: any
): Promise<void> => {
  try {
    //await nonceManager.resetNonce();
    const nonce = nonceManager.nextNonce();
    const txHash = await contractCall();

    pendingTransactions.push({
      type,
      hash: txHash,
      timestamp,
      nonce,
      submittedAt: Date.now(),
      data: additionalData,
    });

    // Useful for debugging
    logger.info(
      `Submitted ${type} transaction for timestamp ${timestamp}. Hash: ${txHash}`
    );
  } catch (error) {
    if (nonceManager.shouldResetNonce(error)) {
      await nonceManager.resetNonce();
      //logger.warn(`Nonce reset due to error: ${error}`);

      logger.error(`Nonce reset due to error.`);
      // Retry the transaction
      await submitTransaction(type, timestamp, contractCall, additionalData);
    } else {
      if (error instanceof BaseError) {
        const revertError = error.walk(
          (err) => err instanceof ContractFunctionRevertedError
        );
        if (revertError instanceof ContractFunctionRevertedError) {
          const errorName = revertError.data?.errorName ?? "";
          logger.error(
            `Contract revert error: ${errorName}, args: ${revertError.data?.args}`
          );
        }
      }

      //logger.error(`Error submitting ${type} transaction: ${error}`);
    }
  }
};

const isDrandAvailable = async (timestamp: number): Promise<boolean> => {
  try {
    const isAvailable = await publicClient.readContract({
      address: drandOracleAddress,
      abi: drandOracleAbi,
      functionName: "willBeAvailable",
      args: [BigInt(timestamp)],
    });
    return isAvailable as boolean;
  } catch (error) {
    console.error(
      `Error checking availability for Drand value at ${timestamp}:`,
      error
    );
    return false;
  }
};

const postDrandValue = async (
  timestamp: number,
  drandValue: string
): Promise<void> => {
  if (processedDrandTimestamps.has(timestamp)) {
    //this creates too much log, maybe add only to file log.
    //logger.info(`Drand value for ${timestamp} has already been processed, skipping.`);
    return;
  }

  const drandValueBytes32 = hexToBytes32(drandValue);
  await submitTransaction(
    "drand",
    timestamp,
    async () => {
      const tx = await walletClient.writeContract({
        account,
        address: drandOracleAddress,
        abi: drandOracleAbi,
        functionName: "setDrand",
        args: [BigInt(timestamp), drandValueBytes32],
        maxFeePerGas: await publicClient.estimateMaxPriorityFeePerGas(),
      });
      return tx;
    },
    { drandValue }
  );

  processedDrandTimestamps.add(timestamp);
};

const processPendingTransactions = async () => {
  const currentTime = Date.now();

  for (let i = 0; i < pendingTransactions.length; i++) {
    const tx = pendingTransactions[i];

    try {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx.hash,
        timeout: 5000, // Short timeout to quickly check status
      });

      //useful debug info
      logger.info(`Transaction ${tx.hash} for ${tx.type} at ${tx.timestamp} confirmed`);
      pendingTransactions.splice(i, 1);
      i--;
    } catch (error) {
      if (currentTime - tx.submittedAt > MAX_TRANSACTION_TIME) {
        logger.warn(
          `Transaction ${tx.hash} for ${tx.type} at ${tx.timestamp} is taking too long. Attempting replacement.`
        );

        try {
          const newGasPrice = await bumpGasPrice(tx.hash);
          const newTxHash = await replaceTransaction(tx, newGasPrice);

          logger.info(`Replaced transaction ${tx.hash} with ${newTxHash}`);
          pendingTransactions[i] = {
            ...tx,
            hash: newTxHash,
            submittedAt: currentTime,
          };
        } catch (replaceError) {
          logger.error(
            `Failed to replace transaction ${tx.hash}: ${replaceError}`
          );
        }
      }
    }
  }
};

// Function to replace a transaction
const replaceTransaction = async (
  tx: PendingTransaction,
  newGasPrice: bigint
): Promise<`0x${string}`> => {
  switch (tx.type) {
    case "drand":
      const drandValueBytes32 = hexToBytes32(tx.data.drandValue);
      return await walletClient.writeContract({
        account,
        address: drandOracleAddress,
        abi: drandOracleAbi,
        functionName: "setDrand",
        args: [BigInt(tx.timestamp), drandValueBytes32],
        maxFeePerGas: newGasPrice,
        nonce: tx.nonce,
      });

    case "commitment":
      return await walletClient.writeContract({
        address: sequencerRandomOracleAddress,
        abi: sequencerRandomOracleAbi,
        functionName: "postCommitment",
        args: [BigInt(tx.timestamp), tx.data.commitment as `0x${string}`],
        maxFeePerGas: newGasPrice,
        nonce: tx.nonce,
      });

    case "reveal":
      return await walletClient.writeContract({
        address: sequencerRandomOracleAddress,
        abi: sequencerRandomOracleAbi,
        functionName: "reveal",
        args: [BigInt(tx.timestamp), tx.data.randomValue as `0x${string}`],
        maxFeePerGas: newGasPrice,
        nonce: tx.nonce,
      });

    default:
      throw new Error(
        `Unsupported transaction type for replacement: ${tx.type}`
      );
  }
};

// Function to bump gas price
const bumpGasPrice = async (txHash: `0x${string}`): Promise<bigint> => {
  const tx = await publicClient.getTransaction({ hash: txHash });
  const currentGasPrice = tx.maxFeePerGas || tx.gasPrice;
  if (!currentGasPrice)
    throw new Error("Unable to determine current gas price");

  const bumpAmount =
    (currentGasPrice * BigInt(GAS_PRICE_BUMP_PERCENTAGE)) / BigInt(100);
  return currentGasPrice + bumpAmount;
};

const cleanupProcessedDrandTimestamps = () => {
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const cutoffTimestamp = currentTimestamp - DRAND_TIMEOUT;

  for (const timestamp of processedDrandTimestamps) {
    if (timestamp < cutoffTimestamp) {
      processedDrandTimestamps.delete(timestamp);
    }
  }
};

const postCommitment = async (
  timestamp: number,
  commitment: string
): Promise<void> => {
  await submitTransaction(
    "commitment",
    timestamp,
    async () => {
      const tx = await walletClient.writeContract({
        address: sequencerRandomOracleAddress,
        abi: sequencerRandomOracleAbi,
        functionName: "postCommitment",
        args: [BigInt(timestamp), commitment as `0x${string}`],
        maxFeePerGas: await publicClient.estimateMaxPriorityFeePerGas(),
      });
      return tx;
    },
    { commitment }
  );

  logger.info(`Posted commitment for ${timestamp}: ${commitment}`);
};

const revealValue = async (timestamp: number, value: string): Promise<void> => {
  try {
    await submitTransaction(
      "reveal",
      timestamp,
      async () => {
        const tx = await walletClient.writeContract({
          address: sequencerRandomOracleAddress,
          abi: sequencerRandomOracleAbi,
          functionName: "reveal",
          args: [BigInt(timestamp), value as `0x${string}`],
          maxFeePerGas: await publicClient.estimateMaxPriorityFeePerGas(),
        });
        return tx;
      },
      { value }
    );

    logger.info(`Revealed value for ${timestamp}: ${value}`);
    //   await publicClient.waitForTransactionReceipt({ hash: tx });
  } catch (error) {
    logger.error(`Error revealing value for ${timestamp}: ${error}`);
    throw error;
  }
};

const generateAndPostCommitments = async (
  blockTimestamp: number
): Promise<void> => {
  const commitmentTimestamp = blockTimestamp + SEQUENCER_PRECOMMIT_DELAY;
  const randomValue = bytesToHex(randomBytes(32));
  const commitment = keccak256(randomValue as `0x${string}`);

  logger.info(
    `Generated commitment and random value for ${commitmentTimestamp}: ${commitment} / ${randomValue}`
  );

  sequencerRandomnessCache.set(commitmentTimestamp, randomValue);

  try {
    await postCommitment(commitmentTimestamp, commitment);
  } catch (error) {
    logger.error(
      `Failed to post commitment for ${commitmentTimestamp}: ${error}`
    );
  }
};

const backfillSequencerValues = async (currentTimestamp: number) => {
  //console.log("backfillSequencerValues___", currentTimestamp);
  for (
    let t = currentTimestamp;
    t <= currentTimestamp + SEQUENCER_PRECOMMIT_DELAY + BLOCK_TIME;
    t += 2
  ) {
    if (!sequencerRandomnessCache.has(t)) {
      const randomValue = bytesToHex(randomBytes(32));
      const commitment = keccak256(randomValue as `0x${string}`);
      sequencerRandomnessCache.set(t, randomValue);
      logger.info(`Backfilled sequencer randomness for ${t}: ${randomValue}`);

      try {
        await postCommitment(t, commitment);
      } catch (error) {
        if (
          error instanceof TransactionExecutionError &&
          error.message.includes("Commitment is too late")
        ) {
          logger.warn(`Commitment for ${t} was too late, skipping.`);
        } else {
          logger.error(
            `Failed to post backfilled commitment for ${t}: ${error}`
          );
        }
      }
    }
  }
};

const revealSequencerValue = async (timestamp: number) => {
  const randomValue = sequencerRandomnessCache.get(timestamp);
  if (!randomValue) {
    logger.warn(
      `No cached sequencer value available for revealing at timestamp ${timestamp}`
    );
    return;
  }

  try {
    console.log("REVEALING", timestamp, randomValue);
    await walletClient.writeContract({
      address: sequencerRandomOracleAddress,
      abi: sequencerRandomOracleAbi,
      functionName: "reveal",
      nonce: nonceManager.nextNonce(),
      args: [BigInt(timestamp), randomValue as `0x${string}`],
      maxFeePerGas: await publicClient.estimateMaxPriorityFeePerGas(),
    });
    logger.info(`Revealed sequencer value for ${timestamp}: ${randomValue}`);
  } catch (error) {
    logger.error(`Failed to reveal sequencer value for ${timestamp}: ${error}`);
  }
};

const getRandomness = async (timestamp: number): Promise<void> => {
  try {
    const randomness = await publicClient.readContract({
      address: randomnessOracleAddress,
      abi: randomnessOracleAbi,
      functionName: "getRandomness",
      args: [BigInt(timestamp)],
    });

    //    chalk.magenta(`Randomness for ${timestamp}: ${randomness}`)
    logger.info(
      chalk.magenta(`Got Randomness for ${timestamp}: ${randomness}`)
    );

    logger.info(`Randomness for ${timestamp}: ${randomness}`);

    const willBeAvailable = await publicClient.readContract({
      address: randomnessOracleAddress,
      abi: randomnessOracleAbi,
      functionName: "willBeAvailable",
      args: [BigInt(timestamp)],
    });
    logger.info(
      `Randomness will be available for ${timestamp}: ${willBeAvailable}`
    );
  } catch (err) {
    if (err instanceof BaseError) {
      const revertError = err.walk(
        (err) => err instanceof ContractFunctionRevertedError
      );
      if (revertError instanceof ContractFunctionRevertedError) {
        const errorName = revertError.data?.errorName ?? "";
        const revertReason = revertError.data?.args ?? "";
        // do something with `errorName`
        //console.log("ERRORNAME",revertReason);
        //console.log("ERRORNAME",revertReason[0]);
        logger.error(`Error getting randomness value for ${timestamp}`, {
          message: revertReason[0],
        });
      }
    }

    // logger.error(`Error getting randomness value for ${timestamp}: ${error}`);
  }
};

const backfillMissingValues = async (): Promise<void> => {
  //console.log("BACKFILLING VALUES");

  try {
    const currentBlock = await publicClient.getBlock({ blockTag: "latest" });


  const currentTimestamp = Number(currentBlock.timestamp);

  for (
    // if you start directly from DRAND_TIMEOUT it is guaranteed to fail so we start a little bit later
    let t = currentTimestamp - DRAND_TIMEOUT;
    t <= currentTimestamp;
    t += BLOCK_TIME
  ) {
    //why is t same
    //console.log("BACKFILL for TIMESTAMP", t);

    if (processedDrandTimestamps.has(t)) {
      // creates too much log but useful if you want to debug something
      //logger.info(`Drand value for ${t} has already been processed, skipping.`);

      return;
    } else {
      //const drandAvailable = await isDrandAvailable(t);

      //if (!drandAvailable) {
      const round = calculateDrandRound(t);
      const drandValue = await fetchDrandValue(round);
      if (drandValue) {
        addToTransactionQueue({
          type: "drand",
          timestamp: t,
          value: drandValue,
          retries: 0,
        });
        //processedDrandTimestamps.add(t);
      }
      // }
    }
  }

} catch (e) {
    console.log("ERROR",e);
    const error = e as GetBlockNumberErrorType;
    console.log("ERROR", error);
    return;
  }

};

const generateAndCacheSequencerRandomness = (timestamp: number) => {
  const randomValue = bytesToHex(randomBytes(32));
  const commitment = keccak256(randomValue as `0x${string}`);
  sequencerRandomnessCache.set(timestamp, randomValue);
  logger.info(
    `Generated and cached sequencer randomness for ${timestamp}: ${randomValue}`
  );
  return commitment;
};

const postSequencerCommitment = async (timestamp: number) => {
  const currentTime = Math.floor(Date.now() / 1000);
  if (timestamp <= currentTime + SEQUENCER_PRECOMMIT_DELAY) {
    logger.warn(`Skipping commitment for ${timestamp} as it's too late.`);
    return;
  }

  const commitment = generateAndCacheSequencerRandomness(timestamp);
  try {
    const tx = await walletClient.writeContract({
      address: sequencerRandomOracleAddress,
      abi: sequencerRandomOracleAbi,
      functionName: "postCommitment",
      args: [BigInt(timestamp), commitment],
      maxFeePerGas: await publicClient.estimateMaxPriorityFeePerGas(),
    });
    logger.info(`Posted sequencer commitment for ${timestamp}: ${commitment}`);

    // Add to pending transactions queue
    pendingTransactions.push({
      hash: tx,
      timestamp,
      nonce: nonceManager.nextNonce(),
      submittedAt: new Date().getTime() / 1000,
      type: "commitment",
    });
  } catch (error) {
    logger.error(
      `Error posting sequencer commitment for ${timestamp}: ${error}`
    );
    sequencerRandomnessCache.delete(timestamp);
  }
};
const revealSequencerRandomness = async (timestamp: number): Promise<void> => {
  const randomValue = sequencerRandomnessCache.get(timestamp);
  if (!randomValue) {
    logger.warn(
      `No cached sequencer value available for revealing at timestamp ${timestamp}`
    );
    return;
  }

  try {
    // Check the last revealed timestamp
    const lastRevealedT = await publicClient.readContract({
      address: sequencerRandomOracleAddress,
      abi: sequencerRandomOracleAbi,
      functionName: "getLastRevealedT",
    }) as bigint;
    logger.info(`Last revealed timestamp: ${lastRevealedT}`);

    // Check if commitment exists
    const commitmentData = await publicClient.readContract({
      address: sequencerRandomOracleAddress,
      abi: sequencerRandomOracleAbi,
      functionName: "getCommitment",
      args: [BigInt(timestamp)],
    }) as [string, boolean, bigint];

    const [commitment, revealed, value] = commitmentData;
    logger.info(`Commitment for ${timestamp}: ${commitment}, revealed: ${revealed}, value: ${value}`);

    // Proceed with reveal
    await submitTransaction(
      "reveal",
      timestamp,
      async () => {
        const tx = await walletClient.writeContract({
          address: sequencerRandomOracleAddress,
          abi: sequencerRandomOracleAbi,
          functionName: "reveal",
          args: [BigInt(timestamp), randomValue as `0x${string}`],
          maxFeePerGas: await publicClient.estimateMaxPriorityFeePerGas(),
        });
        return tx;
      },
      { randomValue }
    );

    logger.info(`Revealed sequencer value for ${timestamp}: ${randomValue}`);
  } catch (error) {
    if (error instanceof TransactionExecutionError) {
      logger.error(`Failed to reveal sequencer value for ${timestamp}: ${error.message}`);
    } else {
      logger.error(`Error revealing sequencer value for ${timestamp}: ${error}`);
    }
  }
};

// In your main loop or block processing function
const processSequencerReveals = async (currentTimestamp: number) => {
  const lastRevealedT = await publicClient.readContract({
    address: sequencerRandomOracleAddress,
    abi: sequencerRandomOracleAbi,
    functionName: "getLastRevealedT",
  }) as bigint;

  logger.info(`Current timestamp: ${currentTimestamp}, Last revealed: ${lastRevealedT}`);

  let nextToReveal = Number(lastRevealedT) === 0 ? currentTimestamp - SEQUENCER_TIMEOUT : Number(lastRevealedT) + 2;

  while (nextToReveal <= currentTimestamp - SEQUENCER_TIMEOUT) {
    await revealSequencerRandomness(nextToReveal);
    nextToReveal += 2;
  }
};

// Call this function in your main loop or block processing function




//useful for debugging, not doing anything
const monitorTransactions = async () => {
  publicClient.watchPendingTransactions({
    onTransactions: async (hashes) => {
      for (const hash of hashes) {
        try {
          const receipt = await publicClient.waitForTransactionReceipt({
            hash,
          });
          logger.info(
            `Transaction ${hash} included in block ${receipt.blockNumber}`
          );
        } catch (error) {
          logger.error(`Error monitoring transaction ${hash}: ${error}`);
        }
      }
    },
  });
};

const runService = async (): Promise<void> => {
  await nonceManager.resetNonce();

  // BACKFILL DRAND VALUES
  // Generate Future Commitments

  // wait for some time

  setInterval(async () => {
    try{
    const block = await publicClient.getBlock({ blockTag: "latest" });

    const timestamp = Number(block.timestamp);
    //console.log("THE REAL TIMESTAMP", timestamp);

    const drandRound = calculateDrandRound(timestamp - DRAND_DELAY);
    const drandValue = await fetchDrandValue(drandRound);

    if (drandValue) {
      postDrandValue(timestamp - DRAND_DELAY, drandValue);
      postDrandValue(timestamp - DRAND_DELAY + BLOCK_TIME, drandValue);
      postDrandValue(timestamp - DRAND_DELAY + 2 * BLOCK_TIME, drandValue);
    }

    await processPendingTransactions();
    await backfillMissingValues();
} catch (e) {
    console.log("ERROR",e);

    const error = e as GetBlockNumberErrorType;
    console.log("ERROR", error);
    return;
  }
  }, 1000);

  publicClient.watchBlocks({
    emitMissed: true,
    onBlock: async (block) => {
      logger.info(
        chalk.magenta("================NEW BLOCK STARTED================")
      );
      logger.info(`Block number: ${block.number}`);
      logger.info(`Block timestamp: ${block.timestamp}`);
      await getRandomness(Number(block.timestamp));
      await generateAndPostCommitments(Number(block.timestamp));
      await backfillSequencerValues(Number(block.timestamp));
  //    await revealSequencerValue(Number(block.timestamp));

// Call this function in your main loop or block processing function

  await processSequencerReveals(Number(block.timestamp));
    },
    onError: (error) => logger.error(`Error watching blocks: ${error}`),
  });

  //monitorTransactions();
  setInterval(cleanupProcessedDrandTimestamps, 15000);
};

runService().catch((error) => logger.error(`Service error: ${error}`));
