ALTER TABLE upload_intents ADD COLUMN intent_token_hash TEXT NOT NULL
  DEFAULT '0000000000000000000000000000000000000000000000000000000000000000'
  CHECK (length(intent_token_hash) = 64 AND intent_token_hash NOT GLOB '*[^0-9a-f]*');

CREATE TRIGGER upload_intent_requires_current_project_version
BEFORE INSERT ON upload_intents
WHEN NEW.status IN ('pending', 'uploading', 'finalizing') AND NOT EXISTS (
  SELECT 1 FROM projects
  WHERE id = NEW.project_id AND asset_version = NEW.asset_version
    AND status IN ('pending', 'uploading')
)
BEGIN
  SELECT RAISE(ABORT, 'upload intent project version is stale');
END;

CREATE TRIGGER finalize_intent_requires_ready_project
BEFORE UPDATE OF status ON upload_intents
WHEN NEW.status = 'finalized' AND NOT EXISTS (
  SELECT 1 FROM projects
  WHERE id = NEW.project_id AND status = 'ready' AND asset_version = NEW.asset_version
)
OR NEW.status = 'finalized' AND (
  SELECT COUNT(*) FROM project_assets
  WHERE upload_intent_id = NEW.id AND project_id = NEW.project_id
    AND asset_version = NEW.asset_version AND status = 'staging' AND etag IS NOT NULL
) != json_array_length(NEW.expected_assets_json)
BEGIN
  SELECT RAISE(ABORT, 'project is not ready for this intent');
END;

CREATE TRIGGER ready_asset_requires_finalized_intent
BEFORE UPDATE OF status ON project_assets
WHEN NEW.status = 'ready' AND NOT EXISTS (
  SELECT 1 FROM upload_intents
  WHERE id = NEW.upload_intent_id AND project_id = NEW.project_id
    AND asset_version = NEW.asset_version AND status = 'finalized'
)
BEGIN
  SELECT RAISE(ABORT, 'upload intent is not finalized');
END;
