package main

import (
	"encoding/json"
	"testing"
)

func TestClassify(t *testing.T) {
	cases := map[string]string{
		"Failed password for root from 1.2.3.4 port 22 ssh2":            "auth_failed",
		"Invalid user admin from 1.2.3.4 port 22":                       "auth_failed",
		"Accepted password for ubuntu from 1.2.3.4 port 22 ssh2":        "auth_success",
		`192.168.1.10 - - [07/Nov/2026] "GET /index.html HTTP/1.1" 200`: "http_access",
		"GET /search?q=1' UNION SELECT password FROM users --":          "sqli_suspect",
		"some unrelated kernel message":                                 "generic",
	}
	for raw, want := range cases {
		if got := classify(raw); got != want {
			t.Errorf("classify(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestNormalize(t *testing.T) {
	ev := normalize("Failed password for root from 1.2.3.4", "tcp", "1.2.3.4")
	if ev.Type != "auth_failed" {
		t.Errorf("type = %q, want auth_failed", ev.Type)
	}
	if ev.Source != "tcp" || ev.SourceIP != "1.2.3.4" {
		t.Errorf("source/source_ip = %q/%q", ev.Source, ev.SourceIP)
	}
	if ev.Timestamp == "" || ev.Raw == "" {
		t.Error("timestamp and raw must not be empty")
	}
	b, err := ev.Marshal()
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded Event
	if err := json.Unmarshal(b, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Raw != ev.Raw || decoded.Type != ev.Type {
		t.Error("round-trip changed the event")
	}
}

func TestLoadConfigDefaults(t *testing.T) {
	t.Setenv("HTTP_ADDR", "")
	t.Setenv("TCP_ADDR", "")
	t.Setenv("REDIS_ADDR", "")
	t.Setenv("REDIS_QUEUE", "")
	cfg := loadConfig()
	if cfg.HTTPAddr != ":8080" || cfg.TCPAddr != ":9000" {
		t.Errorf("http/tcp addr = %q/%q", cfg.HTTPAddr, cfg.TCPAddr)
	}
	if cfg.RedisAddr != "localhost:6379" || cfg.RedisQueue != "events:queue" {
		t.Errorf("redis = %q/%q", cfg.RedisAddr, cfg.RedisQueue)
	}
	if cfg.WorkerCount != 8 || cfg.QueueBuffer != 1000 {
		t.Errorf("workers/buffer = %d/%d", cfg.WorkerCount, cfg.QueueBuffer)
	}
}
