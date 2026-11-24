# ExHyGLL — Explainable Vulnerability Intelligence

A responsive C/C++ security-review workspace inspired by the supplied ExHyGLL thesis and visual reference. The project is split into two independently deployable services:

- `frontend/` — Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, CodeMirror and Lucide icons. Deploy to Vercel.
- `backend/` — FastAPI service with a transparent, checkpoint-free static review engine. Deploy to Render.

> **Important research-integrity note**  
> This package does **not** contain or run the trained ExHyGLL model. The thesis model requires trained CodeBERT/fusion/GATv2/ExplBridge weights plus the exact Joern CDG and VASF preprocessing implementation. Those artifacts were not present in the uploaded thesis PDF. The application therefore separates (1) a working lexical static-rule review engine from (2) the documented research architecture. It never fabricates an ExHyGLL probability, token attribution or model result.

## What works without a checkpoint

- Paste C or C++ source code into the editor.
- Upload `.c`, `.cpp`, `.cc`, `.cxx`, `.h`, `.hh`, `.hpp` and `.hxx` text files (120 KB client-side limit).
- Detect ordinary function definitions and request a function choice when multiple functions are present.
- Run 16 transparent pattern/context checks for common C/C++ risk patterns.
- Inspect rule evidence, source lines and a per-function lexical context map.
- See a rule-weighted risk index, severity counts and finding-specific review guidance.
- Use the local Review Assistant to explain actual findings and remediation steps. It is deterministic and does not call an external LLM.
- Explicitly save results in browser-local history. Source code is excluded unless the user opts in.
- Inspect the ExHyGLL research architecture, thesis-reported metrics and the missing artifacts needed for trained inference.

## What is deliberately not claimed

- The static review engine is not CodeBERT, GATv2, a Joern CDG or VASF implementation.
- The context map is not a verified control-dependency graph or data-flow graph.
- Highlighted source lines are rule-matched evidence, not ExplBridge token attributions.
- The 0–100 risk index is a transparent rule-weighted indicator. It is not a probability that code is vulnerable, a CVSS score or a calibrated model output.
- “No rule triggered” does not mean “safe”.
- No source code is compiled or executed by the backend.
- This is not a replacement for compiler diagnostics, a full static-analysis suite, fuzzing, testing or expert review.

## Repository structure

```text
exhy-gll-platform/
├── backend/
│   ├── app/
│   │   ├── analyzer.py       # lexical function scanner + transparent rules
│   │   └── main.py           # FastAPI endpoints, validation, CORS and throttling
│   ├── tests/
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env.example
├── frontend/
│   ├── app/                  # Next.js App Router and responsive design system
│   ├── components/           # editor, evidence view, graph and app shell
│   ├── lib/                  # API client, types and local review assistant
│   ├── package.json
│   └── .env.example
├── docs/
│   ├── ARCHITECTURE.md
│   ├── THESIS_TRACEABILITY.md
│   └── DEPLOYMENT_CHECKLIST.md
├── render.yaml
└── README.md
```

## Run locally

### 1. Backend

Python 3.11 is recommended.

```bash
cd backend
python -m venv .venv

# Windows PowerShell
.venv\Scripts\Activate.ps1

# macOS / Linux
# source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Check:

- `http://127.0.0.1:8000/health`
- `http://127.0.0.1:8000/docs`
- `http://127.0.0.1:8000/api/v1/model-info`

### 2. Frontend

```bash
cd frontend
npm install
```

Copy `.env.example` to `.env.local` and set:

```env
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000
```

Then run:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Deploy backend to Render

1. Push the complete repository to GitHub.
2. In Render, choose **New → Web Service** and connect the repository.
3. Set **Root Directory** to `backend`.
4. Runtime: Python.
5. Build command: `pip install -r requirements.txt`.
6. Start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'`.
7. Health-check path: `/health`.
8. Add environment variables:

   | Key | Value |
   |---|---|
   | `FRONTEND_ORIGINS` | Your exact deployed Vercel origin, e.g. `https://your-project.vercel.app` |
   | `RATE_LIMIT_PER_MINUTE` | `30` |
   | `ALLOW_VERCEL_PREVIEWS` | `false` (set `true` to also allow `*.vercel.app` preview URLs) |
   | `PYTHON_VERSION` | `3.11.9` |

9. Deploy and copy the Render service URL, e.g. `https://your-service.onrender.com`.

A root-level `render.yaml` is included for Blueprint deployments. If you use the dashboard flow, the settings above are sufficient.

## Deploy frontend to Vercel

1. In Vercel, import the same GitHub repository.
2. Set **Root Directory** to `frontend`.
3. Framework preset: Next.js.
4. Add the environment variable:

   ```env
   NEXT_PUBLIC_API_BASE_URL=https://your-service.onrender.com
   ```

