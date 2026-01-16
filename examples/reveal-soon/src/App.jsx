import { useCallback, useEffect, useMemo, useState } from 'react';
import { getContract, createWalletClient, custom, encodeFunctionData } from 'viem';
import { createPrividiumClient } from 'prividium';
import { prividium } from './prividium';
import { REVEAL_SOON_ABI } from './messageAbi';
import {
  explorerTxUrl,
  formatAddress,
  formatRemaining,
  formatTimestamp,
  timeAgo,
  ZERO_ADDRESS
} from './utils';

const CONTRACT_ADDRESS = import.meta.env.VITE_REVEAL_SOON_CONTRACT_ADDRESS;
const FEED_PAGE_SIZE = 20n;

const DELAY_OPTIONS = [
  { label: '1 minute', seconds: 60 },
  { label: '5 minutes', seconds: 300 },
  { label: '30 minutes', seconds: 1800 }
];

function TeachingPanel() {
  return (
    <section className="panel teaching">
      <h2>RevealSoon: time-gated privacy with Prividium</h2>
      <div className="teaching-grid">
        <div>
          <h3>What’s public</h3>
          <ul>
            <li>Who created the message</li>
            <li>When it was created</li>
            <li>When it will be revealed</li>
            <li>Transaction hash</li>
          </ul>
        </div>
        <div>
          <h3>What’s private (until reveal time)</h3>
          <ul>
            <li>The message payload</li>
          </ul>
        </div>
      </div>
      <p className="teaching-copy">
        On a normal public chain, the message text would be visible immediately. With Prividium, the payload is already
        on-chain but unreadable until the chosen time.
      </p>
    </section>
  );
}

function MessageRow({ item }) {
  const revealLabel = item.isRevealedNow
    ? '✅ Revealed'
    : `🔒 Hidden — reveals in ${formatRemaining(item.revealAt)}`;

  return (
    <li className="activity-item">
      <header>
        <span className={`badge ${item.isRevealedNow ? 'reveal' : 'secret'}`}>{revealLabel}</span>
        <div className="activity-meta">
          <strong title={item.author}>{formatAddress(item.author)}</strong>
          <span className="subtle">{item.author}</span>
          <div className="time">
            Created {formatTimestamp(item.createdAt)} · <span>{timeAgo(item.createdAt)}</span>
          </div>
          <div className="time">Reveals at {formatTimestamp(item.revealAt)}</div>
        </div>
      </header>

      <div className="activity-body">
        {item.isRevealedNow ? (
          <div className="note">
            <p className="note-text">“{item.payload}”</p>
            <p className="note-meta">Stored earlier and now publicly readable.</p>
          </div>
        ) : (
          <div className="note">
            <p className="note-text placeholder">🔒 Hidden payload stored on-chain.</p>
            <p className="note-meta">
              The payload exists in contract storage, but Prividium prevents public reads until the reveal time.
            </p>
          </div>
        )}
      </div>
    </li>
  );
}

