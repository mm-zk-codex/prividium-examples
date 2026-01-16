import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  encodePacked,
  keccak256,
  parseAbiItem,
  toHex
} from 'viem';
import { createPrividiumClient } from 'prividium';
import { prividium } from './prividium';
import { NOTES_ABI, NOTE_EVENTS } from './notesAbi';
import {
  explorerTxUrl,
  formatAddress,
  formatTimestamp,
  randomSalt,
  timeAgo,
  ZERO_ADDRESS
} from './utils';

const CONTRACT_ADDRESS = import.meta.env.VITE_NOTES_CONTRACT_ADDRESS;
const FEED_BLOCK_RANGE = Number(import.meta.env.VITE_FEED_BLOCK_RANGE || 5000);

function TeachingPanel() {
  return (
    <section className="panel teaching">
      <h2>Teaching: What is public vs. private in Prividium?</h2>
      <div className="teaching-grid">
        <div>
          <h3>Always Public</h3>
          <ul>
            <li>An action happened</li>
            <li>Who submitted it (address)</li>
            <li>When it happened (timestamp)</li>
            <li>Transaction hash / explorer link</li>
          </ul>
        </div>
        <div>
          <h3>Private with Prividium (when Secret selected)</h3>
          <ul>
            <li>The note text</li>
            <li>Only becomes visible if later revealed / made public</li>
          </ul>
        </div>
      </div>
      <p className="teaching-copy">
        On a normal public chain, the note text would be visible immediately. Prividium lets you keep the payload
        private while keeping a public, timestamped footprint that can be verified later.
      </p>
    </section>
  );
}

