"""Screen several Telemanom channels to find one with separable anomalies.

For every candidate the script trains the same small LSTM, measures how much larger the
prediction error is inside the NASA-labelled anomaly windows, and reports the best achievable
point-level F1 over a grid of thresholds.

Usage:
    python training/screen_channels.py
"""

from __future__ import annotations

import ast

import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.callbacks import EarlyStopping
from tensorflow.keras.layers import LSTM, Dense, Dropout, Input
from tensorflow.keras.models import Sequential

BASE = "https://huggingface.co/datasets/appleparan/telemanom/resolve/main/data"
LABELS = "https://raw.githubusercontent.com/khundman/telemanom/master/labeled_anomalies.csv"
WINDOW = 50
CANDIDATES = ["P-1", "S-1", "E-1", "E-2", "A-1", "F-1", "T-1", "D-1"]


def build_model() -> Sequential:
    model = Sequential([
        Input(shape=(WINDOW, 1)),
        LSTM(64, return_sequences=True),
        Dropout(0.2),
        LSTM(32),
        Dropout(0.2),
        Dense(1),
    ])
    model.compile(optimizer="adam", loss="mse")
    return model


def create_sequences(data: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    inputs, targets = [], []
    for index in range(len(data) - WINDOW):
        inputs.append(data[index:index + WINDOW])
        targets.append(data[index + WINDOW])
    return np.asarray(inputs, np.float32), np.asarray(targets, np.float32)


def main() -> None:
    labels = pd.read_csv(LABELS)
    results = []

    for sensor in CANDIDATES:
        try:
            train = pd.read_parquet(f"{BASE}/train/{sensor}.parquet")["value"].to_numpy(np.float32).reshape(-1, 1)
            test = pd.read_parquet(f"{BASE}/test/{sensor}.parquet")["value"].to_numpy(np.float32).reshape(-1, 1)
            row = labels[labels["chan_id"] == sensor].iloc[0]
            anomalies = ast.literal_eval(row["anomaly_sequences"])
            assert len(test) == int(row["num_values"])

            scaler = MinMaxScaler().fit(train)
            train_scaled = scaler.transform(train).astype(np.float32)
            test_scaled = scaler.transform(test).astype(np.float32)
            x_train, y_train = create_sequences(train_scaled)
            x_test, _ = create_sequences(test_scaled)

            model = build_model()
            model.fit(
                x_train, y_train, epochs=30, batch_size=64, validation_split=0.1, verbose=0,
                callbacks=[EarlyStopping(monitor="val_loss", patience=3, restore_best_weights=True)],
            )

            predictions = model.predict(x_test, verbose=0).flatten()
            actual = test_scaled[WINDOW:].flatten()
            errors = np.abs(actual - predictions)
            mask = np.zeros(len(actual), dtype=bool)
            for start, end in anomalies:
                mask[max(start - WINDOW, 0): end - WINDOW + 1] = True

            ratio = float(errors[mask].mean() / errors[~mask].mean())
            best_f1, best_q = 0.0, 0.0
            for quantile in np.arange(80, 99.9, 0.5):
                threshold = np.percentile(errors[~mask], quantile)
                detected = errors > threshold
                tp = int((detected & mask).sum())
                fp = int((detected & ~mask).sum())
                fn = int((~detected & mask).sum())
                if tp + fp == 0 or tp + fn == 0:
                    continue
                precision = tp / (tp + fp)
                recall = tp / (tp + fn)
                f1 = 2 * precision * recall / (precision + recall)
                if f1 > best_f1:
                    best_f1, best_q = float(f1), float(quantile)

            results.append((sensor, str(row["spacecraft"]), len(train), round(ratio, 2), round(best_f1, 3), best_q))
            print(f"{sensor:5s} {row['spacecraft']:5s} train={len(train):6d} ratio={ratio:6.2f} bestF1={best_f1:.3f} q={best_q}")
        except Exception as exc:  # pragma: no cover - network dependent
            print(f"{sensor}: error {exc!r}")

    print("\nRanking (by best F1):")
    for item in sorted(results, key=lambda row: -row[4]):
        print(item)


if __name__ == "__main__":
    main()
