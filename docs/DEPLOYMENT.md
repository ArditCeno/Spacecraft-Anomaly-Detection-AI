# Deployment guide

The project runs on **Vercel Hobby** at zero cost and without a payment method. Vercel's
multi-service import was not available on the account used for this deployment, so the backend and
frontend run as two separate projects. Both are ordinary free-tier deployments.

| Project | Root | Framework | URL |
| ------- | ---- | --------- | --- |
| `spacecraft-anomaly-detection-ai` | `frontend/` | Vite | https://spacecraft-anomaly-detection-ai.vercel.app |
| `nasa-anomaly-api` | `backend/` | FastAPI | https://nasa-anomaly-api.vercel.app |

The frontend calls the backend across origins. The API allows it through
`ALLOWED_ORIGIN_REGEX=https://[a-z0-9-]+\.vercel\.app` (the default), so preview deployments work
too.

## Prerequisites

- GitHub repository with `main` pushed.
- Vercel account created with GitHub (Hobby plan, no card).

## 1. Backend project

1. Open <https://vercel.com/new> and import `ArditCeno/Spacecraft-Anomaly-Detection-AI`.
2. Under the `backend` application, choose **Import single project**.
3. Project name: `nasa-anomaly-api` · Root Directory: `backend` · Framework: **FastAPI**.
4. Do not add environment variables. Vercel sets `VERCEL=1`, which switches the app to production
   (docs disabled, CSP enabled).
5. Deploy and verify:

   ```bash
   curl https://nasa-anomaly-api.vercel.app/api/health
   # {"status":"ok","model_file":"training/artifacts/nasa_lstm_model.keras",
   #  "inference":"precomputed","sensor":"D-1","points":8459,...}
   ```

## 2. Frontend project

1. Import the same repository again.
2. Under the `frontend` application, choose **Import single project**.
3. Project name: `spacecraft-anomaly-detection-ai` · Root Directory: `frontend` · Framework:
   **Vite**.
4. The API URL is committed in `frontend/.env.production`:

   ```env
   VITE_API_URL=https://nasa-anomaly-api.vercel.app
   ```

   You can also set `VITE_API_URL` in **Settings → Environment Variables**; dashboard values
   override the file. `VITE_*` variables are public by design and must never contain secrets.
5. Deploy. Vercel rebuilds automatically on every push to `main`.

## Verification checklist

```bash
curl -i https://nasa-anomaly-api.vercel.app/api/health
curl -s "https://nasa-anomaly-api.vercel.app/api/metrics?sensitivity=3"
# {"f1":0.9262,"episode_f1":1.0,...}

curl -s -o /dev/null -w "%{http_code}\n" https://nasa-anomaly-api.vercel.app/docs
# 404

curl -sI https://nasa-anomaly-api.vercel.app/api/telemetry/D-1 | grep -i \
  "content-encoding\|cache-control"
# content-encoding: gzip
# cache-control: public, s-maxage=300, stale-while-revalidate=600

curl -sI https://spacecraft-anomaly-detection-ai.vercel.app/ | grep -i \
  "content-security\|x-frame\|strict-transport"
```

Browser checks:

- [ ] Three charts render without console errors
- [ ] Slider changes precision, recall and F1 live
- [ ] "Jump to optimal" sets `6σ` and F1 `94.1%`
- [ ] "What am I looking at?" dialog opens, scrolls and closes with Escape
- [ ] Backdrop loads, motion toggle works, mobile shows the starfield
- [ ] Footer credits are visible

## Deployment protection

Vercel protects per-deployment URLs with SSO by default. A URL such as
`https://spacecraft-anomaly-detection-aoc862lqh-arditceno.vercel.app` redirects to Vercel login.
Always share the **production alias** (`https://spacecraft-anomaly-detection-ai.vercel.app`), which
is public.

## Free-tier limits

| Limit | Value | Impact |
| ----- | ----- | ------ |
| Function size | 250 MB | runtime is ~40 MB (no TensorFlow) |
| Bandwidth | 100 GB/month | ~64 KB per dashboard load with gzip → ~1.5M loads |
| Function duration | 60 s | startup is under 1 s |
| Cold start | 1–3 s | in-memory artefact, no model loading |
| Shared cache | 5 min (`s-maxage=300`) | most requests never reach the function |

Costs stay at **$0** as long as no paid plan or payment method is added.

## Regenerating the forecasts

The API is deterministic and reads a committed artefact. To retrain or change the sensor:

```bash
# training environment (TensorFlow is only needed here)
pip install tensorflow==2.17.1 pandas pyarrow scikit-learn joblib
python training/train.py --sensor D-1
python training/export_predictions.py
```

Commit the new `backend/telemetry_D-1.json` and push. The deployed Python runtime never installs
TensorFlow.

## Optional: single-project services mode

If Vercel enables services for your account, the root [`vercel.json`](../vercel.json) already
describes the two services and the `/api/*` rewrite. Import the repository with Root Directory
`./` and choose **Import multi-service project**. The frontend then uses relative `/api` calls,
which also works because `VITE_API_URL` is unset during that build only if you remove
`frontend/.env.production`.

## Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| Deployment URL redirects to Vercel login | Deployment protection | Share the production alias instead |
| Dashboard shows "Backend unavailable" | `VITE_API_URL` missing at build time | Set it in `.env.production` or the dashboard, then **Redeploy** |
| `404` on `/api/health` | Wrong project root | Backend project must use Root Directory `backend` |
| CORS error | Backend URL not matching the regex | Add the exact origin to `ALLOWED_ORIGINS` |
| Data looks stale | Old `telemetry_D-1.json` | Re-run `training/export_predictions.py` and push |
| `/docs` returns 404 | Production mode | Expected; enable `DOCS_ENABLED=true` only for debugging |
