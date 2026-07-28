# Frontend (GitHub Pages) — public only

Static UI for CKR WWDC. **This repo is public** — no server code, no `project_py/`.

| URL | Repo |
|-----|------|
| https://j3xdr.github.io/CKR-WWDC/ | this repo (`j3xdr/CKR-WWDC`) |
| API | private `j3xdr/CKR-WWDC-server` on Render |

## Edit & deploy

Change `index.html`, `css/`, `js/`, `assets/`, `assets_web/` → push `master` → Pages rebuilds.

After JS/CSS changes, bump `?v=` in `index.html` for cache bust.

## Local preview

Serve this folder (Live Server / `python -m http.server`). `js/config.js` uses local API on `localhost`.

Backend/API lives in the **private** repo — clone `CKR-WWDC-server` alongside for full-stack dev.