export default function App() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [address, setAddress] = useState('');
  const [payload, setPayload] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(DELAY_OPTIONS[0].seconds);
  const [activeTab, setActiveTab] = useState('recent');
  const [feed, setFeed] = useState([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);

  const explorerBase = prividium.chain.blockExplorers?.default?.url;

  useEffect(() => {
    setIsAuthorized(prividium.isAuthorized());
  }, []);

  const rpcClient = useMemo(() => {
    const account = address || ZERO_ADDRESS;
    return createPrividiumClient({
      chain: prividium.chain,
      transport: prividium.transport,
      account
    });
  }, [address]);

  const revealContract = useMemo(() => {
    if (!CONTRACT_ADDRESS) return null;
    return getContract({
      address: CONTRACT_ADDRESS,
      abi: REVEAL_SOON_ABI,
      client: rpcClient
    });
  }, [rpcClient]);

  const loadFeed = useCallback(async () => {
    if (!CONTRACT_ADDRESS) {
      setError('Missing VITE_REVEAL_SOON_CONTRACT_ADDRESS env var.');
      return;
    }
    if (!revealContract) {
      setError('Contract client not ready.');
      return;
    }

    setLoadingFeed(true);
    setError('');

    try {
      const total = await revealContract.read.getMessagesCount();
      if (total === 0n) {
        setFeed([]);
        return;
      }

      const headers = await revealContract.read.getRecentMessages([FEED_PAGE_SIZE, 0n]);
      const items = await Promise.all(
        headers.map(async (header) => {
          const id = Number(header.id);
          const isRevealedNow = header.isRevealedNow;
          const payload = isRevealedNow
            ? await revealContract.read.getMessagePayload([header.id])
            : '';
          return {
            id: `message-${id}`,
            messageId: id,
            author: header.author,
            createdAt: Number(header.createdAt),
            revealAt: Number(header.revealAt),
            isRevealedNow,
            payload
          };
        })
      );

      setFeed(items);
    } catch (err) {
      console.error(err);
      setError('Failed to load messages. Check your Prividium auth and contract permissions.');
    } finally {
      setLoadingFeed(false);
    }
  }, [revealContract]);

  useEffect(() => {
    if (isAuthorized) {
      loadFeed();
    }
  }, [isAuthorized, loadFeed]);

  const handleAuthorizeRead = async () => {
    setError('');
    try {
      await prividium.authorize();
      setIsAuthorized(true);
    } catch (err) {
      console.error(err);
      setError('Read-only sign-in failed.');
    }
  };

  const handleAuthorizeWrite = async () => {
    setError('');
    try {
      await prividium.authorize({
        scopes: ['wallet:required', 'network:required']
      });
      setIsAuthorized(true);
    } catch (err) {
      console.error(err);
      setError('Write access sign-in failed.');
    }
  };

  const connectWallet = async () => {
    setError('');
    if (!window.ethereum) {
      setError('No injected wallet found. Install MetaMask or a compatible wallet.');
      return;
    }
    try {
      const walletClient = createWalletClient({
        chain: prividium.chain,
        transport: custom(window.ethereum)
      });
      const [walletAddress] = await walletClient.requestAddresses();
      setAddress(walletAddress);
    } catch (err) {
      console.error(err);
      setError('Wallet connection failed.');
    }
  };

  const sendMessage = async () => {
    if (!payload.trim()) return;
    if (!address) {
      setError('Connect your wallet to write.');
      return;
    }
    if (!CONTRACT_ADDRESS) {
      setError('Missing VITE_REVEAL_SOON_CONTRACT_ADDRESS env var.');
      return;
    }
    if (!revealContract) {
      setError('Contract client not ready.');
      return;
    }

    setSubmitting(true);
    setError('');
    setReceipt(null);

    try {
      const walletClient = createWalletClient({
        chain: prividium.chain,
        transport: custom(window.ethereum)
      });

      const data = encodeFunctionData({
        abi: REVEAL_SOON_ABI,
        functionName: 'createMessage',
        args: [payload, delaySeconds]
      });

      const nonce = await rpcClient.getTransactionCount({ address });
      const gasPrice = await rpcClient.getGasPrice();
      const gas = await rpcClient.estimateGas({
        account: address,
        to: CONTRACT_ADDRESS,
        data
      });

      const request = await walletClient.prepareTransactionRequest({
        account: address,
        to: CONTRACT_ADDRESS,
        data,
        value: 0n,
        gas,
        gasPrice,
        nonce
      });

      await prividium.authorizeTransaction({
        walletAddress: address,
        toAddress: CONTRACT_ADDRESS,
        nonce: Number(request.nonce),
        calldata: request.data,
        value: request.value
      });

      await walletClient.switchChain({ id: prividium.chain.id });

      const hash = await walletClient.sendTransaction(request);

      const [latest] = await revealContract.read.getRecentMessages([1n, 0n]);

      setReceipt({
        status: 'Submitted',
        messageId: latest ? Number(latest.id) : null,
        createdAt: latest ? Number(latest.createdAt) : Math.floor(Date.now() / 1000),
        revealAt: latest ? Number(latest.revealAt) : Math.floor(Date.now() / 1000) + delaySeconds,
        txHash: hash,
        explorerUrl: explorerTxUrl(prividium.chain, hash)
      });
      setPayload('');
      await loadFeed();
    } catch (err) {
      console.error(err);
      setError('Transaction failed. Check permissions and wallet configuration.');
    } finally {
      setSubmitting(false);
    }
  };

  const delayLabel = DELAY_OPTIONS.find((option) => option.seconds === delaySeconds)?.label ?? '';
  const loginLabel = isAuthorized ? 'Signed in' : 'Sign in for read access';

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>RevealSoon</h1>
          <p className="subtitle">Time-gated privacy: the payload is on-chain now, but readable later.</p>
        </div>
        <div className="header-actions">
          <button className="secondary" onClick={handleAuthorizeRead} disabled={isAuthorized}>
            {loginLabel}
          </button>

        </div>
      </header>

      <TeachingPanel />

      {error && <div className="error">{error}</div>}

      <div className="tabs">
        <button className={activeTab === 'create' ? 'tab active' : 'tab'} onClick={() => setActiveTab('create')}>
          Create
        </button>
        <button className={activeTab === 'recent' ? 'tab active' : 'tab'} onClick={() => setActiveTab('recent')}>
          Recent
        </button>
      </div>

      <main className="main-grid">
        {activeTab === 'create' && (
          <section className="panel">
            <h2>Create</h2>
            <div className="wallet-row">
              <span>{address ? `Wallet: ${formatAddress(address)}` : 'Wallet: not connected'}</span>
              <button className="secondary" onClick={connectWallet}>
                Connect wallet
              </button>
            </div>
            <p className="hint">Login state: {isAuthorized ? 'Authorized' : 'Not signed in'}</p>

            <label className="field">
              <span>Secret message</span>
              <textarea
                value={payload}
                onChange={(event) => setPayload(event.target.value)}
                placeholder="e.g. The launch will be delayed by two weeks."
                disabled={!address}
              />
            </label>

            <label className="field">
              <span>Reveal delay</span>
              <select
                value={delaySeconds}
                onChange={(event) => setDelaySeconds(Number(event.target.value))}
                disabled={!address}
              >
                {DELAY_OPTIONS.map((option) => (
                  <option key={option.seconds} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button onClick={sendMessage} disabled={!address || submitting || !payload.trim()}>
              {submitting ? 'Storing…' : `Store secret (reveals in ${delayLabel})`}
            </button>

            {receipt && (
              <div className="receipt">
                <h3>Receipt</h3>
                <ul>
                  <li>
                    <strong>Message ID:</strong> {receipt.messageId ?? 'Pending'}
                  </li>
                  <li>
                    <strong>Created:</strong> {formatTimestamp(receipt.createdAt)}
                  </li>
                  <li>
                    <strong>Reveal at:</strong> {formatTimestamp(receipt.revealAt)}
                  </li>
                  <li>
                    <strong>Tx:</strong>{' '}
                    {receipt.explorerUrl ? (
                      <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">
                        {receipt.txHash}
                      </a>
                    ) : (
                      receipt.txHash
                    )}
                  </li>
                </ul>
                <p className="hint">
                  The message is already stored in contract storage, but Prividium keeps it private until the reveal
                  time.
                </p>
              </div>
            )}

            {explorerBase && <p className="hint">Explorer base: {explorerBase}</p>}
          </section>
        )}

        {activeTab === 'recent' && (
          <section className="panel">
            <div className="feed-header">
              <h2>Recent</h2>
              <button className="secondary" onClick={loadFeed} disabled={loadingFeed || !isAuthorized}>
                {loadingFeed ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <p className="hint">
              The payload exists in contract storage, but Prividium prevents public reads until the reveal time.
            </p>

            {!isAuthorized && (
              <p className="hint">
                Sign in to load the feed. This demo uses Prividium read access even for public metadata.
              </p>
            )}

            {loadingFeed && <p className="hint">Loading feed…</p>}

            {feed.length === 0 && !loadingFeed ? (
              <p className="hint">No messages yet.</p>
            ) : (
              <ul className="activity-list">
                {feed.map((item) => (
                  <MessageRow key={item.id} item={item} />
                ))}
              </ul>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
