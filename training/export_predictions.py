"""Generate precomputed LSTM forecasts for the serverless API.

The trained model and scaler live in ``training/artifacts``. Running this script once produces
``backend/telemetry_D-1.json``, which the FastAPI service serves without needing TensorFlow at
runtime. This keeps the deployment small enough for free serverless hosting.

Usage:
    python training/export_predictions.py
"""

from __future__ import annotations

import argparse
import json
import os

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTIFACTS = os.path.join(ROOT, "training", "artifacts")


def export(sensor: str = "D-1", every: int = 1) -> dict:
    from tensorflow.keras.models import load_model

    data_path = os.path.join(ARTIFACTS, f"sensor_{sensor}_data.json")
    model_path = os.path.join(ARTIFACTS, "nasa_lstm_model.keras")
    with open(data_path, encoding="utf-8") as handle:
        raw = json.load(handle)

    window = int(raw["window_size"])
    series = np.asarray(raw["test_scaled"], dtype=np.float32).reshape(-1, 1)
    windows = np.stack([series[i:i + window] for i in range(len(series) - window)])

    model = load_model(model_path)
    predictions = model.predict(windows, batch_size=256, verbose=0).flatten()
    actual = series[window:].flatten()
    errors = np.abs(actual - predictions)
    steps = np.arange(window, window + len(actual), dtype=np.int64)

    anomalies = [[int(start), int(end)] for start, end in raw["true_anomalies"]]
    mask = np.zeros(len(actual), dtype=bool)
    for start, end in anomalies:
        mask[max(start - window, 0): end - window + 1] = True

    reference = errors[: max(int(0.40 * len(errors)), 1)]
    payload = {
        "sensor_id": sensor,
        "spacecraft": raw.get("spacecraft", "SMAP"),
        "window_size": window,
        "every": every,
        "model": {
            "artifact": f"training/artifacts/nasa_lstm_model.keras",
            "framework": "tensorflow",
            "inference": "precomputed",
        },
        "true_anomalies": anomalies,
        "stats": {
            "mean_error": round(float(errors.mean()), 6),
            "std_error": round(float(errors.std()), 6),
            "ref_mean": round(float(reference.mean()), 6),
            "ref_std": round(float(reference.std()), 6),
            "anomaly_ratio": round(float(errors[mask].mean() / reference.mean()), 3),
        },
        "points": [
            {
                "step": int(steps[index]),
                "actual": round(float(actual[index]), 4),
                "predicted": round(float(predictions[index]), 4),
                "error": round(float(errors[index]), 4),
                "isTrueAnomaly": bool(mask[index]),
            }
            for index in range(0, len(actual), max(1, every))
        ],
    }
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sensor", default="D-1")
    parser.add_argument("--every", type=int, default=1)
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    payload = export(args.sensor, args.every)
    output = args.output or os.path.join(ROOT, "backend", f"telemetry_{args.sensor}.json")
    with open(output, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))

    stats = payload["stats"]
    size_kb = os.path.getsize(output) / 1024
    print(f"wrote {output} ({size_kb:.0f} KB, {len(payload['points'])} points)")
    print(f"anomaly_ratio={stats['anomaly_ratio']} ref_mean={stats['ref_mean']} ref_std={stats['ref_std']}")

    errors = np.asarray([point["error"] for point in payload["points"]], dtype=np.float32)
    mask = np.asarray([point["isTrueAnomaly"] for point in payload["points"]], dtype=bool)
    best = (0.0, 0.0)
    for sensitivity in np.arange(0.5, 10.0 + 1e-9, 0.25):
        threshold = stats["ref_mean"] + float(sensitivity) * stats["ref_std"]
        detected = errors > threshold
        tp = int((detected & mask).sum())
        fp = int((detected & ~mask).sum())
        fn = int((~detected & mask).sum())
        if tp + fp == 0 or tp + fn == 0:
            continue
        precision = tp / (tp + fp)
        recall = tp / (tp + fn)
        f1 = 2 * precision * recall / (precision + recall)
        if f1 > best[0]:
            best = (float(f1), float(sensitivity))
    print(f"best point F1={best[0]:.4f} at sensitivity={best[1]:.2f}")


if __name__ == "__main__":
    main()
