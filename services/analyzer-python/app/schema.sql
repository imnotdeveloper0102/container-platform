-- Alerts written by analyzer-python. Applied on startup by store.py
-- (CREATE TABLE IF NOT EXISTS) and also usable as a manual migration.
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip VARCHAR(45) NOT NULL,
    type VARCHAR(32) NOT NULL,
    severity VARCHAR(16) NOT NULL,
    count INTEGER NOT NULL DEFAULT 1,
    first_seen TIMESTAMPTZ NOT NULL,
    last_seen TIMESTAMPTZ NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(16) NOT NULL DEFAULT 'open'
);

-- One open alert per ip+type; the store upserts into it while it is open,
-- so a burst of events updates one row instead of spamming new rows.
CREATE UNIQUE INDEX IF NOT EXISTS alerts_open_ip_type_idx
    ON alerts (ip, type) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS alerts_ip_created_idx ON alerts (ip, created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_type_created_idx ON alerts (type, created_at DESC);