5. Deploy.
6. Copy the Vercel production URL and add it to Render's `FRONTEND_ORIGINS` value. If you use a custom domain, include that exact origin too.
7. Redeploy the Render service after changing CORS settings.
8. Open the Vercel app → Settings and use **Test connection**. The top status should show **API connected**.

Do not put trailing slashes in the API base URL. Do not use `*` for production CORS origins (trailing slashes in `FRONTEND_ORIGINS` are tolerated and stripped automatically).

> **Important:** `NEXT_PUBLIC_API_BASE_URL` is baked into the frontend at *build* time. If you change it in Vercel, you must **Redeploy** for it to take effect.
>
> **Render free tier:** the service sleeps after ~15 minutes of inactivity; the first request can take 30–60 seconds. The UI shows "Connecting (server may be waking up)" and retries automatically.

## API

### `GET /health`
Returns service status, version and whether the static engine is available. It explicitly reports trained ExHyGLL inference as unavailable.

### `GET /api/v1/model-info`
Returns the thesis architecture, reported research results, model availability and the missing artifacts required for actual inference.

### `POST /api/v1/functions`
Accepts `{ "code": "...", "language": "c" | "cpp" }` and returns detected function boundaries. This is a lightweight lexical scanner, not a standards-complete C/C++ parser.

### `POST /api/v1/analyze`
Accepts:

```json
{
  "code": "void copy(char *dst, const char *src) { strcpy(dst, src); }",
  "language": "c",
  "file_name": "sample.c",
  "function_id": null
}
```

If more than one function is found, the API returns `status: selection_required` and a function list. Submit the selected `function_id` for analysis. The response contains findings, evidence lines, a rule-weighted risk index, lexical context relationships and explicit limitations.

## Rule catalogue

The current engine checks for:

- `gets()` unbounded input
- `strcpy()` and `strcat()` unbounded string operations
- `sprintf()` / `vsprintf()` unbounded formatting
- `%s` input conversions without a visible field width
- a variable used as a `printf()` format string
- `system()` / `popen()` process execution sinks
- direct assignment from `realloc()`
- heap allocations without a nearby visible null check
- `strncpy()` termination review
- `memcpy()` / `memmove()` bounds review
- allocation expressions containing multiplication
- possible use-after-free patterns
- repeated `free()` calls for the same pointer name
- credential-like string literals
- dynamic array indexing without an obvious nearby textual guard

Some rules are contextual warnings rather than proof of a defect. For example, `memcpy()` can be used safely when object bounds and byte counts are correct. Findings should be reviewed against the complete program context.

## Privacy and security

- The API does not persist submitted source code or request bodies.
- The backend does not execute submitted C/C++ code.
- Request code is limited to 120,000 characters; the browser file-upload limit is 120 KB.
- CORS is restricted to the configured origins.
- A simple per-process rate limit is enabled for POST API requests. It is not a distributed rate limiter; use a gateway/WAF or shared limiter for a scaled deployment.
- API responses use `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- Saved history is opt-in and stored in the current browser's local storage. Source code is excluded by default.
- The browser-side API URL override is not a secret. Do not place API keys in `NEXT_PUBLIC_*` variables.

## Enabling the actual research model later

Read `docs/THESIS_TRACEABILITY.md` and `docs/ARCHITECTURE.md`. To activate real ExHyGLL inference, obtain the exact trained checkpoint and the original inference/preprocessing artifacts used in the thesis. Then implement and validate the model loader, tokenizer, Joern CDG extraction, exact 32-dimensional VASF generation, GATv2, ExplBridge and gated residual fusion against the thesis equations and archived experiment outputs. Add the checkpoint through a private model artifact store or protected backend volume; never commit private weights or credentials to GitHub. Do not substitute another model and label it ExHyGLL.

## Tests

Backend tests:

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest
```

The tests cover ordinary function extraction, a rule match, context-graph generation and the distinction between “no rule triggered” and “safe”. After deploying Render, run `python scripts/smoke_test.py https://your-service.onrender.com` from the repository root to verify the live API. Then complete the responsive and browser checks in `docs/DEPLOYMENT_CHECKLIST.md` against the Vercel URL.

The frontend production build was not executed in the authoring environment because npm package registry access was unavailable. Run `npm install` and `npm run build` locally or in Vercel before treating the frontend build as verified.

## Design direction

The interface uses the supplied reference's midnight-cherry / powder-white / amber-yellow palette and a restrained editorial grid. The layout adapts for desktop, tablet and mobile without shrinking the desktop workspace into a narrow column.
