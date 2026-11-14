"""NASA Spacecraft Anomaly Detection API.

Serves precomputed LSTM forecasts for the SMAP D-1 telemetry channel together with the
ground-truth anomaly windows released by NASA JPL (Telemanom dataset).

The trained model is not loaded at runtime: forecasts are generated once by
``training/export_predictions.py`` and served from ``telemetry_D-1.json``. This keeps the
service small enough for free serverless hosting and makes responses deterministic.
"""

from __future__ import annotations

import json
import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.gzip import GZipMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware

import config
from security import CacheControlMiddleware, RateLimitMiddleware, SecurityHeadersMiddleware

logger = logging.getLogger("nasa-anomaly-api")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SENSOR_ID = "D-1"
DEFAULT_EVERY = 1
DEFAULT_SENSITIVITY = 3.0
DEFAULT_TOLERANCE = 25
REFERENCE_FRACTION = 0.40
MIN_DURATION = 3
MIN_EPISODE_GAP = 50

BENCHMARK = [
    {"sensor": "D-1", "spacecraft": "SMAP", "ratio": 10.08, "best_f1": 0.935, "status": "selected"},
    {"sensor": "A-1", "spacecraft": "SMAP", "ratio": 24.45, "best_f1": 0.404, "status": "rejected"},
    {"sensor": "E-1", "spacecraft": "SMAP", "ratio": 2.61, "best_f1": 0.438, "status": "rejected"},
    {"sensor": "E-2", "spacecraft": "SMAP", "ratio": 1.90, "best_f1": 0.337, "status": "rejected"},
    {"sensor": "S-1", "spacecraft": "SMAP", "ratio": 1.79, "best_f1": 0.304, "status": "rejected"},
    {"sensor": "T-1", "spacecraft": "SMAP", "ratio": 1.13, "best_f1": 0.210, "status": "rejected"},
    {"sensor": "F-1", "spacecraft": "SMAP", "ratio": 1.04, "best_f1": 0.028, "status": "rejected"},
    {"sensor": "P-1", "spacecraft": "SMAP", "ratio": 0.89, "best_f1": 0.084, "status": "rejected"},
]

STATE: dict[str, Any] = {}


def build_runtime(payload: dict) -> dict:
    """Convert the precomputed payload into numpy arrays used by every endpoint."""
    points = payload["points"]
    steps = np.asarray([point["step"] for point in points], dtype=np.int64)
    actual = np.asarray([point["actual"] for point in points], dtype=np.float64)
    predictions = np.asarray([point["predicted"] for point in points], dtype=np.float64)
    errors = np.asarray([point["error"] for point in points], dtype=np.float64)
    mask = np.asarray([point["isTrueAnomaly"] for point in points], dtype=bool)

    anomalies = [(int(start), int(end)) for start, end in payload["true_anomalies"]]
    reference = errors[: max(int(REFERENCE_FRACTION * len(errors)), 1)]
    ref_mean = float(payload.get("stats", {}).get("ref_mean", reference.mean()))
    ref_std = float(payload.get("stats", {}).get("ref_std", reference.std()))

    return {
        "sensor_id": payload.get("sensor_id", SENSOR_ID),
        "spacecraft": payload.get("spacecraft", "SMAP"),
        "window": int(payload["window_size"]),
        "model": payload.get("model", {"inference": "precomputed"}),
        "steps": steps,
        "actual": actual,
        "predictions": predictions,
        "errors": errors,
        "mask": mask,
        "anomalies": anomalies,
        "ref_mean": ref_mean,
        "ref_std": ref_std,
        "mean_error": float(errors.mean()),
        "std_error": float(errors.std()),
        "anomaly_ratio": float(errors[mask].mean() / ref_mean) if mask.any() and ref_mean else 0.0,
    }


def threshold_for(runtime: dict, sensitivity: float) -> float:
    return runtime["ref_mean"] + max(float(sensitivity), 0.0) * runtime["ref_std"]


def detected_mask(runtime: dict, sensitivity: float) -> np.ndarray:
    return runtime["errors"] > threshold_for(runtime, sensitivity)


