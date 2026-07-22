# 07 — Feature history / decisions log

เรียงจากงานเก่า → ใหม่ (อิง commit บน `CKR WWDC` + แชท)

---

## Scaffold → split UI/API

| Decision | Why |
|----------|-----|
| Scaffold token-based farm API | ขายรอบฟาร์มเป็นโทเค็น |
| Serve UI on **GitHub Pages**; Render **API-only** | Free hosting แยก static ออกจาก Python cold start |
| Strip public README to title only | ไม่โฆษณาวิธีใช้/ความลับบน GitHub |
| Username login (ไม่โชว์ email) | UX ลูกค้า + synthetic `@users.ckr.local` |
| Admin แยกที่ Login_j3xdr | ไม่ปนปุ่มแอดมินในหน้าฟาร์มสาธารณะ |
| **Self-registration** (`/api/auth/register`) | ลดขั้นตอนติดต่อแอดมินเพื่อสร้างบัญชี; tokens เริ่ม 0 |

Commits ที่เกี่ยวข้องโดยประมาณ: `255fa39` … `926aa69` … `89af18f` … `73f1dab`

---

## Farm UX polish

| Decision | Why |
|----------|-----|
| Dark Cookie Run bakery theme | brand |
| Token gate + confirm + Telegram top-up modal | กันกดฟาร์มตอนโทเค็นหมด / ยืนยันก่อนหัก |
| Number format commas + Thai magnitude + Int32 max | ใส่เลขใหญ่ให้อ่านง่าย กัน overflow |
| Default farm stats = 0; clear on focus | ไม่พลาดค่า default เก่า |
| Lock inputs when tokens empty | บังคับเติมก่อนแก้ตัวเลข |
| Accept DevPlay email as plain string | บัญชีแปลกๆ ยังส่งเข้า core ได้ |
| Default claim totals / clearer errors | กัน UI โชว์ undefined |

---

## Result popup + queue + XP (commit `7adfb1b`)

| Decision | Why |
|----------|-----|
| Result summary modal หลังฟาร์ม | โชว์ nickname, coin/XP delta+total, token before→after |
| FIFO farm queue + 2m turn | Free 1 instance — ต้องคิว |
| Level XP calculator | ช่วยใส่ XP จากเลเวลเป้าหมาย |

---

## Account peek

| Decision | Why |
|----------|-----|
| Peek ต้องมีโทเค็น ≥1 แต่ไม่หัก | กัน spam บัญชีว่าง / ยังไม่เสียโทเค็น |
| 180s cooldown | ลดโหลด DevPlay/gRPC |
| Empty-tokens modal closable | ไม่ล็อก UI |

---

## TrueMoney auto top-up (angpao)

| Decision | Why |
|----------|-----|
| Redeem via gift.truemoney.com (tmn-voucher style Python client) | เติมอัตโนมัติโดยไม่รอแอดมิน |
| Exact package amount only (1=100 … 10=600฿) | กันยอดซองไม่ตรง / ซองสุ่ม |
| `topup_redemptions.voucher_id` unique + `admin_credit_tokens` | กันเติมซ้ำ + ledger เดิม |
| Coin Vault UI + collapse when balance > 0 | UX พรีเมียม / ไม่รกตอนมียอด |
| `TRUEWALLET_PHONE` on Render only | เบอร์รับเงินไม่ commit ใน repo |

ดู `11-topup-angpao.md`

---

## Security + UX upgrades (2026-07-22)

| Decision | Why |
|----------|-----|
| Topup rate limit: user 10/h + IP 20/h + voucher fail 3/15m | กัน brute / spam redeem |
| Sanitize TMN errors → `{code, message}` ไทย; log raw server-side | ไม่โชว์ข้อความอังกฤษดิบให้ลูกค้า |
| `profiles.session_token` + `X-Session-Token` | session เดียวต่อบัญชี; login ใหม่ตัดของเก่า |
| `topup_redemptions.credit_status` + admin credit-retry | รับซองแล้วแต่ credit พลาด → ตามมือได้ |
| `admin_audit_log` + `/api/admin/audit` | ติดตาม add/set/create/delete/credit-retry |
| User topup history + copy price + API ready chip | ความสะดวกฝั่งลูกค้า / cold start |

---

## API + farm engine batch (2026-07-22)

| Decision | Why |
|----------|-----|
| Auto-refund on farm fail after consume | ไม่เสียโทเค็นเมื่อเกม/แมตช์พัง |
| Soft caps coin/exp | ลดโอกาส corrupt_pending จากค่ามโหฬาร |
| `app_settings` maintenance gates | ปิดฟาร์ม/เติมได้จากแอดมินโดยไม่ redeploy |
| `profiles.banned_at` + ban/unban | ตัดบัญชีปัญหา + หมุน session |
| Farm history + richer peek (tier/cookie/pet) | ใช้ข้อมูลที่มีอยู่แล้วใน core/DB |
| `/api/topup/verify` + daily admin stats | ตรวจซองก่อนรับ + มองภาพรวมรายวัน |

---

## Explicit non-goals / deferred

- Desktop exe PartyRun packaging (`exe_รอทำ`) — คนละสายงาน
- Guest reroll / API-only gRPC unlock จาก transcript เก่า — ไม่ใช่ WWDC next task
- Multi-instance farm workers — นอก Free plan
- Official Pee Tong / bank balance API — นอกขอบเขตซองอั่งเปา
- Read-only coin/XP without ClaimQuestRewardAll — ต้องทดสอบ protocol เพิ่ม
- ลบ/ข้าม corrupt pending — ยังไม่มี API ใน core
