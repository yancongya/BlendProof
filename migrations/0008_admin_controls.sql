-- Admin-configurable limits stay below the service's hard safety ceilings.
DROP TRIGGER storage_reservation_capacity_guard;

CREATE TABLE platform_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  capacity_bytes INTEGER NOT NULL CHECK (capacity_bytes BETWEEN 104857600 AND 5368709120),
  max_share_hours INTEGER NOT NULL CHECK (max_share_hours BETWEEN 1 AND 48),
  updated_at TEXT NOT NULL
);

INSERT INTO platform_settings (id, capacity_bytes, max_share_hours, updated_at)
VALUES (1, 5368709120, 48, CURRENT_TIMESTAMP);

CREATE TRIGGER storage_reservation_capacity_guard
BEFORE INSERT ON project_storage_reservations
WHEN NEW.status = 'reserved' AND (
  SELECT pool.ready_bytes + pool.reserved_bytes + NEW.byte_size > settings.capacity_bytes
  FROM storage_pool pool JOIN platform_settings settings ON settings.id = pool.id WHERE pool.id = 1
)
BEGIN
  SELECT RAISE(ABORT, 'storage pool capacity exceeded');
END;

CREATE INDEX users_role_disabled_idx ON users(role, disabled_at);
