# Deployment guide

The project runs entirely on **Vercel Hobby** at zero cost and without a payment method. The
repository is configured as a single Vercel project with two services:

| Service | Root | Framework | Responsibility |
| ------- | ---- | --------- | -------------- |
| `backend` | `backend/` | FastAPI | Serves precomputed LSTM forecasts from `telemetry_D-1.json` |
| `frontend` | `frontend/` | Vite | Static React dashboard |

Routing lives in the root [`vercel.json`](../vercel.json): `/api/*` goes to the backend, everything
else to the frontend. Because the API is on the same origin, **no environment variables are needed
in production** and no CORS preflight is involved.

## Prerequisites

- A GitHub account with the repository pushed (already done).
- A Vercel account created with GitHub (Hobby plan, no card required).

## Steps

1. Open <https://vercel.com/new> and import `ArditCeno/Spacecraft-Anomaly-Detection-AI`.
2. Vercel detects multiple applications because of `vercel.json`. Keep **Root Directory** as `./`
   and confirm **Import multi-service project**.
3. Do not add environment variables. Click **Deploy**.
4. The first build takes about two minutes: Vercel installs `fastapi`, `numpy` and `uvicorn` for
   the backend and builds the Vite bundle for the frontend.
5. Open the production URL printed by Vercel, for example
   `https://spacecraft-anomaly-detection-ai.vercel.app`.

## Verification checklist

```bash
curl -i https://<project>.vercel.app/api/health
# 200, {"status":"ok","model_file":"training/artifacts/nasa_lstm_model.keras",
#       "inference":"precomputed","sensor":"D-1","points":8459,...}

curl -s https://<project>.vercel.app/api/telemetry/D-1?every=2 | head -c 200
curl -s "https://<project>.vercel.app/api/metrics?sensitivity=3"
# {"f1":0.9262,"episode_f1":1.0,...}

curl -s -o /dev/null -w "%{http_code}\n" https://<project>.vercel.app/docs
# 404  (documentation is disabled in production)

curl -sI https://<project>.vercel.app/api/telemetry/D-1 | grep -i \
  "content-encoding\|cache-control\|x-content-type"
# content-encoding: gzip
# cache-control: public, s-maxage=300, stale-while-revalidate=600
```

Dashboard checks:

- [ ] Three charts render without console errors
- [ ] Threshold slider changes precision, recall and F1 live
- [ ] "Jump to optimal" button sets `6σ` and F1 `94.1%`
- [ ] Sketchfab backdrop loads, motion toggle works, mobile shows the starfield
- [ ] Footer credits and the `precomputed` inference label are visible

## Free-tier limits

| Limit | Value | Impact |
| ----- | ----- | ------ |
| Function size | 250 MB | runtime is ~40 MB (no TensorFlow) |
| Bandwidth | 100 GB/month | ~100 KB per dashboard load with gzip → ~1M loads |
| Function duration | 60 s | startup is under 1 s |
| Cold start | 1–3 s | in-memory data, no model loading |
| Shared cache | 5 min (`s-maxage=300`) | most requests never reach the function |

Costs stay at **$0** as long as no paid plan or payment method is added. If Vercel ever asks for a
card, stop: the free path does not require one.

## Regenerating the forecasts

The API is deterministic and reads a committed artefact. To retrain or change the sensor:

```bash
# training environment (TensorFlow is only needed here)
pip install tensorflow==2.17.1 pandas pyarrow scikit-learn joblib
python training/train.py --sensor D-1
python training/export_predictions.py
```

Commit the new `backend/telemetry_D-1.json` and redeploy. The Python runtime never installs
TensorFlow.

## Fallback: two separate Vercel projects

If the services import is unavailable on your account, deploy the backend and frontend separately:

1. **Backend project**: root `backend/`. Add `backend/api/index.py`:

   ```python
   import os
   import sys

   sys.path.append(os.path.dirname(os.path.dirname(__file__)))

   from main import app  # noqa: E402,F401
   ```

   and `backend/vercel.json`:

   ```json
   {
     "builds": [{ "src": "api/index.py", "use": "@vercel/python" }],
     "routes": [{ "src": "/(.*)", "dest": "api/index.py" }]
   }
   ```

2. **Frontend project**: root `frontend/`, with `VITE_API_URL` set to the backend URL. The CORS
   regex already allows `https://*.vercel.app`.

## Local development

```bash
# terminal 1
cd backend
pip install -r requirements.txt
uvicorn main:app --reload

# terminal 2
cd frontend
npm install
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8000`, so the frontend always uses relative URLs.

## Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `404` on `/api/health` | Rewrite not applied | Confirm the root `vercel.json` is committed and Root Directory is `./` |
| `400 Invalid host header` | Custom domain not in `ALLOWED_HOSTS` | Set the variable in the project settings |
| Dashboard shows "Backend unavailable" | Backend build failed | Check the service build logs in Vercel |
| Data looks stale | Old `telemetry_D-1.json` | Re-run `training/export_predictions.py` and redeploy |
| `/docs` returns 404 | Production mode | Expected: set `DOCS_ENABLED=true` only for debugging |
