package main

import (
	"os"
	"strconv"
)

type Config struct {
	HTTPAddr      string
	TCPAddr       string
	RedisAddr     string
	RedisPassword string
	RedisDB       int
	RedisQueue    string
	WorkerCount   int
	QueueBuffer   int
	PushTimeoutMs int
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func loadConfig() Config {
	return Config{
		HTTPAddr:      envOr("HTTP_ADDR", ":8080"),
		TCPAddr:       envOr("TCP_ADDR", ":9000"),
		RedisAddr:     envOr("REDIS_ADDR", "localhost:6379"),
		RedisPassword: os.Getenv("REDIS_PASSWORD"),
		RedisDB:       envInt("REDIS_DB", 0),
		RedisQueue:    envOr("REDIS_QUEUE", "events:queue"),
		WorkerCount:   envInt("WORKER_COUNT", 8),
		QueueBuffer:   envInt("QUEUE_BUFFER", 1000),
		PushTimeoutMs: envInt("PUSH_TIMEOUT_MS", 2000),
	}
}
