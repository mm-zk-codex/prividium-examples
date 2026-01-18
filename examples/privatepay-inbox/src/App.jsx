import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeFunctionData,
  encodePacked,
  getAddress,
  hexToBytes,
  http,
  isAddress,
  keccak256,
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

export default function App() {
  const [activeTab, setActiveTab] = useState('send');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [mintValue, setMintValue] = useState('');
  const [refundRecipient, setRefundRecipient] = useState('');
  const [recipientPubKey, setRecipientPubKey] = useState('');
  const [pubKeyStatus, setPubKeyStatus] = useState('');
  const [payload, setPayload] = useState(null);
  const [encryptionError, setEncryptionError] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');

  const [isAuthorized, setIsAuthorized] = useState(prividium.isAuthorized());
  const [walletClient, setWalletClient] = useState(null);
  const [walletAddress, setWalletAddress] = useState('');
  const [chainWarning, setChainWarning] = useState('');
  const [hasPrivKey, setHasPrivKey] = useState(false);
  const [privKeyHex, setPrivKeyHex] = useState('');
  const [generatedKeys, setGeneratedKeys] = useState(null);
  const [depositHeaders, setDepositHeaders] = useState([]);
  const [decryptable, setDecryptable] = useState([]);
  const [depositError, setDepositError] = useState('');
  const [loadingDeposits, setLoadingDeposits] = useState(false);
  const [balanceWarning, setBalanceWarning] = useState('');
  const [claimingIndex, setClaimingIndex] = useState(null);
  const [claimTo, setClaimTo] = useState('');
  const [lastClaimTx, setLastClaimTx] = useState('');
  const [lastPrivKeyTx, setLastPrivKeyTx] = useState('');

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

  useEffect(() => {
    if (!amount) {
      setMintValue('');
      return;
    }
    if (!mintValue) {
      setMintValue(amount);
    }
  }, [amount, mintValue]);

  const l2Calldata = useMemo(() => {
    if (!payload) return '';
    return encodeFunctionData({
      abi: privatePayInboxAbi,
      functionName: 'onL1Deposit',
      args: [payload.depositId, payload.commitment, payload.ciphertext]
    });
  }, [payload]);

  const castCommand = useMemo(() => {
    if (!payload || !amount || !mintValue) return '';
    const refund = refundRecipient || walletAddress || ZERO_ADDRESS;
    return `cast send ${BRIDGEHUB_ADDRESS} "requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))" '(${L2_CHAIN_ID},${mintValue},${PRIVATEPAY_INBOX_L2_ADDRESS},${amount},${l2Calldata},${L2_GAS_LIMIT.toString()},${L2_GAS_PER_PUBDATA.toString()},[],${refund})' --value ${mintValue} --private-key $PRIVATE_KEY`;
  }, [payload, amount, mintValue, refundRecipient, walletAddress, l2Calldata]);

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
        recipient: recipientAddress
      });
      setShowSecret(false);
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

  const connectWallet = useCallback(async () => {
    const ready = await authorize();
    if (!ready) return;
    if (!window.ethereum) {
      setChainWarning('No injected wallet found.');
      return;
    }
    try {
      //await prividium.addNetworkToWallet();
      await window.ethereum.request({
        method: 'wallet_requestPermissions',
        params: [{ eth_accounts: {} }]
      });
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      const address = accounts?.[0];
      if (!address) {
        setChainWarning('No wallet address returned.');
        return;
      }
      const client = createWalletClient({
        chain: prividium.chain,
        transport: custom(window.ethereum)
      });
      setWalletClient(client);
      setWalletAddress(getAddress(address));
      setClaimTo(getAddress(address));
      const chainId = await client.getChainId();
      if (Number(chainId) !== Number(L2_CHAIN_ID)) {
        setChainWarning(`Connected chain ${chainId}. Switch to L2 chain ${L2_CHAIN_ID}.`);
      } else {
        setChainWarning('');
      }
      setBalanceWarning('');
    } catch (error) {
      console.error('Wallet connect failed', error);
      setChainWarning('Wallet connection failed.');
    }
  }, [authorize]);

  const refreshPrivKeyStatus = useCallback(async () => {
    setDepositError('');
    if (!walletAddress) return;
    if (!prividium.isAuthorized()) {
      setDepositError('Authorize Prividium to read private storage.');
      return;
    }
    try {
      const exists = await l2PublicClient.readContract({
        address: PRIVATEPAY_INBOX_L2_ADDRESS,
        abi: privatePayInboxAbi,
        functionName: 'hasMyPrivKey',
        account: walletAddress
      });
      setHasPrivKey(Boolean(exists));
    } catch (error) {
      console.error('Failed to read priv key status', error);
      setDepositError('Unable to read private key status.');
    }
  }, [walletAddress, l2PublicClient]);

  const fetchPrivKey = useCallback(async () => {
    setDepositError('');
    if (!walletAddress) return;
    if (!prividium.isAuthorized()) {
      setDepositError('Authorize Prividium to read private storage.');
      return;
    }
    try {
      const key = await l2PublicClient.readContract({
        address: PRIVATEPAY_INBOX_L2_ADDRESS,
        abi: privatePayInboxAbi,
        functionName: 'getMyPrivKey',
        account: walletAddress
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
  }, [walletAddress, l2PublicClient]);

  const sendL2Transaction = useCallback(
    async ({ to, data, value = 0n }) => {
      if (!walletClient || !walletAddress) {
        throw new Error('Wallet not connected');
      }
      if (!prividium.isAuthorized()) {
        throw new Error('Prividium authorization required');
      }
      const nonce = await l2PublicClient.getTransactionCount({ address: walletAddress });
      const gas = await l2PublicClient.estimateGas({
        account: walletAddress,
        to,
        data,
        value
      });
      const gasPrice = await l2PublicClient.getGasPrice();
      await prividium.authorizeTransaction({
        walletAddress,
        toAddress: to,
        nonce: Number(nonce),
        calldata: data
      });
      return walletClient.sendTransaction({
        account: walletAddress,
        to,
        data,
        nonce,
        gas,
        gasPrice,
        value
      });
    },
    [walletClient, walletAddress, l2PublicClient]
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
    } catch (error) {
      console.error('Failed to store private key', error);
      setDepositError('Failed to store private key.');
    }
  }, [generatedKeys, sendL2Transaction]);

  const loadDeposits = useCallback(async () => {
    setDepositError('');
    if (!walletAddress || !privKeyHex) return;
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
          if (getAddress(recipient) === getAddress(walletAddress)) {
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

      const balance = await l2PublicClient.getBalance({ address: walletAddress });
      if (balance === 0n) {
        setBalanceWarning('Your L2 balance is 0. You will need gas to claim.');
      } else {
        setBalanceWarning('');
      }
    } catch (error) {
      console.error('Failed to load deposits', error);
      setDepositError('Unable to load deposits.');
    } finally {
      setLoadingDeposits(false);
    }
  }, [walletAddress, privKeyHex, l2PublicClient, buildAad]);

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
        await loadDeposits();
      } catch (error) {
        console.error('Claim failed', error);
        setDepositError('Claim failed.');
      } finally {
        setClaimingIndex(null);
      }
    },
    [sendL2Transaction, claimTo, loadDeposits]
  );

  useEffect(() => {
    if (walletAddress && isAuthorized) {
      refreshPrivKeyStatus();
    }
  }, [walletAddress, isAuthorized, refreshPrivKeyStatus]);

  useEffect(() => {
    if (privKeyHex) {
      loadDeposits();
    }
  }, [privKeyHex, loadDeposits]);

  const totalIncoming = decryptable.reduce((sum, item) => sum + item.amount, 0n);

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
                Amount on L2 (wei)
                <input
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder="50000000000000000"
                />
              </label>
              <label>
                Mint value on L2 (wei)
                <input
                  value={mintValue}
                  onChange={(event) => setMintValue(event.target.value)}
                  placeholder="amount + gas buffer"
                />
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
              <button type="button" onClick={generatePayload}>
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
                    <div>
                      <code>{amount || '0'}</code>
                    </div>
                  </div>
                  <div className="row">
                    <span>Deposit ID</span>
                    <div>
                      <code>{payload.depositId}</code>
                      <button type="button" onClick={() => copyValue(payload.depositId)}>
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="row">
                    <span>Commitment</span>
                    <div>
                      <code>{payload.commitment}</code>
                      <button type="button" onClick={() => copyValue(payload.commitment)}>
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="row">
                    <span>Ciphertext</span>
                    <div>
                      <code className="wrap">{payload.ciphertext}</code>
                      <button type="button" onClick={() => copyValue(payload.ciphertext)}>
                        Copy
                      </button>
                    </div>
                  </div>
                  <div className="row">
                    <span>Destination</span>
                    <div>
                      <code>{PRIVATEPAY_INBOX_L2_ADDRESS}</code>
                      <button
                        type="button"
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
                    <div>
                      <code>{payload.recipient}</code>
                    </div>
                  </div>
                  <div className="row">
                    <span>Secret</span>
                    <div>
                      <code>{showSecret ? payload.secret : '••••••••••••••••••••••••'}</code>
                      <button type="button" onClick={() => setShowSecret(!showSecret)}>
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
              <h3>Bridgehub requestL2TransactionDirect</h3>
              <p>
                Use the command below to send the deposit. Adjust mintValue if you see
                MsgValueTooLow or validation errors.
              </p>
              <div className="row">
                <span>l2Calldata</span>
                <div>
                  <code className="wrap">{l2Calldata || 'Generate payload first.'}</code>
                  {l2Calldata ? (
                    <button type="button" onClick={() => copyValue(l2Calldata)}>
                      Copy
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="row">
                <span>Cast command</span>
                <div>
                  <code className="wrap">{castCommand || 'Fill in the form above.'}</code>
                  {castCommand ? (
                    <button type="button" onClick={() => copyValue(castCommand)}>
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
                  <button type="button" onClick={connectWallet}>
                    {walletAddress ? 'Reconnect wallet' : 'Connect wallet'}
                  </button>
                  {!isAuthorized ? (
                    <button type="button" onClick={authorize} className="secondary">
                      Authorize Prividium
                    </button>
                  ) : null}
                </div>
                {walletAddress ? (
                  <div className="status-line">
                    <span>Connected: {formatAddress(walletAddress)}</span>
                  </div>
                ) : null}
                {chainWarning ? <p className="warning">{chainWarning}</p> : null}
              </div>

              <div className="card">
                <h3>Private key storage</h3>
                {hasPrivKey ? (
                  <p>Private key found in Prividium private storage.</p>
                ) : (
                  <p>No private key stored yet. Generate one to receive deposits.</p>
                )}
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
                    <button type="button" onClick={storePrivKey}>
                      Store private key on L2
                    </button>
                  ) : null}
                </div>
                {generatedKeys ? (
                  <div className="mini-grid">
                    <div>
                      <span>Public key</span>
                      <code className="wrap">{generatedKeys.pubKey}</code>
                      <button type="button" onClick={() => copyValue(generatedKeys.pubKey)}>
                        Copy
                      </button>
                    </div>
                    <div>
                      <span>Private key (kept in memory)</span>
                      <code className="wrap">{generatedKeys.privKey}</code>
                      <button type="button" onClick={() => copyValue(generatedKeys.privKey)}>
                        Copy
                      </button>
                    </div>
                  </div>
                ) : null}
                {generatedKeys ? (
                  <div className="notice">
                    <p>Register the public key on L1 using:</p>
                    <code className="wrap">
                      cast send {KEY_DIRECTORY_L1_ADDRESS} "register(bytes)" {generatedKeys.pubKey}{' '}
                      --private-key $PRIVATE_KEY
                    </code>
                  </div>
                ) : null}
                {lastPrivKeyTx ? (
                  <p className="muted">Stored private key tx: {lastPrivKeyTx}</p>
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
              <label className="claim-input">
                Claim to address (default: your wallet)
                <input
                  value={claimTo}
                  onChange={(event) => setClaimTo(event.target.value)}
                  placeholder={walletAddress || '0x...'}
                />
              </label>
              {balanceWarning ? (
                <p className="warning">
                  {balanceWarning}{' '}
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
                          disabled={claimingIndex === deposit.index}
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
