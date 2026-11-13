"""Offline sanity check: load the model and confirm anomaly separability.

Usage:
    python scripts/verify_model.py
"""

from __future__ import annotations

import json
import os
import sys

import numpy as np
from tensorflow.keras.models import load_model

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SENSOR_ID = "D-1"
CANDIDATES = ("nasa_lstm_model.keras", "nasa_lstm_model.h5")
MIN_RATIO = 5.0


def main() -> int:
    with open(os.path.join(BASE_DIR, f"sensor_{SENSOR_ID}_data.json"), encoding="utf-8") as handle:
        raw = json.load(handle)

    window = int(raw["window_size"])
    series = np.asarray(raw["test_scaled"], dtype=np.float32).reshape(-1, 1)
    windows = np.stack([series[i:i + window] for i in range(len(series) - window)])

    for name in CANDIDATES:
        path = os.path.join(BASE_DIR, name)
        if not os.path.exists(path):
            continue
        try:
            model = load_model(path)
        except Exception as exc:  # pragma: no cover - version dependent
            print(f"[skip] {name}: {exc}")
            continue

        predictions = model.predict(windows, batch_size=256, verbose=0).flatten()
        actual = series[window:].flatten()
        errors = np.abs(actual - predictions)

        mask = np.zeros(len(actual), dtype=bool)
        for start, end in raw["true_anomalies"]:
            mask[max(start - window, 0): end - window + 1] = True

        ratio = float(errors[mask].mean() / errors[~mask].mean())
        status = "PASS" if ratio >= MIN_RATIO else "FAIL"
        print(f"[{status}] {name} anomaly_ratio={ratio:.2f} (minimum {MIN_RATIO})")
        return 0 if status == "PASS" else 1

    print("No loadable model found.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
