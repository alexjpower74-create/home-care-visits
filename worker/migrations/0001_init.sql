-- Home Care Visits schema. Instants are ISO 8601 UTC text truncated to the second (…:12.000Z), so they sort and compare
-- as text. Visit dates and times are NL local ("YYYY-MM-DD", "HH:MM") beside the UTC instants they mean.

-- One deployment = one agency: exactly one row.
CREATE TABLE agency (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  office_phone TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/St_Johns',
  office_label TEXT NOT NULL,
  office_lat REAL NOT NULL,
  office_lng REAL NOT NULL,
  pin_hash TEXT NOT NULL,       -- base64 PBKDF2-SHA256 output
  pin_salt TEXT NOT NULL,       -- base64, 16 random bytes
  pin_iterations INTEGER NOT NULL
);

CREATE TABLE zones (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE funders (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

-- Office sessions: only the SHA-256 of the token is stored.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Rate guards, per client IP: wrong PINs, and unknown family-link keys.
CREATE TABLE signin_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX signin_attempts_by_ip ON signin_attempts (ip, at);

CREATE TABLE family_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX family_lookups_by_ip ON family_lookups (ip, at);

CREATE TABLE workers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  availability TEXT NOT NULL,   -- JSON {"1": {"start","end"} | null, … "7": …}
  max_week_minutes INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  worker_key TEXT NOT NULL UNIQUE
);

CREATE TABLE worker_zones (
  worker_id INTEGER NOT NULL REFERENCES workers (id),
  zone_id INTEGER NOT NULL REFERENCES zones (id),
  PRIMARY KEY (worker_id, zone_id)
);

CREATE TABLE clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  zone_id INTEGER NOT NULL REFERENCES zones (id),
  entry_notes TEXT NOT NULL DEFAULT '',
  funder_id INTEGER NOT NULL REFERENCES funders (id),
  active INTEGER NOT NULL DEFAULT 1,
  family_key TEXT NOT NULL UNIQUE
);

CREATE TABLE client_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients (id),
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
CREATE INDEX client_tasks_by_client ON client_tasks (client_id, position);

CREATE TABLE family_contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients (id),
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL
);
CREATE INDEX family_contacts_by_client ON family_contacts (client_id, position);

-- A client's repeating visit. Never edited in place except worker_id when a worker is deactivated: a change ends the
-- pattern (ended_at) and stores a new one (valid_from_at), so a past or started visit is never rewritten (DECISIONS 7).
CREATE TABLE patterns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients (id),
  days TEXT NOT NULL,           -- JSON array of ISO weekdays, unique and sorted
  start_hm TEXT NOT NULL,
  end_hm TEXT NOT NULL,
  worker_id INTEGER REFERENCES workers (id),
  valid_from_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE INDEX patterns_by_client ON patterns (client_id);

CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients (id),
  pattern_id INTEGER REFERENCES patterns (id),   -- null for a one-off visit
  pattern_date TEXT,                              -- the date it was generated for; never changed
  date TEXT NOT NULL,
  start_hm TEXT NOT NULL,
  end_hm TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  worker_id INTEGER REFERENCES workers (id),
  cancelled INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (pattern_id, pattern_date)
);
CREATE INDEX visits_by_date ON visits (date, starts_at);
CREATE INDEX visits_by_client ON visits (client_id, date);
CREATE INDEX visits_by_worker ON visits (worker_id, date);

-- Every worker ever assigned to a visit, so a phone that checked in before a reassignment still lands (DECISIONS 9).
CREATE TABLE visit_workers (
  visit_id INTEGER NOT NULL REFERENCES visits (id),
  worker_id INTEGER NOT NULL REFERENCES workers (id),
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (visit_id, worker_id)
);

-- Check-ins and check-outs. The id is the phone's UUID: the idempotency key that makes a resend safe.
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  visit_id INTEGER NOT NULL REFERENCES visits (id),
  worker_id INTEGER NOT NULL REFERENCES workers (id),
  kind TEXT NOT NULL CHECK (kind IN ('check_in', 'check_out')),
  at TEXT NOT NULL,
  at_adjusted INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('phone', 'office')),
  location TEXT CHECK (location IN ('near', 'far', 'not_shared')),  -- check-ins only
  lat REAL,
  lng REAL,
  accuracy_m REAL,
  distance_m INTEGER,
  correction_reason TEXT,
  voided_at TEXT
);
CREATE INDEX events_by_visit ON events (visit_id);
CREATE INDEX events_by_worker_at ON events (worker_id, kind, at);
-- One effective check-in and one effective check-out per visit, enforced by the database.
CREATE UNIQUE INDEX events_one_check_in ON events (visit_id) WHERE kind = 'check_in' AND voided_at IS NULL;
CREATE UNIQUE INDEX events_one_check_out ON events (visit_id) WHERE kind = 'check_out' AND voided_at IS NULL;

-- The task checklist as the phone sent it with the check-out (a snapshot: later task edits never rewrite a past visit).
CREATE TABLE visit_tasks (
  visit_id INTEGER NOT NULL REFERENCES visits (id),
  position INTEGER NOT NULL,
  task_id INTEGER,
  kind TEXT NOT NULL,
  label TEXT NOT NULL,
  done INTEGER NOT NULL,
  PRIMARY KEY (visit_id, position)
);

CREATE TABLE visit_notes (
  visit_id INTEGER PRIMARY KEY REFERENCES visits (id),
  text TEXT NOT NULL,
  shareable INTEGER NOT NULL DEFAULT 0,
  event_id TEXT NOT NULL,
  written_at TEXT NOT NULL
);
