# Frontend — Mission Control Dashboard

React 19 + Vite dashboard for the NASA spacecraft anomaly detection API. It plots the SMAP
telemetry channel against LSTM forecasts, visualises NASA-labelled anomaly windows, and lets the
user tune the alarm threshold in real time.

## Features

- Live threshold slider (`1σ` – `8σ`) with instant precision / recall / F1 updates
- Point-level and episode-level metrics with a persistence filter
- Sensor signal vs LSTM forecast chart with anomaly bands
- Prediction-error chart with the current alarm threshold
- Detection diagnostics chart (F1 as a function of sensitivity)
- Cold-start handling for the free-tier backend

## Scripts

```bash
npm install
npm run dev      # development server on http://localhost:5173
npm run build    # production bundle in dist/
npm run lint     # Oxlint
npm run preview  # preview the production build
```

## Configuration

Create `.env.local` (or set the variable in your hosting provider):

```env
VITE_API_URL=https://your-backend-url
```

If the variable is missing, the app falls back to `http://localhost:8000`.
