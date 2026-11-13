import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Cpu,
  Gauge,
  Radio,
  RefreshCw,
  Satellite,
  ShieldCheck,
  Sliders,
  Sparkles,
} from 'lucide-react'
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

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/+$/, '')
const SENSOR_ID = 'D-1'
const CHART_EVERY = 3
const TOLERANCE = 25
const MIN_DURATION = 3
const EPISODE_GAP = 50

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

function Card({ className = '', children }) {
  return (
    <section className={`rounded-2xl border border-slate-800/80 bg-slate-900/60 p-5 shadow-lg shadow-black/20 backdrop-blur ${className}`}>
      {children}
    </section>
  )
}

function Kpi({ icon: Icon, label, value, sub, tone }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
        <Icon className={`h-4 w-4 ${tone}`} />
        {label}
      </div>
      <div className="mt-3 text-3xl font-semibold text-white">{value}</div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </Card>
  )
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs shadow-xl">
      <p className="mb-1 font-mono text-slate-300">step {label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="font-mono" style={{ color: entry.color }}>
          {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(4) : entry.value}
        </p>
      ))}
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 text-slate-300">
      <Satellite className="h-10 w-10 animate-pulse-slow text-cyan-400" />
      <p className="text-sm">Loading NASA SMAP telemetry…</p>
      <p className="max-w-sm text-center text-xs text-slate-500">
        The free-tier backend may take up to 30 seconds to wake up after inactivity.
      </p>
    </div>
  )
}

