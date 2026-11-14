import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')
const SENSOR_ID = 'D-1'
const CHART_EVERY = 3
const TOLERANCE = 25
const MIN_DURATION = 3
const EPISODE_GAP = 50

const INK = '#070b12'
const RULE = '#1b2532'
const MOTION_KEY = 'spacecraft-dashboard.motion'
const SKETCHFAB_MODEL = '178d1deb210a4bc4a63ee05bc6cb6dcf'
const SKETCHFAB_PAGE = `https://sketchfab.com/3d-models/solar-system-${SKETCHFAB_MODEL}`

const asPercent = (value) => `${(value * 100).toFixed(1)}%`

function computeMetrics(points, threshold, trueAnomalies) {
  const flags = points.map((point) => point.error > threshold)
  const persistent = new Array(points.length).fill(false)

  let runStart = -1
  for (let i = 0; i <= points.length; i += 1) {
    const flagged = i < points.length && flags[i]
    if (flagged && runStart === -1) runStart = i
    if (!flagged && runStart !== -1) {
      if (i - runStart >= MIN_DURATION) {
        for (let j = runStart; j < i; j += 1) persistent[j] = true
      }
      runStart = -1
    }
  }

  const episodes = []
  let current = null
  points.forEach((point, index) => {
    if (!persistent[index]) return
    if (current && point.step - current.end <= EPISODE_GAP) {
      current.end = point.step
    } else {
      if (current) episodes.push(current)
      current = { start: point.step, end: point.step }
    }
  })
  if (current) episodes.push(current)

  let tp = 0
  let fp = 0
  let fn = 0
  points.forEach((point, index) => {
    if (flags[index] && point.isTrueAnomaly) tp += 1
    else if (flags[index]) fp += 1
    else if (point.isTrueAnomaly) fn += 1
  })

  const precision = tp + fp ? tp / (tp + fp) : 0
  const recall = tp + fn ? tp / (tp + fn) : 0
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0

  const overlap = (first, second) =>
    !(first.end < second.start - TOLERANCE || first.start > second.end + TOLERANCE)
  const windows = trueAnomalies.map(([start, end]) => ({ start, end }))
  const detectedWindows = windows.filter((window) => episodes.some((episode) => overlap(window, episode))).length
  const falseEpisodes = episodes.filter((episode) => !windows.some((window) => overlap(episode, window))).length
  const episodePrecision = detectedWindows + falseEpisodes ? detectedWindows / (detectedWindows + falseEpisodes) : 0
  const episodeRecall = windows.length ? detectedWindows / windows.length : 0
  const episodeF1 = episodePrecision + episodeRecall
    ? (2 * episodePrecision * episodeRecall) / (episodePrecision + episodeRecall)
    : 0

  return {
    precision,
    recall,
    f1,
    tp,
    fp,
    fn,
    episodes,
    windows,
    detectedWindows,
    falseEpisodes,
    episodePrecision,
    episodeRecall,
    episodeF1,
    flaggedPoints: flags.filter(Boolean).length,
  }
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
      <p className="mb-1 font-mono text-slate-400">step {label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="font-mono" style={{ color: entry.color }}>
          {entry.name} {typeof entry.value === 'number' ? entry.value.toFixed(4) : entry.value}
        </p>
      ))}
    </div>
  )
}

function Metric({ label, value, sub }) {
  return (
    <div className="px-5 py-5 text-center" style={{ backgroundColor: 'rgba(2,6,12,0.22)' }}>
      <div className="text-[11px] uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className="mt-1.5 font-mono text-2xl text-slate-100">{value}</div>
      <div className="mt-1 text-[11px] text-slate-400">{sub}</div>
    </div>
  )
}

function LegendItem({ color, label, dashed = false }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-[11px] text-slate-400">
      <span
        className="inline-block h-0 w-5 border-t"
        style={{ borderColor: color, borderTopStyle: dashed ? 'dashed' : 'solid' }}
      />
      {label}
    </span>
  )
}

const STARS = (() => {
  let state = 97
  const next = () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
  return Array.from({ length: 140 }, () => ({
    x: next() * 1600,
    y: next() * 900,
    radius: 0.4 + next() * 1.2,
    opacity: 0.12 + next() * 0.5,
  }))
})()

