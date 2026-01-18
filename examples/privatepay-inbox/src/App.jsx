import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeFunctionData,
  encodePacked,
  formatEther,
  getAddress,
  hexToBytes,
  http,
  isAddress,
  keccak256,
  parseEther,
  toHex
} from 'viem';
import {
  BRIDGEHUB_ADDRESS,
  CONTEXT_STRING,
  KEY_DIRECTORY_L1_ADDRESS,
  L1_CHAIN_ID,
  L1_RPC_URL,
  L2_CHAIN_ID,
  L2_GAS_LIMIT,
  L2_GAS_PER_PUBDATA,
  PRIVATEPAY_INBOX_L2_ADDRESS
} from './config.js';
import { prividium } from './prividium.js';
import { keyDirectoryAbi } from './abi/keyDirectoryAbi.js';
import { privatePayInboxAbi } from './abi/privatePayInboxAbi.js';
import {
  bundleCiphertext,
  decryptPayload,
  encryptPayload,
  generateKeyPair
} from './crypto.js';
import { copyToClipboard, formatAddress, formatNumber, formatTimestamp } from './utils.js';

const CONTEXT_HASH = keccak256(toHex(CONTEXT_STRING));
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const MINT_BUFFER_WEI = 50_000_000_000_000n;
const GAS_BUFFER_WEI_PER_UNIT = 1n;
const L1_LOW_BALANCE_THRESHOLD = parseEther('0.001');
const L2_LOW_BALANCE_THRESHOLD = parseEther('0.0001');
const MAX_INLINE_CIPHERTEXT = 220;

const bridgehubAbi = [
  {
    type: 'function',
    name: 'requestL2TransactionDirect',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'chainId', type: 'uint256' },
          { name: 'mintValue', type: 'uint256' },
          { name: 'l2Contract', type: 'address' },
          { name: 'l2Value', type: 'uint256' },
          { name: 'l2Calldata', type: 'bytes' },
          { name: 'l2GasLimit', type: 'uint256' },
          { name: 'l2GasPerPubdataByteLimit', type: 'uint256' },
          { name: 'factoryDeps', type: 'bytes[]' },
          { name: 'refundRecipient', type: 'address' }
        ]
      }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'l2TransactionBaseCost',
    stateMutability: 'view',
    inputs: [
      {
        name: 'request',
        type: 'tuple',
        components: [
          { name: 'chainId', type: 'uint256' },
          { name: 'gasPrice', type: 'uint256' },
          { name: 'l2GasLimit', type: 'uint256' },
          { name: 'l2GasPerPubdataByteLimit', type: 'uint256' },

        ]
      }
    ],
    outputs: []

  }


];

const l1Chain = defineChain({
  id: L1_CHAIN_ID,
  name: 'L1',
  nativeCurrency: {
    name: 'ETH',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [L1_RPC_URL]
    }
  }
});

function randomHex32() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

async function ensureChain(walletClient, requiredChainId, label) {
  if (!walletClient) {
    return { ok: false, message: 'Wallet not connected.' };
  }
  const currentChainId = await walletClient.getChainId();
  if (Number(currentChainId) === Number(requiredChainId)) {
    return { ok: true, message: '' };
  }
  try {
    await walletClient.switchChain({ id: requiredChainId });
    return { ok: true, message: '' };
  } catch (error) {
    console.error('Failed to switch chain', error);
    return {
      ok: false,
      message: `Wrong network. Please switch your wallet to ${label} (chain ${requiredChainId}).`
    };
  }
}

function getL1ExplorerTxUrl(hash) {
  if (!hash) return '';
  if (Number(L1_CHAIN_ID) === 11155111) {
    return `https://sepolia.etherscan.io/tx/${hash}`;
  }
  if (Number(L1_CHAIN_ID) === 1) {
    return `https://etherscan.io/tx/${hash}`;
  }
  return '';
}

function parseEthInput(value) {
  if (!value) return { value: 0n, error: '' };
  try {
    return { value: parseEther(value), error: '' };
  } catch (error) {
    return { value: 0n, error: 'Enter a valid ETH amount.' };
  }
}

