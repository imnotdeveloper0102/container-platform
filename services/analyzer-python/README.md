# analyzer-python

FastAPI service (Python 3.12) that reads the collector's events from
Redis, detects brute force / port scan / SQLi, and writes alerts to
PostgreSQL. It never invents events: every alert comes from a real
event that arrived in the Redis queue.

## How events flow (no loss on transient failure)

The collector LPUSHes normalized event JSON onto the Redis list
`events:queue` (env `REDIS_QUEUE`, default `events:queue`). Each event
has `timestamp`, `source`, `source_ip`, `type`, `raw`.

This service consumes with `BRPOPLPUSH queue -> events:processing`
(env `REDIS_PROCESSING_QUEUE`):

1. `BRPOPLPUSH` atomically moves one event to the processing list.
2. The detector runs; any alert is upserted into PostgreSQL.
3. Only then is the event removed from the processing list (`LREM`).
4. If detection or the DB write fails, the event is moved back to the
   main queue for a later retry, with a short backoff.
5. If the process dies mid-event, the event stays in the processing
   list; on startup the consumer requeues everything left there.

Unparseable payloads are logged and dropped (they can never be
processed), so a poison message cannot block the queue forever.

## Detection

All thresholds are env-configurable; defaults in brackets.

- **Brute force** [`BRUTE_FORCE_THRESHOLD=5` in
  `BRUTE_FORCE_WINDOW_SECONDS=300`]: `auth_failed` events (collector
  type, or `failed password` / `invalid user` / `authentication
  failure` / `failed login` in the raw line) from one IP.
- **Port scan** [`PORT_SCAN_THRESHOLD=5` distinct ports in
  `PORT_SCAN_WINDOW_SECONDS=60`]: distinct destination ports from one
  IP, extracted from `port N`, `destination port N`, `to port N`, or
  `://host:N` in the raw line. The same port repeated does not count.
- **SQLi** (immediate, severity `high`): collector type
  `sqli_suspect`, or URL-decoded patterns in the raw line
  (`UNION SELECT`, `OR '1'='1`, `DROP TABLE`, `--`, `/* */`, `%27`).

An alert is only created when its threshold is reached. An open alert
for the same ip+type is updated, not duplicated, while it is younger
than `ALERT_COOLDOWN_SECONDS=3600`: the store upserts on
`(ip, type) WHERE status='open'`, accumulating `count` and moving
`last_seen`.

## Alerts table

See `app/schema.sql` (applied on startup, `CREATE TABLE IF NOT
EXISTS`): `id, created_at, ip, type, severity, count, first_seen,
last_seen, evidence JSONB, status` (`open` by default).

## Endpoints

- `GET /healthz` — 200 while the process is alive.
- `GET /readyz` — 200 only when Redis ping and `SELECT 1` on
  PostgreSQL both succeed, otherwise 503 with the problems listed.
- `GET /stats` — in-memory counters: `processed`, `alerts`,
  `last_event`.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANALYZER_HOST` / `ANALYZER_PORT` | `0.0.0.0` / `8000` | HTTP listen |
| `REDIS_ADDR` | `localhost:6379` | Redis (compose: `redis:6379`) |
| `REDIS_PASSWORD` / `REDIS_DB` | `` / `0` | Redis auth / DB |
| `REDIS_QUEUE` | `events:queue` | Queue the collector writes |
| `REDIS_PROCESSING_QUEUE` | `events:processing` | In-flight list |
| `REDIS_TIMEOUT_SECONDS` | `5` | Redis socket/connect timeout |
| `DATABASE_URL` | built from `POSTGRES_*` | PostgreSQL DSN |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `localhost` / `5432` / `secuser` / `change-me` / `sec_events` | Used when `DATABASE_URL` is unset |
| `DB_TIMEOUT_SECONDS` | `5` | DB connect timeout |
| `BRUTE_FORCE_THRESHOLD` / `BRUTE_FORCE_WINDOW_SECONDS` | `5` / `300` | Brute-force rule |
| `PORT_SCAN_THRESHOLD` / `PORT_SCAN_WINDOW_SECONDS` | `5` / `60` | Port-scan rule |
| `ALERT_COOLDOWN_SECONDS` | `3600` | Dedup window per ip+type |
| `ANALYZER_RUN_WORKER` | `true` | Set `false` to run HTTP only (tests) |

## Run locally

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Test

```bash
pip install -r requirements.txt
pytest -v
```

Tests cover the detector (brute force below/at threshold, cooldown,
window expiry, port scan distinct vs repeated port, SQLi patterns,
benign HTTP) and the HTTP endpoints. They need no Redis or PostgreSQL;
`/readyz` is expected to return 503 when no backend is running.
