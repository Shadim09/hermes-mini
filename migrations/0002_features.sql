-- hermes-mini: due dates / reminders and an undo journal.
-- Apply with:  npm run db:migrate:remote
-- (0001 is never edited: schema changes are always new files.)

-- Due date of a task, as a Tehran calendar day (YYYY-MM-DD) plus an optional Tehran hour 0-23.
-- A task with a due day but no hour is reminded at REMINDER_HOUR (default 08:00) of that day.
ALTER TABLE tasks ADD COLUMN due_day     TEXT;
ALTER TABLE tasks ADD COLUMN due_hour    INTEGER CHECK (due_hour IS NULL OR (due_hour BETWEEN 0 AND 23));
ALTER TABLE tasks ADD COLUMN reminded_at TEXT;   -- UTC timestamp: set once the reminder was sent

-- The hourly cron only ever looks at open, not-yet-reminded tasks with a due date.
CREATE INDEX idx_tasks_due ON tasks (due_day)
  WHERE deleted_at IS NULL AND done = 0 AND reminded_at IS NULL AND due_day IS NOT NULL;

-- Undo journal: every successful change writes one row holding what is needed to revert it.
-- payload is JSON: {"added":[ids]} for an add, or {"rows":[{id, done, done_at, ...}]} snapshots
-- of the rows as they were BEFORE the change.
CREATE TABLE action_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  summary    TEXT NOT NULL,      -- short Persian description shown after an undo
  payload    TEXT NOT NULL,
  created_at TEXT NOT NULL,      -- UTC ISO timestamp
  undone_at  TEXT                -- set when this entry has been reverted
);
