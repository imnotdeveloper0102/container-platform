# syntax=docker/dockerfile:1
# analyzer-python 0.1.0 — multi-stage, final image python:3.12-slim, non-root.
FROM python:3.12-slim AS builder

WORKDIR /src

# Layer cache: dependencies first, source code last.
COPY requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/usr/local/bin:$PATH

RUN groupadd -r analyzer && useradd -r -g analyzer analyzer \
    && mkdir -p /app && chown analyzer:analyzer /app

WORKDIR /app

COPY --from=builder /install /usr/local
COPY app ./app

USER analyzer:analyzer

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2)"]

CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
