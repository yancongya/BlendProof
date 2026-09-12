CREATE TABLE platform_lifetime_metrics (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  launched_at TEXT NOT NULL,
  processed_project_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_project_count >= 0),
  processed_asset_count INTEGER NOT NULL DEFAULT 0 CHECK (processed_asset_count >= 0),
  processed_bytes INTEGER NOT NULL DEFAULT 0 CHECK (processed_bytes >= 0),
  cleaned_asset_count INTEGER NOT NULL DEFAULT 0 CHECK (cleaned_asset_count >= 0),
  cleaned_bytes INTEGER NOT NULL DEFAULT 0 CHECK (cleaned_bytes >= 0),
  updated_at TEXT NOT NULL
);

INSERT INTO platform_lifetime_metrics (id, launched_at, updated_at)
VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TRIGGER platform_metrics_count_finalized_project
AFTER UPDATE OF status ON projects
WHEN OLD.status != 'ready' AND NEW.status = 'ready'
BEGIN
  UPDATE platform_lifetime_metrics
  SET processed_project_count = processed_project_count + 1,
      processed_asset_count = processed_asset_count + (
        SELECT COUNT(*) FROM project_assets
        WHERE project_id = NEW.id AND asset_version = NEW.asset_version AND status = 'ready'
      ),
      processed_bytes = processed_bytes + COALESCE((
        SELECT SUM(byte_size) FROM project_assets
        WHERE project_id = NEW.id AND asset_version = NEW.asset_version AND status = 'ready'
      ), 0),
      updated_at = NEW.updated_at
  WHERE id = 1;
END;

CREATE TRIGGER platform_metrics_count_cleaned_asset
AFTER UPDATE OF status ON project_assets
WHEN OLD.status != 'deleted' AND NEW.status = 'deleted'
BEGIN
  UPDATE platform_lifetime_metrics
  SET cleaned_asset_count = cleaned_asset_count + 1,
      cleaned_bytes = cleaned_bytes + OLD.byte_size,
      updated_at = NEW.updated_at
  WHERE id = 1;
END;
