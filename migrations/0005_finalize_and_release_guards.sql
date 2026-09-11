-- A project may become ready only after the intent and reservation reached
-- their terminal states in the same D1 transaction. This converts a lost CAS
-- into an abort, preventing cleanup/finalize races from committing free data.
DROP TRIGGER IF EXISTS finalize_intent_requires_ready_project;

CREATE TRIGGER finalize_intent_requires_active_project
BEFORE UPDATE OF status ON upload_intents
WHEN NEW.status = 'finalized' AND (
  NOT EXISTS (
    SELECT 1 FROM projects p WHERE p.id = NEW.project_id
      AND p.status = 'uploading' AND p.asset_version = NEW.asset_version
  ) OR (
    SELECT COUNT(*) FROM project_assets
    WHERE upload_intent_id = NEW.id AND project_id = NEW.project_id
      AND asset_version = NEW.asset_version AND status = 'staging' AND etag IS NOT NULL
  ) != json_array_length(NEW.expected_assets_json)
)
BEGIN
  SELECT RAISE(ABORT, 'project upload is not active');
END;

CREATE TRIGGER project_ready_requires_settled_upload
BEFORE UPDATE OF status ON projects
WHEN OLD.status = 'uploading' AND NEW.status = 'ready' AND NOT EXISTS (
  SELECT 1 FROM upload_intents ui
  JOIN project_storage_reservations reservation ON reservation.upload_intent_id = ui.id
  WHERE ui.project_id = NEW.id AND ui.asset_version = NEW.asset_version
    AND ui.status = 'finalized' AND reservation.status = 'settled'
    AND (SELECT COUNT(*) FROM project_assets asset
      WHERE asset.upload_intent_id = ui.id AND asset.status = 'ready') = json_array_length(ui.expected_assets_json)
)
BEGIN
  SELECT RAISE(ABORT, 'project upload is not settled');
END;

-- Physical storage remains charged until every exact-key job is done and the
-- project has been marked deleted inside the same batch.
CREATE TRIGGER project_release_requires_completed_deletion
BEFORE UPDATE OF status ON project_storage_reservations
WHEN OLD.status = 'settled' AND NEW.status = 'released' AND NOT EXISTS (
  SELECT 1 FROM projects p
  WHERE p.id = NEW.project_id AND p.status = 'deleting' AND p.deleted_at IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'project deletion is not complete');
END;
