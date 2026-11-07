import json
from datetime import datetime, timedelta, timezone

import pytest

from app.detector import Detector, Event, extract_ports, is_sqli

BASE = datetime(2026, 11, 7, 12, 0, 0, tzinfo=timezone.utc)


def make_event(raw, ip="1.2.3.4", at=None, type="generic"):
    return Event(
        timestamp=at or BASE,
        source="tcp",
        source_ip=ip,
        type=type,
        raw=raw,
    )


def test_brute_force_below_threshold_no_alert():
    detector = Detector(brute_force_threshold=5, brute_force_window=300)
    alerts = []
    for i in range(4):
        alerts += detector.process(make_event(
            "Failed password for root from 1.2.3.4 port 22 ssh2",
            at=BASE + timedelta(seconds=i * 10), type="auth_failed"))
    assert alerts == []


def test_brute_force_at_threshold_one_alert():
    detector = Detector(brute_force_threshold=5, brute_force_window=300)
    alerts = []
    for i in range(5):
        alerts += detector.process(make_event(
            "Failed password for root from 1.2.3.4 port 22 ssh2",
            at=BASE + timedelta(seconds=i * 10), type="auth_failed"))
    assert len(alerts) == 1
    alert = alerts[0]
    assert alert.type == "brute_force"
    assert alert.ip == "1.2.3.4"
    assert alert.severity == "medium"
    assert alert.count == 5


def test_brute_force_cooldown_no_duplicate_alert():
    detector = Detector(brute_force_threshold=5, brute_force_window=300,
                        alert_cooldown=3600)
    alerts = []
    for i in range(10):
        alerts += detector.process(make_event(
            "Failed password for root from 1.2.3.4 port 22 ssh2",
            at=BASE + timedelta(seconds=i * 10), type="auth_failed"))
    assert len(alerts) == 1


def test_brute_force_window_expires():
    detector = Detector(brute_force_threshold=5, brute_force_window=60)
    for i in range(4):
        detector.process(make_event(
            "Failed password for root from 1.2.3.4 port 22 ssh2",
            at=BASE + timedelta(seconds=i * 5), type="auth_failed"))
    # 61s later the first failures are out of the window; one more
    # failure must not reach the threshold of 5 in-window events.
    alerts = detector.process(make_event(
        "Failed password for root from 1.2.3.4 port 22 ssh2",
        at=BASE + timedelta(seconds=61), type="auth_failed"))
    assert alerts == []


def test_port_scan_distinct_ports():
    detector = Detector(port_scan_threshold=5, port_scan_window=60)
    alerts = []
    for i, port in enumerate([22, 80, 443, 21, 3306]):
        alerts += detector.process(make_event(
            f"Connection attempt to 10.0.0.1 port {port}",
            at=BASE + timedelta(seconds=i * 5)))
    assert len(alerts) == 1
    assert alerts[0].type == "port_scan"
    assert alerts[0].evidence["ports"] == [21, 22, 80, 443, 3306]


def test_port_scan_same_port_repeated_no_alert():
    detector = Detector(port_scan_threshold=5, port_scan_window=60)
    alerts = []
    for i in range(6):
        alerts += detector.process(make_event(
            "Connection attempt to 10.0.0.1 port 80",
            at=BASE + timedelta(seconds=i * 5)))
    assert alerts == []


def test_extract_ports():
    assert extract_ports("GET http://10.0.0.1:8080/admin HTTP/1.1") == {8080}
    assert extract_ports("plain log line without a port") == set()


def test_sqli_union_select():
    event = make_event(
        "GET /search?q=1%20UNION%20SELECT%20username,password%20FROM%20users "
        "HTTP/1.1",
        type="sqli_suspect")
    assert is_sqli(event)
    detector = Detector()
    alerts = detector.process(event)
    assert len(alerts) == 1
    assert alerts[0].type == "sqli"
    assert alerts[0].severity == "high"


def test_sqli_or_1_equals_1():
    detector = Detector()
    alerts = detector.process(make_event(
        "GET /login?user=admin' OR '1'='1 HTTP/1.1"))
    assert len(alerts) == 1
    assert alerts[0].type == "sqli"


def test_sqli_cooldown_no_duplicate():
    detector = Detector(alert_cooldown=3600)
    first = detector.process(make_event(
        "GET /search?q=1 UNION SELECT 1 HTTP/1.1"))
    second = detector.process(make_event(
        "GET /search?q=2 UNION SELECT 2 HTTP/1.1",
        at=BASE + timedelta(seconds=30)))
    assert len(first) == 1
    assert second == []


def test_benign_http_no_alert():
    detector = Detector()
    alerts = detector.process(make_event(
        '192.168.1.10 - - [07/Nov/2026:10:00:00 +0700] '
        '"GET /index.html HTTP/1.1" 200 1234',
        ip="192.168.1.10", type="http_access"))
    assert alerts == []


def test_event_from_dict_extracts_ip_from_raw():
    event = Event.from_dict({
        "timestamp": "2026-11-07T12:00:00+00:00",
        "source": "tcp",
        "source_ip": "",
        "type": "generic",
        "raw": "Failed password for root from 9.9.9.9 port 22 ssh2",
    })
    assert event.source_ip == "9.9.9.9"


def test_event_from_dict_matches_collector_json():
    payload = json.dumps({
        "timestamp": "2026-11-07T12:00:00.123456789Z",
        "source": "http",
        "source_ip": "1.2.3.4",
        "type": "auth_failed",
        "raw": "Failed password for root from 1.2.3.4 port 22 ssh2",
    })
    event = Event.from_dict(json.loads(payload))
    assert event.source_ip == "1.2.3.4"
    assert event.type == "auth_failed"
