package main

import (
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func testCollector() *Collector {
	cfg := loadConfig()
	cfg.QueueBuffer = 10
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	// Publisher is nil on purpose: /healthz and /ingest never touch
	// Redis, they only enqueue into the in-memory channel.
	c := newCollector(cfg, nil, log)
	return c
}

func TestHealthz(t *testing.T) {
	c := testCollector()
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	c.handleHealthz(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("healthz status = %d, want 200", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"ok"`) {
		t.Errorf("healthz body = %q", rec.Body.String())
	}
}

func TestIngestJSON(t *testing.T) {
	c := testCollector()
	body := `{"raw":"Failed password for root from 1.2.3.4 port 22 ssh2","source":"http","source_ip":"1.2.3.4"}`
	req := httptest.NewRequest(http.MethodPost, "/ingest", strings.NewReader(body))
	req.RemoteAddr = "10.0.0.1:1234"
	rec := httptest.NewRecorder()
	c.handleIngest(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("ingest status = %d, want 202; body %q", rec.Code, rec.Body.String())
	}
	ev := <-c.jobs
	if ev.Type != "auth_failed" || ev.Raw == "" {
		t.Errorf("queued event = %+v", ev)
	}
}

func TestIngestPlainText(t *testing.T) {
	c := testCollector()
	body := "Accepted password for ubuntu from 1.2.3.4 port 22 ssh2"
	req := httptest.NewRequest(http.MethodPost, "/ingest", strings.NewReader(body))
	req.RemoteAddr = "10.0.0.1:1234"
	rec := httptest.NewRecorder()
	c.handleIngest(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("ingest status = %d, want 202", rec.Code)
	}
	ev := <-c.jobs
	if ev.Type != "auth_success" {
		t.Errorf("type = %q, want auth_success", ev.Type)
	}
}

func TestIngestEmptyBodyRejected(t *testing.T) {
	c := testCollector()
	req := httptest.NewRequest(http.MethodPost, "/ingest", strings.NewReader("  "))
	rec := httptest.NewRecorder()
	c.handleIngest(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("empty ingest status = %d, want 400", rec.Code)
	}
}

func TestIngestMethodNotAllowed(t *testing.T) {
	c := testCollector()
	req := httptest.NewRequest(http.MethodGet, "/ingest", nil)
	rec := httptest.NewRecorder()
	c.handleIngest(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET /ingest status = %d, want 405", rec.Code)
	}
}
