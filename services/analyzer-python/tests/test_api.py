import os

os.environ["ANALYZER_RUN_WORKER"] = "false"

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_healthz():
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_stats_shape():
    response = client.get("/stats")
    assert response.status_code == 200
    body = response.json()
    assert body["processed"] == 0
    assert body["alerts"] == 0
    assert body["last_event"] is None


def test_readyz_without_backends_is_not_ready():
    # No Redis/Postgres is running in the test environment, so the
    # service must report not_ready (503) rather than pretend it is.
    response = client.get("/readyz")
    assert response.status_code == 503
    assert response.json()["status"] == "not_ready"
