# Deposits

Pleae make sure to finish the [Setup](00_setup.md) before to set all the necessary env variables.

You can check if things are working by calling:

```shell
cast call $BRIDGEHUB_ADDRESS "getZKChain(uint256)(address)" $L2_CHAIN_ID
```
You should get some address in response.


Let's create a new address, and try to deposit some assets there:

```
Successfully created new keypair.
Address:     0xF3F011F9Ab6252F9Aad3A472E47D365E85e33437
Private key: 0x21ec325365e1c2bd3009c6ee319aa2016a089c3636e4c6c376fabe1fd6fa4d66
```

```shell
export DESTINATION_ADDRESS=0xF3F011F9Ab6252F9Aad3A472E47D365E85e33437
```

```shell
cast balance -r http://localhost:3050 $DESTINATION_ADDRESS
# response should be 0
```

To do this, we'll have to call the Bridgehub on L1, pass it some funds, and tell it to pass them over to a given account on L2.
In reality this call is a lot more powerful (as we can not only pass the funds but also call the methods on L2, but let's just do a funds tranfer for now).

You can also checkout the era-contracts repository to see the contract details that we'll be executing.
Make sure to pick the right branch (probably something like zkos-v0.29.3 etc).

We are going to use "requestL2TransactionDirect" from "Bridgehub.sol", and we have to pass there:

```solidity
struct L2TransactionRequestDirect {
  uint256 chainId;       // This will be our L2 chain id
  uint256 mintValue;     // how many tokens should be "created" on L2 chain (see explanations below)
  address l2Contract;    // L2 contract -- this will be our new account
  uint256 l2Value;       // how much value should we pass it it (see explanations below)
  bytes l2Calldata;      // Calldata will be 0x (as we're just passing value)
  uint256 l2GasLimit;    // gas limit for this call 
  uint256 l2GasPerPubdataByteLimit; // This is zksync specific
  bytes[] factoryDeps;   // Empty for now - this would be needed if we wanted to deploy some contract
  address refundRecipient; // Where should "rest" of the tokens go.
}
```

### Understanding mint value, l2 value etc.

When you do the call, then you as a user are saying:

Please mint me `mintValue` tokens on L2 chain, and then call the `l2Contract` and using `l2GasLimit` with `l2Value` tokens.
All the remaining tokens (so `mintValue - l2Value - usedGas*gasPrice`) please put into `refundRecipient` addess on L2.

You can see in the commands below, on how it works in practice.

### Creating deposit transaction

Let's say we want to sent 50 gwei to that new account on L2.

We'll start by doing "cast call" (think about it as "dry-runs").

We wanted to mint 50 gwei, pass it to new account (l2 value == 50), and anything remaining should go back to our rich account (refund recipient.)

```shell
# This will fail
cast call  $BRIDGEHUB_ADDRESS "requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))" '(270,50,0xF3F011F9Ab6252F9Aad3A472E47D365E85e33437,50,0x,100000,800,[],0x36615Cf349d7F6344891B1e7CA7C72883F5dc049)'
```

And this will fail with:

```
Error: server returned an error response: error code 3: execution reverted: J   D12, data: "0x4a09443100000000000000000000000000000000000000000000000000000000000000320000000000000000000000000000000000000000000000000000000000000000"
```

Great - let's learn how to debug these things. `0x4a094431` is our error selector, when you look it up in the code, you'll see:

```
error MsgValueMismatch(uint256 expectedMsgValue, uint256 providedMsgValue);
```

And the issue is - that we wanted to mint things - but we forgot to actually pass the ETH on L1.. Ups, let's fix that by adding "--value" to our call.

```shell
# We added the value to the call.
# This will fail again.
cast call  $BRIDGEHUB_ADDRESS "requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))" '(270,50,0xF3F011F9Ab6252F9Aad3A472E47D365E85e33437,50,0x,100000,800,[],0x36615Cf349d7F6344891B1e7CA7C72883F5dc049)' --value 50
```
And now it fails with:
```
// 0xb385a3da
error MsgValueTooLow(uint256 required, uint256 provided);
```
And you can see that minimal value is set to `25_000_000_000_050`


```shell
cast call  $BRIDGEHUB_ADDRESS "requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))" '(270,50,0xF3F011F9Ab6252F9Aad3A472E47D365E85e33437,50,0x,100000,800,[],0x36615Cf349d7F6344891B1e7CA7C72883F5dc049)' --value 25000000000050
# Error: Msg Value mismatch.
```

Ah right, we passed a lot more "value" in "--value" param, but we didn't tell it it mint it on L2 (second parameter). So as a safety precaution, the contract has returned the error.

Let's increase it and try again:

```shell
cast call  $BRIDGEHUB_ADDRESS "requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))" '(270,25000000000050,0xF3F011F9Ab6252F9Aad3A472E47D365E85e33437,50,0x,100000,800,[],0x36615Cf349d7F6344891B1e7CA7C72883F5dc049)' --value 25000000000050
# Error: ValidateTx not enough gas
```

So here we assumed that our L2 transcation should have 100_000 gas, but that was not enough. Let's increase it to 300k.

```shell
cast call  $BRIDGEHUB_ADDRESS "requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))" '(270,25000000000050,0xF3F011F9Ab6252F9Aad3A472E47D365E85e33437,50,0x,300000,800,[],0x36615Cf349d7F6344891B1e7CA7C72883F5dc049)' --value 25000000000050
# MsgValueTooLow
```

Oh right, we not want to use more gas on L2, so we have to mint more tokens on L2. This means that we have to increase both the second argument (L2TokenMint) - and remember to increase the value that we're passing (otherwise we'll hit MsgValueMismatch).

