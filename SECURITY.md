# Security

This document describes the security posture of the project, the controls that are implemented,
and the categories that are deliberately **not applicable** because of the application's design.

## Scope and threat model

The system is a **public, read-only demonstration**:

- It serves one static NASA telemetry series and one pre-trained model.
- There are no accounts, no sessions, no cookies, no uploads, no database and no write endpoints.
- Every computation happens in memory from artefacts committed to the repository.
- The only client input is a sensor identifier and bounded numeric query parameters.

The relevant threats are therefore: abuse of the public API (scraping, denial of service),
information leakage through error messages or documentation, cross-origin data theft, and
supply-chain vulnerabilities. User-account and database threats do not exist in this architecture.

## Implemented controls

| Control | Implementation | Verified |
| ------- | -------------- | -------- |
| CORS allow-list | `backend/config.py` + `CORSMiddleware`, exact origins plus a `*.vercel.app` regex; only `GET`/`OPTIONS` | allowed origin returns `Access-Control-Allow-Origin`; unknown origin returns nothing |
| Host header validation | `TrustedHostMiddleware` with configurable `ALLOWED_HOSTS` | `Host: evil.example` → `400` |
| Rate limiting | In-memory sliding window per client IP (`RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW_SECONDS`), proxy aware, returns `429` + `Retry-After`. On serverless, counters are per instance | 7 requests with limit 5 → `200 200 200 200 200 429 429` |
| Security headers | `SecurityHeadersMiddleware`: `nosniff`, `X-Frame-Options: DENY`, `no-referrer`, Permissions-Policy, COOP, CORP, HSTS | confirmed with `curl -D -` |
| Production CSP | API responses use `default-src 'none'`; the frontend ships a full CSP from `frontend/vercel.json` (`script-src 'self'`, `connect-src` limited to the API and localhost, `frame-src` limited to Sketchfab) | confirmed with `curl -D -` |
| Docs exposure | `/docs` and `/openapi.json` disabled when `ENVIRONMENT=production` | `404` |
| Error handling | Global exception handler logs server-side and returns a generic message; no stack traces or paths | code review |
| Input validation | `sensor_id` is whitelisted (`D-1` only); numeric query parameters use bounded `Query(ge=..., le=...)`; no object identifiers that could allow IDOR | code review |
| No write surface | All endpoints are `GET`; no request bodies, forms, uploads or cookies | code review |
| Frontend XSS | React escapes rendered values; no `dangerouslySetInnerHTML`; no user-generated content; CSP and headers in `frontend/vercel.json` | `frontend/vercel.json` |
| Secrets | No credentials in the repository or in git history (scanned); `.env*` ignored except `.env.example`; no secret is exposed to Vite | `git grep` over all revisions |
| Debug mode | `uvicorn` runs without `--reload` in the container; `--no-server-header` removes banner disclosure | `backend/Dockerfile` |
| Transport | HTTPS terminated by Vercel; HSTS sent by both projects; HTTP→HTTPS enforced by the platform | platform behaviour |
| Supply chain | `npm audit` reports 0 vulnerabilities; `pip-audit` reviewed (see below) | audit output |

## Third-party embed

The dashboard optionally renders a Sketchfab solar-system scene as a page backdrop:

- The iframe is loaded only on viewports of at least 768 px, after the first idle period, and never
  when the browser reports `Save-Data`. It is unmounted while the tab is hidden.
- The embed uses `dnt=1` (do not track), but Sketchfab may still set cookies and receive the
  visitor's IP address and user agent under its own privacy policy. The parent page shares no
  application data with the iframe.
- CSP is narrowed with a single exception: `frame-src https://sketchfab.com`. No script, style or
  connection exception is granted to Sketchfab because the iframe is a separate origin.
- The model is licensed **Editorial** and attributed in the footer. It must be replaced before any
  commercial use.
- A deterministic CSS/SVG starfield is rendered underneath, so the page still looks correct when
  the embed is blocked, offline, or disabled.

To remove the integration entirely, delete the `SpaceBackdrop` component and the `frame-src`
directive; no other code depends on it.

## Not applicable to this architecture

These items are common in web apps with accounts and databases, but adding them here would be
**security theatre** because the underlying attack surface does not exist:

| Item | Why it does not apply |
| ---- | --------------------- |
| Authentication / login | No user accounts or private resources |
| Admin routes | No admin panel or privileged endpoints exist |
| User permissions / UUID isolation | No per-user data is stored or served |
| Row Level Security | No database |
| SQL injection | No SQL, no ORM, no query construction |
| Password hashing | No passwords |
| CSRF | No cookies, no sessions, no state-changing requests |
| Secure cookies | No cookies are set |
| File uploads | No upload endpoints |
| Form sanitisation | There are no forms; the only input is a numeric slider and a sensor id |

If authentication, user preferences or a database are added later, the corresponding controls
must be implemented at that point (Argon2id password hashing, server-side sessions or short-lived
JWTs, CSRF tokens, parameterised queries, and row-level authorization checks on every resource).

## Dependency audit

```text
npm audit            → 0 vulnerabilities
git secret scan      → no matches in working tree or history
pip-audit            → no vulnerabilities in the runtime requirements
```

The runtime dependencies are `fastapi`, `numpy` and `uvicorn`. TensorFlow, scikit-learn and joblib
were removed from the deployed service because inference is precomputed; they remain in the training
environment only, which removes the large TensorFlow attack surface from the public deployment. CI
runs `pip-audit` and `npm audit` on every push.

## Secret handling rules

1. Never place a secret in a `VITE_*` variable: everything prefixed with `VITE_` is embedded in the
   public JavaScript bundle. `frontend/.env.production` therefore contains only the public API URL.
2. Keep real `.env` files local; only `.env.example` files are committed.
3. Hosting tokens (GitHub, Vercel) are used only in the provider dashboards or as `git push`
   passwords and are never written to disk by this project.
4. Rotate any token immediately if it is pasted into a chat, issue or commit.
5. GitHub push protection and secret scanning should stay enabled on the repository.

## Production environment variables

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `ENVIRONMENT` | `development` | Set to `production` on the Space (disables docs, enables CSP) |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Exact CORS origins, comma separated |
| `ALLOWED_ORIGIN_REGEX` | `https://[a-z0-9-]+\.vercel\.app` | Preview/production frontend hostnames |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1,testserver,*.vercel.app` | Host header allow-list (add a custom domain here) |
| `RATE_LIMIT_REQUESTS` | `120` | Requests allowed per window per IP |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | Rate-limit window length |
| `DOCS_ENABLED` | `true` in development, `false` in production | Interactive OpenAPI docs |
| `ENVIRONMENT` | `development` | Set by the Vercel deployment to `production` |

## Reporting

This is a portfolio project. If you find a security issue, open a private report through GitHub's
**Security → Report a vulnerability** feature on the repository.
