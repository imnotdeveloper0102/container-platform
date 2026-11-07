import re
import urllib.parse
from dataclasses import dataclass, field
from datetime import datetime, timezone

_IP_RE = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
_PORT_RE = re.compile(
    r"(?:destination port|dest port|to port|port)\s+(\d{1,5})"
    r"|://[^/:]+:(\d{1,5})",
    re.IGNORECASE,
)
# SQLi patterns are matched against the URL-decoded raw line.
_SQLI_PATTERNS = [
    re.compile(r"union\s+select", re.IGNORECASE),
    re.compile(r"or\s+['\"]?1['\"]?\s*=\s*['\"]?1['\"]?", re.IGNORECASE),
    re.compile(r"'\s*or\s+'", re.IGNORECASE),
    re.compile(r"drop\s+table", re.IGNORECASE),
    re.compile(r"--\s*$", re.IGNORECASE),
    re.compile(r"/\*.*?\*/", re.IGNORECASE),
    re.compile(r"%27|%2527", re.IGNORECASE),
    re.compile(r"select\s+.*\s+from\s+\w+", re.IGNORECASE),
]


@dataclass
class Event:
    timestamp: datetime
    source: str
    source_ip: str
    type: str
    raw: str

    @classmethod
    def from_dict(cls, data):
        raw = str(data.get("raw") or "")
        ip = str(data.get("source_ip") or "")
        if not _IP_RE.fullmatch(ip):
            found = _IP_RE.search(raw)
            ip = found.group(0) if found else ""
        ts = data.get("timestamp") or ""
        try:
            parsed = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        except ValueError:
            parsed = datetime.now(timezone.utc)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return cls(
            timestamp=parsed,
            source=str(data.get("source") or ""),
            source_ip=ip,
            type=str(data.get("type") or ""),
            raw=raw,
        )


@dataclass
class Alert:
    ip: str
    type: str  # brute_force | port_scan | sqli
    severity: str  # low | medium | high
    count: int
    first_seen: datetime
    last_seen: datetime
    evidence: dict = field(default_factory=dict)


def extract_ports(raw):
    ports = set()
    for match in _PORT_RE.finditer(raw):
        for group in match.groups():
            if group and 1 <= int(group) <= 65535:
                ports.add(int(group))
    return ports


def is_auth_failed(event):
    if event.type == "auth_failed":
        return True
    lowered = event.raw.lower()
    return any(
        phrase in lowered
        for phrase in (
            "failed password",
            "invalid user",
            "authentication failure",
            "failed login",
        )
    )


def is_sqli(event):
    if event.type == "sqli_suspect":
        return True
    decoded = urllib.parse.unquote_plus(event.raw)
    return any(pattern.search(decoded) for pattern in _SQLI_PATTERNS)


class Detector:
    """Stateful sliding-window detector over the live event stream.

    Windows are kept per IP in memory; only alerts that reach a
    threshold are written to PostgreSQL, and an open alert for the
    same ip+type is updated (not duplicated) inside the cooldown.
    """

    def __init__(self, brute_force_threshold=5, brute_force_window=300,
                 port_scan_threshold=5, port_scan_window=60,
                 alert_cooldown=3600):
        self.brute_force_threshold = brute_force_threshold
        self.brute_force_window = brute_force_window
        self.port_scan_threshold = port_scan_threshold
        self.port_scan_window = port_scan_window
        self.alert_cooldown = alert_cooldown
        self._auth_failures = {}   # ip -> list[datetime]
        self._ports_seen = {}      # ip -> dict[port, datetime]
        self._last_alert = {}      # (ip, type) -> datetime of last alert

    def _prune(self, store, now, window):
        cutoff = now.timestamp() - window
        for ip in list(store):
            kept = [t for t in store[ip] if t.timestamp() > cutoff]
            if kept:
                store[ip] = kept
            else:
                del store[ip]

    def _prune_ports(self, now):
        cutoff = now.timestamp() - self.port_scan_window
        for ip in list(self._ports_seen):
            kept = {p: t for p, t in self._ports_seen[ip].items()
                    if t.timestamp() > cutoff}
            if kept:
                self._ports_seen[ip] = kept
            else:
                del self._ports_seen[ip]

    def _due(self, ip, alert_type, now):
        last = self._last_alert.get((ip, alert_type))
        if last is None:
            return True
        return (now - last).total_seconds() >= self.alert_cooldown

    def process(self, event):
        """Return a list of alerts (usually 0 or 1) for one event."""
        if not event.source_ip:
            return []
        now = event.timestamp
        alerts = []

        if is_sqli(event):
            if self._due(event.source_ip, "sqli", now):
                self._last_alert[(event.source_ip, "sqli")] = now
                alerts.append(Alert(
                    ip=event.source_ip, type="sqli", severity="high",
                    count=1, first_seen=now, last_seen=now,
                    evidence={"raw": event.raw[:500], "source": event.source},
                ))
            return alerts

        if is_auth_failed(event):
            failures = self._auth_failures.setdefault(event.source_ip, [])
            failures.append(now)
            self._prune(self._auth_failures, now, self.brute_force_window)
            failures = self._auth_failures.get(event.source_ip, [])
            if (len(failures) >= self.brute_force_threshold
                    and self._due(event.source_ip, "brute_force", now)):
                self._last_alert[(event.source_ip, "brute_force")] = now
                alerts.append(Alert(
                    ip=event.source_ip, type="brute_force",
                    severity="medium", count=len(failures),
                    first_seen=failures[0], last_seen=now,
                    evidence={"raw": event.raw[:500],
                              "window_seconds": self.brute_force_window},
                ))
            return alerts

        ports = extract_ports(event.raw)
        if ports:
            seen = self._ports_seen.setdefault(event.source_ip, {})
            for port in ports:
                seen[port] = now
            self._prune_ports(now)
            seen = self._ports_seen.get(event.source_ip, {})
            if (len(seen) >= self.port_scan_threshold
                    and self._due(event.source_ip, "port_scan", now)):
                self._last_alert[(event.source_ip, "port_scan")] = now
                alerts.append(Alert(
                    ip=event.source_ip, type="port_scan",
                    severity="medium", count=len(seen),
                    first_seen=min(seen.values()), last_seen=now,
                    evidence={"ports": sorted(seen),
                              "window_seconds": self.port_scan_window},
                ))
        return alerts
