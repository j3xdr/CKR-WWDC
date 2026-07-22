# 09 — Account peek (ดู coins / XP / nickname ก่อนฟาร์ม)

## Status

**IMPLEMENTED** (2026-07-22) — token gate + 180s cooldown + shared farm lock

---

## User goal

ก่อนกดฟาร์ม ผู้ใช้กดปุ่มเพื่อดูสถานะบัญชีเกมปัจจุบัน:

- **nickname**
- **coins** (ยอดในเกม)
- **XP** (และ level ถ้าดึงได้)

โดยใช้ DevPlay email/password จาก `#dp-acct-mail` / `#dp-acct-secret`  
**ไม่บังคับ** peek ก่อนฟาร์ม — ฟาร์มตรงๆ ได้ตามปกติ

---

## Product rules (shipped)

| Rule | Detail |
|------|--------|
| Token gate | ต้อง `token_balance >= 1` ถึงจะ peek ได้ |
| No token charge | **ไม่** เรียก `consume_token` |
| Rate limit | **180 วินาที / user** + UI นับถอยหลัง |
| Share farm lock | Peek ใช้ `_farm_lock` / `_farm_busy` ร่วมกับฟาร์ม |
| No farm FIFO queue | Peek **ไม่** `join_queue` |
| Mutual exclusion | ระหว่าง peek → ปิดปุ่มฟาร์ม (และกลับกัน) |
| Empty tokens UX | ปิดปุ่ม + API `402 insufficient_tokens_for_peek` ข้อความไทยชัดว่าต้องมีโทเค็น (ไม่หัก) |

---

## API

```http
POST /api/farm/peek
Authorization: Bearer <jwt>
Content-Type: application/json

{ "email": "...", "password": "..." }
```

Success:

```json
{
  "ok": true,
  "nickname": "...",
  "mid": "...",
  "coin": 123,
  "exp": 456,
  "level": 79,
  "retry_after": 180,
  "token_balance": 1
}
```

Errors:

| Status | Detail |
|--------|--------|
| 402 | `insufficient_tokens_for_peek` |
| 429 | `{ code: "peek_rate_limited", retry_after: N }` |
| 409 | `{ code: "farm_busy" }` |
| 401 | `login_failed` |

---

## Implementation notes

- Core: `peek_account()` in `server/farm/partyrun_core.py`
  - `GetMemberSummary` → nickname / mid / level
  - Coin/XP: `GetMemberSummary` **ไม่มี** currency ใน descriptor — ใช้ `RewardAPI.ClaimQuestRewardAll` best-effort เพื่ออ่าน `cash_info.coin` + `exp` (อาจเคลมเควสรอรับของ episode 0/1 ถ้ามี)
- UI: `#peek-btn`, `#peek-cooldown`, modal โหมด `peek`
- Cooldown เก็บใน `sessionStorage` ตาม user id (server เป็น source of truth)

---

## Acceptance checklist

- [x] tokens = 0 → ปุ่มปิด / 402 ข้อความไทย ไม่หัก ledger
- [x] tokens ≥ 1 → peek ได้ โดยไม่ลด balance
- [x] กดซ้ำใน 180s → 429 + UI นับถอยหลัง
- [x] ระหว่าง peek → กดฟาร์มไม่ได้
- [x] ระหว่างฟาร์ม → peek ได้ 409
- [x] ฟาร์มโดยไม่ peek ยังได้ตามปกติ
