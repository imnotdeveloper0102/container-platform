import json
import logging
import threading
import time

import redis

from .detector import Detector, Event

log = logging.getLogger("analyzer.consumer")


class Consumer:
    """Reads the collector's Redis list with BRPOPLPUSH.

    The collector LPUSHes events onto REDIS_QUEUE (default
    ``events:queue``). This consumer atomically moves one event to
    REDIS_PROCESSING_QUEUE (default ``events:processing``) and only
    removes it there after detection + DB write succeed. If the DB
    write fails, the event is moved back to the main queue for a
    later retry instead of being lost. If this process dies mid-event,
    the event stays in the processing queue; on startup the consumer
    requeues everything left there, so a crash does not lose events.
    """

    def __init__(self, settings, detector, store, stats):
        self.settings = settings
        self.detector = detector
        self.store = store
        self.stats = stats
        self.stop_event = threading.Event()
        self._client = None

    def _connect_redis(self):
        while not self.stop_event.is_set():
            try:
                client = redis.Redis(**self.settings.redis_kwargs())
                client.ping()
                return client
            except redis.RedisError as exc:
                log.warning("redis connect failed, retrying",
                            extra={"extra": {"error": str(exc)}})
                self.stop_event.wait(2)
        raise RuntimeError("stopped before redis connected")

    def _requeue_processing(self):
        """Move events left in the processing queue back to the main queue."""
        moved = 0
        while True:
            item = self._client.rpoplpush(
                self.settings.processing_queue, self.settings.redis_queue)
            if item is None:
                break
            moved += 1
        if moved:
            log.info("requeued events left in processing queue",
                     extra={"extra": {"moved": moved}})

    def _handle(self, payload):
        try:
            data = json.loads(payload)
        except (ValueError, TypeError):
            log.warning("dropping unparseable event from queue",
                        extra={"extra": {"payload": str(payload)[:200]}})
            return True
        event = Event.from_dict(data)
        alerts = self.detector.process(event)
        for alert in alerts:
            self.store.upsert_alert(alert)
            self.stats["alerts"] += 1
            log.info("alert written",
                     extra={"extra": {"ip": alert.ip, "type": alert.type,
                                      "severity": alert.severity,
                                      "count": alert.count}})
        self.stats["processed"] += 1
        self.stats["last_event"] = event.timestamp.isoformat()
        return True

    def run(self):
        self._client = self._connect_redis()
        self._requeue_processing()
        timeout = self.settings.redis_timeout
        while not self.stop_event.is_set():
            try:
                item = self._client.brpoplpush(
                    self.settings.redis_queue,
                    self.settings.processing_queue, timeout=timeout)
            except redis.RedisError as exc:
                log.warning("redis read failed, reconnecting",
                            extra={"extra": {"error": str(exc)}})
                try:
                    self._client = self._connect_redis()
                except RuntimeError:
                    break
                continue
            if item is None:
                continue
            try:
                self._handle(item)
            except Exception as exc:
                # DB or detector error: put the event back for retry
                # instead of dropping it, then back off briefly.
                log.warning("event handling failed, requeuing",
                            extra={"extra": {"error": str(exc)}})
                try:
                    self._client.lrem(
                        self.settings.processing_queue, 1, item)
                    self._client.lpush(self.settings.redis_queue, item)
                except redis.RedisError as re_exc:
                    log.error("requeue failed, event stays in processing "
                              "queue", extra={"extra": {"error": str(re_exc)}})
                self.stop_event.wait(1)
                continue
            try:
                self._client.lrem(self.settings.processing_queue, 1, item)
            except redis.RedisError as exc:
                log.warning("failed to ack event in processing queue",
                            extra={"extra": {"error": str(exc)}})

    def stop(self):
        self.stop_event.set()
