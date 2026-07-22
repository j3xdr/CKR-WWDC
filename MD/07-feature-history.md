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
| Rename label **EXP → XP** | ตรงภาษาที่ user ใช้ |
| Level→XP calculator จาก `cookierun_level_table.md` | user ต้องการคำนวณ XP จากเลเวล (เช่น 25→75) |
| FIFO queue + **2-minute turn** | Render Free 1 instance — กันคนแย่ง + ไม่ค้างคิว |
| Supabase `farm_queue` + `farm_lock` | lock/queue ทน cold restart ระดับหนึ่ง |
| Pipeline status cards ในแผง `#farm-log-wrap` (ตอนนั้น) | แสดงขั้นตอน login/clear/match/run/claim |

---

## Run-status as locked popup (LOCAL ONLY after `7adfb1b`)

User ชี้ DOM `#farm-log-wrap` แล้วขอให้เป็น **popup**:

| Decision | Why |
|----------|-----|
| ย้ายสถานะการวิ่งไป `#run-status-root` | ไม่ดันเลย์เอาต์หน้าฟอร์ม |
| ล็อกปิดจนกว่าเสร็จ | กันปิดกลางคันแล้วสับสน |
| หลังปิด status ค่อยโชว์ result modal | ไม่ซ้อนสอง modal |
| Fail อยู่ใน cards ไม่ซ้อน error modal | UI สะอาดขึ้น |

**ยังไม่ commit/push** ตอนเขียน docs — ดู `10-git-status-uncommitted.md`

---

## Account peek (IMPLEMENTED)

User ขอ: ดู coins/XP/nickname **ก่อน** กดฟาร์ม

ตกลงออกแบบแล้ว (12:31–12:48 2026-07-22):

- Share farm lock กับฟาร์ม
- ไม่เข้าคิว 2 นาที
- Busy → ปิดปุ่ม/ตอบ busy
- ระหว่าง peek บล็อกฟาร์ม
- ไม่หักโทเค็น
- Rate limit
- Cost ถูกกว่าฟาร์มแต่ occupy Free instance สั้นๆ

แผนเต็ม: `09-NEXT-TASK-account-peek.md`

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

## Explicit non-goals / deferred

- Desktop exe PartyRun packaging (`exe_รอทำ`) — คนละสายงาน
- Guest reroll / API-only gRPC unlock จาก transcript เก่า — ไม่ใช่ WWDC next task
- Multi-instance farm workers — นอก Free plan
- Official Pee Tong / bank balance API — นอกขอบเขตซองอั่งเปา