def apply_persistence(flags: np.ndarray, min_duration: int) -> np.ndarray:
    """Keep only runs of consecutive flagged points at least ``min_duration`` long."""
    if min_duration <= 1:
        return flags.copy()
    kept = np.zeros_like(flags)
    indices = np.flatnonzero(flags)
    if indices.size == 0:
        return kept
    start = previous = int(indices[0])
    for current in indices[1:]:
        current = int(current)
        if current - previous == 1:
            previous = current
            continue
        if previous - start + 1 >= min_duration:
            kept[start:previous + 1] = True
        start = previous = current
    if previous - start + 1 >= min_duration:
        kept[start:previous + 1] = True
    return kept


def group_episodes(flags: np.ndarray, steps: np.ndarray, max_gap: int = MIN_EPISODE_GAP) -> list[tuple[int, int]]:
    indices = np.flatnonzero(flags)
    if indices.size == 0:
        return []
    episodes: list[tuple[int, int]] = []
    start = previous = int(indices[0])
    for current in indices[1:]:
        current = int(current)
        if steps[current] - steps[previous] <= max_gap:
            previous = current
        else:
            episodes.append((int(steps[start]), int(steps[previous])))
            start = previous = current
    episodes.append((int(steps[start]), int(steps[previous])))
    return episodes


def overlaps(first: tuple[int, int], second: tuple[int, int], tolerance: int) -> bool:
    return not (first[1] < second[0] - tolerance or first[0] > second[1] + tolerance)


def compute_metrics(
    runtime: dict,
    sensitivity: float,
    tolerance: int = DEFAULT_TOLERANCE,
    min_duration: int = MIN_DURATION,
    episode_gap: int = MIN_EPISODE_GAP,
) -> dict:
    flags = detected_mask(runtime, sensitivity)
    persistent = apply_persistence(flags, max(1, int(min_duration)))
    mask = runtime["mask"]

    tp = int(np.sum(flags & mask))
    fp = int(np.sum(flags & ~mask))
    fn = int(np.sum(~flags & mask))
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

    detected_episodes = group_episodes(persistent, runtime["steps"], episode_gap)
    true_episodes = runtime["anomalies"]
    matched = [any(overlaps(window, episode, tolerance) for episode in detected_episodes) for window in true_episodes]
    tp_eps = sum(matched)
    fn_eps = len(true_episodes) - tp_eps
    fp_eps = sum(
        1 for episode in detected_episodes
        if not any(overlaps(episode, window, tolerance) for window in true_episodes)
    )
    p_eps = tp_eps / (tp_eps + fp_eps) if tp_eps + fp_eps else 0.0
    r_eps = tp_eps / (tp_eps + fn_eps) if tp_eps + fn_eps else 0.0
    f1_eps = 2 * p_eps * r_eps / (p_eps + r_eps) if p_eps + r_eps else 0.0

    return {
        "sensitivity": round(float(sensitivity), 4),
        "threshold": round(threshold_for(runtime, sensitivity), 6),
        "tolerance": int(tolerance),
        "min_duration": int(min_duration),
        "episode_gap": int(episode_gap),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
        "episode_precision": round(p_eps, 4),
        "episode_recall": round(r_eps, 4),
        "episode_f1": round(f1_eps, 4),
        "flagged_points": int(flags.sum()),
        "detected_points": int(persistent.sum()),
        "true_positive_points": tp,
        "false_positive_points": fp,
        "false_negative_points": fn,
        "detected_episodes": len(detected_episodes),
        "true_episodes": len(true_episodes),
        "true_positive_episodes": int(tp_eps),
        "false_positive_episodes": int(fp_eps),
        "false_negative_episodes": int(fn_eps),
        "windows": [
            {
                "start": start,
                "end": end,
                "detected": bool(flag),
                "length": int(end - start + 1),
            }
            for (start, end), flag in zip(true_episodes, matched)
        ],
    }


