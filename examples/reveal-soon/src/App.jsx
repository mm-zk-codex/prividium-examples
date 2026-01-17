import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createWalletClient, custom, encodeFunctionData, formatEther, getContract } from 'viem';
import { createPrividiumClient } from 'prividium';
import { prividium } from './prividium';
import { REVEAL_SOON_ABI } from './messageAbi';
import logo from './assets/logo.svg';
import {
  copyToClipboard,
  explorerTxUrl,
  formatAddress,
  formatCountdown,
  formatRelative,
  formatTimestamp,
  timeAgo,
  truncateMiddle,
  ZERO_ADDRESS
} from './utils';

const CONTRACT_ADDRESS = import.meta.env.VITE_REVEAL_SOON_CONTRACT_ADDRESS;
const FEED_PAGE_SIZE = 50;
const LOW_BALANCE_THRESHOLD = 1_000_000_000_000_000n; // 0.001 native token

const DELAY_OPTIONS = [
  { label: '1 minute', seconds: 60 },
  { label: '5 minutes', seconds: 300 },
  { label: '30 minutes', seconds: 1800 },
  { label: '1 hour', seconds: 3600 },
  { label: '24 hours', seconds: 86400 },
  { label: 'Custom minutes', seconds: 'custom' }
];

const PUBLIC_TEXT_HINT = 'Teaser (80–120 chars works well).';

function parseRoute(pathname) {
  const match = pathname.match(/^\/message\/(\d+)/);
  if (match) {
    return { view: 'message', messageId: Number(match[1]) };
  }
  return { view: 'home', messageId: null };
}

