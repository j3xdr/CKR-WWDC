# Frontend (GitHub Pages) — public only

Static UI for CKR WWDC. **This repo is public** — no server code, no `project_py/`.

| URL | Repo |
|-----|------|
| https://crgwwdc.shop | this repo (Cloudflare Pages) |
| API | https://api.crgwwdc.shop (VPS) |

## Edit & deploy

Change `index.html`, `css/`, `js/`, `assets/`, `assets_web/` → push `master` → Pages rebuilds.

After JS/CSS changes, bump `?v=` in `index.html` for cache bust.

## Local preview

Serve this folder (`python -m http.server 5500`). On localhost, `js/config.js` uses API at `http://127.0.0.1:8787`.

Full stack: run `CKR-WWDC-server/scripts/dev-preview.ps1` or VS Code task **CKR: Dev Preview**.