function Starfield() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {STARS.map((star, index) => (
        <circle
          key={index}
          cx={star.x}
          cy={star.y}
          r={star.radius}
          fill="#cbd5e1"
          opacity={star.opacity}
        />
      ))}
    </svg>
  )
}

function SpaceBackdrop({ showIframe, motion, loaded, onLoad }) {
  const src = `https://sketchfab.com/models/${SKETCHFAB_MODEL}/embed?autospin=${motion ? '0.15' : '0'}&autostart=1&preload=1&ui_controls=0&ui_infos=0&ui_stop=0&ui_watermark=0&ui_theme=dark&ui_fullscreen=0&ui_help=0&ui_settings=0&ui_vr=0&ui_annotations=0&ui_general_controls=0&ui_hint=0&ui_loading=0&dnt=1`

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#070b12]">
      <Starfield />
      {showIframe ? (
        <iframe
          key={motion ? 'animated' : 'static'}
          title="Solar System backdrop by pinotoon on Sketchfab"
          src={src}
          allow="autoplay; fullscreen"
          loading="lazy"
          onLoad={onLoad}
          className="absolute inset-0 h-full w-full border-0"
          style={{
            opacity: loaded ? 0.74 : 0,
            transform: 'scale(1.2) translateX(12%)',
            transformOrigin: 'center',
            filter: 'brightness(0.9) saturate(0.95)',
            transition: 'opacity 1.4s ease',
          }}
        />
      ) : null}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgba(7,11,18,0.18) 0%, rgba(7,11,18,0.45) 45%, rgba(7,11,18,0.82) 100%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 35%, rgba(7,11,18,0.02) 0%, rgba(7,11,18,0.28) 65%, rgba(7,11,18,0.75) 100%)',
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0 h-[38%]"
        style={{
          background: 'linear-gradient(180deg, rgba(7,11,18,0) 0%, rgba(7,11,18,0.92) 100%)',
        }}
      />
    </div>
  )
}


function AboutDialog({ dialogRef }) {
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="about-title"
      className="about-dialog flex max-h-[86vh] w-[min(760px,92vw)] flex-col rounded-md border border-white/10 bg-slate-950/85 p-0 text-slate-200 shadow-2xl shadow-black/70 backdrop-blur-xl"
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-300">mission brief</p>
          <h2 id="about-title" className="mt-1 text-xl font-semibold text-slate-100">
            What am I looking at?
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          className="border border-white/15 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-slate-300 hover:bg-white/5"
        >
          close
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5 text-sm leading-relaxed text-slate-300">
        <p>
          This is a mission-control view of one real telemetry channel from NASA's SMAP satellite. An
          LSTM network was trained only on normal operation and forecasts the next sample from the
          previous 50 samples. The distance between the forecast and reality is the anomaly signal.
        </p>
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400">How to read it</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>The cyan line is the real sensor value. The grey dashed line is the LSTM forecast.</li>
            <li>The shaded band is the anomaly window labelled by NASA JPL engineers. The red outline is the episode the alarm detected.</li>
            <li>The slider moves the alarm threshold: <span className="font-mono">reference mean + k x reference std</span>, computed on the first 40% of the test split.</li>
            <li>The second chart shows the prediction error and the active threshold. Everything above the dashed line is flagged.</li>
          </ul>
        </div>
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400">Metrics</h3>
          <dl className="mt-2 space-y-2">
            <div>
              <dt className="text-slate-400">Episodes detected</dt>
              <dd className="mt-0.5">Labelled anomaly windows caught by the alarm, out of the total.</dd>
            </div>
            <div>
              <dt className="text-slate-400">Precision / recall</dt>
              <dd className="mt-0.5">Point-level scores over all 8,459 test samples.</dd>
            </div>
            <div>
              <dt className="text-slate-400">Point vs episode F1</dt>
              <dd className="mt-0.5">Episode F1 counts an alarm as correct when it overlaps a labelled window within +/-25 samples.</dd>
            </div>
            <div>
              <dt className="text-slate-400">Error ratio</dt>
              <dd className="mt-0.5">Mean error inside anomalies divided by mean error during normal operation (18.6x).</dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400">Data and model</h3>
          <p className="mt-2">
            Dataset: Telemanom (Hundman et al., KDD 2018), channel D-1, 8,509 test samples with one
            labelled anomaly between steps 5,250 and 8,508. Model: two stacked LSTM layers (64 and 32
            units) with dropout, trained on 2,849 normal samples. Forecasts are precomputed once and
            replayed by FastAPI, which keeps this demo free to host.
          </p>
        </div>
        <div>
          <h3 className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate-400">Links</h3>
          <ul className="mt-2 space-y-1.5">
            <li><a className="text-cyan-300 underline decoration-cyan-900 underline-offset-4 hover:text-cyan-200" href="https://github.com/ArditCeno/Spacecraft-Anomaly-Detection-AI" target="_blank" rel="noreferrer noopener">Source code and full documentation</a></li>
            <li><a className="text-cyan-300 underline decoration-cyan-900 underline-offset-4 hover:text-cyan-200" href="https://github.com/khundman/telemanom" target="_blank" rel="noreferrer noopener">Telemanom dataset and paper</a></li>
            <li><a className="text-cyan-300 underline decoration-cyan-900 underline-offset-4 hover:text-cyan-200" href="https://huggingface.co/datasets/appleparan/telemanom" target="_blank" rel="noreferrer noopener">Telemetry mirror used for training</a></li>
          </ul>
        </div>
      </div>
    </dialog>
  )
}

