# hc_drand


# How to run


```
pnpm install
```

in a new terminal windows 
```
pnpm start:anvil
```

in another terminal window
```
pnpm backend:all
```

if for some reason you don't see any tx related output in your terminal:

- check .env files in packages/backend/ts and packages/contracts/drandOracle
-  drandOracle/.env file should have a valid private key
-  run `"forge script script/Deploy.sol --rpc-url http://localhost:8545 --broadcast"` inside contracts/drandOracle
-  ts/.env file should have all the correct smart contract addresses from previous output.
-  run "yarn build" && "node ./dist/main.js" from backend/ts folder
    

