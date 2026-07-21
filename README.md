# Frontend: GitHub Pages (this repo root — index.html)
# Backend API: Render Free — https://ckr-wwdc.onrender.com

Token-based Cookie Run farm. Admin creates users and credits tokens; **1 token = 1 farm run**.

## URLs

- UI (GitHub Pages): https://j3xdr.github.io/CKR-WWDC/
- API (Render): https://ckr-wwdc.onrender.com/api/health

## Local API

```bash
pip install -r requirements.txt
# set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
uvicorn server.main:app --reload --port 8000
```

Open `index.html` locally or use Pages; set `API_BASE` in `js/config.js` if needed.