function ActivityItem({ item, onReveal }) {
  const badge = item.type === 'public' ? 'PUBLIC' : item.type === 'secret' ? 'SECRET' : 'REVEAL';
  const actionLabel =
    item.type === 'public' ? 'set a public note' : item.type === 'secret' ? 'set a secret' : 'revealed a note';

  return (
    <li className="activity-item">
      <header>
        <span className={`badge ${badge.toLowerCase()}`}>{badge}</span>
        <div className="activity-meta">
          <strong title={item.actor}>{formatAddress(item.actor)}</strong> {actionLabel}
          <div className="time">
            {formatTimestamp(item.timestamp)} · <span>{timeAgo(item.timestamp)}</span>
          </div>
        </div>
      </header>

      <div className="activity-body">
        <div className="tx-row">
          <span className="label">Tx</span>
          {item.explorerUrl ? (
            <a href={item.explorerUrl} target="_blank" rel="noreferrer">
              {item.txHash.slice(0, 10)}…
            </a>
          ) : (
            <span>{item.txHash.slice(0, 10)}…</span>
          )}
        </div>

        {item.type === 'public' && (
          <div className="note">
            <p className="note-text">“{item.note}”</p>
            <p className="note-meta">Originally set at {formatTimestamp(item.timestamp)}.</p>
          </div>
        )}

        {item.type === 'secret' && (
          <div className="note">
            <p className="note-text placeholder">(Secret note text hidden)</p>
            <details>
              <summary>Why can’t I see this?</summary>
              <ul>
                <li>The payload is stored privately via Prividium.</li>
                <li>Explorers show metadata, not secret content.</li>
                <li>The author can later reveal using the commitment hash.</li>
              </ul>
            </details>
            {item.canReveal && (
              <button className="secondary" onClick={() => onReveal(item)}>
                Reveal my note
              </button>
            )}
          </div>
        )}

        {item.type === 'reveal' && (
          <div className="note">
            <p className="note-text">“{item.note}”</p>
            {item.originalTimestamp && (
              <p className="note-meta">Originally set at {formatTimestamp(item.originalTimestamp)}.</p>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

export default function App() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState('secret');
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

  const loadFeed = useCallback(async () => {
    if (!CONTRACT_ADDRESS) {
      setError('Missing VITE_NOTES_CONTRACT_ADDRESS env var.');
      return;
    }

    setLoadingFeed(true);
    setError('');

    try {
      const latestBlock = await rpcClient.getBlockNumber();
      const range = BigInt(Math.max(1, FEED_BLOCK_RANGE));
      const fromBlock = latestBlock > range ? latestBlock - range : 0n;

      const [publicLogs, secretLogs, revealLogs] = await Promise.all([
        rpcClient.getLogs({
          address: CONTRACT_ADDRESS,
          event: parseAbiItem(NOTE_EVENTS.public),
          fromBlock,
          toBlock: 'latest'
        }),
        rpcClient.getLogs({
          address: CONTRACT_ADDRESS,
          event: parseAbiItem(NOTE_EVENTS.secret),
          fromBlock,
          toBlock: 'latest'
        }),
        rpcClient.getLogs({
          address: CONTRACT_ADDRESS,
          event: parseAbiItem(NOTE_EVENTS.reveal),
          fromBlock,
          toBlock: 'latest'
        })
      ]);

      const secretsByCommitment = new Map();
      const secretItems = secretLogs.map((log) => {
        const commitment = log.args.commitment;
        secretsByCommitment.set(commitment, log.args.timestamp);
        return {
          id: `secret-${log.transactionHash}-${log.logIndex}`,
          type: 'secret',
          actor: log.args.author,
          timestamp: Number(log.args.timestamp),
          commitment,
          txHash: log.transactionHash,
          explorerUrl: explorerTxUrl(prividium.chain, log.transactionHash),
          logIndex: Number(log.logIndex)
        };
      });

      const publicItems = publicLogs.map((log) => ({
        id: `public-${log.transactionHash}-${log.logIndex}`,
        type: 'public',
        actor: log.args.author,
        timestamp: Number(log.args.timestamp),
        note: log.args.note,
        txHash: log.transactionHash,
        explorerUrl: explorerTxUrl(prividium.chain, log.transactionHash),
        logIndex: Number(log.logIndex)
      }));

      const revealItems = revealLogs.map((log) => ({
        id: `reveal-${log.transactionHash}-${log.logIndex}`,
        type: 'reveal',
        actor: log.args.author,
        timestamp: Number(log.args.timestamp),
        note: log.args.note,
        commitment: log.args.commitment,
        originalTimestamp: secretsByCommitment.get(log.args.commitment),
        txHash: log.transactionHash,
        explorerUrl: explorerTxUrl(prividium.chain, log.transactionHash),
        logIndex: Number(log.logIndex)
      }));

      const allItems = [...secretItems, ...publicItems, ...revealItems]
        .sort((a, b) => {
          if (b.timestamp !== a.timestamp) {
            return b.timestamp - a.timestamp;
          }
          return b.logIndex - a.logIndex;
        })
        .map((item) => ({
          ...item,
          canReveal:
            item.type === 'secret' &&
            address &&
            item.actor?.toLowerCase() === address.toLowerCase() &&
            !!localStorage.getItem(`my-secret:${item.commitment}`)
        }));

      setFeed(allItems);
    } catch (err) {
      console.error(err);
      setError('Failed to load activity feed. Check your Prividium auth and contract permissions.');
    } finally {
      setLoadingFeed(false);
    }
  }, [address, rpcClient]);

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
      await prividium.addNetworkToWallet();
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

  const sendNote = async () => {
    if (!note.trim()) return;
    if (!address) {
      setError('Connect your wallet to write.');
      return;
    }
    if (!CONTRACT_ADDRESS) {
      setError('Missing VITE_NOTES_CONTRACT_ADDRESS env var.');
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

      const args = visibility === 'public'
        ? [note]
        : (() => {
            const salt = randomSalt();
            const commitment = keccak256(encodePacked(['string', 'bytes32', 'address'], [note, toHex(salt), address]));
            localStorage.setItem(
              `my-secret:${commitment}`,
              JSON.stringify({ note, salt: toHex(salt), address })
            );
            return [commitment];
          })();

      const data = encodeFunctionData({
        abi: NOTES_ABI,
        functionName: visibility === 'public' ? 'setPublic' : 'setSecret',
        args
      });

      const nonce = await rpcClient.getTransactionCount({ address });
      const gas = await rpcClient.estimateGas({
        account: address,
        to: CONTRACT_ADDRESS,
        data
      });
      const gasPrice = await rpcClient.getGasPrice();

      await prividium.authorizeTransaction({
        walletAddress: address,
        contractAddress: CONTRACT_ADDRESS,
        nonce: Number(nonce),
        calldata: data,
        value: 0n
      });

      const hash = await walletClient.sendTransaction({
        account: address,
        to: CONTRACT_ADDRESS,
        data,
        nonce,
        gas,
        gasPrice,
        value: 0n
      });

      const now = Math.floor(Date.now() / 1000);
      const commitment = visibility === 'secret' ? args[0] : null;

      setReceipt({
        status: 'Submitted',
        txHash: hash,
        explorerUrl: explorerTxUrl(prividium.chain, hash),
        timestamp: now,
        visibility,
        commitment
      });
      setNote('');
      await loadFeed();
    } catch (err) {
      console.error(err);
      setError('Transaction failed. Check permissions and wallet configuration.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReveal = async (item) => {
    if (!address) return;
    const stored = localStorage.getItem(`my-secret:${item.commitment}`);
    if (!stored) {
      setError('No local secret payload found to reveal.');
      return;
    }

    try {
      const { note: storedNote, salt } = JSON.parse(stored);
      const walletClient = createWalletClient({
        chain: prividium.chain,
        transport: custom(window.ethereum)
      });

      const data = encodeFunctionData({
        abi: NOTES_ABI,
        functionName: 'reveal',
        args: [item.commitment, storedNote, salt]
      });

      const nonce = await rpcClient.getTransactionCount({ address });
      const gas = await rpcClient.estimateGas({
        account: address,
        to: CONTRACT_ADDRESS,
        data
      });
      const gasPrice = await rpcClient.getGasPrice();

      await prividium.authorizeTransaction({
        walletAddress: address,
        contractAddress: CONTRACT_ADDRESS,
        nonce: Number(nonce),
        calldata: data,
        value: 0n
      });

      await walletClient.sendTransaction({
        account: address,
        to: CONTRACT_ADDRESS,
        data,
        nonce,
        gas,
        gasPrice,
        value: 0n
      });

      await loadFeed();
    } catch (err) {
      console.error(err);
      setError('Reveal failed. Make sure the commitment matches your secret.');
    }
  };

  const loginLabel = isAuthorized ? 'Signed in' : 'Sign in for read access';

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>My Secret</h1>
          <p className="subtitle">A tiny Prividium demo: secret vs public notes with timestamped commitments.</p>
        </div>
        <div className="header-actions">
          <button className="secondary" onClick={handleAuthorizeRead} disabled={isAuthorized}>
            {loginLabel}
          </button>
          <button className="secondary" onClick={handleAuthorizeWrite}>
            Enable write access
          </button>
        </div>
      </header>

      <TeachingPanel />

      {error && <div className="error">{error}</div>}

      <main className="main-grid">
        <section className="panel">
          <h2>Write</h2>
          <div className="wallet-row">
            <span>{address ? `Wallet: ${formatAddress(address)}` : 'Wallet: not connected'}</span>
            <button className="secondary" onClick={connectWallet}>
              Connect wallet
            </button>
          </div>

          {!address && <p className="hint">Connect to write.</p>}

          <label className="field">
            <span>My note / prediction</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. ETH will hit 5k"
              disabled={!address}
            />
          </label>

          <div className="toggle-row">
            <label>
              <input
                type="radio"
                name="visibility"
                value="secret"
                checked={visibility === 'secret'}
                onChange={() => setVisibility('secret')}
                disabled={!address}
              />
              Secret
            </label>
            <label>
              <input
                type="radio"
                name="visibility"
                value="public"
                checked={visibility === 'public'}
                onChange={() => setVisibility('public')}
                disabled={!address}
              />
              Public
            </label>
          </div>

          <button onClick={sendNote} disabled={!address || submitting || !note.trim()}>
            {submitting ? 'Saving…' : 'Save'}
          </button>

          {receipt && (
            <div className="receipt">
              <h3>Receipt</h3>
              <ul>
                <li>
                  <strong>Status:</strong> {receipt.status}
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
                <li>
                  <strong>Timestamp:</strong> {formatTimestamp(receipt.timestamp)}
                </li>
                <li>
                  <strong>Visibility:</strong> {receipt.visibility}
                </li>
                {receipt.visibility === 'secret' && (
                  <li>
                    <strong>Hidden payload:</strong> stored privately
                    <div className="hash">Commitment: {receipt.commitment}</div>
                  </li>
                )}
              </ul>
            </div>
          )}

          {explorerBase && (
            <p className="hint">Explorer base: {explorerBase}</p>
          )}
        </section>

        <section className="panel">
          <div className="feed-header">
            <h2>Recent activity</h2>
            <button className="secondary" onClick={loadFeed} disabled={loadingFeed || !isAuthorized}>
              {loadingFeed ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {!isAuthorized && (
            <p className="hint">
              Sign in to load the feed. This demo uses Prividium read access even for public metadata.
            </p>
          )}

          {loadingFeed && <p className="hint">Loading feed…</p>}

          {feed.length === 0 && !loadingFeed ? (
            <p className="hint">No activity yet.</p>
          ) : (
            <ul className="activity-list">
              {feed.map((item) => (
                <ActivityItem key={item.id} item={item} onReveal={handleReveal} />
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
