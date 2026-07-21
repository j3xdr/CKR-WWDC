# CKR WWDC

Token-based Cookie Run farm web app. Admin creates users and credits tokens; **1 token = 1 farm run**.

## Stack

- **Frontend**: static HTML/CSS/JS (Intercom-inspired UI), served by FastAPI
- **Backend**: FastAPI on Render Free (static + API in one service)
- **Auth / data**: Supabase Auth + Postgres (JWT, RLS, `consume_token` RPC)

## Local run

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# fill SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
uvicorn server.main:app --reload --port 8000
```

Open `http://127.0.0.1:8000`.

## Deploy (Render Free)

1. Connect this GitHub repo in Render (or use `render.yaml`).
2. Runtime: Python. Build: `pip install -r requirements.txt`. Start: `uvicorn server.main:app --host 0.0.0.0 --port $PORT`.
3. Set env vars in the Render dashboard (never commit secrets):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server only — required for create-user)
4. Free tier sleeps after idle; first request may be slow. Farm runs are sequential on a single instance.

## Supabase

Apply `supabase/schema.sql` (token columns, `token_ledger`, `run_jobs`, RPCs).  
Roles remain `admin` / `normal`. No self-registration.

## API

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/health` | — | Liveness |
| GET | `/api/me` | JWT | Profile + token balance |
| POST | `/api/farm/run` | JWT | Consume 1 token, run farm |
| GET | `/api/admin/lookup?q=` | Admin JWT | Lookup by email/username |
| POST | `/api/admin/add-tokens` | Admin JWT | Credit tokens |
| POST | `/api/admin/create-user` | Admin JWT + service role | Create user |
| GET | `/api/admin/users` | Admin JWT | List profiles |

## Assets

Decorative PNGs under `static/assets/` are **original** illustrations inspired by a Cookie Run aesthetic (not ripped game files). Official Fan Kit / wiki assets can replace them later if licensing allows.

## Notes

- Farm core lives under `server/farm/` and is executed only on the server behind JWT auth.
- Do not put `SUPABASE_SERVICE_ROLE_KEY`, admin passwords, or Render API keys in this README or in client JS.