```shell
cast call  $BRIDGEHUB_ADDRESS "requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))" '(270,75000000000050,0xF3F011F9Ab6252F9Aad3A472E47D365E85e33437,50,0x,300000,800,[],0x36615Cf349d7F6344891B1e7CA7C72883F5dc049)' --value 75000000000050
# Success!!
```

Success - so let's execute for real.

```shell
cast send  $BRIDGEHUB_ADDRESS "requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))" '(270,75000000000050,0xF3F011F9Ab6252F9Aad3A472E47D365E85e33437,50,0x,300000,800,[],0x36615Cf349d7F6344891B1e7CA7C72883F5dc049)' --value 75000000000050  --private-key $PRIVATE_KEY
# This one will actually fail - which is a bad surprise, as it requires us to specify a little bit more gas (82500523200050).
# Still have to debug why.
```

But adding more mint + more value:

```shell
cast send  $BRIDGEHUB_ADDRESS "requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))" '(270,82500523200050,0xF3F011F9Ab6252F9Aad3A472E47D365E85e33437,50,0x,300000,800,[],0x36615Cf349d7F6344891B1e7CA7C72883F5dc049)' --value 82500523200050 --private-key $PRIVATE_KEY
# Success !!
```

And now we can verify:

```shell
cast balance -r http://localhost:3050 $DESTINATION_ADDRESS
# Should return 50
```


## Seeing details of the transaction

We can also check how this transaction looked on L2.
If you look at the latest block:

```shell
cast block -r http://localhost:3050 
```

You can see one transaction - this will be this transaction coming from L1:

```
transactions:        [
        0x39182ca4b72da298618a7a8a28d18ca241950a0595e0dc50538eddc13cda7f55
]
```
And you can see it details:

```shell
cast receipt -r http://localhost:3050 0x39182ca4b72da298618a7a8a28d18ca241950a0595e0dc50538eddc13cda7f55
```

In my case, you can notice that it used:

```
gasUsed              98400
```

And the remaining unused gas (we passed 300k) would be refunded as tokens into the `refundAddress`.

0x69ecC00Df9d098907Cc952F961D45Eef0b517Ab2

You can check it out by calling the transfer again - but this time setting some "brand new" address as refund:

```
cast send  $BRIDGEHUB_ADDRESS "requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))" '(270,82500523200050,0xF3F011F9Ab6252F9Aad3A472E47D365E85e33437,50,0x,300000,800,[],0x69ecC00Df9d098907Cc952F961D45Eef0b517Ab2)' --value 82500523200050 --private-key $PRIVATE_KEY
```

```
cast balance -r http://localhost:3050 0x69ecC00Df9d098907Cc952F961D45Eef0b517Ab2
# result: 55440422143200
```
