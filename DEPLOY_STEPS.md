# Deploy in 10 minutes (GitHub → Render → Vercel)

## 1. GitHub
Create an empty repo, then in this folder:
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo>.git
git push -u origin main
```
(or drag-and-drop all files into the GitHub web uploader — `package-lock.json` must be included.)

## 2. Render (backend) — do this first
1. Render → **New → Web Service** → pick your repo.
2. **Root Directory:** `backend` · **Runtime:** Python 3
3. **Build:** `pip install -r requirements.txt`
4. **Start:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips='*'`
5. **Health check path:** `/health`
6. Environment variables:
   - `PYTHON_VERSION` = `3.11.9`
   - `FRONTEND_ORIGINS` = `http://localhost:3000` (temporary; you will change it in step 4)
   - `RATE_LIMIT_PER_MINUTE` = `30`
7. Deploy. Open `https://<your-service>.onrender.com/health` → must show `"status":"ok"`.

## 3. Vercel (frontend)
1. Vercel → **Add New → Project** → import the same repo.
2. **Root Directory:** `frontend` (framework: Next.js is auto-detected).
3. Environment variable: `NEXT_PUBLIC_API_BASE_URL` = `https://<your-service>.onrender.com` (no trailing slash).
4. Deploy and copy your Vercel URL, e.g. `https://exhygll.vercel.app`.

## 4. Connect them (CORS)
Render → your service → Environment → set `FRONTEND_ORIGINS` = your exact Vercel URL → Save (it redeploys).
Open the Vercel site: the top-right pill should say **API connected**.

## Troubleshooting
| Symptom | Fix |
|---|---|
| "API offline" / "Cannot reach the analysis API" | Check `NEXT_PUBLIC_API_BASE_URL`, then **Redeploy** on Vercel (value is baked at build time). Check `FRONTEND_ORIGINS` on Render matches the Vercel URL. |
| First request is slow | Render free tier is waking up (30–60 s). Wait; the app retries automatically. |
| Vercel preview URLs blocked | Set `ALLOW_VERCEL_PREVIEWS=true` on Render. |
