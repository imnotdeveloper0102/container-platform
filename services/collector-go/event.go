package main

import (
	"encoding/json"
	"strings"
	"time"
)

// Event is the normalized form every log line becomes before it
// is pushed to Redis. No sample data is ever produced here:
// every field comes from the received line or the connection.
type Event struct {
	Timestamp string `json:"timestamp"`
	Source    string `json:"source"`
	SourceIP  string `json:"source_ip"`
	Type      string `json:"type"`
	Raw       string `json:"raw"`
}

// classify guesses a coarse type from the raw line. It is a
// heuristic for routing only, never a detection verdict.
func classify(raw string) string {
	lower := strings.ToLower(raw)
	switch {
	case strings.Contains(lower, "failed password"),
		strings.Contains(lower, "invalid user"),
		strings.Contains(lower, "authentication failure"),
		strings.Contains(lower, "failed login"):
		return "auth_failed"
	case strings.Contains(lower, "accepted password"),
		strings.Contains(lower, "accepted publickey"),
		strings.Contains(lower, "session opened"):
		return "auth_success"
	case strings.Contains(lower, "union select"),
		strings.Contains(lower, "' or '1'='1"),
		strings.Contains(lower, "%27"):
		return "sqli_suspect"
	case strings.Contains(raw, "HTTP/"),
		strings.Contains(lower, "get /"),
		strings.Contains(lower, "post /"):
		return "http_access"
	default:
		return "generic"
	}
}

func normalize(raw, source, sourceIP string) Event {
	raw = strings.TrimSpace(raw)
	return Event{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Source:    source,
		SourceIP:  sourceIP,
		Type:      classify(raw),
		Raw:       raw,
	}
}

func (e Event) Marshal() ([]byte, error) {
	return json.Marshal(e)
}
