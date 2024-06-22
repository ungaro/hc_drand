import * as dotenv from 'dotenv';

import { createPublicClient, http } from 'viem';
import { anvil } from 'viem/chains';
import ky from 'ky';


//import { privateKeyToAccount } from 'viem/accounts'


import DrandOracleABIJson from '../../../contracts/DrandOracle/out/DrandOracle.sol/DrandOracle.json' with { type: "json" };; // This import style requires "esModuleInterop", see "side notes"
import SequencerRandomOracleABIJson from '../../../contracts/DrandOracle/out/SequencerRandomOracle.sol/SequencerRandomOracle.json' with { type: "json" };; // This import style requires "esModuleInterop", see "side notes"
import randomnessOracleABIJson from '../../../contracts/DrandOracle/out/RandomnessOracle.sol/RandomnessOracle.json' with { type: "json" };; // This import style requires "esModuleInterop", see "side notes"





dotenv.config();



export const publicClient = createPublicClient({
  chain: anvil,
  transport: http(process.env.RPC_URL),
})

/*
const walletClient = createWalletClient({
  transport: http(process.env.RPC_URL)
})
*/
//const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') 



const drandOracleAddress = process.env.DRAND_ORACLE_ADDRESS as `0x${string}`;
const sequencerRandomOracleAddress = process.env.SEQUENCER_RANDOM_ORACLE_ADDRESS as `0x${string}`;
const randomnessOracleAddress = process.env.RANDOMNESS_ORACLE_ADDRESS as `0x${string}`;

/*
const drandOracleAbi = [
  "function unsafeGetDrandValue(uint256 _timestamp) public view returns (bytes32)",
  "function willBeAvailable(uint256 _timestamp) public view returns (bool)"
];*/

//console.log("DrandOracleABIJson.abi",DrandOracleABIJson.abi);

const drandOracleAbi = DrandOracleABIJson.abi;
const sequencerRandomOracleAbi = SequencerRandomOracleABIJson.abi;
const randomnessOracleAbi = randomnessOracleABIJson.abi;
/*
const randomnessOracleAbi = [
  "function unsafeGetRandomness(uint256 _timestamp) public view returns (bytes32)",
  "function willBeAvailable(uint256 _timestamp) public view returns (bool)"
];
*/
//const drandOracle = new ethers.Contract(drandOracleAddress, drandOracleAbi, client);
/*
const drandOracle = getContract({
  address: drandOracleAddress,
  abi: drandOracleAbi,
  client: { public: publicClient, wallet: walletClient }
});

const sequencerRandomOracle = getContract({
  address: sequencerRandomOracleAddress,
  abi: sequencerRandomOracleAbi,
  client: { public: publicClient, wallet: walletClient }
});

const randomnessOracle = getContract({
  address: randomnessOracleAddress,
  abi: randomnessOracleAbi,
  client: { public: publicClient, wallet: walletClient }
});
*/
//const sequencerRandomOracle = new ethers.Contract(sequencerRandomOracleAddress, sequencerRandomOracleAbi, client);
//const randomnessOracle = new ethers.Contract(randomnessOracleAddress, randomnessOracleAbi, client);

const getDrandValue = async (timestamp: number): Promise<void> => {
  console.log("getDrandValue_timestamp",timestamp);
  console.log("drandOracleAddress",drandOracleAddress);
  



  try {
    const drandValue = await publicClient.readContract({
      address: drandOracleAddress,
      abi: drandOracleAbi,
      functionName: 'unsafeGetDrandValue',
      //functionName: 'getDrandValue',
      args: [timestamp]
    });
    console.log(`Drand value for ${timestamp}:`, drandValue);
  } catch (error) {
    console.error('Error getting Drand value:', error);
  }
};

const getSequencerRandom = async (timestamp: number): Promise<void> => {
  try {
    const sequencerRandom = await publicClient.readContract({
      address: sequencerRandomOracleAddress,
      abi: sequencerRandomOracleAbi,
      functionName: 'unsafeGetSequencerRandom',
      args: [timestamp]
    });
    console.log(`Sequencer random for ${timestamp}:`, sequencerRandom);
  } catch (error) {
    console.error('Error getting sequencer random value:', error);
  }
};

const getRandomness = async (timestamp: number): Promise<void> => {
  try {
    const randomness = await publicClient.readContract({
      address: randomnessOracleAddress,
      abi: randomnessOracleAbi,
//      functionName: 'unsafeGetRandomness',
      functionName: 'unsafeGetRandomness',
      args: [timestamp]
    });
    console.log(`Randomness for ${timestamp}:`, randomness);
  } catch (error) {
    console.error('Error getting randomness value:', error);
  }
};


console.log("BLOCK_LISTENER_START");


console.log("DEBUG::::",publicClient.chain?.name);
console.log("DEBUG::::",await publicClient.getBlockNumber());



setInterval(async () => {


  const block = await publicClient.getBlock() 
  //console.log("block",block);
  //console.log("block_timestamp",block.timestamp);
  //console.log("block_timestamp",Number(block.timestamp));

  await getDrandValue(Number(block.timestamp));


}, 1000);

/*
//@ts-ignore
const unwatch = publicClient.watchBlocks( 
  { onBlock: async block => {
    console.log("BLOCK_LISTENER_START1");


//    console.log("BLOCK",block)

//const timestamp = parseInt('1718958448', 16);
//const timestamp = parseInt('1718958523');

    await getDrandValue(Number(block.timestamp));
    //await getSequencerRandom(timestamp);
    //await getRandomness(timestamp);




  } }
);
*/
console.log("BLOCK_LISTENER_END");

/*
publicClient.watchBlocks('newBlockHeaders', async (blockHeader: any) => {
  const blockNumber = blockHeader.number;
  const block = await publicClient.request({ method: 'eth_getBlockByNumber', params: [blockNumber, false] });
  const timestamp = parseInt(block.timestamp, 16);
  await getDrandValue(timestamp);
  await getSequencerRandom(timestamp);
  await getRandomness(timestamp);
});


*/
    /*
        //console.log(block);

    const blockNumber = blockHeader.number;
    const block = await publicClient.request({ method: 'eth_getBlockByNumber', params: [blockNumber, false] });
//const timestamp = parseInt('2022-01-03T22:59:39.000Z', 16);

    await getDrandValue(timestamp);
    await getSequencerRandom(timestamp);
    await getRandomness(timestamp);

*/    
console.log('Listening for new blocks...');