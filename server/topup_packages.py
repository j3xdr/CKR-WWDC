"""Token top-up packages (TrueMoney angpao). Edit prices here only."""
from __future__ import annotations

from typing import Any

# tokens -> price in baht (exact voucher amount required)
TOPUP_PACKAGES: dict[int, int] = {
    1: 100,
    2: 200,
    3: 270,
    4: 340,
    5: 400,
    6: 450,
    7: 490,
    8: 520,
    9: 560,
    10: 600,
}

FULL_PRICE_PER_TOKEN = 100


def package_list() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for tokens, price_baht in sorted(TOPUP_PACKAGES.items()):
        full = tokens * FULL_PRICE_PER_TOKEN
        save = max(full - price_baht, 0)
        per = round(price_baht / tokens, 2)
        out.append(
            {
                "tokens": tokens,
                "price_baht": price_baht,
                "price_satang": price_baht * 100,
                "per_token_baht": per,
                "save_baht": save,
                "promo": save > 0,
            }
        )
    return out


def get_package(tokens: int) -> dict[str, Any] | None:
    if tokens not in TOPUP_PACKAGES:
        return None
    price_baht = TOPUP_PACKAGES[tokens]
    full = tokens * FULL_PRICE_PER_TOKEN
    return {
        "tokens": tokens,
        "price_baht": price_baht,
        "price_satang": price_baht * 100,
        "per_token_baht": round(price_baht / tokens, 2),
        "save_baht": max(full - price_baht, 0),
        "promo": full > price_baht,
    }