export default function App() {
  const [telemetry, setTelemetry] = useState(null)
  const [curve, setCurve] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [sensitivity, setSensitivity] = useState(3)
  const [reloadToken, setReloadToken] = useState(0)

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

  if (status === 'loading') return <LoadingScreen />

  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
        <Card className="max-w-lg">
          <div className="flex items-center gap-3 text-rose-400">
            <AlertTriangle className="h-6 w-6" />
            <h1 className="text-lg font-semibold">Backend unavailable</h1>
          </div>
          <p className="mt-3 text-sm text-slate-400">{error}</p>
          <p className="mt-2 text-xs text-slate-500">
            Make sure the API is running at <span className="font-mono text-cyan-400">{API_URL}</span>.
          </p>
          <button
            type="button"
            onClick={retry}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </Card>
      </div>
    )
  }

  const { stats, spacecraft } = telemetry

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-4 border-b border-slate-800/80 pb-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">
              <Radio className="h-4 w-4 animate-pulse-slow" />
              NASA {spacecraft} telemetry · telemanom
            </div>
            <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">Spacecraft Anomaly Detection AI</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              An LSTM forecasts the next telemetry sample from the previous {telemetry.window_size} samples.
              Deviations between reality and forecast drive the anomaly alarm.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 font-medium text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              API online
            </span>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-slate-300">
              sensor {telemetry.sensor_id}
            </span>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-slate-300">
              LSTM · {telemetry.window_size}-step window
            </span>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi
            icon={AlertTriangle}
            label="Anomaly episodes"
            value={`${metrics.detectedWindows}/${metrics.windows.length}`}
            sub={`${metrics.falseEpisodes} false alarms · persistence ≥ ${MIN_DURATION} samples`}
            tone="text-rose-400"
          />
          <Kpi
            icon={ShieldCheck}
            label="Precision"
            value={asPercent(metrics.precision)}
            sub={`${metrics.tp} true / ${metrics.fp} false points`}
            tone="text-emerald-400"
          />
          <Kpi
            icon={Activity}
            label="Recall"
            value={asPercent(metrics.recall)}
            sub={`${metrics.fn} missed anomaly points`}
            tone="text-cyan-400"
          />
          <Kpi
            icon={Gauge}
            label="Point F1"
            value={asPercent(metrics.f1)}
            sub={`Episode F1 ${asPercent(metrics.episodeF1)}`}
            tone="text-indigo-400"
          />
          <Kpi
            icon={Cpu}
            label="Error ratio"
            value={`${stats.anomaly_ratio.toFixed(1)}×`}
            sub={`optimal ${stats.optimal_sensitivity}σ → F1 ${(stats.optimal_f1 * 100).toFixed(1)}%`}
            tone="text-amber-400"
          />
        </div>

        <Card>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <Sliders className="mt-0.5 h-6 w-6 shrink-0 text-cyan-400" />
              <div>
                <h2 className="text-lg font-semibold text-white">Alarm sensitivity</h2>
                <p className="text-sm text-slate-400">
                  Threshold = reference mean + k × reference std. Reference statistics come from the first 40% of
                  the test split (known normal behaviour).
                </p>
              </div>
            </div>
            <div className="flex w-full flex-col gap-3 lg:w-[420px]">
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="1"
                  max="8"
                  step="0.1"
                  value={sensitivity}
                  onChange={(event) => setSensitivity(Number(event.target.value))}
                  className="h-2 w-full cursor-pointer accent-cyan-400"
                  aria-label="Threshold multiplier"
                />
                <span className="w-16 rounded-md bg-slate-800 px-2 py-1 text-center font-mono text-sm font-semibold text-cyan-300">
                  {sensitivity.toFixed(1)}σ
                </span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                <span className="font-mono">
                  threshold <span className="text-slate-200">{threshold.toFixed(4)}</span> · flagged{' '}
                  <span className="text-slate-200">{metrics.flaggedPoints}</span> points
                </span>
                <button
                  type="button"
                  onClick={() => setSensitivity(stats.optimal_sensitivity)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 font-medium text-cyan-300 transition hover:bg-cyan-500/20"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Jump to optimal ({stats.optimal_sensitivity}σ)
                </button>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-white">Sensor signal vs LSTM forecast</h2>
              <p className="text-sm text-slate-400">
                Shaded band = NASA-labelled anomaly · dashed outline = detected episode
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-sky-400" /> actual
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" /> predicted
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-rose-500" /> anomaly window
              </span>
            </div>
          </div>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 6, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis
                  dataKey="step"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  stroke="#64748b"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(value) => value.toLocaleString()}
                  minTickGap={40}
                />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} width={56} />
                <Tooltip content={<ChartTooltip />} />
                {metrics.windows.map((window) => (
                  <ReferenceArea
                    key={`true-${window.start}`}
                    x1={window.start}
                    x2={window.end}
                    fill="#f43f5e"
                    fillOpacity={0.08}
                    ifOverflow="extendDomain"
                  />
                ))}
                {metrics.episodes.map((episode) => (
                  <ReferenceArea
                    key={`episode-${episode.start}`}
                    x1={episode.start}
                    x2={episode.end}
                    fill="#f43f5e"
                    fillOpacity={0.05}
                    stroke="#fb7185"
                    strokeDasharray="4 4"
                    ifOverflow="extendDomain"
                  />
                ))}
                <Line
                  type="monotone"
                  dataKey="actual"
                  name="actual"
                  stroke="#38bdf8"
                  strokeWidth={1.6}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  name="predicted"
                  stroke="#34d399"
                  strokeWidth={1.4}
                  strokeDasharray="4 2"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white">Prediction error and alarm threshold</h2>
              <p className="text-sm text-slate-400">
                Error = |actual − predicted|. Points above the dashed line are flagged.
              </p>
            </div>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 6, right: 12, bottom: 0, left: -12 }}>
                  <defs>
                    <linearGradient id="errorFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="step"
                    type="number"
                    domain={['dataMin', 'dataMax']}
                    stroke="#64748b"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(value) => value.toLocaleString()}
                    minTickGap={40}
                  />
                  <YAxis stroke="#64748b" tick={{ fontSize: 11 }} width={56} />
                  <Tooltip content={<ChartTooltip />} />
                  {metrics.windows.map((window) => (
                    <ReferenceArea
                      key={`error-window-${window.start}`}
                      x1={window.start}
                      x2={window.end}
                      fill="#f43f5e"
                      fillOpacity={0.06}
                      ifOverflow="extendDomain"
                    />
                  ))}
                  <Area
                    type="monotone"
                    dataKey="error"
                    name="error"
                    stroke="#f59e0b"
                    strokeWidth={1.2}
                    fill="url(#errorFill)"
                    isAnimationActive={false}
                  />
                  <ReferenceLine
                    y={threshold}
                    stroke="#fb7185"
                    strokeDasharray="5 4"
                    strokeWidth={1.5}
                    label={{ value: `${sensitivity.toFixed(1)}σ`, fill: '#fb7185', fontSize: 11, position: 'insideTopRight' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-white">Detection diagnostics</h2>
              <p className="text-sm text-slate-400">How the alarm behaves across sensitivities.</p>
            </div>
            <div className="h-40 w-full">
              {curve ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={curve.points} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                    <XAxis dataKey="sensitivity" stroke="#64748b" tick={{ fontSize: 10 }} />
                    <YAxis stroke="#64748b" domain={[0, 1]} tick={{ fontSize: 10 }} width={40} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="f1"
                      name="point F1"
                      stroke="#22d3ee"
                      strokeWidth={1.8}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="episode_f1"
                      name="episode F1"
                      stroke="#a78bfa"
                      strokeWidth={1.4}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <ReferenceLine x={sensitivity} stroke="#fb7185" strokeDasharray="4 4" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-slate-500">
                  Threshold curve unavailable
                </div>
              )}
            </div>
            <dl className="mt-4 space-y-2 border-t border-slate-800 pt-4 text-xs">
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Reference mean / std</dt>
                <dd className="font-mono text-slate-300">
                  {stats.ref_mean.toFixed(4)} / {stats.ref_std.toFixed(4)}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Episode tolerance</dt>
                <dd className="font-mono text-slate-300">±{TOLERANCE} samples</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Episode merge gap</dt>
                <dd className="font-mono text-slate-300">{EPISODE_GAP} samples</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500">Model artefact</dt>
                <dd className="font-mono text-slate-300">{telemetry.model_file}</dd>
              </div>
            </dl>
          </Card>
        </div>

        <footer className="border-t border-slate-800/80 pb-6 pt-5 text-xs text-slate-500">
          <p>
            Telemetry: NASA SMAP via the{' '}
            <a
              className="text-cyan-400 hover:text-cyan-300"
              href="https://github.com/khundman/telemanom"
              target="_blank"
              rel="noreferrer"
            >
              Telemanom
            </a>{' '}
            dataset (Hundman et al., KDD 2018). Anomaly windows labelled by NASA JPL engineers.
          </p>
          <p className="mt-1">
            Point metrics evaluate every test sample; episode metrics count an alarm as correct when it overlaps a
            labelled window within ±{TOLERANCE} samples.
          </p>
        </footer>
      </div>
    </div>
  )
}
