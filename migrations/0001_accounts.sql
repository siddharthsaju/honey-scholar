PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS members (
 uid TEXT PRIMARY KEY, email TEXT NOT NULL, created_at INTEGER NOT NULL,
 last_seen INTEGER NOT NULL, favourites TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS saved_tests (
 uid TEXT NOT NULL REFERENCES members(uid) ON DELETE CASCADE,
 id TEXT NOT NULL, fingerprint TEXT NOT NULL, title TEXT NOT NULL, topic TEXT NOT NULL,
 payload TEXT NOT NULL, finished INTEGER NOT NULL DEFAULT 0,
 practice INTEGER NOT NULL DEFAULT 0, correct INTEGER NOT NULL, graded INTEGER NOT NULL, total INTEGER NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(uid,id)
);
CREATE INDEX IF NOT EXISTS saved_tests_user_date ON saved_tests(uid,updated_at DESC);
CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS initial_per_worksheet ON saved_tests(uid,fingerprint) WHERE practice=0;
