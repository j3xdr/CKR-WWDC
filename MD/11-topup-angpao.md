# Auto top-up (TrueMoney angpao)

## Packages (edit `server/topup_packages.py`)

| Token | Baht |
|------:|-----:|
| 1 | 100 |
| 2 | 200 |
| 3 | 270 |
| 4 | 340 |
| 5 | 400 |
| 6 | 450 |
| 7 | 490 |
| 8 | 520 |
| 9 | 560 |
| 10 | 600 |

Exact voucher amount required. Customer must create voucher from **another phone** (not merchant wallet).

## Env

- `TRUEWALLET_PHONE` — merchant TrueMoney mobile (server only; Render env)

## API

- `GET /api/topup/packages`
- `GET /api/topup/history` — JWT + session; last 20 own rows
- `POST /api/topup/redeem` `{ voucher, package_tokens }` (JWT + `X-Session-Token`)
  - Rate limits: ~10/h/user, ~20/h/IP, voucher fail 3×/15m → `topup_voucher_blocked`
  - Errors: public `{ code, message }` (Thai); raw TMN message logged server-side
- Admin:
  - `GET /api/admin/topups?status=needs_manual`
  - `GET /api/admin/users/{id}/topups`
  - `POST /api/admin/topups/{id}/credit`

## DB

`topup_redemptions` — unique `voucher_id`; credits via `admin_credit_tokens` reason `topup_angpao`.

Columns:

- `credit_status`: `credited` | `needs_manual`
- `error_note`: set when credit RPC fails after voucher accepted

Flow: insert row → credit tokens → on credit fail mark `needs_manual` (admin can retry).
