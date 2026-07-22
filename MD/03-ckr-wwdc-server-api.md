# 03 — CKR WWDC server API

**Entry:** `CKR WWDC/server/main.py` (`uvicorn server.main:app`)  
**Farm engine:** `CKR WWDC/server/farm/partyrun_core.py` → `run_farm(...)`  
**Queue helpers:** `CKR WWDC/server/farm_queue.py`

---

## Runtime constraints (Render Free)

| Constraint | Implication |
|------------|-------------|
| Free plan, **1 instance** | ไม่มี horizontal scale |
| Cold start | request แรกช้ามาก; UI มีข้อความ “กำลังปลุกเซิร์ฟเวอร์…” |
| In-process `_farm_lock` + `_farm_busy` | **ฟาร์มพร้อมกันไม่ได้** บน process เดียวกัน |
| Supabase `farm_lock` row id=1 | lock ข้าม restart / สำหรับ UI gate |
| FIFO `farm_queue` + **TURN_SECONDS = 120** | คนถึงคิวมี 2 นาทีต้องกดเริ่ม ไม่งั้น expire |

**อย่าสมมติว่ามี worker queue แยก** — farm รันใน request ด้วย `asyncio.to_thread(_run_farm_sync, ...)`.

---

## Auth model

1. Client `POST /api/auth/login` ด้วย `{username, password}`
   - หรือ `POST /api/auth/register` ด้วย `{username, password, confirm_password}` → สร้างบัญชี + ออก JWT ทันที
2. Server resolve auth email:
   - Prefer RPC `resolve_username_email` (service_role)
   - Fallback: username-as-email (admin) + synthetic `{sanitized}@users.ckr.local`
3. Supabase `grant_type=password` → access/refresh tokens
4. Login/register ตั้ง `profiles.session_token` (uuid) ใหม่ → คืนคู่ JWT เป็น `session_token`
5. Subsequent API calls: `Authorization: Bearer <access_token>` + `X-Session-Token: <session_token>`
6. `verify_user` → `GET {SUPABASE}/auth/v1/user` แล้วเทียบ `X-Session-Token` กับ `profiles.session_token`
   - mismatch → **401** `session_replaced` (login เครื่องอื่นตัดของเก่า)
7. Profile from `profiles` (role, username, token_balance)

**Self-register:** public; role บังคับ `normal`; `token_balance` เริ่ม **0**; rate limit in-memory ~5/ชม./IP  
Admin endpoints require `profiles.role == "admin"`.

---

## Endpoints

### Public / user

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/` | no | JSON pointers to UI/admin |
| GET | `/api/health` | no | `farm_busy`, flags, maintenance, soft_caps |
| POST | `/api/auth/login` | no | username login → JWT + `session_token` (blocked if banned) |
| POST | `/api/auth/register` | no | self-signup → JWT (0 tokens) + `session_token` |
| GET | `/api/me` | JWT+session | profile + tokens |
| GET | `/api/topup/packages` | no | package price table (1–10 tokens) |
| GET | `/api/topup/history` | JWT+session | last 20 own redemptions |
| POST | `/api/topup/verify` | JWT+session | check voucher amount **without** redeem |
| POST | `/api/topup/redeem` | JWT+session | redeem angpao; rate-limit; maintenance gate |
| GET | `/api/farm/gate` | JWT+session | queue snapshot + `can_run` + maintenance |
| POST | `/api/farm/queue/join` | JWT+session | enqueue / activate turn |
| GET | `/api/farm/history` | JWT+session | last run_jobs for self |
| POST | `/api/farm/run` | JWT+session | consume 1 token; soft-cap coin/exp; **refund on fail** |
| POST | `/api/farm/peek` | JWT+session | nick/coin/XP + tier/cookie/pet/treas; no consume |

### Admin (Login_j3xdr)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/admin/lookup?q=` | find user by username |
| GET | `/api/admin/audit?limit=` | admin_audit_log (default 50) |
| GET | `/api/admin/stats?date=` | daily summary (Asia/Bangkok) |
| GET/POST | `/api/admin/settings` | farm/topup maintenance flags |
| GET | `/api/admin/topups?status=` | list redemptions; `needs_manual` / `credited` |
| GET | `/api/admin/users/{id}/topups` | last 5 topups for user |
| POST | `/api/admin/topups/{id}/credit` | manual credit retry → mark credited |
| POST | `/api/admin/add-tokens` | credit tokens (+ audit) |
| POST | `/api/admin/set-tokens` | set balance (+ audit) |
| POST | `/api/admin/create-user` | create Auth user + profile (+ audit) |
| GET | `/api/admin/users` | list profiles (incl. banned_at) |
| POST | `/api/admin/users/{id}/ban` | ban + rotate session_token |
| POST | `/api/admin/users/{id}/unban` | clear ban |
| DELETE | `/api/admin/users/{id}` | delete user (+ audit) |

