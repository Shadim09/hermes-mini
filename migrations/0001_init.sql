-- hermes-mini: initial schema (R7: migrations live apart from the code)
-- Apply with:  npx wrangler d1 migrations apply hermes-mini-db --remote
--
-- About "today": the Worker has no timezone (it runs in UTC). The code computes the
-- Tehran calendar day with Intl and stores it as text YYYY-MM-DD in *_day columns.
-- Timestamps (created_at, done_at, deleted_at) are always stored in UTC (ISO 8601).

CREATE TABLE tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT    NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  created_at  TEXT    NOT NULL,   -- UTC ISO timestamp
  created_day TEXT    NOT NULL,   -- Tehran day, e.g. 2026-10-31
  done_at     TEXT,               -- UTC ISO timestamp
  done_day    TEXT,               -- Tehran day when it was completed
  deleted_at  TEXT                -- soft delete: row is kept, just hidden
);

-- Partial index: the list query only ever looks at non-deleted rows.
CREATE INDEX idx_tasks_live ON tasks (done, done_day) WHERE deleted_at IS NULL;

-- R4: minimal conversation memory (the code keeps only the last ~20 rows).
CREATE TABLE messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  role       TEXT NOT NULL CHECK (role IN ('user', 'bot')),
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Idempotency: Telegram can redeliver an update; we remember which ones we handled.
CREATE TABLE processed_updates (
  update_id   INTEGER PRIMARY KEY,
  received_at TEXT NOT NULL
);
