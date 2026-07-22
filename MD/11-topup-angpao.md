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

Exact voucher amount required.

## Env

- `TRUEWALLET_PHONE` — merchant TrueMoney mobile (server only)

## API

- `GET /api/topup/packages`
- `POST /api/topup/redeem` `{ voucher, package_tokens }` (JWT)

## DB

`topup_redemptions` — unique `voucher_id`; credits via `admin_credit_tokens` reason `topup_angpao`.
