-- Fixed-window counters. `key_hash` is SHA-256 of a scoped, opaque key; raw
-- IP addresses, owner capabilities, and share tokens are deliberately never
-- persisted. Expired rows are pruned by the Worker scheduled cleanup.
CREATE TABLE rate_limit_windows (
  scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 64),
  key_hash TEXT NOT NULL
    CHECK (length(key_hash) = 64 AND key_hash NOT GLOB '*[^0-9a-f]*'),
  window_start INTEGER NOT NULL CHECK (window_start >= 0),
  count INTEGER NOT NULL CHECK (count > 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > window_start),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, key_hash, window_start)
);

CREATE INDEX rate_limit_windows_expiry_idx ON rate_limit_windows(expires_at);
