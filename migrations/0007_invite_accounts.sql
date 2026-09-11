-- Cloud accounts are intentionally separate from per-project owner capabilities.
-- The latter remain useful for a local/recovery workflow; sessions establish the
-- account identity used for cloud ownership, quotas, and administration.
CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  invite_id TEXT,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (invite_id) REFERENCES invites(id) ON DELETE RESTRICT
);

CREATE TABLE invites (
  id TEXT PRIMARY KEY NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL,
  max_uses INTEGER NOT NULL CHECK (max_uses BETWEEN 1 AND 10000),
  uses_count INTEGER NOT NULL DEFAULT 0 CHECK (uses_count >= 0 AND uses_count <= max_uses),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX sessions_active_user_idx ON sessions(user_id, expires_at);
CREATE INDEX invites_active_idx ON invites(expires_at, revoked_at);

-- Registration inserts a user by selecting an unexpired invite. These triggers
-- make the check-and-consume transition atomic inside that same D1 write.
CREATE TRIGGER user_invite_must_be_usable
BEFORE INSERT ON users
WHEN NEW.invite_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM invites
  WHERE id = NEW.invite_id AND revoked_at IS NULL AND julianday(expires_at) > julianday('now')
    AND uses_count < max_uses
)
BEGIN
  SELECT RAISE(ABORT, 'invite is not usable');
END;

CREATE TRIGGER user_invite_consume
AFTER INSERT ON users
WHEN NEW.invite_id IS NOT NULL
BEGIN
  UPDATE invites
  SET uses_count = uses_count + 1, updated_at = NEW.created_at
  WHERE id = NEW.invite_id AND revoked_at IS NULL AND julianday(expires_at) > julianday('now')
    AND uses_count < max_uses;
END;