### Soft caps / refund

- Soft caps (API): coin ≤ 50000, exp ≤ 5000 (`value_capped`) — conservative, not official game limits
- After successful `consume_token`, failed farm runs credit +1 (`farm_fail_refund`)

### Previously planned (done)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/farm/peek` | login + member snapshot — **no token charge** |

---

## `POST /api/farm/run` flow (critical)

Body (`FarmRunBody`):

```json
{
  "email": "devplay@...",
  "password": "...",
  "score": 0,
  "coin": 0,
  "exp": 0
}
```

Limits: ints `0 … 2_147_483_647`. Email is plain `str` (not EmailStr) so odd accounts still work.

Sequence:

1. Load profile; require `token_balance >= 1`
2. Gate check via `farm_queue.queue_snapshot` — if busy / not `can_run` → **409** `farm_busy` (**before** spending token)
3. RPC `consume_token` reason `farm_run` (−1)
4. Optional insert `run_jobs` (service_role)
5. Acquire threading `_farm_lock` non-blocking; on fail → refund + 409
6. Set `_farm_busy=True`, mark queue done, set `farm_lock`, job=running
7. `await asyncio.to_thread(_run_farm_sync, ...)` → `partyrun_core.run_farm`
8. Return `{ok, token_balance, tokens_before/after, job_id, result, logs[-80:]}`
9. `finally`: clear busy/lock, expire stale turns, `promote_next`

Refund helper: `_refund_token` via `admin_credit_tokens` (service_role only).

---

## Queue semantics (`farm_queue.py`)

- Statuses: `waiting | active | done | expired | cancelled`
- Unique open row per user (`waiting`/`active`)
- `join_queue`: if free → become `active` with `turn_expires_at = now+120s`
- `can_run = (not farm_busy) and (is_my_turn OR (nobody queued and nobody active))`
- After farm starts: `mark_queue_done` → promote waiter

Gate response shape (approx):

```json
{
  "farm_busy": false,
  "queue_length": 1,
  "active": {"user_id": "...", "turn_expires_at": "...", "is_me": true},
  "me": {"status": "active", "position": 0, "turn_expires_at": "..."},
  "can_run": true,
  "is_my_turn": true,
  "turn_seconds": 120
}
```

---

## CORS allowlist (`ALLOWED_ORIGINS`)

- `https://j3xdr.github.io`
- `http://localhost:5500`, `127.0.0.1:5500`
- `http://localhost:8000`, `127.0.0.1:8000`

---

## Env vars (Render)

See `08-secrets-safety.md`. Required for useful operation:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (queue/lock/jobs/admin create; placeholder `REPLACE*` treated as unset)

---

## Integration point for peek

Reuse:

- Same `_farm_lock` / `_farm_busy` (or at least refuse when busy + share lock)
- Same DevPlay login + `GetMemberSummary` path inside `partyrun_core`
- **Do not** call `consume_token`
- **Do not** call `join_queue`

Details in `09-NEXT-TASK-account-peek.md`.
