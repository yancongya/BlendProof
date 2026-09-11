-- The public service has a deliberately small, product-owned pool.  This is
-- not an R2 account limit: it is the authoritative admission ledger used by
-- every Worker upload intent.
CREATE TABLE storage_pool (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  capacity_bytes INTEGER NOT NULL CHECK (capacity_bytes = 5368709120),
  ready_bytes INTEGER NOT NULL DEFAULT 0 CHECK (ready_bytes >= 0),
  reserved_bytes INTEGER NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  updated_at TEXT NOT NULL
);

INSERT INTO storage_pool (id, capacity_bytes, ready_bytes, reserved_bytes, updated_at)
VALUES (1, 5368709120, 0, 0, CURRENT_TIMESTAMP);

-- Previous versions allowed unlimited shares.  They are converted once to
-- the product's 24-hour default; old records are therefore immediately
-- eligible for the normal expiry ledger rather than remaining immortal.
UPDATE shares
SET expires_at = datetime(created_at, '+1 day'), updated_at = CURRENT_TIMESTAMP
WHERE expires_at IS NULL;

-- A reservation covers every byte declared in an active intent, including
-- files not yet PUT to R2.  The status transitions are maintained by D1
-- triggers so a concurrent intent cannot observe free space that another
-- intent has already claimed.
CREATE TABLE project_storage_reservations (
  upload_intent_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (upload_intent_id) REFERENCES upload_intents(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT
);

CREATE INDEX project_storage_reservations_project_status_idx
  ON project_storage_reservations(project_id, status);

-- Backfill before enabling accounting triggers.  Existing ready assets remain
-- protected, while incomplete legacy intents reserve their full declaration.
INSERT INTO project_storage_reservations
  (upload_intent_id, project_id, byte_size, status, created_at, updated_at)
SELECT ui.id, ui.project_id,
  COALESCE((SELECT SUM(CAST(json_extract(item.value, '$.byteSize') AS INTEGER))
    FROM json_each(ui.expected_assets_json) AS item), 1),
  CASE WHEN ui.status = 'finalized' THEN 'settled' ELSE 'reserved' END,
  ui.created_at, ui.updated_at
FROM upload_intents ui
WHERE ui.status IN ('pending', 'uploading', 'finalizing', 'finalized');

UPDATE storage_pool
SET ready_bytes = COALESCE((SELECT SUM(byte_size) FROM project_storage_reservations WHERE status = 'settled'), 0),
    reserved_bytes = COALESCE((SELECT SUM(byte_size) FROM project_storage_reservations WHERE status = 'reserved'), 0),
    updated_at = CURRENT_TIMESTAMP
WHERE id = 1;

CREATE TRIGGER storage_reservation_capacity_guard
BEFORE INSERT ON project_storage_reservations
WHEN NEW.status = 'reserved' AND (
  SELECT ready_bytes + reserved_bytes + NEW.byte_size > capacity_bytes
  FROM storage_pool WHERE id = 1
)
BEGIN
  SELECT RAISE(ABORT, 'storage pool capacity exceeded');
END;

CREATE TRIGGER storage_reservation_insert_accounting
AFTER INSERT ON project_storage_reservations
WHEN NEW.status = 'reserved'
BEGIN
  UPDATE storage_pool
  SET reserved_bytes = reserved_bytes + NEW.byte_size, updated_at = NEW.updated_at
  WHERE id = 1;
END;

CREATE TRIGGER storage_reservation_transition_guard
BEFORE UPDATE OF status ON project_storage_reservations
WHEN (OLD.status = 'reserved' AND NEW.status NOT IN ('reserved', 'settled', 'released'))
  OR (OLD.status = 'settled' AND NEW.status NOT IN ('settled', 'released'))
  OR (OLD.status = 'released' AND NEW.status != 'released')
BEGIN
  SELECT RAISE(ABORT, 'invalid storage reservation transition');
END;

CREATE TRIGGER storage_reservation_settle_accounting
AFTER UPDATE OF status ON project_storage_reservations
WHEN OLD.status = 'reserved' AND NEW.status = 'settled'
BEGIN
  UPDATE storage_pool
  SET reserved_bytes = reserved_bytes - OLD.byte_size,
      ready_bytes = ready_bytes + OLD.byte_size,
      updated_at = NEW.updated_at
  WHERE id = 1;
END;

CREATE TRIGGER storage_reservation_release_reserved_accounting
AFTER UPDATE OF status ON project_storage_reservations
WHEN OLD.status = 'reserved' AND NEW.status = 'released'
BEGIN
  UPDATE storage_pool
  SET reserved_bytes = reserved_bytes - OLD.byte_size, updated_at = NEW.updated_at
  WHERE id = 1;
END;

CREATE TRIGGER storage_reservation_release_ready_accounting
AFTER UPDATE OF status ON project_storage_reservations
WHEN OLD.status = 'settled' AND NEW.status = 'released'
BEGIN
  UPDATE storage_pool
  SET ready_bytes = ready_bytes - OLD.byte_size, updated_at = NEW.updated_at
  WHERE id = 1;
END;

-- A pending deletion is retained as an audit record.  It becomes complete
-- only after every exact-key cleanup job has succeeded.
ALTER TABLE projects ADD COLUMN deleted_at TEXT;
ALTER TABLE projects ADD COLUMN expires_at TEXT;

-- Every published asset has an upper retention bound even if its owner never
-- creates a share. Sharing can shorten this window, but can never extend it.
UPDATE projects
SET expires_at = datetime(created_at, '+2 days')
WHERE expires_at IS NULL;

CREATE INDEX projects_expiry_idx ON projects(status, expires_at);

CREATE TRIGGER share_requires_ready_project
BEFORE INSERT ON shares
WHEN NOT EXISTS (SELECT 1 FROM projects WHERE id = NEW.project_id AND status = 'ready')
BEGIN
  SELECT RAISE(ABORT, 'share project is not ready');
END;
