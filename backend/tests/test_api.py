"""Contract tests for the precomputed inference API.

Run with:  pytest backend/tests -q
"""

import pytest
from fastapi.testclient import TestClient

from main import app


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def test_health_reports_precomputed_inference(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["inference"] == "precomputed"
    assert payload["sensor"] == "D-1"
    assert payload["points"] == 8459


def test_telemetry_returns_full_and_downsampled_series(client):
    full = client.get("/api/telemetry/D-1").json()
    compact = client.get("/api/telemetry/D-1?every=2").json()

    assert len(full["data"]) == 8459
    assert len(compact["data"]) == 4230
    assert full["data"][0]["step"] == 50
    assert full["data"][-1]["step"] == 8508
    assert set(full["data"][0]) == {"step", "actual", "predicted", "error", "isTrueAnomaly"}
    assert full["true_anomalies"] == [[5250, 8508]]
    assert full["inference"] == "precomputed"


def test_telemetry_rejects_unknown_sensor(client):
    response = client.get("/api/telemetry/P-1")
    assert response.status_code == 404
    assert "D-1" in response.json()["detail"]


def test_metrics_match_the_reported_results(client):
    payload = client.get("/api/metrics?sensitivity=3").json()
    assert payload["precision"] == 0.9638
    assert payload["recall"] == 0.8914
    assert payload["f1"] == 0.9262
    assert payload["episode_f1"] == 1.0
    assert payload["true_episodes"] == 1
    assert payload["detected_episodes"] == 1
    assert payload["windows"][0]["start"] == 5250
    assert payload["windows"][0]["end"] == 8508
    assert payload["windows"][0]["detected"] is True


def test_threshold_curve_finds_optimal_multiplier(client):
    payload = client.get("/api/threshold-curve").json()
    assert len(payload["points"]) == 39
    assert payload["best"]["sensitivity"] == 6.0
    assert payload["best"]["f1"] == 0.9405


def test_benchmark_exposes_the_screening_table(client):
    payload = client.get("/api/benchmark").json()
    assert payload["selected"] == "D-1"
    assert len(payload["channels"]) == 8
    assert payload["channels"][0]["sensor"] == "D-1"


def test_query_parameters_are_validated(client):
    assert client.get("/api/metrics?sensitivity=99").status_code == 422
    assert client.get("/api/telemetry/D-1?every=0").status_code == 422
    assert client.get("/api/anomalies?min_duration=0").status_code == 422


def test_security_and_cache_headers(client):
    response = client.get("/api/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["cache-control"] == "no-store"

    telemetry = client.get("/api/telemetry/D-1")
    assert "s-maxage=300" in telemetry.headers["cache-control"]
    assert telemetry.headers["x-content-type-options"] == "nosniff"


def test_host_header_is_validated(client):
    response = client.get("/api/health", headers={"host": "evil.example"})
    assert response.status_code == 400
