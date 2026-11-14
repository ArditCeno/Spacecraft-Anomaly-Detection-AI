# Backend — NASA Spacecraft Anomaly Detection API

FastAPI service that serves precomputed LSTM forecasts for the SMAP `D-1` telemetry channel and
compares prediction errors with the anomaly windows labelled by NASA JPL engineers.

The TensorFlow model is **not** loaded at runtime. Forecasts are generated once by
`training/export_predictions.py` and stored in `telemetry_D-1.json`, which keeps the service small
enough to run on free serverless hosting.

## Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/health` | Liveness probe with inference mode and uptime |
| GET | `/api/model-info` | Sensor metadata, error statistics and channel benchmark |
| GET | `/api/telemetry/{sensor_id}` | Series (`step`, `actual`, `predicted`, `error`, `isTrueAnomaly`) |
| GET | `/api/anomalies?sensitivity=3` | Ground-truth windows plus detected episodes |
| GET | `/api/metrics?sensitivity=3` | Point-level and episode-level precision / recall / F1 |
| GET | `/api/threshold-curve` | F1 as a function of the threshold multiplier |
| GET | `/api/benchmark` | Forecast separability screening across eight channels |

Interactive documentation is available at `/docs` in development. It is disabled when
`ENVIRONMENT=production`.

## Run locally

```bash
pip install -r requirements.txt
uvicorn main:app --reload
```

## Security

CORS allow-list, trusted-host validation, per-IP rate limiting, security headers, HSTS, gzip and
shared caching are applied to every response. In serverless mode the rate limiter is per instance,
which is documented in [SECURITY.md](../SECURITY.md).

## Deployment

Deployed as a Vercel service together with the frontend. See [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).
