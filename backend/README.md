---
title: NASA Spacecraft Anomaly API
emoji: 🛰️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# NASA Spacecraft Anomaly Detection API

FastAPI service that serves LSTM reconstruction-quality forecasts for the SMAP
`D-1` telemetry channel and compares prediction errors with the anomaly windows
labelled by NASA JPL engineers (Telemanom dataset).

## Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/health` | Liveness probe with model file and uptime |
| GET | `/api/model-info` | Sensor metadata, error statistics and channel benchmark |
| GET | `/api/telemetry/{sensor_id}` | Full series (`step`, `actual`, `predicted`, `error`, `isTrueAnomaly`) |
| GET | `/api/anomalies?sensitivity=3` | Ground-truth windows plus detected episodes |
| GET | `/api/metrics?sensitivity=3` | Point-level and episode-level precision / recall / F1 |
| GET | `/api/threshold-curve` | F1 as a function of the threshold multiplier |
| GET | `/api/benchmark` | Forecast separability screening across eight channels |

Interactive documentation is available at `/docs`.

## Run locally

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

## Docker

```bash
docker build -t nasa-anomaly-api .
docker run -p 7860:7860 nasa-anomaly-api
```
