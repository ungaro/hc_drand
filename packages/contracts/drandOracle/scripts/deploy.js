const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Path to the .env file
const envFilePath = path.join(__dirname, '../../backend/ts/.env');

// Function to deploy contracts and capture output
const deployContracts = () => {
  exec('forge script .script/Deploy.sol --broadcast', (error, stdout, stderr) => {
    if (error) {
      console.error(`Error deploying contracts: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }

    // Capture the contract addresses from the stdout
    const drandAddress = stdout.match(/DrandOracle address: (0x[a-fA-F0-9]{40})/)[1];
    const sequencerAddress = stdout.match(/SequencerRandomOracle address: (0x[a-fA-F0-9]{40})/)[1];
    const randomnessAddress = stdout.match(/RandomnessOracle address: (0x[a-fA-F0-9]{40})/)[1];

    // Read the existing .env file
    fs.readFile(envFilePath, 'utf8', (err, data) => {
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
      fs.writeFile(envFilePath, envContent, (writeErr) => {
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