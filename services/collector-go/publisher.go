package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/redis/go-redis/v9"
)

// Publisher pushes normalized events to a Redis list, with a
// bounded timeout and a small fixed retry loop.
type Publisher struct {
	client  *redis.Client
	queue   string
	timeout time.Duration
	log     *slog.Logger
}

func newPublisher(cfg Config, log *slog.Logger) *Publisher {
	client := redis.NewClient(&redis.Options{
		Addr:         cfg.RedisAddr,
		Password:     cfg.RedisPassword,
		DB:           cfg.RedisDB,
		DialTimeout:  3 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		MaxRetries:   2,
	})
	return &Publisher{
		client:  client,
		queue:   cfg.RedisQueue,
		timeout: time.Duration(cfg.PushTimeoutMs) * time.Millisecond,
		log:     log,
	}
}

func (p *Publisher) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return p.client.Ping(ctx).Err()
}

func (p *Publisher) Close() error {
	return p.client.Close()
}

// Push serializes one event and LPUSHes it. It retries up to 3
// times on transient Redis errors, then returns the last error
// so the caller can log and drop (never silently pretend success).
func (p *Publisher) Push(ctx context.Context, ev Event) error {
	payload, err := ev.Marshal()
	if err != nil {
		return fmt.Errorf("marshal event: %w", err)
	}
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		attemptCtx, cancel := context.WithTimeout(ctx, p.timeout)
		err = p.client.LPush(attemptCtx, p.queue, payload).Err()
		cancel()
		if err == nil {
			return nil
		}
		lastErr = err
		p.log.Warn("redis push failed, retrying",
			"attempt", attempt, "error", err.Error(), "queue", p.queue)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt*100) * time.Millisecond):
		}
	}
	return fmt.Errorf("redis push failed after 3 attempts: %w", lastErr)
}
