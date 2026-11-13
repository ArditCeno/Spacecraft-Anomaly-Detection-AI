# Deployment guide

The project is designed to run for free on two platforms:

| Component | Platform | Free tier limits |
| --------- | -------- | ---------------- |
| Backend (FastAPI + TensorFlow) | Hugging Face Spaces · Docker | 2 vCPU, 16 GB RAM, sleeps after 48 h of inactivity |
| Frontend (React + Vite) | Vercel | 100 GB bandwidth / month |

Render's free tier (512 MB RAM) cannot host TensorFlow, which is why Hugging Face Spaces is used
for the API.

## 1. Backend — Hugging Face Spaces

1. Create a Space at <https://huggingface.co/new-space>:
   - **Name:** `nasa-anomaly-api`
   - **SDK:** Docker → **Blank**
   - **Visibility:** Public
2. The Space repository now needs the contents of [`backend/`](../backend). Two options:

   **Option A — web upload (no git required)**

   Open the Space → **Files** → **Add file** → **Upload files** and upload everything inside
   `backend/`, keeping `README.md`, `Dockerfile`, `requirements.txt`, `main.py`,
   `nasa_lstm_model.keras`, `scaler.pkl`, `sensor_D-1_data.json` and `scripts/verify_model.py`.
   Do **not** upload `.venv/`.

   **Option B — git subtree push**

   ```bash
   git remote add space https://huggingface.co/spaces/<username>/nasa-anomaly-api
   git subtree push --prefix backend space main
   ```

   When prompted, use your Hugging Face username and a **write** access token
   (<https://huggingface.co/settings/tokens>) as the password.

3. The Space builds the Docker image automatically. First build takes ~5 minutes.
4. Verify:

   ```bash
   curl https://<username>-nasa-anomaly-api.hf.space/api/health
   # {"status":"ok","model_file":"nasa_lstm_model.keras","sensor":"D-1","points":8459,...}
   ```

Cold start: after 48 h of inactivity the Space sleeps. The first request can take ~30 s; the
dashboard shows a loading message while it wakes up.

## 2. Frontend — Vercel

1. Push the repository to GitHub (already done).
2. In Vercel: **Add New → Project → Import** the repository.
3. Configure:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Environment variable:** `VITE_API_URL` = the Space URL from step 1
     (e.g. `https://arditceno-nasa-anomaly-api.hf.space`)
4. Deploy. Vercel provides a URL such as `https://spacecraft-anomaly-detection.vercel.app`.

## 3. Post-deployment checklist

- [ ] `/api/health` returns `200`
- [ ] `/api/telemetry/D-1` returns `4230` points (with `every=2`)
- [ ] Dashboard renders three charts without console errors
- [ ] Slider from `1σ` to `8σ` changes precision / recall / F1
- [ ] `VITE_API_URL` is set in Vercel (not hard-coded)
- [ ] README live links are updated

## Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `Backend responded with HTTP 404` | Sensor id mismatch | Only `D-1` is loaded: `/api/telemetry/D-1` |
| Dashboard stuck on "Loading…" | Space sleeping | Wait ~30 s and retry |
| CORS error | API unreachable or wrong URL | Check `VITE_API_URL`, redeploy frontend |
| `No model could be loaded` | Artefacts missing in the Space | Re-upload `.keras` and `.json` files |
| Docker build fails on `tensorflow-cpu` | Python version mismatch | Image pins Python 3.11 |
