"""
Gift Draw core — open Gift Draw boxes over the HTTP DS protocol.

Ported from project_py/GiftDraw/gift_draw.py. The DS codec, the DevPlay login
and the shop/buyStuff.ds call already live in powder_core.GameClient, so this
module only carries what is actually specific to Gift Draw: the box parameters
and the reward-delta parser.

A draw costs 1 Gift Box (100 Gift Points) and 0 gems — price=0 is not a
discount, it is how the game bills this purchase.
"""

from __future__ import annotations

import collections
import time
from typing import Any, Callable, Optional

from powder_core import (
    GameClient,
    PowderError,
    export_powder_session,
    restore_powder_client,
)

# shop/buyStuff.ds parameters for a Gift Draw box (verified against the client)
STUFF_SEQ = 804
PRICE = 0
BUY_TYPE = 0

DELAY_SEC = 0.5          # pause between draws
MAX_DRAWS_PER_JOB = 200  # server-side ceiling so one job cannot hold the lock forever


class GiftDrawError(Exception):
    def __init__(self, code: str, detail: Optional[str] = None):
        super().__init__(code)
        self.code = code
        self.detail = detail


def extract_state(data: Any) -> dict[str, int]:
    """Pull the account balances a draw can move out of a DS payload."""
    if not isinstance(data, dict):
        return {"coin": 0, "gem": 0, "life": 0, "key": 0, "gift_count": 0}
    cash_info = data.get("cashInfo") or {}
    point_result = cash_info.get("pointResult") or {}

    def _i(value: Any) -> int:
        try:
            return int(value or 0)
        except (TypeError, ValueError):
            return 0

    return {
        "coin": _i(data.get("remainderCoin", cash_info.get("coin", 0))),
        "gem": _i(data.get("remainderGem", cash_info.get("gem", 0))),
        "life": _i(data.get("lifeCount", cash_info.get("life", 0))),
        "key": _i(data.get("keyCount", cash_info.get("key", 0))),
        "gift_count": _i(point_result.get("giftCount", data.get("giftCount", 0))),
    }


# Currency deltas are reported by key so the web UI can label them itself;
# the desktop script emitted pre-formatted Thai strings, which a JSON API
# should not do.
_CURRENCY_KEYS = ("coin", "life", "key", "gem")


def parse_round_reward(data: Any, prev_state: dict[str, int]):
    """Return (deltas, new_state) for a single draw.

    Currency gains come from comparing balances before/after, because the
    payload does not itemize them. Item rewards are read from whichever list
    key the payload happens to use.
    """
    deltas: dict[str, int] = collections.defaultdict(int)
    if not isinstance(data, dict):
        return {}, prev_state

    curr_state = extract_state(data)
    for key in _CURRENCY_KEYS:
        diff = curr_state[key] - prev_state.get(key, 0)
        if diff > 0:
            deltas[key] = diff

    for list_key in ("rewardList", "itemList", "gotItems", "gachaResultList", "rewards"):
        items = data.get(list_key)
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict):
                name = item.get("name") or item.get("id") or item.get("type") or "Item"
                qty = item.get("qty") or item.get("count") or item.get("amount") or 1
                try:
                    qty = int(qty)
                except (TypeError, ValueError):
                    qty = 1
                deltas[f"item:{name}"] += qty
            elif isinstance(item, str):
                deltas[f"item:{item}"] += 1

    result_item = data.get("resultItem")
    if isinstance(result_item, str) and result_item:
        deltas[f"item:{result_item}"] += 1

    return dict(deltas), curr_state


def _client_from_session(powder_session: Optional[dict], password: str = "") -> GameClient:
    if not powder_session:
        raise GiftDrawError("session_expired")
    client = restore_powder_client(powder_session, password=password)
    if not client.session.get("access_token"):
        if not client.email or not password:
            raise GiftDrawError("session_expired")
        client.login()
    return client


def estimate_gift_draw(powder_session: dict, log_cb: Optional[Callable[[str], None]] = None):
    """How many boxes the account can open right now, plus current balances."""

    def _log(msg: str) -> None:
        if log_cb:
            log_cb(msg)

    try:
        client = _client_from_session(powder_session)
        _log("giftdraw: initMember3 …")
        init = client.init_member()
    except PowderError as exc:
        raise GiftDrawError(exc.code, exc.detail) from exc

    state = extract_state(init)
    return {
        "ok": True,
        "available_boxes": state["gift_count"],
        "max_per_job": MAX_DRAWS_PER_JOB,
        "state": state,
        "nickname": init.get("nickname") or init.get("nick") or "player",
        "level": init.get("lv"),
        "powder_session": export_powder_session(client),
    }


def run_gift_draw(
    powder_session: dict,
    count: int = 1,
    password: str = "",
    log_cb: Optional[Callable[[str], None]] = None,
):
    """Open `count` Gift Draw boxes, reporting what each round produced."""

    def _log(msg: str) -> None:
        if log_cb:
            log_cb(msg)

    try:
        count = int(count)
    except (TypeError, ValueError):
        count = 1
    count = max(1, min(MAX_DRAWS_PER_JOB, count))

    try:
        client = _client_from_session(powder_session, password=password)
        _log("giftdraw: initMember3 …")
        init = client.init_member()
    except PowderError as exc:
        return {"ok": False, "error": exc.code, "detail": exc.detail}
    except GiftDrawError as exc:
        return {"ok": False, "error": exc.code, "detail": exc.detail}

    state = extract_state(init)
    available = state["gift_count"]
    _log(f"giftdraw: {available} box(es) available, opening {count}")
    if available <= 0:
        return {
            "ok": False,
            "error": "no_gift_boxes",
            "available_boxes": 0,
            "state": state,
            "powder_session": export_powder_session(client),
        }
    if count > available:
        _log(f"giftdraw: only {available} available — trimming request from {count}")
        count = available

    totals: dict[str, int] = collections.defaultdict(int)
    rounds: list[dict[str, Any]] = []
    ok_draws = 0
    failed = 0
    last_error = None
    started = time.time()

    for i in range(1, count + 1):
        try:
            res = client.buy_stuff(stuff_seq=STUFF_SEQ, price=PRICE, buy_type=BUY_TYPE)
        except Exception as exc:  # network/decode — stop, keep what we already got
            failed += 1
            last_error = str(exc)
            _log(f"giftdraw [{i}/{count}]: request failed — {exc}")
            break

        code = res.get("code")
        if code == 200:
            ok_draws += 1
            deltas, state = parse_round_reward(res.get("data"), state)
            for k, v in deltas.items():
                totals[k] += v
            rounds.append({"round": i, "ok": True, "deltas": deltas})
            _log(f"giftdraw [{i}/{count}]: ok {deltas or '(no delta)'}")
        else:
            failed += 1
            last_error = res.get("message") or f"code_{code}"
            rounds.append({"round": i, "ok": False, "code": code, "message": res.get("message")})
            _log(f"giftdraw [{i}/{count}]: failed ({code}) {res.get('message')}")
            # The account is out of boxes or the shop rejected us; more of the
            # same request will not start working.
            break

        if i < count and DELAY_SEC > 0:
            time.sleep(DELAY_SEC)

    return {
        "mode": "giftdraw",
        "ok": ok_draws > 0,
        "error": None if ok_draws > 0 else (last_error or "giftdraw_failed"),
        "requested": count,
        "draws_ok": ok_draws,
        "draws_failed": failed,
        "elapsed_sec": round(time.time() - started, 2),
        "totals": dict(totals),
        "rounds": rounds,
        "state": state,
        "available_boxes": state["gift_count"],
        "powder_session": export_powder_session(client),
    }