def build_telemetry(runtime: dict, every: int) -> dict:
    step = max(1, int(every))
    indices = np.arange(0, len(runtime["actual"]), step)
    points = [
        {
            "step": int(runtime["steps"][i]),
            "actual": round(float(runtime["actual"][i]), 4),
            "predicted": round(float(runtime["predictions"][i]), 4),
            "error": round(float(runtime["errors"][i]), 4),
            "isTrueAnomaly": bool(runtime["mask"][i]),
        }
        for i in indices
    ]
    return {
        "sensor_id": runtime["sensor_id"],
        "spacecraft": runtime["spacecraft"],
        "window_size": runtime["window"],
        "model_file": runtime["model"].get("artifact", "training/artifacts/nasa_lstm_model.keras"),
        "inference": runtime["model"].get("inference", "precomputed"),
        "every": step,
        "stats": {
            "mean_error": round(runtime["mean_error"], 6),
            "std_error": round(runtime["std_error"], 6),
            "ref_mean": round(runtime["ref_mean"], 6),
            "ref_std": round(runtime["ref_std"], 6),
            "anomaly_ratio": round(runtime["anomaly_ratio"], 3),
            "optimal_sensitivity": STATE.get("optimal_sensitivity"),
            "optimal_f1": STATE.get("optimal_f1"),
        },
        "true_anomalies": [list(window) for window in runtime["anomalies"]],
        "data": points,
    }


def build_threshold_curve(runtime: dict, tolerance: int, min_duration: int = MIN_DURATION) -> dict:
    points = []
    for sensitivity in np.arange(0.5, 10.0 + 1e-9, 0.25):
        metrics = compute_metrics(runtime, float(sensitivity), tolerance, min_duration)
        points.append({
            "sensitivity": metrics["sensitivity"],
            "threshold": metrics["threshold"],
            "precision": metrics["precision"],
            "recall": metrics["recall"],
            "f1": metrics["f1"],
            "episode_f1": metrics["episode_f1"],
        })
    best = max(points, key=lambda item: item["f1"])
    return {"points": points, "best": best}


@asynccontextmanager
async def lifespan(app: FastAPI):
    STATE["started_at"] = time.time()
    path = os.path.join(BASE_DIR, f"telemetry_{SENSOR_ID}.json")
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    runtime = build_runtime(payload)
    curve = build_threshold_curve(runtime, DEFAULT_TOLERANCE)
    STATE["runtime"] = runtime
    STATE["optimal_sensitivity"] = curve["best"]["sensitivity"]
    STATE["optimal_f1"] = curve["best"]["f1"]
    yield
    STATE.clear()


app = FastAPI(
    title="NASA Spacecraft Anomaly Detection API",
    description=(
        "API serving precomputed LSTM forecasts for real NASA SMAP telemetry. "
        "Prediction errors above a tunable threshold are flagged as anomalies and compared "
        "against the windows labelled by NASA JPL engineers."
    ),
    version="1.1.0",
    lifespan=lifespan,
    docs_url="/docs" if config.DOCS_ENABLED else None,
    redoc_url=None,
    openapi_url="/openapi.json" if config.DOCS_ENABLED else None,
)

