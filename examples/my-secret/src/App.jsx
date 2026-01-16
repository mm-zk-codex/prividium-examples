import { useCallback, useEffect, useMemo, useState } from 'react';
import { getContract, createWalletClient, custom, encodeFunctionData } from 'viem';
import { createPrividiumClient } from 'prividium';
import { prividium } from './prividium';
import { NOTES_ABI } from './notesAbi';
import { explorerTxUrl, formatAddress, formatTimestamp, timeAgo, ZERO_ADDRESS } from './utils';

const CONTRACT_ADDRESS = import.meta.env.VITE_NOTES_CONTRACT_ADDRESS;
const FEED_PAGE_SIZE = 20n;

function TeachingPanel() {
  return (
    <section className="panel teaching">
      <h2>Teaching: What is public vs. private in Prividium?</h2>
      <div className="teaching-grid">
        <div>
          <h3>Always Public</h3>
          <ul>
            <li>This note is stored in contract storage on Prividium.</li>
            <li>Public metadata includes author + timestamp + visibility.</li>
          </ul>
        </div>
        <div>
          <h3>Private with Prividium (when Secret selected)</h3>
          <ul>
            <li>The note text (stored on-chain, but not publicly readable)</li>
            <li>Becomes readable only after you reveal it</li>
          </ul>
        </div>
      </div>
      <p className="teaching-copy">
        When you reveal, anyone can read it and verify it was originally written on the recorded timestamp.
      </p>
    </section>
  );
}

function ActivityItem({ item, onReveal }) {
  const badge = item.isPublic ? 'PUBLIC' : 'SECRET';
  const actionLabel = item.isPublic ? 'wrote a public note' : 'stored a secret note';

  return (
    <li className="activity-item">
      <header>
        <span className={`badge ${badge.toLowerCase()}`}>{badge}</span>
        <div className="activity-meta">
          <strong title={item.author}>{formatAddress(item.author)}</strong> {actionLabel}
          <div className="time">
            {formatTimestamp(item.createdAt)} · <span>{timeAgo(item.createdAt)}</span>
          </div>
        </div>
      </header>

      <div className="activity-body">
        {item.isPublic && (
          <div className="note">
            <p className="note-text">“{item.note}”</p>
            <p className="note-meta">Originally stored at {formatTimestamp(item.createdAt)}.</p>
          </div>
        )}

        {!item.isPublic && (
          <div className="note">
            <p className="note-text placeholder">🔒 Private note stored on Prividium — content not publicly readable.</p>
            <details>
              <summary>Why can’t I see this?</summary>
              <ul>
                <li>This note is in contract storage on Prividium.</li>
                <li>Public metadata includes author + timestamp + visibility.</li>
                <li>The author can later reveal it to make the content public.</li>
              </ul>
            </details>
            {item.canReveal && (
              <button className="secondary" onClick={() => onReveal(item)}>
                Reveal my note
              </button>
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

  const notesContract = useMemo(() => {
    if (!CONTRACT_ADDRESS) return null;
    return getContract({
      address: CONTRACT_ADDRESS,
      abi: NOTES_ABI,
      client: rpcClient
    });
  }, [rpcClient]);

  const loadFeed = useCallback(async () => {
    if (!CONTRACT_ADDRESS) {
      setError('Missing VITE_NOTES_CONTRACT_ADDRESS env var.');
      return;
    }
    if (!notesContract) {
      setError('Contract client not ready.');
      return;
    }

    setLoadingFeed(true);
    setError('');

    try {
      const total = await notesContract.read.getNotesCount();
      if (total === 0n) {
        setFeed([]);
        return;
      }

      const headers = await notesContract.read.getRecentNotes([FEED_PAGE_SIZE, 0n]);
      const items = await Promise.all(
        headers.map(async (header) => {
          const isPublic = header.isPublic;
          const noteId = Number(header.noteId);
          const note = isPublic ? await notesContract.read.getPublicNoteContent([header.noteId]) : '';
          return {
            id: `note-${noteId}`,
            noteId,
            author: header.author,
            createdAt: Number(header.createdAt),
            isPublic,
            note,
            canReveal: !isPublic && address && header.author?.toLowerCase() === address.toLowerCase()
          };
        })
      );

      setFeed(items);
    } catch (err) {
      console.error(err);
      setError('Failed to load activity feed. Check your Prividium auth and contract permissions.');
    } finally {
      setLoadingFeed(false);
    }
  }, [address, notesContract]);

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
      //await prividium.addNetworkToWallet();
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
      console.log("Prividium chain is ", prividium.chain);

      const data = encodeFunctionData({
        abi: NOTES_ABI,
        functionName: 'createNote',
        args: [note, visibility === 'public']
      });

      console.log("Before request prep");
      const nonce = await rpcClient.getTransactionCount({ address });
      const gasPrice = await rpcClient.getGasPrice();


      const request = await walletClient.prepareTransactionRequest({
        account: address,
        to: CONTRACT_ADDRESS,
        data,
        value: 0n,
        gas: 1000000n,
        gasPrice: gasPrice,
        nonce: nonce
      });

      console.log("Request is ready");


      await prividium.authorizeTransaction({
        walletAddress: address,
        toAddress: CONTRACT_ADDRESS,
        nonce: Number(request.nonce),
        calldata: request.data,
        value: request.value
      });
      await walletClient.switchChain({ id: prividium.chain.id })


      const hash = await walletClient.sendTransaction(request);

      const now = Math.floor(Date.now() / 1000);

      setReceipt({
        status: 'Submitted',
        txHash: hash,
        explorerUrl: explorerTxUrl(prividium.chain, hash),
        timestamp: now,
        visibility
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

    try {
      const walletClient = createWalletClient({
        chain: prividium.chain,
        transport: custom(window.ethereum)
      });

      const data = encodeFunctionData({
        abi: NOTES_ABI,
        functionName: 'makeNotePublic',
        args: [BigInt(item.noteId)]
      });

      const nonce = await rpcClient.getTransactionCount({ address });
      const gasPrice = await rpcClient.getGasPrice();


      const request = await walletClient.prepareTransactionRequest({
        account: address,
        to: CONTRACT_ADDRESS,
        data,
        value: 0n,
        gas: 500000n,
        gasPrice: gasPrice,
        nonce: nonce
      });

      await prividium.authorizeTransaction({
        walletAddress: address,
        toAddress: CONTRACT_ADDRESS,
        nonce: Number(request.nonce),
        calldata: request.data,
        value: request.value
      });

      const hash = await walletClient.sendTransaction(request);

      setReceipt({
        status: 'Submitted',
        txHash: hash,
        explorerUrl: explorerTxUrl(prividium.chain, hash),
        timestamp: Math.floor(Date.now() / 1000),
        visibility: 'public'
      });

      await loadFeed();
    } catch (err) {
      console.error(err);
      setError('Reveal failed. Make sure you are the author of the note.');
    }
  };

  const loginLabel = isAuthorized ? 'Signed in' : 'Sign in for read access';

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>My Secret</h1>
          <p className="subtitle">A tiny Prividium demo: secret vs public notes stored directly on-chain.</p>
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
