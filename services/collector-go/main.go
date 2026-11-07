package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	// Healthcheck mode used by the Docker HEALTHCHECK instruction:
	// distroless has no curl, so the binary checks itself.
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		addr := envOr("HTTP_ADDR", ":8080")
		port := addr
		if len(port) > 0 && port[0] == ':' {
			port = port[1:]
		}
		resp, err := http.Get("http://127.0.0.1:" + port + "/healthz")
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		_ = resp.Body.Close()
		os.Exit(0)
	}

	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(log)

	cfg := loadConfig()
	pub := newPublisher(cfg, log)
	defer func() { _ = pub.Close() }()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	collector := newCollector(cfg, pub, log)
	collector.startWorkers(ctx)

	// TCP runs in the background; HTTP runs in the foreground.
	go func() {
		if err := collector.serveTCP(ctx); err != nil {
			log.Error("tcp server exited", "error", err.Error())
			stop()
		}
	}()

	log.Info("collector starting",
		"http_addr", cfg.HTTPAddr, "tcp_addr", cfg.TCPAddr,
		"redis_addr", cfg.RedisAddr, "redis_queue", cfg.RedisQueue,
		"workers", cfg.WorkerCount)

	// On SIGINT/SIGTERM, shut the HTTP server down so
	// ListenAndServe returns and the process can exit.
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = collector.httpSrv.Shutdown(shutdownCtx)
	}()

	err := collector.httpSrv.ListenAndServe()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("http server exited", "error", err.Error())
	}

	// Graceful shutdown: stop accepting, drain briefly, then close.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := collector.httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Error("http shutdown error", "error", err.Error())
	}
	stop()
	// Give workers a short window to flush the in-memory queue.
	time.Sleep(500 * time.Millisecond)
	log.Info("collector stopped")
}