function useChainWallet({ chain, chainId, label, beforeConnect, onConnect }) {
  const [walletClient, setWalletClient] = useState(null);
  const [walletAddress, setWalletAddress] = useState('');
  const [chainWarning, setChainWarning] = useState('');
  const [connectedChainId, setConnectedChainId] = useState(null);

  const connectWallet = useCallback(async () => {
    if (!window.ethereum) {
      setChainWarning('No injected wallet found.');
      return;
    }
    if (beforeConnect) {
      const ready = await beforeConnect();
      if (!ready) return;
    }
    try {
      const client = createWalletClient({
        chain,
        transport: custom(window.ethereum)
      });
      await client.requestPermissions({ eth_accounts: {} });
      const addresses = await client.requestAddresses();
      const address = addresses?.[0];
      if (!address) {
        setChainWarning('No wallet address returned.');
        return;
      }
      const normalized = getAddress(address);
      setWalletClient(client);
      setWalletAddress(normalized);
      const currentChainId = await client.getChainId();
      setConnectedChainId(Number(currentChainId));
      if (Number(currentChainId) !== Number(chainId)) {
        setChainWarning(`Wrong network. Please switch to ${label} (chain ${chainId}).`);
      } else {
        setChainWarning('');
      }
      if (onConnect) {
        onConnect(normalized);
      }
    } catch (error) {
      console.error('Wallet connect failed', error);
      setChainWarning('Wallet connection failed.');
    }
  }, [beforeConnect, chain, chainId, label, onConnect]);

  const switchChain = useCallback(async () => {
    if (!walletClient) return;
    try {
      await walletClient.switchChain({ id: chainId });
      const currentChainId = await walletClient.getChainId();
      setConnectedChainId(Number(currentChainId));
      if (Number(currentChainId) === Number(chainId)) {
        setChainWarning('');
      }
    } catch (error) {
      console.error('Failed to switch chain', error);
      setChainWarning(`Please switch network in your wallet to ${label} (chain ${chainId}).`);
    }
  }, [walletClient, chainId, label]);

  const refreshChain = useCallback(async () => {
    if (!walletClient) return;
    const currentChainId = await walletClient.getChainId();
    setConnectedChainId(Number(currentChainId));
    if (Number(currentChainId) !== Number(chainId)) {
      setChainWarning(`Wrong network. Please switch to ${label} (chain ${chainId}).`);
    } else {
      setChainWarning('');
    }
  }, [walletClient, chainId, label]);

  return {
    walletClient,
    walletAddress,
    chainWarning,
    connectedChainId,
    connectWallet,
    switchChain,
    refreshChain,
    setChainWarning
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState('send');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [mintValue, setMintValue] = useState('');
  const [l2GasLimitInput, setL2GasLimitInput] = useState(L2_GAS_LIMIT.toString());
  const [mintValueManual, setMintValueManual] = useState(false);
  const [refundRecipient, setRefundRecipient] = useState('');
  const [recipientPubKey, setRecipientPubKey] = useState('');
  const [pubKeyStatus, setPubKeyStatus] = useState('');
  const [payload, setPayload] = useState(null);
  const [encryptionError, setEncryptionError] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const [showCiphertext, setShowCiphertext] = useState(false);
  const [mintValueError, setMintValueError] = useState('');
  const [amountError, setAmountError] = useState('');

  const [isAuthorized, setIsAuthorized] = useState(prividium.isAuthorized());
  const [l1RegisterStatus, setL1RegisterStatus] = useState('');
  const [l1RegisterTx, setL1RegisterTx] = useState('');
  const [l1SendStatus, setL1SendStatus] = useState('');
  const [l1SendTx, setL1SendTx] = useState('');
  const [l1Balance, setL1Balance] = useState(null);
  const [l2Balance, setL2Balance] = useState(null);
  const [hasPrivKey, setHasPrivKey] = useState(false);
  const [privKeyHex, setPrivKeyHex] = useState('');
  const [generatedKeys, setGeneratedKeys] = useState(null);
  const [depositHeaders, setDepositHeaders] = useState([]);
  const [decryptable, setDecryptable] = useState([]);
  const [depositError, setDepositError] = useState('');
  const [loadingDeposits, setLoadingDeposits] = useState(false);
  const [claimingIndex, setClaimingIndex] = useState(null);
  const [claimTo, setClaimTo] = useState('');
  const [lastClaimTx, setLastClaimTx] = useState('');
  const [lastPrivKeyTx, setLastPrivKeyTx] = useState('');

  const l1Wallet = useChainWallet({
    chain: l1Chain,
    chainId: L1_CHAIN_ID,
    label: 'L1'
  });
  const l2Wallet = useChainWallet({
    chain: prividium.chain,
    chainId: L2_CHAIN_ID,
    label: 'L2',
    beforeConnect: async () => {
      const ready = await authorize();
      if (!ready) return false;
      //await prividium.addNetworkToWallet();
      return true;
    },
    onConnect: (address) => {
      setClaimTo(address);
    }
  });

  const l1Client = useMemo(() => {
    return createPublicClient({
      chain: l1Chain,
      transport: http(L1_RPC_URL)
    });
  }, []);

  const l2PublicClient = useMemo(() => {
    return createPublicClient({
      chain: prividium.chain,
      transport: prividium.transport
    });
  }, []);

  const buildAad = useCallback(
    (depositIdHex) => {
      const packed = encodePacked(
        ['uint256', 'address', 'bytes32', 'bytes32'],
        [BigInt(L2_CHAIN_ID), PRIVATEPAY_INBOX_L2_ADDRESS, depositIdHex, CONTEXT_HASH]
      );
      return hexToBytes(packed);
    },
    []
  );

  useEffect(() => {
    setIsAuthorized(prividium.isAuthorized());
  }, []);

  useEffect(() => {
    if (!recipientAddress || !isAddress(recipientAddress)) {
      setRecipientPubKey('');
      setPubKeyStatus('');
      return;
    }

    let isMounted = true;

    async function loadPubKey() {
      try {
        const pubKey = await l1Client.readContract({
          address: KEY_DIRECTORY_L1_ADDRESS,
          abi: keyDirectoryAbi,
          functionName: 'getPubKey',
          args: [recipientAddress]
        });
        if (!isMounted) return;
        if (!pubKey || pubKey.length <= 2) {
          setRecipientPubKey('');
          setPubKeyStatus('Recipient not registered on L1 key directory.');
          return;
        }
        setRecipientPubKey(pubKey);
        setPubKeyStatus('Recipient public key found.');
      } catch (error) {
        if (!isMounted) return;
        console.error('Failed to fetch public key', error);
        setRecipientPubKey('');
        setPubKeyStatus('Unable to read public key. Check the L1 RPC or contract address.');
      }
    }

    loadPubKey();

    return () => {
      isMounted = false;
    };
  }, [recipientAddress, l1Client]);

  const parsedAmount = useMemo(() => parseEthInput(amount), [amount]);
  const parsedGasLimit = useMemo(() => {
    try {
      return { value: BigInt(l2GasLimitInput || '0'), error: '' };
    } catch (error) {
      return { value: 0n, error: 'Enter a valid gas limit.' };
    }
  }, [l2GasLimitInput]);

  const recommendedMintValueWei = useMemo(() => {
    return (
      parsedAmount.value +
      MINT_BUFFER_WEI +
      parsedGasLimit.value * GAS_BUFFER_WEI_PER_UNIT
    );
  }, [parsedAmount.value, parsedGasLimit.value]);

  useEffect(() => {
    if (!amount) {
      setAmountError('');
      return;
    }
    setAmountError(parsedAmount.error);
  }, [amount, parsedAmount.error]);

  useEffect(() => {
    if (!mintValueManual) {
      setMintValue(formatEther(recommendedMintValueWei));
      setMintValueError('');
    }
  }, [mintValueManual, recommendedMintValueWei]);

  useEffect(() => {
    if (mintValueManual) {
      setMintValueError(parseEthInput(mintValue).error);
    }
  }, [mintValue, mintValueManual]);

  const l2Calldata = useMemo(() => {
    if (!payload) return '';
    return encodeFunctionData({
      abi: privatePayInboxAbi,
      functionName: 'onL1Deposit',
      args: [payload.depositId, payload.commitment, payload.ciphertext]
    });
  }, [payload]);

  const castCommand = useMemo(() => {
    if (!payload || !amount || mintValueError || parsedAmount.error || parsedGasLimit.error) {
      return '';
    }
    const refund = refundRecipient || l2Wallet.walletAddress || ZERO_ADDRESS;
    const mintValueWei = parseEthInput(mintValue).value;
    return `cast send ${BRIDGEHUB_ADDRESS} "requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))" '(${L2_CHAIN_ID},${mintValueWei.toString()},${PRIVATEPAY_INBOX_L2_ADDRESS},${parsedAmount.value.toString()},${l2Calldata},${parsedGasLimit.value.toString()},${L2_GAS_PER_PUBDATA.toString()},[],${refund})' --value ${mintValueWei.toString()} --private-key $PRIVATE_KEY`;
  }, [
    payload,
    amount,
    mintValue,
    mintValueError,
    parsedAmount.error,
    parsedAmount.value,
    refundRecipient,
    l2Wallet.walletAddress,
    l2Calldata,
    parsedGasLimit.value
  ]);

  const copyValue = useCallback(async (value) => {
    const success = await copyToClipboard(value);
    setCopyNotice(success ? 'Copied!' : 'Copy failed');
    setTimeout(() => setCopyNotice(''), 1500);
  }, []);

  const generatePayload = useCallback(() => {
    setEncryptionError('');
    if (!recipientPubKey) {
      setEncryptionError('Recipient is not registered with a public key.');
      return;
    }
    if (!recipientAddress || !isAddress(recipientAddress)) {
      setEncryptionError('Enter a valid recipient address.');
      return;
    }
    try {
      const depositId = randomHex32();
      const secret = randomHex32();
      const commitment = keccak256(secret);
      const plaintextHex = encodePacked(['address', 'bytes32'], [recipientAddress, secret]);
      const aad = buildAad(depositId);
      const { ephemeralPub, nonce, sealed } = encryptPayload({
        recipientPubKeyHex: recipientPubKey,
        plaintext: hexToBytes(plaintextHex),
        aad
      });
      const ciphertext = bundleCiphertext({
        depositId: hexToBytes(depositId),
        ephemeralPub,
        nonce,
        sealed
      });
      setPayload({
        depositId,
        secret,
        commitment,
        ciphertext,
        aad: bytesToHex(aad),
        recipient: recipientAddress
      });
      setShowSecret(false);
      setShowCiphertext(false);
    } catch (error) {
      console.error('Encryption failed', error);
      setEncryptionError('Failed to encrypt payload.');
    }
  }, [recipientPubKey, recipientAddress, buildAad]);

  const authorize = useCallback(async () => {
    if (prividium.isAuthorized()) {
      setIsAuthorized(true);
      return true;
    }
    try {
      await prividium.authorize({
        scopes: ['wallet:required', 'network:required']
      });
      setIsAuthorized(true);
      return true;
    } catch (error) {
      console.error('Authorization failed', error);
      return false;
    }
  }, []);

  const l2WalletAddress = l2Wallet.walletAddress;
  const l1WalletAddress = l1Wallet.walletAddress;
  const l1MintValueWei = useMemo(() => parseEthInput(mintValue).value, [mintValue]);

  const refreshL1Balance = useCallback(async () => {
    if (!l1WalletAddress) return;
    const balance = await l1Client.getBalance({ address: l1WalletAddress });
    setL1Balance(balance);
  }, [l1Client, l1WalletAddress]);

  const refreshL2Balance = useCallback(async () => {
    if (!l2WalletAddress) return;
    const balance = await l2PublicClient.getBalance({ address: l2WalletAddress });
    setL2Balance(balance);
  }, [l2PublicClient, l2WalletAddress]);

  const fetchPrivKey = useCallback(async () => {
    setDepositError('');
    if (!l2WalletAddress) return;
    if (!prividium.isAuthorized()) {
      setDepositError('Authorize Prividium to read private storage.');
      return;
    }
    try {
      const key = await l2PublicClient.readContract({
        address: PRIVATEPAY_INBOX_L2_ADDRESS,
        abi: privatePayInboxAbi,
        functionName: 'getMyPrivKey',
        account: l2WalletAddress
      });
      if (!key || key.length <= 2) {
        setDepositError('No private key stored yet.');
        return;
      }
      setPrivKeyHex(key);
      setGeneratedKeys(null);
    } catch (error) {
      console.error('Failed to fetch private key', error);
      setDepositError('Unable to fetch private key.');
    }
  }, [l2WalletAddress, l2PublicClient]);

  const refreshPrivKeyStatus = useCallback(async () => {
    setDepositError('');
    if (!l2WalletAddress) return;
    if (!prividium.isAuthorized()) {
      setDepositError('Authorize Prividium to read private storage.');
      return;
    }
    try {
      const exists = await l2PublicClient.readContract({
        address: PRIVATEPAY_INBOX_L2_ADDRESS,
        abi: privatePayInboxAbi,
        functionName: 'hasMyPrivKey',
        account: l2WalletAddress
      });
      setHasPrivKey(Boolean(exists));
      if (exists) {
        await fetchPrivKey();
      }
    } catch (error) {
      console.error('Failed to read priv key status', error);
      setDepositError('Unable to read private key status.');
    }
  }, [l2WalletAddress, l2PublicClient, fetchPrivKey]);

  const sendL2Transaction = useCallback(
    async ({ to, data, value = 0n }) => {
      if (!l2Wallet.walletClient || !l2WalletAddress) {
        throw new Error('Wallet not connected');
      }
      const chainCheck = await ensureChain(l2Wallet.walletClient, L2_CHAIN_ID, 'L2');
      if (!chainCheck.ok) {
        l2Wallet.setChainWarning(chainCheck.message);
        throw new Error(chainCheck.message);
      }
      l2Wallet.setChainWarning('');
      if (!prividium.isAuthorized()) {
        throw new Error('Prividium authorization required');
      }
      const nonce = await l2PublicClient.getTransactionCount({ address: l2WalletAddress });
      const gas = await l2PublicClient.estimateGas({
        account: l2WalletAddress,
        to,
        data,
        value
      });
      const gasPrice = await l2PublicClient.getGasPrice();
      await prividium.authorizeTransaction({
        walletAddress: l2WalletAddress,
        toAddress: to,
        nonce: Number(nonce),
        calldata: data
      });
      return l2Wallet.walletClient.sendTransaction({
        account: l2WalletAddress,
        to,
        data,
        nonce,
        gas,
        gasPrice,
        value
      });
    },
    [l2Wallet.walletClient, l2WalletAddress, l2Wallet, l2PublicClient]
  );

  const storePrivKey = useCallback(async () => {
    if (!generatedKeys?.privKey) return;
    try {
      const data = encodeFunctionData({
        abi: privatePayInboxAbi,
        functionName: 'setMyPrivKey',
        args: [generatedKeys.privKey]
      });
      const hash = await sendL2Transaction({
        to: PRIVATEPAY_INBOX_L2_ADDRESS,
        data
      });
      setLastPrivKeyTx(hash);
      setPrivKeyHex(generatedKeys.privKey);
      setHasPrivKey(true);
      setDepositError('');
      await refreshL2Balance();
    } catch (error) {
      console.error('Failed to store private key', error);
      setDepositError('Failed to store private key.');
    }
  }, [generatedKeys, sendL2Transaction, refreshL2Balance]);

  const loadDeposits = useCallback(async () => {
    setDepositError('');
    if (!l2WalletAddress || !privKeyHex) return;
    if (!prividium.isAuthorized()) {
      setDepositError('Authorize Prividium to read deposits.');
      return;
    }
    setLoadingDeposits(true);
    try {
      const count = await l2PublicClient.readContract({
        address: PRIVATEPAY_INBOX_L2_ADDRESS,
        abi: privatePayInboxAbi,
        functionName: 'getDepositsCount'
      });
      const total = Number(count);
      const limit = Math.min(total, 20);
      const offset = total > limit ? total - limit : 0;
      const headers = await l2PublicClient.readContract({
        address: PRIVATEPAY_INBOX_L2_ADDRESS,
        abi: privatePayInboxAbi,
        functionName: 'getRecentDeposits',
        args: [BigInt(limit), BigInt(offset)]
      });
      const normalized = headers.map((item) => ({
        index: Number(item.index),
        amount: BigInt(item.amount),
        createdAt: Number(item.createdAt),
        claimed: item.claimed,
        commitment: item.commitment,
        ciphertextSize: Number(item.ciphertextSize)
      }));
      setDepositHeaders(normalized);

      const matches = [];
      for (const header of normalized) {
        if (header.claimed) continue;
        const ciphertext = await l2PublicClient.readContract({
          address: PRIVATEPAY_INBOX_L2_ADDRESS,
          abi: privatePayInboxAbi,
          functionName: 'getCiphertext',
          args: [BigInt(header.index)]
        });
        if (!ciphertext || ciphertext.length <= 2) continue;
        try {
          const { plaintext, depositIdHex } = decryptPayload({
            privKeyHex,
            bundleHex: ciphertext,
            aadBuilder: buildAad
          });
          if (plaintext.length < 52) {
            continue;
          }
          const recipient = bytesToHex(plaintext.slice(0, 20));
          const secret = bytesToHex(plaintext.slice(20, 52));
          if (getAddress(recipient) === getAddress(l2WalletAddress)) {
            matches.push({
              index: header.index,
              amount: header.amount,
              createdAt: header.createdAt,
              commitment: header.commitment,
              secret,
              depositId: depositIdHex
            });
          }
        } catch (error) {
          console.warn('Skipping unreadable ciphertext', error);
        }
      }
      setDecryptable(matches);

      await refreshL2Balance();
    } catch (error) {
      console.error('Failed to load deposits', error);
      setDepositError('Unable to load deposits.');
    } finally {
      setLoadingDeposits(false);
    }
  }, [l2WalletAddress, privKeyHex, l2PublicClient, buildAad, refreshL2Balance]);

  const claimDeposit = useCallback(
    async (deposit) => {
      setDepositError('');
      try {
        if (!claimTo || !isAddress(claimTo)) {
          setDepositError('Enter a valid claim recipient address.');
          return;
        }
        setClaimingIndex(deposit.index);
        const data = encodeFunctionData({
          abi: privatePayInboxAbi,
          functionName: 'claim',
          args: [BigInt(deposit.index), deposit.secret, claimTo]
        });
        const hash = await sendL2Transaction({
          to: PRIVATEPAY_INBOX_L2_ADDRESS,
          data
        });
        setLastClaimTx(hash);
        await refreshL2Balance();
        await loadDeposits();
      } catch (error) {
        console.error('Claim failed', error);
        setDepositError('Claim failed.');
      } finally {
        setClaimingIndex(null);
      }
    },
    [sendL2Transaction, claimTo, loadDeposits, refreshL2Balance]
  );

  useEffect(() => {
    if (l2WalletAddress && isAuthorized) {
      refreshPrivKeyStatus();
    }
  }, [l2WalletAddress, isAuthorized, refreshPrivKeyStatus]);

  useEffect(() => {
    if (l1WalletAddress) {
      refreshL1Balance();
    }
  }, [l1WalletAddress, refreshL1Balance, l1Wallet.connectedChainId]);

  useEffect(() => {
    if (l2WalletAddress) {
      refreshL2Balance();
    }
  }, [l2WalletAddress, refreshL2Balance, l2Wallet.connectedChainId]);

  useEffect(() => {
    if (privKeyHex) {
      loadDeposits();
    }
  }, [privKeyHex, loadDeposits]);

  const totalIncoming = decryptable.reduce((sum, item) => sum + item.amount, 0n);
  const l1BalanceLow = l1Balance !== null && l1Balance < L1_LOW_BALANCE_THRESHOLD;
  const l2BalanceLow = l2Balance !== null && l2Balance < L2_LOW_BALANCE_THRESHOLD;
  const l1BalanceEmpty = l1Balance === 0n;
  const l2BalanceEmpty = l2Balance === 0n;
  const l1InsufficientMint = l1Balance !== null && l1Balance < l1MintValueWei;

  const sendL1Register = useCallback(async () => {
    if (!generatedKeys?.pubKey) return;
    if (!l1Wallet.walletClient || !l1WalletAddress) {
      setL1RegisterStatus('Connect an L1 wallet to register.');
      return;
    }
    const chainCheck = await ensureChain(l1Wallet.walletClient, L1_CHAIN_ID, 'L1');
    if (!chainCheck.ok) {
      l1Wallet.setChainWarning(chainCheck.message);
      setL1RegisterStatus(chainCheck.message);
      return;
    }
    l1Wallet.setChainWarning('');
    try {
      setL1RegisterStatus('Submitting transaction...');
      const data = encodeFunctionData({
        abi: keyDirectoryAbi,
        functionName: 'register',
        args: [generatedKeys.pubKey]
      });
      const hash = await l1Wallet.walletClient.sendTransaction({
        account: l1WalletAddress,
        to: KEY_DIRECTORY_L1_ADDRESS,
        data
      });
      setL1RegisterTx(hash);
      setL1RegisterStatus('Submitted');
      await refreshL1Balance();
    } catch (error) {
      console.error('Failed to register key', error);
      setL1RegisterStatus('Registration failed.');
    }
  }, [generatedKeys, l1Wallet.walletClient, l1WalletAddress, l1Wallet, refreshL1Balance]);

  const sendBridgehubWallet = useCallback(async () => {
    if (!payload || parsedAmount.error || mintValueError || parsedGasLimit.error) return;
    if (!l1Wallet.walletClient || !l1WalletAddress) {
      setL1SendStatus('Connect an L1 wallet to send.');
      return;
    }
    const chainCheck = await ensureChain(l1Wallet.walletClient, L1_CHAIN_ID, 'L1');
    if (!chainCheck.ok) {
      l1Wallet.setChainWarning(chainCheck.message);
      setL1SendStatus(chainCheck.message);
      return;
    }
    l1Wallet.setChainWarning('');
    try {
      setL1SendStatus('Submitting transaction...');
      const refund = refundRecipient || l2WalletAddress || ZERO_ADDRESS;
      const data = encodeFunctionData({
        abi: bridgehubAbi,
        functionName: 'requestL2TransactionDirect',
        args: [
          {
            chainId: BigInt(L2_CHAIN_ID),
            mintValue: l1MintValueWei,
            l2Contract: PRIVATEPAY_INBOX_L2_ADDRESS,
            l2Value: parsedAmount.value,
            l2Calldata,
            l2GasLimit: parsedGasLimit.value,
            l2GasPerPubdataByteLimit: L2_GAS_PER_PUBDATA,
            factoryDeps: [],
            refundRecipient: refund
          }
        ]
      });
      const hash = await l1Wallet.walletClient.sendTransaction({
        account: l1WalletAddress,
        to: BRIDGEHUB_ADDRESS,
        data,
        value: l1MintValueWei
      });
      setL1SendTx(hash);
      setL1SendStatus('Submitted');
      await refreshL1Balance();
    } catch (error) {
      console.error('Bridgehub send failed', error);
      setL1SendStatus('Submission failed.');
    }
  }, [
    payload,
    parsedAmount.error,
    mintValueError,
    parsedGasLimit.error,
    l1Wallet.walletClient,
    l1WalletAddress,
    l1Wallet,
    refundRecipient,
    l2WalletAddress,
    l1MintValueWei,
    l2Calldata,
    parsedGasLimit.value,
    refreshL1Balance,
    parsedAmount.value
  ]);

  return (
    <div className="app">
      <header>
        <div>
          <span className="eyebrow">Example #5</span>
          <h1>PrivatePay Inbox</h1>
          <p>
            L1 senders pay L2 recipients without revealing the recipient address on L1. Public
            encryption keys live on L1, private keys live in Prividium private storage on L2.
          </p>
        </div>
        <div className="network-summary">
          <div>
            <span>L2 Inbox</span>
            <strong>{formatAddress(PRIVATEPAY_INBOX_L2_ADDRESS)}</strong>
          </div>
          <div>
            <span>L1 Key Directory</span>
            <strong>{formatAddress(KEY_DIRECTORY_L1_ADDRESS)}</strong>
          </div>
        </div>
      </header>

      <div className="tabs">
        <button
          type="button"
          className={activeTab === 'send' ? 'active' : ''}
          onClick={() => setActiveTab('send')}
        >
          Send (L1)
        </button>
        <button
          type="button"
          className={activeTab === 'receive' ? 'active' : ''}
          onClick={() => setActiveTab('receive')}
        >
          Receive (L2)
        </button>
      </div>

      {activeTab === 'send' ? (
        <section className="panel">
          <div className="panel-body">
            <div className="form-grid">
              <label>
                Recipient L2 address
                <input
                  value={recipientAddress}
                  onChange={(event) => {
                    setRecipientAddress(event.target.value);
                    setPayload(null);
                  }}
                  placeholder="0x..."
                />
              </label>
              <label>
                Amount on L2 (ETH)
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="0.01"
                />
                <div className="input-meta">
                  <span>Wei: {parsedAmount.value.toString()}</span>
                  {amountError ? <span className="error">{amountError}</span> : null}
                </div>
                <div className="quick-actions">
                  {['0.001', '0.01', '0.1'].map((preset) => (
                    <button
                      type="button"
                      key={preset}
                      className="ghost"
                      onClick={() => setAmount(preset)}
                    >
                      {preset} ETH
                    </button>
                  ))}
                </div>
              </label>
              <label>
                Mint value (auto, ETH)
                <input
                  value={mintValue}
                  onChange={(event) => {
                    setMintValueManual(true);
                    setMintValue(event.target.value);
                  }}
                  placeholder="amount + buffer"
                />
                <div className="input-meta">
                  <span>
                    Recommended: {formatEther(recommendedMintValueWei)} ETH (includes 0.00005 ETH
                    buffer + 1 wei per gas unit)
                  </span>
                  {mintValueError ? <span className="error">{mintValueError}</span> : null}
                </div>
                <div className="quick-actions">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setMintValueManual(false);
                      setMintValue(formatEther(recommendedMintValueWei));
                    }}
                  >
                    Reset to recommended
                  </button>
                </div>
              </label>
              <label>
                L2 gas limit
                <input
                  value={l2GasLimitInput}
                  onChange={(event) => setL2GasLimitInput(event.target.value)}
                  placeholder={L2_GAS_LIMIT.toString()}
                />
                {parsedGasLimit.error ? (
                  <span className="error">{parsedGasLimit.error}</span>
                ) : null}
              </label>
              <label>
                Refund recipient (L2)
                <input
                  value={refundRecipient}
                  onChange={(event) => setRefundRecipient(event.target.value)}
                  placeholder="0x... (optional)"
                />
              </label>
            </div>
            <div className="status-line">
              <span>{pubKeyStatus}</span>
            </div>
            <div className="actions">
              <button
                type="button"
                onClick={generatePayload}
                disabled={Boolean(amountError) || !recipientAddress || !amount}
              >
                Generate deposit payload
              </button>
              {encryptionError ? <span className="error">{encryptionError}</span> : null}
              {copyNotice ? <span className="copy-notice">{copyNotice}</span> : null}
            </div>

            {payload ? (
              <div className="payload-grid">
                <div className="card">
                  <h3>What L1 sees</h3>
                  <div className="row">
                    <span>Amount</span>
                    <div className="value-stack">
                      <code className="mono-block">{formatEther(parsedAmount.value)} ETH</code>
                      <code className="mono-block muted">Wei: {parsedAmount.value.toString()}</code>
                    </div>
                  </div>
                  <div className="row">
                    <span>Deposit ID</span>
                    <div className="value-stack">
                      <code className="mono-block">{payload.depositId}</code>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => copyValue(payload.depositId)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="row">
                    <span>Commitment</span>
                    <div className="value-stack">
                      <code className="mono-block">{payload.commitment}</code>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => copyValue(payload.commitment)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="row">
                    <span>AAD</span>
                    <div className="value-stack">
                      <code className="mono-block">{payload.aad}</code>
                      <button type="button" className="ghost" onClick={() => copyValue(payload.aad)}>
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="row">
                    <span>Ciphertext</span>
                    <div className="value-stack">
                      <code className="mono-block">
                        {showCiphertext || payload.ciphertext.length <= MAX_INLINE_CIPHERTEXT
                          ? payload.ciphertext
                          : `${payload.ciphertext.slice(0, MAX_INLINE_CIPHERTEXT)}…`}
                      </code>
                      <div className="actions">
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => copyValue(payload.ciphertext)}
                        >
                          Copy
                        </button>
                        {payload.ciphertext.length > MAX_INLINE_CIPHERTEXT ? (
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => setShowCiphertext((prev) => !prev)}
                          >
                            {showCiphertext ? 'Show less' : 'Show more'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="row">
                    <span>Destination</span>
                    <div className="value-stack">
                      <code className="mono-block">{PRIVATEPAY_INBOX_L2_ADDRESS}</code>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => copyValue(PRIVATEPAY_INBOX_L2_ADDRESS)}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                </div>

                <div className="card highlight">
                  <h3>Recipient learns after decrypt</h3>
                  <div className="row">
                    <span>Recipient</span>
                    <div className="value-stack">
                      <code className="mono-block">{payload.recipient}</code>
                    </div>
                  </div>
                  <div className="row">
                    <span>Secret</span>
                    <div className="value-stack">
                      <code className="mono-block">
                        {showSecret ? payload.secret : '••••••••••••••••••••••••'}
                      </code>
                      <button type="button" className="ghost" onClick={() => setShowSecret(!showSecret)}>
                        {showSecret ? 'Hide' : 'Reveal'}
                      </button>
                    </div>
                  </div>
                  <p className="muted">
                    The secret is never shown on L1. It only appears after local decryption by the
                    recipient.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="card">
              <h3>Send via L1 wallet</h3>
              <div className="actions">
                <button type="button" onClick={l1Wallet.connectWallet}>
                  {l1WalletAddress ? 'Reconnect L1 wallet' : 'Connect L1 wallet'}
                </button>
                {l1WalletAddress ? (
                  <span className="status-line">Connected: {formatAddress(l1WalletAddress)}</span>
                ) : null}
              </div>
              {l1Wallet.chainWarning ? (
                <p className="warning">
                  {l1Wallet.chainWarning}{' '}
                  {l1Wallet.walletClient ? (
                    <button type="button" className="ghost" onClick={l1Wallet.switchChain}>
                      Switch network
                    </button>
                  ) : null}
                </p>
              ) : null}
              {l1WalletAddress ? (
                <div className="balance-line">
                  <span>Balance: {l1Balance !== null ? `${formatEther(l1Balance)} ETH` : '—'}</span>
                  <button type="button" className="ghost" onClick={refreshL1Balance}>
                    Refresh
                  </button>
                </div>
              ) : null}
              {l1BalanceEmpty ? (
                <p className="warning error">L1 balance is 0. You need gas to send.</p>
              ) : null}
              {l1BalanceLow && !l1BalanceEmpty ? (
                <p className="warning">Low L1 balance detected.</p>
              ) : null}
              {l1InsufficientMint ? (
                <p className="warning error">Insufficient balance to send mintValue.</p>
              ) : null}
              <div className="actions">
                <button
                  type="button"
                  onClick={sendBridgehubWallet}
                  disabled={
                    !l1WalletAddress ||
                    !payload ||
                    Boolean(amountError) ||
                    Boolean(mintValueError) ||
                    Boolean(parsedGasLimit.error) ||
                    l1BalanceEmpty ||
                    l1InsufficientMint
                  }
                >
                  Send via wallet
                </button>
                {l1SendStatus ? <span className="status-line">{l1SendStatus}</span> : null}
              </div>
              {l1SendTx ? (
                <div className="value-stack">
                  <code className="mono-block">{l1SendTx}</code>
                  <div className="actions">
                    <button type="button" className="ghost" onClick={() => copyValue(l1SendTx)}>
                      Copy tx hash
                    </button>
                    {getL1ExplorerTxUrl(l1SendTx) ? (
                      <a
                        className="ghost-link"
                        href={getL1ExplorerTxUrl(l1SendTx)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View on explorer
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="card">
              <h3>Bridgehub requestL2TransactionDirect</h3>
              <p>
                Use the command below to send the deposit. Adjust mintValue if you see
                MsgValueTooLow or validation errors.
              </p>
              <div className="row">
                <span>l2Calldata</span>
                <div className="value-stack">
                  <code className="mono-block">{l2Calldata || 'Generate payload first.'}</code>
                  {l2Calldata ? (
                    <button type="button" className="ghost" onClick={() => copyValue(l2Calldata)}>
                      Copy
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="row">
                <span>Cast command</span>
                <div className="value-stack">
                  <code className="mono-block">{castCommand || 'Fill in the form above.'}</code>
                  {castCommand ? (
                    <button type="button" className="ghost" onClick={() => copyValue(castCommand)}>
                      Copy
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel">
          <div className="panel-body">
            <div className="receive-grid">
              <div className="card">
                <h3>Connect L2 wallet</h3>
                <p>
                  Prividium authentication is required for private reads. This example never uses
                  localStorage for keys.
                </p>
                <div className="actions">
                  <button type="button" onClick={l2Wallet.connectWallet}>
                    {l2WalletAddress ? 'Reconnect wallet' : 'Connect wallet'}
                  </button>
                  {!isAuthorized ? (
                    <button type="button" onClick={authorize} className="secondary">
                      Authorize Prividium
                    </button>
                  ) : null}
                </div>
                {l2WalletAddress ? (
                  <div className="status-line">
                    <span>Connected: {formatAddress(l2WalletAddress)}</span>
                  </div>
                ) : null}
                {l2Wallet.chainWarning ? (
                  <p className="warning">
                    {l2Wallet.chainWarning}{' '}
                    {l2Wallet.walletClient ? (
                      <button type="button" className="ghost" onClick={l2Wallet.switchChain}>
                        Switch network
                      </button>
                    ) : null}
                  </p>
                ) : null}
              </div>

              <div className="card">
                <h3>Private key storage</h3>
                {hasPrivKey ? (
                  <p>Private key found in Prividium private storage.</p>
                ) : (
                  <p>No private key stored yet. Generate one to receive deposits.</p>
                )}
                {l2WalletAddress ? (
                  <div className="balance-line">
                    <span>Balance: {l2Balance !== null ? `${formatEther(l2Balance)} ETH` : '—'}</span>
                    <button type="button" className="ghost" onClick={refreshL2Balance}>
                      Refresh
                    </button>
                  </div>
                ) : null}
                {l2BalanceEmpty ? (
                  <p className="warning error">L2 balance is 0. You need gas to store keys.</p>
                ) : null}
                {l2BalanceLow && !l2BalanceEmpty ? (
                  <p className="warning">Low L2 balance detected.</p>
                ) : null}
                <div className="actions">
                  <button
                    type="button"
                    onClick={() => setGeneratedKeys(generateKeyPair())}
                    className="secondary"
                  >
                    Generate X25519 keypair
                  </button>
                  {hasPrivKey ? (
                    <button type="button" onClick={fetchPrivKey}>
                      Re-fetch private key
                    </button>
                  ) : null}
                  {generatedKeys ? (
                    <button
                      type="button"
                      onClick={storePrivKey}
                      disabled={
                        !l2WalletAddress ||
                        l2BalanceEmpty ||
                        Boolean(l2Wallet.chainWarning)
                      }
                    >
                      Store private key on L2
                    </button>
                  ) : null}
                </div>
                {generatedKeys ? (
                  <div className="mini-grid">
                    <div>
                      <span>Public key</span>
                      <code className="mono-block">{generatedKeys.pubKey}</code>
                      <button type="button" onClick={() => copyValue(generatedKeys.pubKey)}>
                        Copy
                      </button>
                    </div>
                    <div>
                      <span>Private key (kept in memory)</span>
                      <code className="mono-block">{generatedKeys.privKey}</code>
                      <button type="button" onClick={() => copyValue(generatedKeys.privKey)}>
                        Copy
                      </button>
                    </div>
                  </div>
                ) : null}
                {lastPrivKeyTx ? (
                  <p className="muted">Stored private key tx: {lastPrivKeyTx}</p>
                ) : null}
              </div>

              <div className="card">
                <h3>Register public key on L1</h3>
                <p>Use an L1 wallet to register your public key in the L1 directory.</p>
                <div className="actions">
                  <button type="button" onClick={l1Wallet.connectWallet}>
                    {l1WalletAddress ? 'Reconnect L1 wallet' : 'Connect L1 wallet'}
                  </button>
                  {l1WalletAddress ? (
                    <span className="status-line">Connected: {formatAddress(l1WalletAddress)}</span>
                  ) : null}
                </div>
                {l1Wallet.chainWarning ? (
                  <p className="warning">
                    {l1Wallet.chainWarning}{' '}
                    {l1Wallet.walletClient ? (
                      <button type="button" className="ghost" onClick={l1Wallet.switchChain}>
                        Switch network
                      </button>
                    ) : null}
                  </p>
                ) : null}
                {l1WalletAddress ? (
                  <div className="balance-line">
                    <span>Balance: {l1Balance !== null ? `${formatEther(l1Balance)} ETH` : '—'}</span>
                    <button type="button" className="ghost" onClick={refreshL1Balance}>
                      Refresh
                    </button>
                  </div>
                ) : null}
                {l1BalanceEmpty ? (
                  <p className="warning error">L1 balance is 0. You need gas to register.</p>
                ) : null}
                {l1BalanceLow && !l1BalanceEmpty ? (
                  <p className="warning">Low L1 balance detected.</p>
                ) : null}
                <div className="actions">
                  <button
                    type="button"
                    onClick={sendL1Register}
                    disabled={!generatedKeys?.pubKey || !l1WalletAddress || l1BalanceEmpty}
                  >
                    Register public key on L1
                  </button>
                  {l1RegisterStatus ? <span className="status-line">{l1RegisterStatus}</span> : null}
                </div>
                {l1RegisterTx ? (
                  <div className="value-stack">
                    <code className="mono-block">{l1RegisterTx}</code>
                    <div className="actions">
                      <button type="button" className="ghost" onClick={() => copyValue(l1RegisterTx)}>
                        Copy tx hash
                      </button>
                      {getL1ExplorerTxUrl(l1RegisterTx) ? (
                        <a
                          className="ghost-link"
                          href={getL1ExplorerTxUrl(l1RegisterTx)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View on explorer
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {generatedKeys ? (
                  <div className="notice">
                    <p>CLI alternative:</p>
                    <code className="mono-block">
                      cast send {KEY_DIRECTORY_L1_ADDRESS} "register(bytes)" {generatedKeys.pubKey}{' '}
                      --private-key $PRIVATE_KEY
                    </code>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="card">
              <h3>Inbox</h3>
              <div className="actions">
                <button type="button" onClick={loadDeposits}>
                  Refresh deposits
                </button>
                <button type="button" onClick={refreshPrivKeyStatus} className="secondary">
                  Check key status
                </button>
              </div>
              {l2WalletAddress ? (
                <div className="balance-line">
                  <span>Balance: {l2Balance !== null ? `${formatEther(l2Balance)} ETH` : '—'}</span>
                  <button type="button" className="ghost" onClick={refreshL2Balance}>
                    Refresh
                  </button>
                </div>
              ) : null}
              <label className="claim-input">
                Claim to address (default: your wallet)
                <input
                  value={claimTo}
                  onChange={(event) => setClaimTo(event.target.value)}
                  placeholder={l2WalletAddress || '0x...'}
                />
              </label>
              {l2BalanceEmpty ? (
                <p className="warning error">
                  L2 balance is 0. You need gas to claim.{' '}
                  <a href="README.md#faucet" target="_blank" rel="noreferrer">
                    Faucet example
                  </a>
                </p>
              ) : null}
              {l2BalanceLow && !l2BalanceEmpty ? (
                <p className="warning">
                  Low L2 balance detected.{' '}
                  <a href="README.md#faucet" target="_blank" rel="noreferrer">
                    Faucet example
                  </a>
                </p>
              ) : null}
              {depositError ? <p className="error">{depositError}</p> : null}
              {loadingDeposits ? <p>Loading deposits…</p> : null}
              <div className="summary-row">
                <div>
                  <span>Recent deposits scanned</span>
                  <strong>{formatNumber(depositHeaders.length)}</strong>
                </div>
                <div>
                  <span>Decryptable deposits</span>
                  <strong>{formatNumber(decryptable.length)}</strong>
                </div>
                <div>
                  <span>Total incoming (wei)</span>
                  <strong>{totalIncoming.toString()}</strong>
                </div>
              </div>

              <div className="deposit-list">
                {decryptable.length === 0 ? (
                  <p className="muted">No decryptable deposits found yet.</p>
                ) : (
                  decryptable.map((deposit) => (
                    <div key={deposit.index} className="deposit-item">
                      <div>
                        <strong>Deposit #{deposit.index}</strong>
                        <p className="muted">Created {formatTimestamp(deposit.createdAt)}</p>
                        <p className="muted">Commitment: {deposit.commitment}</p>
                        <p className="muted">Deposit ID: {deposit.depositId}</p>
                      </div>
                      <div className="deposit-actions">
                        <span className="amount">{deposit.amount.toString()} wei</span>
                        <button
                          type="button"
                          onClick={() => claimDeposit(deposit)}
                          disabled={
                            claimingIndex === deposit.index ||
                            l2BalanceEmpty ||
                            Boolean(l2Wallet.chainWarning)
                          }
                        >
                          {claimingIndex === deposit.index ? 'Claiming…' : 'Claim'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
              {lastClaimTx ? (
                <p className="muted">Last claim tx: {lastClaimTx}</p>
              ) : null}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
