import logging
import threading
from contextlib import asynccontextmanager

import redis
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from .config import settings
from .consumer import Consumer
from .detector import Detector
from .logging_json import setup_logging
from .store import AlertStore

log = setup_logging()
stats = {"processed": 0, "alerts": 0, "last_event": None}
_consumer = None
_consumer_thread = None
_store = None


def get_store():
    global _store
    if _store is None:
        _store = AlertStore(settings.database_url, settings.db_timeout)
    return _store


@asynccontextmanager
async def lifespan(app):
    global _consumer, _consumer_thread
    if settings.run_worker:
        detector = Detector(
            brute_force_threshold=settings.brute_force_threshold,
            brute_force_window=settings.brute_force_window,
            port_scan_threshold=settings.port_scan_threshold,
            port_scan_window=settings.port_scan_window,
            alert_cooldown=settings.alert_cooldown,
        )
        _consumer = Consumer(settings, detector, get_store(), stats)
        _consumer_thread = threading.Thread(
            target=_consumer.run, name="redis-consumer", daemon=True)
        _consumer_thread.start()
        log.info("analyzer worker started",
                 extra={"extra": {"queue": settings.redis_queue}})
    else:
        log.info("analyzer worker disabled (ANALYZER_RUN_WORKER=false)")
    yield
    # Graceful shutdown: uvicorn stops on SIGTERM/SIGINT, lifespan
    # exit runs here — stop the consumer and close the DB connection.
    if _consumer is not None:
        _consumer.stop()
    if _consumer_thread is not None:
        _consumer_thread.join(timeout=10)
    if _store is not None:
        _store.close()
    log.info("analyzer stopped")


app = FastAPI(title="container-platform analyzer", lifespan=lifespan)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/readyz")
def readyz():
    problems = []
    try:
        client = redis.Redis(**settings.redis_kwargs())
        if not client.ping():
            problems.append("redis ping failed")
        client.close()
    except Exception as exc:
        problems.append(f"redis: {exc}")
    try:
        if not get_store().ping():
            problems.append("postgres ping failed")
    except Exception as exc:
        problems.append(f"postgres: {exc}")
    if problems:
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "problems": problems},
        )
    return {"status": "ready"}


@app.get("/stats")
def get_stats():
    return dict(stats)


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=settings.http_host,
        port=settings.http_port,
        log_config=None,
    )
