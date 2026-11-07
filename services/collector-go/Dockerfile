# syntax=docker/dockerfile:1
# collector-go 0.1.0 — multi-stage, final image distroless (no shell, non-root).
FROM golang:1.22-alpine AS builder

WORKDIR /src

# Layer cache: dependencies first, source code last.
COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /collector .

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /collector /collector

USER nonroot:nonroot

EXPOSE 8080 9000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/collector", "healthcheck"]

ENTRYPOINT ["/collector"]
