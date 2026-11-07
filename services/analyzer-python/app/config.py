import os


def _env(key, default):
    value = os.environ.get(key)
    return default if value is None or value == "" else value


def _env_int(key, default):
    try:
        return int(os.environ.get(key, "")) or default
    except (TypeError, ValueError):
        return default


class Settings:
    """All configuration comes from the environment; no secrets here."""

    def __init__(self):
        self.http_host = _env("ANALYZER_HOST", "0.0.0.0")
        self.http_port = _env_int("ANALYZER_PORT", 8000)
        # Same names as collector-go so compose can share REDIS_* vars.
        self.redis_addr = _env("REDIS_ADDR", "localhost:6379")
        self.redis_password = os.environ.get("REDIS_PASSWORD", "")
        self.redis_db = _env_int("REDIS_DB", 0)
        self.redis_queue = _env("REDIS_QUEUE", "events:queue")
        self.processing_queue = _env(
            "REDIS_PROCESSING_QUEUE", "events:processing"
        )
        self.redis_timeout = _env_int("REDIS_TIMEOUT_SECONDS", 5)
        self.database_url = self._database_url()
        self.db_timeout = _env_int("DB_TIMEOUT_SECONDS", 5)
        # Detection thresholds (counts inside the window).
        self.brute_force_threshold = _env_int("BRUTE_FORCE_THRESHOLD", 5)
        self.brute_force_window = _env_int("BRUTE_FORCE_WINDOW_SECONDS", 300)
        self.port_scan_threshold = _env_int("PORT_SCAN_THRESHOLD", 5)
        self.port_scan_window = _env_int("PORT_SCAN_WINDOW_SECONDS", 60)
        # An open alert for the same ip+type is updated, not duplicated,
        # while it is younger than this cooldown.
        self.alert_cooldown = _env_int("ALERT_COOLDOWN_SECONDS", 3600)
        self.run_worker = _env("ANALYZER_RUN_WORKER", "true").lower() != "false"

    def _database_url(self):
        url = os.environ.get("DATABASE_URL")
        if url:
            return url
        host = _env("POSTGRES_HOST", "localhost")
        port = _env_int("POSTGRES_PORT", 5432)
        user = _env("POSTGRES_USER", "secuser")
        password = os.environ.get("POSTGRES_PASSWORD", "change-me")
        db = _env("POSTGRES_DB", "sec_events")
        return f"postgresql://{user}:{password}@{host}:{port}/{db}"

    def redis_kwargs(self):
        host, _, port = self.redis_addr.partition(":")
        return {
            "host": host or "localhost",
            "port": int(port) if port.isdigit() else 6379,
            "password": self.redis_password or None,
            "db": self.redis_db,
            "socket_timeout": self.redis_timeout,
            "socket_connect_timeout": self.redis_timeout,
            "decode_responses": True,
        }


settings = Settings()
