
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safes (
  safe_address TEXT PRIMARY KEY,
  chain_id INT NOT NULL,
  threshold INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safe_owners (
  safe_address TEXT NOT NULL REFERENCES safes(safe_address) ON DELETE CASCADE,
  owner_address TEXT NOT NULL,
  PRIMARY KEY (safe_address, owner_address)
);

CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY,
  safe_address TEXT NOT NULL REFERENCES safes(safe_address) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  value TEXT NOT NULL,
  data TEXT NOT NULL,
  operation INT NOT NULL,
  nonce BIGINT NOT NULL,
  safe_tx_hash TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,
  is_advanced BOOLEAN NOT NULL DEFAULT FALSE,
  summary JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  executed_tx_hash TEXT NULL,
  executed_at TIMESTAMPTZ NULL
);

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS is_advanced BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS summary JSONB NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_safe_nonce ON proposals(safe_address, nonce);

CREATE TABLE IF NOT EXISTS signatures (
  proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  owner_address TEXT NOT NULL,
  signature TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (proposal_id, owner_address)
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS address_book (
  id UUID PRIMARY KEY,
  safe_address TEXT NOT NULL REFERENCES safes(safe_address) ON DELETE CASCADE,
  address TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL,
  UNIQUE (safe_address, address)
);

CREATE TABLE IF NOT EXISTS address_book_audit (
  id UUID PRIMARY KEY,
  address_book_id UUID NULL REFERENCES address_book(id) ON DELETE SET NULL,
  safe_address TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  old_label TEXT NULL,
  new_label TEXT NULL,
  old_address TEXT NULL,
  new_address TEXT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_address_book_safe ON address_book(safe_address);
CREATE INDEX IF NOT EXISTS idx_address_book_audit_safe_changed_at ON address_book_audit(safe_address, changed_at DESC);

CREATE TABLE IF NOT EXISTS withdrawals (
  proposal_id UUID PRIMARY KEY REFERENCES proposals(id) ON DELETE CASCADE,
  safe_address TEXT NOT NULL REFERENCES safes(safe_address) ON DELETE CASCADE,
  l2_tx_hash TEXT NULL,
  l1_tx_hash TEXT NULL,
  l1_recipient TEXT NOT NULL,
  amount_wei TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'awaiting_signatures', 'ready_to_execute', 'executed_l2', 'awaiting_proof', 'finalizing_l1', 'finalized_l1', 'failed')),
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  l2_batch_number BIGINT NULL,
  l2_message_index BIGINT NOT NULL DEFAULT 0,
  l2_tx_number_in_batch INT NULL,
  l2_sender TEXT NOT NULL DEFAULT '0x000000000000000000000000000000000000800a',
  message TEXT NULL,
  merkle_proof JSONB NULL,
  proof_raw JSONB NULL,
  next_retry_at TIMESTAMPTZ NULL,
  retry_count INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_safe_address ON withdrawals(safe_address);


ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'base';
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS l2_token_address TEXT NULL;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS l1_token_address TEXT NULL;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS calldata_summary JSONB NULL;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS proof_kind TEXT NULL;

ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS spender TEXT NULL;
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS uses_multicall3 BOOLEAN NOT NULL DEFAULT FALSE;
