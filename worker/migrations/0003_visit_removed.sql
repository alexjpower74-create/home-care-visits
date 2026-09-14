-- API.md clarification 7: rebuilt and removed visits are soft-removed, never deleted. A phone may still hold a check-in made
-- before the change; the removed row keeps accepting it, and then shows as cancelled with the removal reason.
ALTER TABLE visits ADD COLUMN removed_at TEXT;
ALTER TABLE visits ADD COLUMN removed_reason TEXT;
