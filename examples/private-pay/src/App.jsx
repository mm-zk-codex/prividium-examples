import { useEffect, useMemo, useState } from 'react';
import {
  createWalletClient,
  custom,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  formatUnits,
  getContract,
  isAddress,
  parseUnits
} from 'viem';
import { createPrividiumClient } from 'prividium';
import { prividium } from './prividium';
import { BRIDGEHUB_ABI, PRIVATE_PAY_ABI } from './abis';
import {
  BRIDGEHUB_ADDRESS,
  CONTEXT,
  L1_CHAIN_ID,
  L1_CHAIN_NAME,
  L1_EXPLORER_URL,
  L2_CHAIN_ID,
  L2_GAS_LIMIT_DEFAULT,
  L2_GAS_PER_PUBDATA_DEFAULT,
  MINT_VALUE_DEFAULT,
  PRIVATE_PAY_L2_ADDRESS,
  PUBLIC_KEY,
  REFUND_RECIPIENT_DEFAULT
} from './constants';
import { encryptRecipient } from './crypto';
import { copyToClipboard, explorerTxUrl, formatUnitsDisplay, truncateMiddle } from './utils';

const l1Chain = defineChain({
  id: L1_CHAIN_ID,
  name: L1_CHAIN_NAME,
  nativeCurrency: {
    name: 'ETH',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: []
    }
  },
  blockExplorers: {
    default: {
      name: 'Explorer',
      url: L1_EXPLORER_URL
    }
  }
});

function CopyButton({ value, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(value);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button className="icon-button" type="button" onClick={handleCopy} disabled={!value}>
      {copied ? 'Copied' : label}
    </button>
  );
}

