"""Reproducible training script for the spacecraft anomaly detection model.

Runs on CPU in a few minutes; a GPU is not required for the final D-1 model.
Data comes from the public Hugging Face mirror of the Telemanom dataset.

Usage:
    python training/train.py
    python training/train.py --sensor P-1
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import random

import joblib
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.preprocessing import MinMaxScaler
from tensorflow.keras.callbacks import EarlyStopping, ModelCheckpoint
from tensorflow.keras.layers import LSTM, Dense, Dropout, Input
from tensorflow.keras.models import Sequential

BASE = "https://huggingface.co/datasets/appleparan/telemanom/resolve/main/data"
LABELS = "https://raw.githubusercontent.com/khundman/telemanom/master/labeled_anomalies.csv"


def build_model(window_size: int) -> Sequential:
    model = Sequential([
        Input(shape=(window_size, 1)),
        LSTM(64, return_sequences=True),
        Dropout(0.2),
        LSTM(32),
        Dropout(0.2),
        Dense(1),
    ])
    model.compile(optimizer="adam", loss="mse")
    return model


def create_sequences(data: np.ndarray, window: int) -> tuple[np.ndarray, np.ndarray]:
    inputs, targets = [], []
    for index in range(len(data) - window):
        inputs.append(data[index:index + window])
        targets.append(data[index + window])
    return np.asarray(inputs, dtype=np.float32), np.asarray(targets, dtype=np.float32)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sensor", default="D-1")
    parser.add_argument("--window", type=int, default=50)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=64)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", default="backend")
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    tf.random.set_seed(args.seed)

    labels = pd.read_csv(LABELS)
    row = labels[labels["chan_id"] == args.sensor].iloc[0]
    anomalies = ast.literal_eval(row["anomaly_sequences"])

    train = pd.read_parquet(f"{BASE}/train/{args.sensor}.parquet")["value"].to_numpy(np.float32).reshape(-1, 1)
    test = pd.read_parquet(f"{BASE}/test/{args.sensor}.parquet")["value"].to_numpy(np.float32).reshape(-1, 1)
    assert len(test) == int(row["num_values"]), "test length does not match NASA metadata"

    scaler = MinMaxScaler()
    train_scaled = scaler.fit_transform(train).astype(np.float32)
    test_scaled = scaler.transform(test).astype(np.float32)

    x_train, y_train = create_sequences(train_scaled, args.window)
    x_test, _ = create_sequences(test_scaled, args.window)

    os.makedirs(args.output, exist_ok=True)
    checkpoint = os.path.join(args.output, "nasa_lstm_model.keras")

    model = build_model(args.window)
    history = model.fit(
        x_train,
        y_train,
        epochs=args.epochs,
        batch_size=args.batch_size,
        validation_split=0.1,
        shuffle=True,
        verbose=1,
        callbacks=[
            EarlyStopping(monitor="val_loss", patience=5, restore_best_weights=True),
            ModelCheckpoint(checkpoint, monitor="val_loss", save_best_only=True),
        ],
    )
    model = tf.keras.models.load_model(checkpoint)

    predictions = model.predict(x_test, batch_size=256, verbose=0).flatten()
    actual = test_scaled[args.window:].flatten()
    errors = np.abs(actual - predictions)

    mask = np.zeros(len(actual), dtype=bool)
    for start, end in anomalies:
        mask[max(start - args.window, 0): end - args.window + 1] = True

    ratio = float(errors[mask].mean() / errors[~mask].mean())
    print(f"anomaly error ratio: {ratio:.2f}x")

    model.save(checkpoint)
    joblib.dump(scaler, os.path.join(args.output, "scaler.pkl"))
    with open(os.path.join(args.output, f"sensor_{args.sensor}_data.json"), "w", encoding="utf-8") as handle:
        json.dump({
            "sensor_id": args.sensor,
            "spacecraft": str(row["spacecraft"]),
            "window_size": args.window,
            "test_raw": test.flatten().tolist(),
            "test_scaled": test_scaled.flatten().tolist(),
            "true_anomalies": anomalies,
        }, handle)
    with open(os.path.join("training", "training_history.json"), "w", encoding="utf-8") as handle:
        json.dump({key: [float(v) for v in values] for key, values in history.history.items()}, handle)


if __name__ == "__main__":
    main()