export default function App() {
  const [telemetry, setTelemetry] = useState(null)
  const [curve, setCurve] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [sensitivity, setSensitivity] = useState(3)
  const [reloadToken, setReloadToken] = useState(0)
  const [motion, setMotion] = useState(() => {
    const saved = window.localStorage.getItem(MOTION_KEY)
    if (saved === 'on') return true
    if (saved === 'off') return false
    return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  })
  const [wide, setWide] = useState(() => window.matchMedia?.('(min-width: 768px)').matches ?? true)
  const [backdropReady, setBackdropReady] = useState(false)
  const [backdropFailed, setBackdropFailed] = useState(false)
  const [backdropLoaded, setBackdropLoaded] = useState(false)
  const [tabVisible, setTabVisible] = useState(() => !document.hidden)
  const aboutRef = useRef(null)

  useEffect(() => {
    const controller = new AbortController()

    async function fetchData() {
      try {
        const [telemetryResponse, curveResponse] = await Promise.all([
          fetch(`${API_URL}/api/telemetry/${SENSOR_ID}?every=1`, { signal: controller.signal }),
          fetch(`${API_URL}/api/threshold-curve`, { signal: controller.signal }).catch(() => null),
        ])
        if (!telemetryResponse.ok) {
          throw new Error(`Backend responded with HTTP ${telemetryResponse.status}`)
        }
        const payload = await telemetryResponse.json()
        const curvePayload = curveResponse?.ok ? await curveResponse.json() : null
        setTelemetry(payload)
        if (curvePayload) setCurve(curvePayload)
        setStatus('ready')
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Unexpected error')
        setStatus('error')
      }
    }

    fetchData()
    return () => controller.abort()
  }, [reloadToken])

  useEffect(() => {
    window.localStorage.setItem(MOTION_KEY, motion ? 'on' : 'off')
  }, [motion])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => {
      if (media.matches) setMotion(false)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    const onChange = () => setWide(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const onVisibilityChange = () => setTabVisible(!document.hidden)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  useEffect(() => {
    if (status !== 'ready' || !wide || navigator.connection?.saveData) return undefined
    const handle = window.requestIdleCallback
      ? window.requestIdleCallback(() => setBackdropReady(true), { timeout: 2500 })
      : window.setTimeout(() => setBackdropReady(true), 1200)
    return () => {
      if (window.cancelIdleCallback) window.cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    }
  }, [status, wide])

  useEffect(() => {
    if (!backdropReady || backdropLoaded || backdropFailed) return undefined
    const timer = window.setTimeout(() => setBackdropFailed(true), 9000)
    return () => window.clearTimeout(timer)
  }, [backdropReady, backdropLoaded, backdropFailed])

  const retry = () => {
    setStatus('loading')
    setError('')
    setReloadToken((token) => token + 1)
  }

  const threshold = telemetry
    ? telemetry.stats.ref_mean + sensitivity * telemetry.stats.ref_std
    : 0

  const metrics = useMemo(
    () => (telemetry ? computeMetrics(telemetry.data, threshold, telemetry.true_anomalies) : null),
    [telemetry, threshold],
  )

  const chartData = useMemo(
    () => (telemetry ? telemetry.data.filter((_, index) => index % CHART_EVERY === 0) : []),
    [telemetry],
  )

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3" style={{ backgroundColor: INK }}>
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-400">acquiring telemetry</p>
        <p className="max-w-sm px-6 text-center text-xs text-slate-600">
          The free-tier backend can take up to 60 seconds to wake after inactivity.
        </p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6" style={{ backgroundColor: INK }}>
        <div className="w-full max-w-md border p-6" style={{ borderColor: RULE }}>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-rose-400">link down</p>
          <h1 className="mt-2 text-lg text-slate-100">Backend unavailable</h1>
          <p className="mt-2 text-sm text-slate-400">{error}</p>
          <p className="mt-2 font-mono text-xs text-slate-400">{API_URL || 'same origin (/api)'}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-5 border px-3 py-1.5 font-mono text-xs uppercase tracking-wider text-cyan-300 transition-colors hover:bg-cyan-500/10"
            style={{ borderColor: '#164e63' }}
          >
            retry
          </button>
        </div>
      </div>
    )
  }

  const { stats, spacecraft } = telemetry
  const showIframe = wide && backdropReady && tabVisible && !backdropFailed

  return (
    <div className="relative min-h-screen overflow-hidden" style={{ backgroundColor: INK }}>
      <SpaceBackdrop
        showIframe={showIframe}
        motion={motion}
        loaded={backdropLoaded}
        onLoad={() => setBackdropLoaded(true)}
      />
      <AboutDialog dialogRef={aboutRef} />
      <div className="relative z-10 w-full px-3 py-6 sm:px-5 lg:px-6">
        <div className="w-full">
        <div className="w-full rounded-md border border-white/10 bg-slate-950/55 shadow-2xl shadow-black/60 backdrop-blur-md">
          <header className="flex flex-col gap-6 bg-gradient-to-b from-white/[0.05] to-slate-950/40 px-6 py-6 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
                nasa {spacecraft.toLowerCase()} / telemanom
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-100 sm:text-3xl">
                Spacecraft Anomaly Detection AI
              </h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
                An LSTM forecasts the next telemetry sample from the previous {telemetry.window_size} samples.
                The distance between forecast and reality drives the alarm.
              </p>
              <button
                type="button"
                onClick={() => aboutRef.current?.showModal()}
                className="mt-3 border-b border-cyan-800 pb-0.5 font-mono text-xs text-cyan-300 hover:text-cyan-200"
              >
                what am I looking at?
              </button>
            </div>
            <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1.5 font-mono text-[11px]">
              <dt className="text-slate-400">status</dt>
              <dd className="text-cyan-300">online</dd>
              <dt className="text-slate-400">sensor</dt>
              <dd className="text-slate-200">{telemetry.sensor_id}</dd>
              <dt className="text-slate-400">window</dt>
              <dd className="text-slate-200">{telemetry.window_size} samples</dd>
              <dt className="text-slate-400">model</dt>
              <dd className="text-slate-200">lstm 64 / 32</dd>
              <dt className="text-slate-400">points</dt>
              <dd className="text-slate-200">{telemetry.data.length.toLocaleString()}</dd>
              <dt className="text-slate-400">motion</dt>
              <dd>
                <button
                  type="button"
                  onClick={() => setMotion((value) => !value)}
                  aria-pressed={motion}
                  className="text-cyan-300 underline decoration-cyan-800 underline-offset-4 hover:text-cyan-200"
                >
                  {motion ? 'on' : 'off'}
                </button>
              </dd>
            </dl>
          </header>

          <div className="grid grid-cols-2 gap-px border-t sm:grid-cols-3 lg:grid-cols-5" style={{ borderColor: 'rgba(148,163,184,0.18)', backgroundColor: 'rgba(148,163,184,0.18)' }}>
            <Metric
              label="episodes detected"
              value={`${metrics.detectedWindows} / ${metrics.windows.length}`}
              sub={`${metrics.falseEpisodes} false alarms`}
            />
            <Metric
              label="precision"
              value={asPercent(metrics.precision)}
              sub={`${metrics.tp} true / ${metrics.fp} false points`}
            />
            <Metric
              label="recall"
              value={asPercent(metrics.recall)}
              sub={`${metrics.fn} missed points`}
            />
            <Metric
              label="point f1"
              value={asPercent(metrics.f1)}
              sub={`episode f1 ${asPercent(metrics.episodeF1)}`}
            />
            <Metric
              label="error ratio"
              value={`${stats.anomaly_ratio.toFixed(1)}x`}
              sub={`optimal ${stats.optimal_sensitivity} sigma`}
            />
          </div>

          <section className="border-t px-6 py-5" style={{ borderColor: 'rgba(148,163,184,0.14)', backgroundColor: 'rgba(2,6,12,0.35)' }}>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-400">
                  alarm sensitivity
                </h2>
                <p className="mt-1 max-w-xl text-sm text-slate-400">
                  threshold = reference mean + k x reference std. Reference statistics come from the first
                  40% of the test split, before the labelled anomaly.
                </p>
              </div>
              <div className="w-full lg:w-[400px]">
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="8"
                    step="0.1"
                    value={sensitivity}
                    onChange={(event) => setSensitivity(Number(event.target.value))}
                    className="h-1 w-full cursor-pointer accent-cyan-400"
                    aria-label="Threshold multiplier"
                  />
                  <span className="w-14 border px-2 py-1 text-center font-mono text-sm text-cyan-300" style={{ borderColor: RULE }}>
                    {sensitivity.toFixed(1)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-slate-400">
                  <span>
                    threshold {threshold.toFixed(4)} / flagged {metrics.flaggedPoints}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSensitivity(stats.optimal_sensitivity)}
                    className="text-cyan-300 underline decoration-cyan-800 underline-offset-4 hover:text-cyan-200"
                  >
                    use optimal {stats.optimal_sensitivity}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="border-t px-6 py-6" style={{ borderColor: 'rgba(148,163,184,0.14)', backgroundColor: 'rgba(2,6,12,0.35)' }}>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">
                  Sensor signal and forecast
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Shaded band is the anomaly window labelled by NASA. Dashed outline is the episode the
                  alarm detected.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                <LegendItem color="#22d3ee" label="actual" />
                <LegendItem color="#94a3b8" label="predicted" dashed />
                <LegendItem color="#fb7185" label="anomaly" />
              </div>
            </div>
            <div className="h-72 w-full rounded-sm bg-slate-950/25 p-1">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                  <CartesianGrid stroke={RULE} strokeDasharray="2 4" />
                  <XAxis
                    dataKey="step"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    stroke="#475569"
                    tick={{ fontSize: 11, fontFamily: 'ui-monospace' }}
                    tickFormatter={(value) => value.toLocaleString()}
                    minTickGap={48}
                  />
                  <YAxis
                    stroke="#475569"
                    tick={{ fontSize: 11, fontFamily: 'ui-monospace' }}
                    width={52}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  {metrics.windows.map((window) => (
                    <ReferenceArea
                      key={`true-${window.start}`}
                      x1={window.start}
                      x2={window.end}
                      fill="#f43f5e"
                      fillOpacity={0.07}
                      ifOverflow="extendDomain"
                    />
                  ))}
                  {metrics.episodes.map((episode) => (
                    <ReferenceArea
                      key={`episode-${episode.start}`}
                      x1={episode.start}
                      x2={episode.end}
                      fill="none"
                      stroke="#fb7185"
                      strokeDasharray="3 3"
                      ifOverflow="extendDomain"
                    />
                  ))}
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="actual"
                    stroke="#22d3ee"
                    strokeWidth={1.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="predicted"
                    name="predicted"
                    stroke="#94a3b8"
                    strokeWidth={1.2}
                    strokeDasharray="4 3"
                    dot={false}
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid border-t lg:grid-cols-3" style={{ borderColor: 'rgba(148,163,184,0.14)', backgroundColor: 'rgba(2,6,12,0.35)' }}>
            <section className="border-b px-6 py-6 lg:col-span-2 lg:border-b-0 lg:border-r" style={{ borderColor: RULE }}>
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">
                Prediction error and threshold
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                error = absolute difference between actual and predicted. Everything above the dashed line
                is flagged.
              </p>
              <div className="mt-4 h-56 w-full rounded-sm bg-slate-950/25 p-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -14 }}>
                    <defs>
                      <linearGradient id="errorFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={RULE} strokeDasharray="2 4" />
                    <XAxis
                      dataKey="step"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      stroke="#475569"
                      tick={{ fontSize: 11, fontFamily: 'ui-monospace' }}
                      tickFormatter={(value) => value.toLocaleString()}
                      minTickGap={48}
                    />
                    <YAxis
                      stroke="#475569"
                      tick={{ fontSize: 11, fontFamily: 'ui-monospace' }}
                      width={52}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    {metrics.windows.map((window) => (
                      <ReferenceArea
                        key={`error-window-${window.start}`}
                        x1={window.start}
                        x2={window.end}
                        fill="#f43f5e"
                        fillOpacity={0.05}
                        ifOverflow="extendDomain"
                      />
                    ))}
                    <Area
                      type="monotone"
                      dataKey="error"
                      name="error"
                      stroke="#f59e0b"
                      strokeWidth={1}
                      fill="url(#errorFill)"
                      isAnimationActive={false}
                    />
                    <ReferenceLine
                      y={threshold}
                      stroke="#fb7185"
                      strokeDasharray="4 4"
                      strokeWidth={1.2}
                      label={{
                        value: `${sensitivity.toFixed(1)} sigma`,
                        fill: '#fb7185',
                        fontSize: 10,
                        position: 'insideTopLeft',
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </section>

            <section className="px-6 py-6">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">
                Detection diagnostics
              </h2>
              <p className="mt-1 text-sm text-slate-400">F1 across every threshold multiplier.</p>
              <div className="mt-4 h-36 w-full rounded-sm bg-slate-950/20 p-1">
                {curve ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={curve.points} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                      <CartesianGrid stroke={RULE} strokeDasharray="2 4" />
                      <XAxis
                        dataKey="sensitivity"
                        stroke="#475569"
                        tick={{ fontSize: 10, fontFamily: 'ui-monospace' }}
                      />
                      <YAxis
                        stroke="#475569"
                        domain={[0, 1]}
                        tick={{ fontSize: 10, fontFamily: 'ui-monospace' }}
                        width={38}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="f1"
                        name="point f1"
                        stroke="#22d3ee"
                        strokeWidth={1.6}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="episode_f1"
                        name="episode f1"
                        stroke="#94a3b8"
                        strokeWidth={1.1}
                        dot={false}
                        isAnimationActive={false}
                      />
                      <ReferenceLine x={sensitivity} stroke="#fb7185" strokeDasharray="3 3" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center font-mono text-[11px] text-slate-600">
                    curve unavailable
                  </div>
                )}
              </div>
              <dl className="mt-5 space-y-2 border-t pt-4 font-mono text-[11px]" style={{ borderColor: RULE }}>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">ref mean / std</dt>
                  <dd className="text-slate-300">
                    {stats.ref_mean.toFixed(4)} / {stats.ref_std.toFixed(4)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">persistence</dt>
                  <dd className="text-slate-300">{MIN_DURATION} samples</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">match tolerance</dt>
                  <dd className="text-slate-300">+/- {TOLERANCE} samples</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">merge gap</dt>
                  <dd className="text-slate-300">{EPISODE_GAP} samples</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">inference</dt>
                  <dd className="text-slate-300">{telemetry.inference || 'precomputed'}</dd>
                </div>                <div className="flex justify-between gap-3">
                  <dt className="text-slate-400">artefact</dt>
                  <dd className="break-all text-right text-slate-300">{telemetry.model_file}</dd>
                </div>
              </dl>
            </section>
          </div>

          <footer className="border-t px-6 py-4 text-[11px] leading-relaxed text-slate-400" style={{ borderColor: 'rgba(148,163,184,0.14)', backgroundColor: 'rgba(2,6,12,0.35)' }}>
            <p>
              Telemetry from the NASA SMAP channel D-1, distributed with the Telemanom dataset (Hundman et
              al., KDD 2018). Anomaly windows labelled by NASA JPL engineers.
            </p>
            <p className="mt-1">
              Point metrics score every test sample. Episode metrics count an alarm as correct when it
              overlaps a labelled window within +/-{TOLERANCE} samples.
            </p>
            <p className="mt-1">
              Backdrop:{' '}
              <a
                href={SKETCHFAB_PAGE}
                target="_blank"
                rel="noreferrer noopener"
                className="text-cyan-300 underline decoration-cyan-900 underline-offset-4 hover:text-cyan-200"
              >
                Solar System by pinotoon on Sketchfab
              </a>{' '}
              (Editorial licence, embedded with do-not-track).
            </p>
          </footer>
        </div>
        </div>
      </div>
    </div>
  )
}
