package main

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
)

// ingestRequest is the JSON body accepted by POST /ingest.
type ingestRequest struct {
	Raw      string `json:"raw"`
	Source   string `json:"source"`
	SourceIP string `json:"source_ip"`
}

// Collector owns the HTTP server, the TCP listener and the
// worker pool that drains the in-memory channel into Redis.
type Collector struct {
	cfg     Config
	pub     *Publisher
	log     *slog.Logger
	jobs    chan Event
	httpSrv *http.Server
	tcpLn   net.Listener
}

func newCollector(cfg Config, pub *Publisher, log *slog.Logger) *Collector {
	c := &Collector{
		cfg:  cfg,
		pub:  pub,
		log:  log,
		jobs: make(chan Event, cfg.QueueBuffer),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", c.handleHealthz)
	mux.HandleFunc("/readyz", c.handleReadyz)
	mux.HandleFunc("/ingest", c.handleIngest)
	c.httpSrv = &http.Server{
		Addr:         cfg.HTTPAddr,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	return c
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (c *Collector) handleHealthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (c *Collector) handleReadyz(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if err := c.pub.Ping(ctx); err != nil {
		c.log.Warn("readyz redis ping failed", "error", err.Error())
		writeJSON(w, http.StatusServiceUnavailable,
			map[string]string{"status": "not_ready", "error": "redis unreachable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}

func (c *Collector) handleIngest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	defer r.Body.Close()
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "cannot read body"})
		return
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "empty body"})
		return
	}

	// Accept JSON {"raw": "...", "source": "...", "source_ip": "..."}
	// or a plain-text log line as the raw body.
	var req ingestRequest
	raw := ""
	source := "http"
	sourceIP := ""
	if err := json.Unmarshal(body, &req); err == nil && req.Raw != "" {
		raw = req.Raw
		if req.Source != "" {
			source = req.Source
		}
		sourceIP = req.SourceIP
	} else {
		raw = string(body)
	}
	if sourceIP == "" {
		sourceIP = clientIP(r)
	}
	ev := normalize(raw, source, sourceIP)
	select {
	case c.jobs <- ev:
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted", "type": ev.Type})
	default:
		c.log.Warn("ingest queue full, dropping event", "source", source)
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "queue full"})
	}
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// startWorkers launches cfg.WorkerCount goroutines that push
// queued events to Redis. They stop when ctx is cancelled.
func (c *Collector) startWorkers(ctx context.Context) {
	for i := 0; i < c.cfg.WorkerCount; i++ {
		go func(id int) {
			for {
				select {
				case <-ctx.Done():
					return
				case ev := <-c.jobs:
					pushCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
					if err := c.pub.Push(pushCtx, ev); err != nil {
						c.log.Error("dropping event after push failure",
							"worker", id, "error", err.Error(), "type", ev.Type)
					}
					cancel()
				}
			}
		}(i)
	}
}

// serveTCP accepts line-delimited log lines. One goroutine per
// connection; each line becomes one normalized event.
func (c *Collector) serveTCP(ctx context.Context) error {
	ln, err := net.Listen("tcp", c.cfg.TCPAddr)
	if err != nil {
		return err
	}
	c.tcpLn = ln
	c.log.Info("tcp listener started", "addr", c.cfg.TCPAddr)
	go func() {
		<-ctx.Done()
		_ = ln.Close()
	}()
	for {
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return nil
			default:
				c.log.Warn("tcp accept error", "error", err.Error())
				continue
			}
		}
		go c.handleTCPConn(ctx, conn)
	}
}

func (c *Collector) handleTCPConn(ctx context.Context, conn net.Conn) {
	defer conn.Close()
	remoteIP, _, _ := net.SplitHostPort(conn.RemoteAddr().String())
	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.TrimSpace(line) == "" {
			continue
		}
		ev := normalize(line, "tcp", remoteIP)
		select {
		case c.jobs <- ev:
		case <-ctx.Done():
			return
		default:
			c.log.Warn("ingest queue full, dropping tcp event", "source_ip", remoteIP)
		}
	}
	if err := scanner.Err(); err != nil {
		c.log.Warn("tcp connection read error", "source_ip", remoteIP, "error", err.Error())
	}
}
