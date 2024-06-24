import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Path to the .env file
const envFilePath = './.env'; // Adjust this if .env is in a different location

// Function to deploy contracts and capture output
const deployContracts = () => {
  exec('cd ../../contracts/DrandOracle/ && forge script ./script/Deploy.sol --broadcast', (error: Error | null, stdout: string, stderr: string) => {
    if (error) {
      console.error(`Error deploying contracts: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }
console.log("stdout_",stdout);
    // Capture the contract addresses from the stdout
    const drandAddressMatch = stdout.match(/DrandOracle deployed at: (0x[a-fA-F0-9]{40})/);
    const sequencerAddressMatch = stdout.match(/SequencerRandomOracle deployed at: (0x[a-fA-F0-9]{40})/);
    const randomnessAddressMatch = stdout.match(/RandomnessOracle deployed at: (0x[a-fA-F0-9]{40})/);

    if (!drandAddressMatch || !sequencerAddressMatch || !randomnessAddressMatch) {
      console.error('Failed to capture one or more contract addresses.');
      return;
    }

    const drandAddress = drandAddressMatch[1];
    const sequencerAddress = sequencerAddressMatch[1];
    const randomnessAddress = randomnessAddressMatch[1];

    // Read the existing .env file
    fs.readFile(envFilePath, 'utf8', (err: NodeJS.ErrnoException | null, data: string) => {
      if (err) {
        console.error(`Error reading .env file: ${err.message}`);
        return;
      }

      // Update the contract addresses in the .env content
      let envContent = data;
      envContent = envContent.replace(/DRAND_ORACLE_ADDRESS=.*/g, `DRAND_ORACLE_ADDRESS=${drandAddress}`);
      envContent = envContent.replace(/SEQUENCER_RANDOM_ORACLE_ADDRESS=.*/g, `SEQUENCER_RANDOM_ORACLE_ADDRESS=${sequencerAddress}`);
      envContent = envContent.replace(/RANDOMNESS_ORACLE_ADDRESS=.*/g, `RANDOMNESS_ORACLE_ADDRESS=${randomnessAddress}`);

      // Write the updated content back to the .env file
      fs.writeFile(envFilePath, envContent, (writeErr: NodeJS.ErrnoException | null) => {
        if (writeErr) {
          console.error(`Error writing to .env file: ${writeErr.message}`);
          return;
        }
        console.log('Contract addresses updated in .env file successfully.');
      });
    });
  });
};

// Execute the deployment and capture process
deployContracts();
