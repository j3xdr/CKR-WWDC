# 06 — Deploy & ops

## Repos / services

| Piece | Where | How it updates |
|-------|-------|----------------|
| Frontend | GitHub Pages from `j3xdr/CKR-WWDC` **root** | `git push origin master` → Pages rebuild |
| API | Render service `ckr-wwdc` (`render.yaml`) | auto-deploy on push **or** manual `trigger_deploy` |
| DB | Supabase project | apply SQL manually from `supabase/schema.sql` |
| Admin UI | `Login_j3xdr` Pages | แยกจาก CKR-WWDC |

Git remote:

```
origin  https://github.com/j3xdr/CKR-WWDC.git
branch  master (tracks origin/master)
```

Render (`render.yaml`):

- type: web, runtime: python, plan: **free**, region: singapore
- build: `pip install -r requirements.txt`
- start: `uvicorn server.main:app --host 0.0.0.0 --port $PORT`
- env: `PYTHON_VERSION=3.11.9`, plus Supabase secrets (sync:false)

---

## Critical: Pages serves ROOT files

| Correct (Pages) | Stale / ignore for UI edits |
|-----------------|-----------------------------|
| `index.html` | `static/index.html` |
| `js/app.js` | `static/js/app.js` |
| `css/styles.css` | `static/css/styles.css` |
| `assets/` | `static/assets/` |

ถ้าแก้แค่ `static/` → **เว็บจริงไม่เปลี่ยน**

---

## Frontend cache busting (สำคัญ)

เบราว์เซอร์มักแคช `js/*.js` / `css/*.css` นาน — หลัง push บางคนยังเห็น UI เก่า  
**ไม่จำเป็นต้องล้างคุกกี้** (ล้างคุกกี้แค่ทำให้ต้องล็อกอินใหม่)

แก้โดยใส่ `?v=<git-short-hash>` ที่ลิงก์ใน `index.html` เช่น:

```html
<link rel="stylesheet" href="css/styles.css?v=0e7e661" />
<script src="js/app.js?v=0e7e661"></script>
```

**ทุกครั้งที่แก้ frontend แล้วจะ push:** อัปเดตค่า `v=` ใน `index.html` ให้ตรง `git rev-parse --short HEAD` (หรือเลขเวอร์ชันใหม่)  
เมื่อ `index.html` เปลี่ยน → ผู้ใช้โหลด HTML ใหม่ → ดึง JS/CSS ตาม `?v=` ใหม่

---

## When to push vs redeploy

| Change type | Action |
|-------------|--------|
| `index.html`, `js/*`, `css/*`, `assets/*` | **git push** → Pages (API ไม่ต้อง redeploy) |
| `server/*`, `requirements.txt`, `Procfile`, `render.yaml` | **git push** + รอ Render deploy (หรือ trigger manual) |
| `supabase/schema.sql` | apply SQL บน Supabase **แล้ว**อาจต้อง redeploy API |
| `.env` local | ไม่ push; ตั้งบน Render dashboard |

Render Free cold start: หลัง idle ครั้งแรกช้า — UI รองรับข้อความปลุกเซิร์ฟใน queue modal แล้ว

---

## Local API smoke

```bash
cd "CKR WWDC"
# set SUPABASE_* in .env or env
uvicorn server.main:app --reload --port 8000
```

Open UI via Live Server on 5500 **or** open Pages against local by temporarily pointing `API_BASE` (อย่า commit API_BASE เป็น localhost)

Health: `GET /api/health` → `{ok, farm_busy, supabase_configured, service_role_configured}`

---

## CORS

อนุญาต `https://j3xdr.github.io` เท่านั้นสำหรับ production UI  
ถ้า preview จาก origin อื่น ต้องเพิ่มใน `ALLOWED_ORIGINS` ใน `server/main.py` แล้ว redeploy

---

## Known ops quirks

1. Free instance = **หนึ่งฟาร์มต่อครั้ง** — คิวจำเป็น
2. ถ้า deploy API ล้มเหลว แต่ Pages อัปเดตแล้ว → UI เรียก endpoint ใหม่ไม่ได้
3. `service_role` หาย/placeholder → login ยังพยายาม fallback synthetic email ได้ แต่ queue/lock/jobs/admin create พัง (`503 service_role_not_configured`)
4. Health อาจ timeout ตอน cold — ไม่ได้แปลว่า service ตายถาวร; ลองใหม่

---

## Git status snapshot (ณ ตอนเขียน docs)

ดูรายละเอียด: `10-git-status-uncommitted.md`

สั้นๆ: `origin/master` = `7adfb1b` (result popup + queue + XP calc)  
Local มี diff run-status popup ที่ **ยังไม่ push**
