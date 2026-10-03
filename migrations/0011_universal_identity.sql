ALTER TABLE sessions ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'local'
  CHECK (auth_source IN ('local', 'universal'));

CREATE TABLE identity_bindings (
  id TEXT PRIMARY KEY NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'universal'),
  issuer TEXT NOT NULL,
  external_subject TEXT NOT NULL,
  local_user_id TEXT NOT NULL,
  product_admin INTEGER NOT NULL DEFAULT 0 CHECK (product_admin IN (0, 1)),
  linked_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  created_by TEXT NOT NULL CHECK (created_by IN ('first_login', 'user_binding', 'migration')),
  FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE (issuer, external_subject),
  UNIQUE (provider, local_user_id)
);

CREATE INDEX identity_bindings_local_user_idx ON identity_bindings(local_user_id);

CREATE TABLE oidc_login_transactions (
  state_hash TEXT PRIMARY KEY NOT NULL,
  nonce TEXT NOT NULL,
  pkce_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL,
  local_user_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (local_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX oidc_login_transactions_expiry_idx ON oidc_login_transactions(expires_at);
