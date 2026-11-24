# Deployment and QA checklist

## Before deployment

- [ ] Push the repository to GitHub.
- [ ] Confirm no `.env`, credentials, source samples or private model weights are committed.
- [ ] Run backend tests: `cd backend && python -m pytest`.
- [ ] Run frontend dependency install and build: `cd frontend && npm install && npm run build`.
- [ ] Confirm the frontend uses the production Render URL, not localhost.

## Render

- [ ] Root directory: `backend`.
- [ ] Build: `pip install -r requirements.txt`.
- [ ] Start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
- [ ] Health check: `/health`.
- [ ] Set `FRONTEND_ORIGINS` to the exact Vercel origin(s).
- [ ] Set `RATE_LIMIT_PER_MINUTE=30` or a stricter value appropriate to the deployment.
- [ ] Confirm `/health` returns `status: ok` and `trained_exhy_gll_model: unavailable`.
- [ ] Confirm `/api/v1/model-info` returns `research_model.available: false`.

## Vercel

- [ ] Root directory: `frontend`.
- [ ] Set `NEXT_PUBLIC_API_BASE_URL` to the deployed Render service URL.
- [ ] Build and deploy.
- [ ] Confirm API connection status in the UI.

## Functional smoke tests

- [ ] Paste a simple function and run analysis.
- [ ] Paste a function containing `strcpy()` and verify the rule evidence line is shown.
- [ ] Paste two ordinary functions and confirm the UI asks for a function selection.
- [ ] Upload a supported `.c` or `.cpp` file.
- [ ] Upload an unsupported file and confirm a clear validation error.
- [ ] Submit empty code and confirm the action is blocked.
- [ ] Submit source larger than the limit and confirm a clear message.
- [ ] Confirm a no-findings result says “No rule triggered”, not “safe”.
- [ ] Save a result without source and confirm the source is absent when reopened.
- [ ] Opt in to source retention and confirm the source is available only in browser-local history.
- [ ] Confirm no sample/fake history is preloaded.
- [ ] Confirm the trained model is visibly unavailable and no ExHyGLL probability is displayed.

## Responsive visual checks

Manually inspect the deployed app at 320, 375, 390, 768, 1024 and 1440 CSS-pixel widths:

- [ ] No page-level horizontal overflow.
- [ ] The editor scrolls internally for long lines.
- [ ] Navigation is usable from the mobile menu.
- [ ] Function selection, error messages and result controls fit the viewport.
- [ ] Relationship graph scrolls inside its own region if needed.
- [ ] Finding details and assistant stack vertically on mobile.
- [ ] Buttons and text remain readable at 320 px.

## Important production caveat

The API rate limiter is in-memory per process. For a multi-instance production service, use a shared gateway, WAF or distributed rate limiter. The lexical scanner is best-effort and should be paired with compiler/static-analysis tooling for high-assurance use.