function SectionTitle({ title, subtitle }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('send');

  const [recipient, setRecipient] = useState('');
  const [amountInput, setAmountInput] = useState('50');
  const [amountUnit, setAmountUnit] = useState('gwei');
  const [l2GasLimit, setL2GasLimit] = useState(L2_GAS_LIMIT_DEFAULT.toString());
  const [l2GasPerPubdata, setL2GasPerPubdata] = useState(L2_GAS_PER_PUBDATA_DEFAULT.toString());
  const [mintValue, setMintValue] = useState(MINT_VALUE_DEFAULT.toString());
  const [refundRecipient, setRefundRecipient] = useState(REFUND_RECIPIENT_DEFAULT);

  const [depositId, setDepositId] = useState('');
  const [aad, setAad] = useState('');
  const [ciphertext, setCiphertext] = useState('');
  const [payloadError, setPayloadError] = useState('');
  const [payloadNote, setPayloadNote] = useState('');

  const [l1Address, setL1Address] = useState('');
  const [l1WalletClient, setL1WalletClient] = useState(null);
  const [l1ConnectError, setL1ConnectError] = useState('');
  const [isConnectingL1, setIsConnectingL1] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [txHash, setTxHash] = useState('');

  const [isAuthorized, setIsAuthorized] = useState(prividium.isAuthorized());
  const [l2Address, setL2Address] = useState('');
  const [l2WalletClient, setL2WalletClient] = useState(null);
  const [l2ConnectError, setL2ConnectError] = useState('');
  const [isConnectingL2, setIsConnectingL2] = useState(false);
  const [receivedTotal, setReceivedTotal] = useState(null);
  const [receivedError, setReceivedError] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const amountWei = useMemo(() => {
    try {
      if (!amountInput) return 0n;
      const decimals = amountUnit === 'eth' ? 18 : amountUnit === 'gwei' ? 9 : 0;
      return parseUnits(amountInput, decimals);
    } catch (error) {
      return 0n;
    }
  }, [amountInput, amountUnit]);

  const l2ValueLabel = useMemo(() => {
    if (!amountWei) return '0';
    return formatUnitsDisplay(amountWei, 18);
  }, [amountWei]);

  const castCommand = useMemo(() => {
    if (!depositId || !aad || !ciphertext) return '';
    const calldata = encodeFunctionData({
      abi: PRIVATE_PAY_ABI,
      functionName: 'onL1Deposit',
      args: [depositId, aad, ciphertext]
    });
    return `# 1) Build L2 calldata\nexport L2_CALLDATA=\"${calldata}\"\n\n# 2) Send Bridgehub request\ncast send ${BRIDGEHUB_ADDRESS} \\\n  \"requestL2TransactionDirect((uint256,uint256,address,uint256,bytes,uint256,uint256,bytes[],address))\" \\\n  '(\\n    ${L2_CHAIN_ID},\\n    ${mintValue},\\n    ${PRIVATE_PAY_L2_ADDRESS},\\n    ${amountWei.toString()},\\n    '"'$L2_CALLDATA'"',\\n    ${l2GasLimit},\\n    ${l2GasPerPubdata},\\n    [],\\n    ${refundRecipient}\n  )' \\\n  --value ${mintValue}`;
  }, [depositId, aad, ciphertext, amountWei, l2GasLimit, l2GasPerPubdata, mintValue, refundRecipient]);

  const l1Summary = useMemo(
    () => ({
      amount: amountWei ? amountWei.toString() : '0',
      depositId,
      aad,
      ciphertext,
      destination: PRIVATE_PAY_L2_ADDRESS
    }),
    [amountWei, depositId, aad, ciphertext]
  );

  const l2Summary = useMemo(
    () => ({
      recipient,
      amount: amountWei ? amountWei.toString() : '0',
      depositId,
      context: CONTEXT
    }),
    [recipient, amountWei, depositId]
  );

  const connectL1Wallet = async () => {
    setL1ConnectError('');
    if (!window.ethereum) {
      setL1ConnectError('No injected wallet found. Install MetaMask or a compatible wallet.');
      return;
    }
    setIsConnectingL1(true);
    try {
      const nextWalletClient = createWalletClient({
        chain: l1Chain,
        transport: custom(window.ethereum)
      });
      try {
        await nextWalletClient.requestPermissions({ eth_accounts: {} });
      } catch (permissionError) {
        if (permissionError?.code !== -32601) {
          throw permissionError;
        }
      }
      let accounts = await nextWalletClient.requestAddresses();
      if (!accounts || accounts.length === 0) {
        accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      }
      if (!accounts || accounts.length === 0) {
        setL1ConnectError('No account selected / permission not granted. Try Connect again.');
        setL1Address('');
        setL1WalletClient(null);
        return;
      }
      setL1WalletClient(nextWalletClient);
      setL1Address(accounts[0]);
    } catch (error) {
      console.error(error);
      if (error?.code === 4001) {
        setL1ConnectError('Wallet connection was rejected. Please approve permissions to continue.');
      } else {
        setL1ConnectError('Wallet connection failed.');
      }
    } finally {
      setIsConnectingL1(false);
    }
  };

  const parseSendError = (error) => {
    if (!error) return 'Transaction failed.';
    if (error?.code === 4001) return 'Transaction signature was rejected in your wallet.';
    const message = error?.shortMessage || error?.message || '';
    if (message.includes('MsgValueMismatch') || message.includes('0x4a094431')) {
      return 'MsgValueMismatch: mintValue must equal the L1 msg.value you send.';
    }
    if (message.includes('MsgValueTooLow') || message.includes('0xb385a3da')) {
      return 'MsgValueTooLow: increase mintValue to cover l2Value + gas + pubdata.';
    }
    if (message.toLowerCase().includes('not enough gas')) {
      return 'ValidateTx not enough gas: increase l2GasLimit or mintValue.';
    }
    if (message.toLowerCase().includes('insufficient funds')) {
      return 'Insufficient funds in the L1 wallet to cover msg.value and gas.';
    }
    return message || 'Transaction failed.';
  };

  const generatePayload = async () => {
    setPayloadError('');
    setPayloadNote('');
    setDepositId('');
    setAad('');
    setCiphertext('');

    if (!recipient || !isAddress(recipient)) {
      setPayloadError('Enter a valid recipient L2 address.');
      return;
    }
    if (!PUBLIC_KEY || PUBLIC_KEY === '0x') {
      setPayloadError('Missing PUBLIC_KEY constant.');
      return;
    }

    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const depositIdHex = `0x${Array.from(randomBytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;

    try {
      const aadHex = encodePacked(
        ['uint256', 'address', 'bytes32', 'bytes32'],
        [BigInt(L2_CHAIN_ID), PRIVATE_PAY_L2_ADDRESS, CONTEXT, depositIdHex]
      );

      const plaintextHex = encodeAbiParameters([{ type: 'address' }], [recipient]);
      const { ciphertextHex } = await encryptRecipient({
        recipientHex: recipient,
        aadHex,
        publicKeyHex: PUBLIC_KEY,
        plaintextHex
      });

      setDepositId(depositIdHex);
      setAad(aadHex);
      setCiphertext(ciphertextHex);
      setPayloadNote('Payload generated. You can now send via wallet or cast.');
    } catch (error) {
      console.error(error);
      setPayloadError('Failed to encrypt payload. Check your public key and try again.');
    }
  };

  const sendTransaction = async () => {
    setSendError('');
    setTxHash('');
    if (!l1WalletClient || !l1Address) {
      setSendError('Connect an L1 wallet to send.');
      return;
    }
    if (!depositId || !aad || !ciphertext) {
      setSendError('Generate an encrypted payload first.');
      return;
    }

    let mintValueBigInt;
    let l2GasLimitBigInt;
    let l2GasPerPubdataBigInt;
    try {
      mintValueBigInt = BigInt(mintValue);
      l2GasLimitBigInt = BigInt(l2GasLimit);
      l2GasPerPubdataBigInt = BigInt(l2GasPerPubdata);
    } catch (error) {
      setSendError('Gas or mint values are invalid numbers.');
      return;
    }

    if (!isAddress(refundRecipient)) {
      setSendError('Refund recipient must be a valid address.');
      return;
    }

    setIsSending(true);
    try {
      const l2Calldata = encodeFunctionData({
        abi: PRIVATE_PAY_ABI,
        functionName: 'onL1Deposit',
        args: [depositId, aad, ciphertext]
      });

      const request = {
        chainId: BigInt(L2_CHAIN_ID),
        mintValue: mintValueBigInt,
        l2Contract: PRIVATE_PAY_L2_ADDRESS,
        l2Value: amountWei,
        l2Calldata,
        l2GasLimit: l2GasLimitBigInt,
        l2GasPerPubdataByteLimit: l2GasPerPubdataBigInt,
        factoryDeps: [],
        refundRecipient
      };

      const data = encodeFunctionData({
        abi: BRIDGEHUB_ABI,
        functionName: 'requestL2TransactionDirect',
        args: [request]
      });

      try {
        await l1WalletClient.switchChain({ id: L1_CHAIN_ID });
      } catch (error) {
        console.warn('Unable to switch L1 chain', error);
      }

      const hash = await l1WalletClient.sendTransaction({
        account: l1Address,
        to: BRIDGEHUB_ADDRESS,
        data,
        value: mintValueBigInt
      });

      setTxHash(hash);
    } catch (error) {
      console.error(error);
      setSendError(parseSendError(error));
    } finally {
      setIsSending(false);
    }
  };

  const connectL2Wallet = async () => {
    setL2ConnectError('');
    if (!window.ethereum) {
      setL2ConnectError('No injected wallet found. Install MetaMask or a compatible wallet.');
      return;
    }
    setIsConnectingL2(true);
    try {
      await prividium.authorize({ scopes: ['wallet:required', 'network:required'] });
      setIsAuthorized(true);
      await prividium.addNetworkToWallet();

      const nextWalletClient = createWalletClient({
        chain: prividium.chain,
        transport: custom(window.ethereum)
      });
      try {
        await nextWalletClient.requestPermissions({ eth_accounts: {} });
      } catch (permissionError) {
        if (permissionError?.code !== -32601) {
          throw permissionError;
        }
      }
      let accounts = await nextWalletClient.requestAddresses();
      if (!accounts || accounts.length === 0) {
        accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      }
      if (!accounts || accounts.length === 0) {
        setL2ConnectError('No account selected / permission not granted. Try Connect again.');
        setL2Address('');
        setL2WalletClient(null);
        return;
      }
      setL2WalletClient(nextWalletClient);
      setL2Address(accounts[0]);
    } catch (error) {
      console.error(error);
      if (error?.code === 4001) {
        setL2ConnectError('Wallet connection was rejected. Please approve permissions to continue.');
      } else {
        setL2ConnectError('Wallet connection failed.');
      }
    } finally {
      setIsConnectingL2(false);
    }
  };

  const refreshReceived = async () => {
    setReceivedError('');
    if (!isAuthorized) {
      setReceivedError('Connect and sign in with Prividium to read totals.');
      return;
    }
    if (!l2Address) {
      setReceivedError('Connect your L2 wallet to read totals.');
      return;
    }
    setIsRefreshing(true);
    try {
      const rpcClient = createPrividiumClient({
        chain: prividium.chain,
        transport: prividium.transport,
        account: l2Address
      });
      const contract = getContract({
        address: PRIVATE_PAY_L2_ADDRESS,
        abi: PRIVATE_PAY_ABI,
        client: rpcClient
      });
      const total = await contract.read.receivedTotal([l2Address]);
      setReceivedTotal(total);
    } catch (error) {
      console.error(error);
      setReceivedError('Failed to read totals. Ensure you are signed in and on the correct network.');
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'received' && isAuthorized && l2Address) {
      refreshReceived();
    }
  }, [activeTab, isAuthorized, l2Address]);

  const txLink = explorerTxUrl(L1_EXPLORER_URL, txHash);

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Example #4</p>
          <h1>PrivatePay</h1>
          <p>
            Pay a hidden L2 recipient from L1. L1 only sees ciphertext + AAD + depositId, while L2 decrypts the real
            recipient privately.
          </p>
        </div>
        <div className="hero-card">
          <div>
            <span className="label">Privacy scope</span>
            <strong>Recipient hidden on L1 only</strong>
          </div>
          <div>
            <span className="label">L1 wallet usage</span>
            <strong>Only used to pay the Bridgehub deposit</strong>
          </div>
        </div>
      </header>

      <div className="tabs">
        <button className={activeTab === 'send' ? 'active' : ''} onClick={() => setActiveTab('send')} type="button">
          Send privately (L1)
        </button>
        <button
          className={activeTab === 'received' ? 'active' : ''}
          onClick={() => setActiveTab('received')}
          type="button"
        >
          My received (L2)
        </button>
      </div>

      {activeTab === 'send' && (
        <section className="panel">
          <SectionTitle
            title="Send privately (L1)"
            subtitle="Generate ciphertext without Prividium login. Connect an L1 wallet only when you want to submit the deposit transaction."
          />

          <div className="notice">
            You’re connecting an L1 wallet only to pay for the deposit transaction. You are not signing into Prividium or
            connecting to L2.
          </div>

          <div className="grid two">
            <div>
              <label>
                Recipient L2 address
                <input
                  type="text"
                  placeholder="0x..."
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value.trim())}
                />
              </label>

              <div className="row">
                <label className="grow">
                  Amount to send on L2
                  <input
                    type="text"
                    value={amountInput}
                    onChange={(event) => setAmountInput(event.target.value)}
                  />
                </label>
                <label>
                  Unit
                  <select value={amountUnit} onChange={(event) => setAmountUnit(event.target.value)}>
                    <option value="wei">wei</option>
                    <option value="gwei">gwei</option>
                    <option value="eth">ETH</option>
                  </select>
                </label>
              </div>
              <p className="helper">L2 value (ETH): {l2ValueLabel}</p>

              <details className="advanced">
                <summary>Advanced</summary>
                <div className="advanced-grid">
                  <label>
                    L2 gas limit
                    <input type="text" value={l2GasLimit} onChange={(event) => setL2GasLimit(event.target.value)} />
                  </label>
                  <label>
                    L2 gas per pubdata byte
                    <input
                      type="text"
                      value={l2GasPerPubdata}
                      onChange={(event) => setL2GasPerPubdata(event.target.value)}
                    />
                  </label>
                  <label>
                    Mint value (msg.value on L1)
                    <input type="text" value={mintValue} onChange={(event) => setMintValue(event.target.value)} />
                    <span className="helper">
                      Must cover l2Value + gas + pubdata. Excess refunds to refundRecipient on L2.
                    </span>
                  </label>
                  <label>
                    Refund recipient (L2)
                    <input
                      type="text"
                      value={refundRecipient}
                      onChange={(event) => setRefundRecipient(event.target.value.trim())}
                    />
                  </label>
                </div>
              </details>

              <div className="actions">
                <button type="button" onClick={generatePayload}>
                  Generate encrypted payload
                </button>
                {payloadError && <p className="error">{payloadError}</p>}
                {payloadNote && <p className="success">{payloadNote}</p>}
              </div>

              <div className="payload">
                <h3>Generated payload</h3>
                <div className="payload-row">
                  <span className="label">depositId</span>
                  <span className="mono wrap">{depositId || '—'}</span>
                  <CopyButton value={depositId} />
                </div>
                <div className="payload-row">
                  <span className="label">aad</span>
                  <span className="mono wrap">{aad || '—'}</span>
                  <CopyButton value={aad} />
                </div>
                <div className="payload-row">
                  <span className="label">ciphertext</span>
                  <span className="mono wrap">{ciphertext || '—'}</span>
                  <CopyButton value={ciphertext} />
                </div>
              </div>
            </div>

            <div>
              <div className="side-by-side">
                <div className="column">
                  <h3>What L1 sees (public)</h3>
                  <ul>
                    <li>Sender address: {l1Address ? truncateMiddle(l1Address) : 'unknown until submit'}</li>
                    <li>Amount: {l1Summary.amount}</li>
                    <li>DepositId: {l1Summary.depositId || '—'}</li>
                    <li>AAD: {l1Summary.aad || '—'}</li>
                    <li>Ciphertext: {l1Summary.ciphertext || '—'}</li>
                    <li>Destination (L2): {l1Summary.destination}</li>
                    <li>Recipient: hidden</li>
                  </ul>
                </div>
                <div className="column">
                  <h3>What L2 learns (private decrypt)</h3>
                  <ul>
                    <li>Recipient: {l2Summary.recipient || '—'}</li>
                    <li>Amount: {l2Summary.amount}</li>
                    <li>DepositId: {l2Summary.depositId || '—'}</li>
                    <li>Context: {l2Summary.context}</li>
                  </ul>
                </div>
              </div>
              <p className="helper">
                The recipient address never appears in L1 calldata. Only encrypted bytes + AAD + depositId are stored on
                L1, while L2 decrypts and transfers immediately.
              </p>

              <div className="wallet-card">
                <div>
                  <span className="label">L1 wallet</span>
                  <strong>{l1Address ? truncateMiddle(l1Address) : 'Not connected'}</strong>
                </div>
                <button type="button" onClick={connectL1Wallet} disabled={isConnectingL1}>
                  {l1Address ? 'Connected' : isConnectingL1 ? 'Connecting…' : 'Connect L1 wallet'}
                </button>
                {l1ConnectError && <p className="error">{l1ConnectError}</p>}
              </div>

              <div className="action-card">
                <button
                  type="button"
                  onClick={sendTransaction}
                  disabled={!l1Address || !depositId || isSending}
                >
                  {isSending ? 'Sending…' : 'Send transaction'}
                </button>
                {!l1Address && <p className="helper">Connect L1 wallet to send.</p>}
                {sendError && <p className="error">{sendError}</p>}
                {txHash && (
                  <div className="tx-result">
                    <span className="label">L1 tx hash</span>
                    <span className="mono">{txHash}</span>
                    <CopyButton value={txHash} label="Copy hash" />
                    {txLink && (
                      <a className="icon-button" href={txLink} target="_blank" rel="noreferrer">
                        View
                      </a>
                    )}
                  </div>
                )}
              </div>

              <div className="payload">
                <h3>Cast command (alternative)</h3>
                <p className="helper">Use this if you prefer CLI. It already includes calldata and mint value.</p>
                <pre className="mono wrap">{castCommand || 'Generate payload to see command.'}</pre>
                <CopyButton value={castCommand} label="Copy command" />
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === 'received' && (
        <section className="panel">
          <SectionTitle
            title="My received (L2)"
            subtitle="Connect your Prividium-authenticated L2 wallet to read storage-based totals."
          />

          <div className="wallet-card">
            <div>
              <span className="label">L2 wallet</span>
              <strong>{l2Address ? truncateMiddle(l2Address) : 'Not connected'}</strong>
            </div>
            <button type="button" onClick={connectL2Wallet} disabled={isConnectingL2}>
              {l2Address ? 'Connected' : isConnectingL2 ? 'Connecting…' : 'Connect L2 wallet'}
            </button>
            {l2ConnectError && <p className="error">{l2ConnectError}</p>}
          </div>

          <div className="result-card">
            <div>
              <span className="label">Total received via PrivatePay</span>
              <strong>{receivedTotal !== null ? formatUnits(receivedTotal, 18) : '—'}</strong>
            </div>
            <button type="button" onClick={refreshReceived} disabled={isRefreshing}>
              {isRefreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            {receivedError && <p className="error">{receivedError}</p>}
          </div>
        </section>
      )}
    </div>
  );
}
