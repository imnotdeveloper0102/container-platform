import json
import logging
import os
import time

import psycopg

log = logging.getLogger("analyzer.store")


class AlertStore:
    """PostgreSQL alert store. Connects lazily, retries on startup."""

    def __init__(self, database_url, timeout=5):
        self.database_url = database_url
        self.timeout = timeout
        self._conn = None

    def connect(self, retries=5):
        last_error = None
        for attempt in range(1, retries + 1):
            try:
                self._conn = psycopg.connect(
                    self.database_url, connect_timeout=self.timeout,
                    autocommit=True,
                )
                self.ensure_schema()
                return self._conn
            except Exception as exc:
                last_error = exc
                log.warning("postgres connect failed, retrying",
                            extra={"extra": {"attempt": attempt,
                                             "error": str(exc)}})
                time.sleep(min(attempt, 5))
        raise RuntimeError(
            f"postgres connect failed after {retries} attempts: {last_error}"
        )

    def ensure_schema(self):
        schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
        with open(schema_path, encoding="utf-8") as handle:
            self._conn.execute(handle.read())

    def ping(self):
        if self._conn is None:
            # Readiness checks must fail fast, not retry for ~15s.
            self.connect(retries=2)
        with self._conn.cursor() as cur:
            cur.execute("SELECT 1")
            return cur.fetchone()[0] == 1

    def upsert_alert(self, alert):
        """Insert a new open alert, or update the existing open one
        for the same ip+type (count accumulates, last_seen moves)."""
        if self._conn is None:
            self.connect()
        sql = """
            INSERT INTO alerts
                (ip, type, severity, count, first_seen, last_seen, evidence)
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (ip, type) WHERE status = 'open'
            DO UPDATE SET count = alerts.count + EXCLUDED.count,
                          last_seen = EXCLUDED.last_seen,
                          evidence = EXCLUDED.evidence,
                          severity = EXCLUDED.severity
            RETURNING id
        """
        try:
            with self._conn.cursor() as cur:
                cur.execute(sql, (
                    alert.ip, alert.type, alert.severity, alert.count,
                    alert.first_seen, alert.last_seen,
                    json.dumps(alert.evidence, ensure_ascii=False),
                ))
                return cur.fetchone()[0]
        except psycopg.Error:
            # Connection may have dropped; reconnect once and retry.
            self._conn = None
            self.connect()
            with self._conn.cursor() as cur:
                cur.execute(sql, (
                    alert.ip, alert.type, alert.severity, alert.count,
                    alert.first_seen, alert.last_seen,
                    json.dumps(alert.evidence, ensure_ascii=False),
                ))
                return cur.fetchone()[0]

    def close(self):
        if self._conn is not None:
            self._conn.close()
            self._conn = None
