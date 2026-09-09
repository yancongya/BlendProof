CREATE TABLE projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  owner_id TEXT,
  owner_capability_hash TEXT NOT NULL,
  storage_namespace TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploading', 'ready', 'deleting', 'delete_failed')),
  asset_version INTEGER NOT NULL DEFAULT 1 CHECK (asset_version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE upload_intents (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  asset_version INTEGER NOT NULL CHECK (asset_version > 0),
  staging_namespace TEXT NOT NULL UNIQUE,
  expected_assets_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uploading', 'finalizing', 'finalized', 'expired', 'failed')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, idempotency_key),
  UNIQUE (project_id, asset_version),
  UNIQUE (id, project_id, asset_version),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE project_assets (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  upload_intent_id TEXT NOT NULL,
  asset_version INTEGER NOT NULL CHECK (asset_version > 0),
  asset_name TEXT NOT NULL CHECK (asset_name IN ('model.glb', 'manifest.json', 'thumbnail.webp')),
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  etag TEXT,
  status TEXT NOT NULL DEFAULT 'staging' CHECK (status IN ('staging', 'ready', 'deleting', 'deleted')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, asset_version, asset_name),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (upload_intent_id, project_id, asset_version)
    REFERENCES upload_intents(id, project_id, asset_version) ON DELETE CASCADE
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  expires_at TEXT,
  comments_permission TEXT NOT NULL DEFAULT 'read_only'
    CHECK (comments_permission IN ('read_only', 'comment')),
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE comments (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  object_name TEXT,
  position_json TEXT NOT NULL,
  normal_json TEXT NOT NULL,
  camera_json TEXT NOT NULL,
  body TEXT NOT NULL,
  author_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved')),
  author_id TEXT,
  author_type TEXT NOT NULL DEFAULT 'owner'
    CHECK (author_type IN ('owner', 'guest')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE cleanup_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  object_key TEXT NOT NULL,
  asset_version INTEGER CHECK (asset_version > 0),
  kind TEXT NOT NULL CHECK (kind IN ('staging', 'project')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'failed', 'done')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (kind, object_key)
);

CREATE INDEX shares_project_id_idx ON shares(project_id);
CREATE INDEX comments_project_created_idx ON comments(project_id, created_at, id);
CREATE INDEX comments_project_status_idx ON comments(project_id, status);
CREATE INDEX projects_status_updated_idx ON projects(status, updated_at);
CREATE INDEX upload_intents_project_status_idx ON upload_intents(project_id, status, updated_at);
CREATE INDEX project_assets_project_version_idx ON project_assets(project_id, asset_version, status);
CREATE INDEX cleanup_jobs_status_updated_idx ON cleanup_jobs(status, updated_at);