function useChainNow(rpcClient, enabled) {
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const tick = () => setNowSeconds(Math.floor(Date.now() / 1000) + offsetSeconds);
    tick();
    const interval = window.setInterval(tick, 500);
    return () => window.clearInterval(interval);
  }, [offsetSeconds]);

  useEffect(() => {
    if (!rpcClient || !enabled) return;
    let active = true;

    const sync = async () => {
      try {
        const block = await rpcClient.getBlock();
        if (!active) return;
        const chainTime = Number(block.timestamp);
        const localTime = Math.floor(Date.now() / 1000);
        setOffsetSeconds(chainTime - localTime);
        setSynced(true);
      } catch (error) {
        console.warn('Failed to sync chain time', error);
        if (active) setSynced(false);
      }
    };

    sync();
    const interval = window.setInterval(sync, 30000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [rpcClient, enabled]);

  return { nowSeconds, synced };
}

function TeachingPanel({ compact }) {
  return (
    <section className={compact ? 'panel teaching compact' : 'panel teaching'}>
      <h2>RevealSoon: public teaser + private reveal</h2>
      <div className="teaching-grid">
        <div>
          <h3>Public immediately</h3>
          <ul>
            <li>Public teaser text</li>
            <li>Author + timestamps</li>
            <li>Reveal schedule</li>
          </ul>
        </div>
        <div>
          <h3>Private until reveal</h3>
          <ul>
            <li>Full private message</li>
          </ul>
        </div>
      </div>
      <p className="teaching-copy">
        Both parts live on-chain in contract storage. Prividium keeps the private text unreadable until reveal time — no
        events, no server timers, no explicit reveal transaction.
      </p>
    </section>
  );
}

function MessageRow({ item, nowSeconds, onOpen, txHash, explorerUrl }) {
  const isRevealed = nowSeconds >= item.revealAt;
  const revealLabel = isRevealed ? 'Revealed' : 'Hidden';
  const countdown = formatCountdown(item.revealAt, nowSeconds);
  const isFreshReveal = isRevealed && nowSeconds - item.revealAt < 120;

  return (
    <li className="activity-item">
      <div className="activity-grid">
        <div className="status-col">
          <div className="status-badges">
            <span className={`badge ${isRevealed ? 'reveal' : 'secret'}`}>{revealLabel}</span>
            {isFreshReveal && <span className="badge unlocked pulse">Unlocked!</span>}
          </div>
          <strong className="truncate" title={item.publicText}>
            {item.publicText}
          </strong>
          <div className="time">
            Created {formatTimestamp(item.createdAt)} · {timeAgo(item.createdAt, nowSeconds)}
          </div>
        </div>
        <div className="author-col">
          <span className="label">Author</span>
          <div className="inline-meta">
            <span className="truncate" title={item.author}>
              {truncateMiddle(item.author)}
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label="Copy author"
              onClick={() => copyToClipboard(item.author)}
            >
              ⧉
            </button>
          </div>
        </div>
        <div className="reveal-col">
          <span className="label">Reveal</span>
          <span>{formatTimestamp(item.revealAt)}</span>
          <span className="subtle">{isRevealed ? 'Now public' : `Unlocks in ${countdown}`}</span>
        </div>
        <div className="tx-col">
          <span className="label">Tx / link</span>
          <div className="inline-meta">
            <span className="truncate" title={txHash || 'Not available'}>
              {txHash ? truncateMiddle(txHash) : '—'}
            </span>
            {txHash && (
              <button
                className="icon-button"
                type="button"
                aria-label="Copy transaction hash"
                onClick={() => copyToClipboard(txHash)}
              >
                ⧉
              </button>
            )}
            {explorerUrl && (
              <a className="icon-button" href={explorerUrl} target="_blank" rel="noreferrer" aria-label="View on explorer">
                ↗
              </a>
            )}
          </div>
          <button
            className="secondary small"
            type="button"
            onClick={() => {
              onOpen(item.messageId);
            }}
          >
            Open
          </button>
        </div>
      </div>
    </li>
  );
}

function MessagePage({
  messageId,
  revealContract,
  nowSeconds,
  synced,
  txHash,
  txLink,
  onBack,
  onShare,
  onCelebrate,
  hasCelebrated,
  markCelebrated
}) {
  const [message, setMessage] = useState(null);
  const [privateText, setPrivateText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showUnlocked, setShowUnlocked] = useState(false);

  useEffect(() => {
    if (!revealContract) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const header = await revealContract.read.getMessageHeader([BigInt(messageId)]);
        const publicText = await revealContract.read.getPublicText([BigInt(messageId)]);
        if (!active) return;
        setMessage({
          id: Number(header.id),
          author: header.author,
          createdAt: Number(header.createdAt),
          revealAt: Number(header.revealAt),
          publicText
        });
      } catch (err) {
        console.error(err);
        if (active) setError('Unable to load this message. Check permissions and the message id.');
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [messageId, revealContract]);

  useEffect(() => {
    if (!revealContract || !message) return;
    if (nowSeconds < message.revealAt) return;
    if (privateText) return;
    let active = true;
    const loadPrivate = async () => {
      try {
        const text = await revealContract.read.getPrivateText([BigInt(messageId)]);
        if (active) setPrivateText(text);
      } catch (err) {
        console.warn('Private text still locked', err);
      }
    };
    loadPrivate();
    return () => {
      active = false;
    };
  }, [messageId, message, nowSeconds, privateText, revealContract]);

  useEffect(() => {
    if (!message) return;
    if (nowSeconds < message.revealAt) return;
    if (!privateText) return;
    if (hasCelebrated(message.id)) return;
    markCelebrated(message.id);
    onCelebrate();
    setShowUnlocked(true);
    const timeout = window.setTimeout(() => setShowUnlocked(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [hasCelebrated, markCelebrated, message, nowSeconds, onCelebrate, privateText]);

  if (loading) {
    return (
      <section className="panel">
        <button className="secondary" onClick={onBack}>
          ← Back
        </button>
        <p className="hint">Loading message…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel">
        <button className="secondary" onClick={onBack}>
          ← Back
        </button>
        <p className="error">{error}</p>
      </section>
    );
  }

  if (!message) return null;

  const isRevealed = nowSeconds >= message.revealAt;
  const countdown = formatCountdown(message.revealAt, nowSeconds);

  return (
    <section className="panel message-panel">
      <div className="message-header">
        <button className="secondary" onClick={onBack}>
          ← Back
        </button>
        <button className="secondary" onClick={onShare}>
          Share
        </button>
      </div>

      <h2 className="message-title">{message.publicText}</h2>
      <p className="hint">
        {isRevealed ? 'Revealed to everyone.' : `Unlocks in ${countdown}.`}{' '}
        {!synced && <span className="subtle">(based on local clock)</span>}
      </p>

      <div className="metadata">
        <div>
          <span className="label">Author</span>
          <div className="inline-meta">
            <span className="truncate" title={message.author}>
              {truncateMiddle(message.author)}
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label="Copy author"
              onClick={() => copyToClipboard(message.author)}
            >
              ⧉
            </button>
          </div>
        </div>
        <div>
          <span className="label">Created</span>
          <span>
            {formatTimestamp(message.createdAt)} · {timeAgo(message.createdAt, nowSeconds)}
          </span>
        </div>
        <div>
          <span className="label">Reveal at</span>
          <span>
            {formatTimestamp(message.revealAt)} · {formatRelative(message.revealAt, nowSeconds)}
          </span>
        </div>
        <div>
          <span className="label">Tx hash</span>
          <div className="inline-meta">
            <span className="truncate" title={txHash || 'Not available'}>
              {txHash ? truncateMiddle(txHash) : 'Not available'}
            </span>
            {txHash && (
              <button
                className="icon-button"
                type="button"
                aria-label="Copy transaction hash"
                onClick={() => copyToClipboard(txHash)}
              >
                ⧉
              </button>
            )}
            {txLink && (
              <a className="icon-button" href={txLink} target="_blank" rel="noreferrer" aria-label="View on explorer">
                ↗
              </a>
            )}
          </div>
        </div>
      </div>

      <div className={`private-block ${isRevealed ? 'revealed' : ''}`}>
        <div className="private-header">
          <h3>{isRevealed ? 'Revealed payload' : 'Private reveal'}</h3>
          {showUnlocked && <span className="badge unlocked pulse">Unlocked!</span>}
        </div>
        {isRevealed ? (
          <div className="revealed-content">
            <span className="label">Payload</span>
            <pre className="private-text">{privateText || 'Fetching private text…'}</pre>
          </div>
        ) : (
          <div className="note">
            <p className="note-text placeholder">🔒 Private text stored on-chain but unreadable until reveal time.</p>
            <p className="note-meta">Prividium enforces access based on block time — no manual reveal transaction.</p>
          </div>
        )}
      </div>

      <TeachingPanel compact />
    </section>
  );
}

export default function App() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [address, setAddress] = useState('');
  const [walletClient, setWalletClient] = useState(null);
  const [publicText, setPublicText] = useState('');
  const [privateText, setPrivateText] = useState('');
  const [delaySelection, setDelaySelection] = useState(String(DELAY_OPTIONS[0].seconds));
  const [customMinutes, setCustomMinutes] = useState('10');
  const [activeTab, setActiveTab] = useState('upcoming');
  const [feed, setFeed] = useState([]);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname));
  const [txById, setTxById] = useState({});
  const [shareNotice, setShareNotice] = useState('');
  const [celebrationActive, setCelebrationActive] = useState(false);
  const [balanceWei, setBalanceWei] = useState(null);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const celebratedRef = useRef(new Set());

  const explorerBase = prividium.chain.blockExplorers?.default?.url;

  useEffect(() => {
    setIsAuthorized(prividium.isAuthorized());
  }, []);

  useEffect(() => {
    const handlePop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
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

  const { nowSeconds, synced } = useChainNow(rpcClient, isAuthorized);

  const refreshBalance = useCallback(
    async ({ showError } = { showError: false }) => {
      if (!address) return;
      setIsRefreshingBalance(true);
      try {
        const balance = await rpcClient.getBalance({ address });
        setBalanceWei(balance);
      } catch (err) {
        console.warn('Failed to fetch balance', err);
        setBalanceWei(null);
        if (showError) {
          setError('Unable to fetch wallet balance. Sign in again or refresh.');
        }
      } finally {
        setIsRefreshingBalance(false);
      }
    },
    [address, rpcClient]
  );

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
      const total = Number(await revealContract.read.getMessagesCount());
      if (total === 0) {
        setFeed([]);
        return;
      }

      const count = Math.min(total, FEED_PAGE_SIZE);
      const start = total - count;
      const headers = await revealContract.read.getMessagesRange([BigInt(start), BigInt(count)]);

      const items = await Promise.all(
        headers.map(async (header) => {
          const id = Number(header.id);
          const publicTextValue = await revealContract.read.getPublicText([header.id]);
          return {
            id: `message-${id}`,
            messageId: id,
            author: header.author,
            createdAt: Number(header.createdAt),
            revealAt: Number(header.revealAt),
            publicText: publicTextValue
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

  useEffect(() => {
    if (!address) {
      setBalanceWei(null);
      return;
    }
    refreshBalance();
  }, [address, refreshBalance]);

  useEffect(() => {
    if (isAuthorized && address) {
      refreshBalance();
    }
  }, [address, isAuthorized, refreshBalance]);

  useEffect(() => {
    if (!window.ethereum) return undefined;

    const handleAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        setAddress('');
        setWalletClient(null);
        setBalanceWei(null);
        return;
      }
      setAddress(accounts[0]);
    };

    const handleDisconnect = () => {
      setAddress('');
      setWalletClient(null);
      setBalanceWei(null);
    };

    const handleChainChanged = () => {
      refreshBalance();
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('disconnect', handleDisconnect);
    window.ethereum.on('chainChanged', handleChainChanged);

    return () => {
      window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
      window.ethereum.removeListener('disconnect', handleDisconnect);
      window.ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, [refreshBalance]);

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
    setIsConnecting(true);
    try {
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
        setError('No account selected / permission not granted. Try Connect again.');
        setAddress('');
        setWalletClient(null);
        return;
      }
      setWalletClient(nextWalletClient);
      setAddress(accounts[0]);
    } catch (err) {
      console.error(err);
      if (err?.code === 4001) {
        setError('Wallet connection was rejected. Please approve permissions to continue.');
      } else {
        setError('Wallet connection failed.');
      }
    } finally {
      setIsConnecting(false);
    }
  };

  const delaySeconds =
    delaySelection === 'custom'
      ? Math.max(Number(customMinutes || 0), 1) * 60
      : Number(delaySelection);

  const sendMessage = async () => {
    if (!publicText.trim() || !privateText.trim()) return;
    if (!address) {
      setError('Connect your wallet to write.');
      return;
    }
    if (!walletClient) {
      setError('Wallet client not ready. Try reconnecting your wallet.');
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
      const data = encodeFunctionData({
        abi: REVEAL_SOON_ABI,
        functionName: 'createMessage',
        args: [publicText.trim(), privateText.trim(), delaySeconds]
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
      await rpcClient.waitForTransactionReceipt({ hash });

      const total = Number(await revealContract.read.getMessagesCount());
      const messageId = total > 0 ? total - 1 : null;
      const header = messageId !== null ? await revealContract.read.getMessageHeader([BigInt(messageId)]) : null;

      const receiptPayload = {
        status: 'Submitted',
        messageId,
        createdAt: header ? Number(header.createdAt) : Math.floor(Date.now() / 1000),
        revealAt: header ? Number(header.revealAt) : Math.floor(Date.now() / 1000) + delaySeconds,
        txHash: hash,
        explorerUrl: explorerTxUrl(prividium.chain, hash)
      };

      setTxById((prev) => (messageId !== null ? { ...prev, [messageId]: hash } : prev));
      setReceipt(receiptPayload);
      setPublicText('');
      setPrivateText('');
      await loadFeed();
      await refreshBalance();
    } catch (err) {
      console.error(err);
      setError('Transaction failed. Check permissions and wallet configuration.');
    } finally {
      setSubmitting(false);
    }
  };

  const sortedFeed = useMemo(() => {
    return [...feed].sort((a, b) => a.revealAt - b.revealAt);
  }, [feed]);

  const loginLabel = isAuthorized ? 'Signed in' : 'Sign in for read access';
  const nativeSymbol = prividium.chain.nativeCurrency?.symbol ?? 'ETH';
  const formattedBalance = balanceWei === null ? '—' : `${Number(formatEther(balanceWei)).toFixed(4)} ${nativeSymbol}`;
  const balanceIsZero = balanceWei === 0n;
  const hasLowBalance = balanceWei !== null && balanceWei > 0n && balanceWei < LOW_BALANCE_THRESHOLD;
  const balanceState = balanceWei === null ? 'neutral' : balanceIsZero ? 'danger' : hasLowBalance ? 'warning' : 'ok';
  const balanceMessage =
    balanceWei === null
      ? 'Balance unavailable'
      : balanceIsZero
      ? 'No balance for gas — Create will fail'
      : hasLowBalance
      ? 'Low balance — may fail'
      : 'Balance OK';
  const createDisabled =
    !address || !walletClient || isConnecting || submitting || !publicText.trim() || !privateText.trim() || balanceIsZero;

  const navigate = useCallback((path) => {
    window.history.pushState({}, '', path);
    setRoute(parseRoute(path));
  }, []);

  const openMessage = useCallback(
    (messageId) => {
      navigate(`/message/${messageId}`);
    },
    [navigate]
  );

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareNotice('Link copied.');
      window.setTimeout(() => setShareNotice(''), 2000);
    } catch (err) {
      console.error(err);
      setShareNotice('Copy failed.');
    }
  };

  const onCelebrate = useCallback(() => {
    setCelebrationActive(true);
    window.setTimeout(() => setCelebrationActive(false), 1200);
  }, []);

  const hasCelebrated = useCallback((id) => celebratedRef.current.has(id), []);
  const markCelebrated = useCallback((id) => celebratedRef.current.add(id), []);

  const headerContent = (
    <div className="header-brand">
      <img className="logo" src={logo} alt="RevealSoon logo" />
      <div>
        <h1>RevealSoon</h1>
        <p className="subtitle">Public teaser now, private reveal later.</p>
      </div>
    </div>
  );

  if (route.view === 'message' && route.messageId !== null) {
    const txHash = txById[route.messageId];
    const txLink = txHash ? explorerTxUrl(prividium.chain, txHash) : '';
    return (
      <div className="app">
        <header className="app-header">
          {headerContent}
          <div className="header-actions">
            <button className="secondary" onClick={handleAuthorizeRead} disabled={isAuthorized}>
              {loginLabel}
            </button>

          </div>
        </header>

        {error && <div className="error">{error}</div>}

        <MessagePage
          messageId={route.messageId}
          revealContract={revealContract}
          nowSeconds={nowSeconds}
          synced={synced}
          txHash={txHash}
          txLink={txLink}
          onBack={() => navigate('/')}
          onShare={handleShare}
          onCelebrate={onCelebrate}
          hasCelebrated={hasCelebrated}
          markCelebrated={markCelebrated}
        />
        <div className={`celebration-layer ${celebrationActive ? 'active' : ''}`} aria-hidden={!celebrationActive}>
          <span className="celebration-emoji">🎉</span>
          <span className="celebration-emoji">✨</span>
          <span className="celebration-emoji">🎊</span>
          <span className="celebration-emoji">🔓</span>
        </div>
        {shareNotice && <p className="hint">{shareNotice}</p>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        {headerContent}
        <div className="header-actions">
          <button className="secondary" onClick={handleAuthorizeRead} disabled={isAuthorized}>
            {loginLabel}
          </button>

        </div>
      </header>

      <TeachingPanel />

      {error && <div className="error">{error}</div>}

      <div className="tabs">
        <button className={activeTab === 'upcoming' ? 'tab active' : 'tab'} onClick={() => setActiveTab('upcoming')}>
          Upcoming Unlocks
        </button>
        <button className={activeTab === 'create' ? 'tab active' : 'tab'} onClick={() => setActiveTab('create')}>
          Create
        </button>
      </div>

      <main className="main-grid">
        {activeTab === 'upcoming' && (
          <section className="panel">
            <div className="feed-header">
              <h2>Upcoming unlocks</h2>
              <button className="secondary" onClick={loadFeed} disabled={loadingFeed || !isAuthorized}>
                {loadingFeed ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
            <p className="hint">
              Sorted by soonest reveal time.{' '}
              {synced ? 'Countdowns synced to chain time.' : 'Countdowns use local time; refresh to resync.'}
            </p>

            {!isAuthorized && (
              <p className="hint">
                Sign in to load the feed. This demo uses Prividium read access even for public metadata.
              </p>
            )}

            {loadingFeed && <p className="hint">Loading feed…</p>}

            {sortedFeed.length === 0 && !loadingFeed ? (
              <p className="hint">No messages yet.</p>
            ) : (
              <div className="activity-table">
                <div className="activity-grid header-row">
                  <span>Status</span>
                  <span>Author</span>
                  <span>Reveal time</span>
                  <span>Tx / explorer</span>
                </div>
                <ul className="activity-list">
                  {sortedFeed.map((item) => {
                    const txHash = txById[item.messageId];
                    const explorerUrl = txHash ? explorerTxUrl(prividium.chain, txHash) : '';
                    return (
                      <MessageRow
                        key={item.id}
                        item={item}
                        nowSeconds={nowSeconds}
                        onOpen={openMessage}
                        txHash={txHash}
                        explorerUrl={explorerUrl}
                      />
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        )}

        {activeTab === 'create' && (
          <section className="panel">
            <h2>Create</h2>
            <div className="wallet-row">
              <span>{address ? `Wallet: ${formatAddress(address)}` : 'Wallet: not connected'}</span>
              <button className="secondary" onClick={connectWallet} disabled={isConnecting}>
                {isConnecting ? 'Connecting…' : 'Connect wallet'}
              </button>
            </div>
            <p className="hint">Login state: {isAuthorized ? 'Authorized' : 'Not signed in'}</p>

            <label className="field">
              <span>Public teaser</span>
              <input
                value={publicText}
                onChange={(event) => setPublicText(event.target.value)}
                placeholder="e.g. The project launches next week."
                maxLength={120}
                disabled={!address}
              />
              <span className="hint">{PUBLIC_TEXT_HINT}</span>
            </label>

            <label className="field">
              <span>Private reveal</span>
              <textarea
                value={privateText}
                onChange={(event) => setPrivateText(event.target.value)}
                placeholder="Full reveal details live here."
                disabled={!address}
              />
            </label>

            <label className="field">
              <span>Reveal delay</span>
              <select
                value={delaySelection}
                onChange={(event) => setDelaySelection(event.target.value)}
                disabled={!address}
              >
                {DELAY_OPTIONS.map((option) => (
                  <option key={option.label} value={option.seconds}>
                    {option.label}
                  </option>
                ))}
              </select>
              {delaySelection === 'custom' && (
                <input
                  type="number"
                  min="1"
                  value={customMinutes}
                  onChange={(event) => setCustomMinutes(event.target.value)}
                  placeholder="Minutes"
                  disabled={!address}
                />
              )}
            </label>

            <button
              onClick={sendMessage}
              disabled={createDisabled}
            >
              {submitting ? 'Storing…' : 'Create message'}
            </button>
            {address && (
              <div className="balance-row">
                <span className="label">Balance</span>
                <span className="balance-value">{formattedBalance}</span>
                <span className={`balance-message ${balanceState}`}>{balanceMessage}</span>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Refresh balance"
                  onClick={() => refreshBalance({ showError: true })}
                  disabled={isRefreshingBalance}
                >
                  ⟳
                </button>
              </div>
            )}
            {balanceIsZero && <p className="hint warning">Add funds to pay gas.</p>}

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
                {receipt.messageId !== null && (
                  <button className="secondary" onClick={() => openMessage(receipt.messageId)}>
                    Open message page
                  </button>
                )}
                <p className="hint">
                  Both teaser + reveal are stored on-chain immediately, but Prividium keeps the private text unreadable
                  until reveal time.
                </p>
              </div>
            )}

            {explorerBase && <p className="hint">Explorer base: {explorerBase}</p>}
          </section>
        )}
      </main>
    </div>
  );
}
