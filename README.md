# CKR WWDC

Public farm UI (GitHub Pages) + API (Render).

- UI: https://j3xdr.github.io/CKR-WWDC/
- API: https://ckr-wwdc.onrender.com/
- Admin (create users / tokens): https://j3xdr.github.io/Login_j3xdr/

Login uses **username + password**. Accounts are created by admin only.

## Local API

```bash
pip install -r requirements.txt
# set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
uvicorn server.main:app --reload --port 8000
```

Open `index.html` locally or use Pages; `API_BASE` is set in `js/config.js`.