# Middleware is added inner-first: the last one added is the outermost.
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(CacheControlMiddleware)
app.add_middleware(RateLimitMiddleware, max_requests=config.RATE_LIMIT_REQUESTS, window_seconds=config.RATE_LIMIT_WINDOW_SECONDS)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=config.ALLOWED_HOSTS)
app.add_middleware(SecurityHeadersMiddleware, production=config.IS_PRODUCTION)
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_origin_regex=config.ALLOWED_ORIGIN_REGEX or None,
    allow_methods=["GET", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
    max_age=600,
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse({"detail": "Internal server error."}, status_code=500)


@app.get("/", tags=["meta"])
def root() -> dict:
    payload = {
        "name": "NASA Spacecraft Anomaly Detection API",
        "version": app.version,
        "sensor": SENSOR_ID,
        "inference": "precomputed",
        "endpoints": [
            "/api/health",
            "/api/model-info",
            "/api/telemetry/{sensor_id}",
            "/api/anomalies",
            "/api/metrics",
            "/api/threshold-curve",
            "/api/benchmark",
        ],
    }
    if config.DOCS_ENABLED:
        payload["docs"] = "/docs"
    return payload


@app.get("/api/health", tags=["meta"])
def health() -> dict:
    return {
        "status": "ok",
        "model_file": STATE["runtime"]["model"].get("artifact") if STATE.get("runtime") else None,
        "inference": "precomputed",
        "sensor": SENSOR_ID,
        "points": int(len(STATE["runtime"]["actual"])) if STATE.get("runtime") else 0,
        "uptime_seconds": round(time.time() - STATE.get("started_at", time.time()), 1),
    }


@app.get("/api/model-info", tags=["meta"])
def model_info() -> dict:
    runtime = STATE["runtime"]
    return {
        "sensor_id": runtime["sensor_id"],
        "spacecraft": runtime["spacecraft"],
        "window_size": runtime["window"],
        "model": runtime["model"],
        "inference": "precomputed",
        "stats": {
            "mean_error": round(runtime["mean_error"], 6),
            "std_error": round(runtime["std_error"], 6),
            "ref_mean": round(runtime["ref_mean"], 6),
            "ref_std": round(runtime["ref_std"], 6),
            "anomaly_ratio": round(runtime["anomaly_ratio"], 3),
            "optimal_sensitivity": STATE.get("optimal_sensitivity"),
            "optimal_f1": STATE.get("optimal_f1"),
        },
        "true_anomalies": [list(window) for window in runtime["anomalies"]],
        "benchmark": BENCHMARK,
    }


@app.get("/api/telemetry/{sensor_id}", tags=["telemetry"])
def telemetry(
    sensor_id: str,
    every: int = Query(DEFAULT_EVERY, ge=1, le=20, description="Down-sampling step"),
) -> dict:
    if sensor_id.upper() != SENSOR_ID.upper():
        raise HTTPException(
            status_code=404,
            detail=f"Sensor '{sensor_id}' is not loaded. Available sensor: {SENSOR_ID}.",
        )
    return build_telemetry(STATE["runtime"], every)


@app.get("/api/anomalies", tags=["detection"])
def anomalies(
    sensitivity: float = Query(DEFAULT_SENSITIVITY, ge=0.0, le=20.0),
    min_duration: int = Query(MIN_DURATION, ge=1, le=500),
) -> dict:
    runtime = STATE["runtime"]
    flags = detected_mask(runtime, sensitivity)
    persistent = apply_persistence(flags, int(min_duration))
    episodes = group_episodes(persistent, runtime["steps"])
    return {
        "sensor_id": runtime["sensor_id"],
        "sensitivity": round(float(sensitivity), 4),
        "threshold": round(threshold_for(runtime, sensitivity), 6),
        "min_duration": int(min_duration),
        "true_windows": compute_metrics(runtime, sensitivity, min_duration=int(min_duration))["windows"],
        "detected_episodes": [{"start": start, "end": end} for start, end in episodes],
    }


@app.get("/api/metrics", tags=["detection"])
def metrics(
    sensitivity: float = Query(DEFAULT_SENSITIVITY, ge=0.0, le=20.0),
    tolerance: int = Query(DEFAULT_TOLERANCE, ge=0, le=500),
    min_duration: int = Query(MIN_DURATION, ge=1, le=500),
) -> dict:
    return compute_metrics(STATE["runtime"], sensitivity, tolerance, int(min_duration))


@app.get("/api/threshold-curve", tags=["detection"])
def threshold_curve(
    tolerance: int = Query(DEFAULT_TOLERANCE, ge=0, le=500),
    min_duration: int = Query(MIN_DURATION, ge=1, le=500),
) -> dict:
    return build_threshold_curve(STATE["runtime"], tolerance, int(min_duration))


@app.get("/api/benchmark", tags=["meta"])
def benchmark() -> dict:
    return {
        "description": "Forecast-error separability screened across eight NASA telemanom channels.",
        "selected": SENSOR_ID,
        "channels": BENCHMARK,
    }
