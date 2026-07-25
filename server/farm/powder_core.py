"""
Magic Powder farm core — HTTP DS protocol (buy treasure + break for powder).
Ported from powder_farm_share/powder_farm.py for CKR WWDC web API.
"""

from __future__ import annotations

import base64
import copy
import io
import json
import math
import os
import random
import re
import string
import struct
import time
import urllib.error
import urllib.request
from typing import Any, Callable, Optional

import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms

HERE = os.path.dirname(os.path.abspath(__file__))
TREASURE_JSON = os.path.join(HERE, "treasure.json")

POWDER_PER_TOKEN = 100_000
DEFAULT_TREASURE = "Revival Boots"
PRINT_EVERY = 5
MAX_LOOPS = 999_999

# --- DS codec (ChaCha20 + FastLZ + urlsafe-base64) ---
_DS_KEY = bytes.fromhex(
    "909d2ab5" "4ab9769c" "a6bb0b4c" "ba7da98d"
    "3f2c42d3" "944b881f" "f8587a62" "b000e97e"
)
_DS_NONCE_BASE = bytes.fromhex("a7935a5977760ed63530acd6")
_DS_ENC_VERSION = 4
_B64_ALPHABET = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
_B64_DECMAP = {c: i for i, c in enumerate(_B64_ALPHABET)}

AUTH_HOST = "https://account.devplay.com"
HTTP_ENDPOINT = "https://server.live.prod.devsnova.cloud/"
APP_HEADERS = {
    "x-bundle-id": "com.devsisters.crg",
    "x-api-key": "SrwOwqNLG7fyi0kYvk03xc1s7eM",
    "user-agent": "okhttp/5.3.2",
}
_LC_TEMPLATE = {
    "app_build": "626",
    "app_version": "26.7.02",
    "locale_on_game": "en",
    "location_country": "TH",
    "os_name": "android",
    "os_version": "12",
    "store": "playstore",
    "timezone": "Asia/Bangkok",
    "library_version": "0.3.3-rc19",
    "library_name": "DevPlay Cocos SDK",
    "device": {"traits": [], "manufacturer": "Samsung", "model": "SM-S918U", "version": "Android OS 12"},
}


class PowderError(Exception):
    def __init__(self, code: str, detail: Optional[str] = None):
        super().__init__(code)
        self.code = code
        self.detail = detail


def _chacha20(data, cipher_len=None):
    if cipher_len is None:
        cipher_len = len(data)
    L = cipher_len & 0xFF
    nonce12 = bytes((b + L) & 0xFF for b in _DS_NONCE_BASE)
    full_nonce = struct.pack("<I", 0) + nonce12
    c = Cipher(algorithms.ChaCha20(_DS_KEY, full_nonce), mode=None)
    e = c.encryptor()
    return e.update(data) + e.finalize()


def _b64_decode(s):
    if isinstance(s, str):
        s = s.encode("ascii")
    s = s.rstrip(b"=")
    out = bytearray()
    acc = bits = 0
    for ch in s:
        if ch not in _B64_DECMAP:
            continue
        acc = (acc << 6) | _B64_DECMAP[ch]
        bits += 6
        if bits >= 8:
            bits -= 8
            out.append((acc >> bits) & 0xFF)
    return bytes(out)


def _b64_encode(data):
    out = bytearray()
    for i in range(0, len(data), 3):
        chunk = data[i : i + 3]
        n = len(chunk)
        b0 = chunk[0]
        b1 = chunk[1] if n > 1 else 0
        b2 = chunk[2] if n > 2 else 0
        out.append(_B64_ALPHABET[b0 >> 2])
        out.append(_B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)])
        out.append(_B64_ALPHABET[((b1 & 0xF) << 2) | (b2 >> 6)] if n > 1 else ord("="))
        out.append(_B64_ALPHABET[b2 & 0x3F] if n > 2 else ord("="))
    return bytes(out).decode("ascii")


_MAX_L2_DISTANCE = 8191


def _fastlz1_decompress(data, maxout):
    ip, n, op = 0, len(data), bytearray()
    ctrl = data[ip] & 31
    ip += 1
    loop = True
    while loop:
        if ctrl >= 32:
            length = (ctrl >> 5) - 1
            ofs = (ctrl & 31) << 8
            if length == 7 - 1:
                length += data[ip]
                ip += 1
            ofs += data[ip]
            ip += 1
            ref = len(op) - ofs - 1
            if len(op) + length + 3 > maxout:
                raise ValueError("output overflow")
            if ref < 0:
                raise ValueError("bad reference")
            if ip < n:
                ctrl = data[ip]
                ip += 1
            else:
                loop = False
            for _ in range(length + 3):
                op.append(op[ref])
                ref += 1
        else:
            count = ctrl + 1
            if ip + count > n:
                raise ValueError("literal overrun")
            op.extend(data[ip : ip + count])
            ip += count
            loop = ip < n
            if loop:
                ctrl = data[ip]
                ip += 1
    return bytes(op)


def _fastlz2_decompress(data, maxout):
    ip, n, op = 0, len(data), bytearray()
    ip_bound = n - 2
    ctrl = data[ip] & 31
    ip += 1
    while True:
        if ctrl >= 32:
            length = (ctrl >> 5) - 1
            ofs = (ctrl & 31) << 8
            ref = len(op) - ofs - 1
            if length == 7 - 1:
                while True:
                    code = data[ip]
                    ip += 1
                    length += code
                    if code != 255:
                        break
            code = data[ip]
            ip += 1
            ref -= code
            length += 3
            if code == 255 and ofs == (31 << 8):
                ofs = data[ip] << 8
                ip += 1
                ofs += data[ip]
                ip += 1
                ref = len(op) - ofs - _MAX_L2_DISTANCE - 1
            if ref < 0:
                raise ValueError("bad reference")
            if len(op) + length > maxout:
                raise ValueError("output overflow")
            for _ in range(length):
                op.append(op[ref])
                ref += 1
        else:
            count = ctrl + 1
            if ip + count > n:
                raise ValueError("literal overrun")
            op.extend(data[ip : ip + count])
            ip += count
        if ip > ip_bound:
            break
        ctrl = data[ip]
        ip += 1
    return bytes(op)


def _fastlz_decompress(data, maxout=1 << 24):
    if len(data) == 0:
        return b""
    level = (data[0] >> 5) + 1
    return _fastlz1_decompress(data, maxout) if level == 1 else _fastlz2_decompress(data, maxout)


def _fastlz_compress(data):
    out = bytearray()
    i, n = 0, len(data)
    if n == 0:
        return b""
    while i < n:
        chunk = data[i : i + 32]
        out.append(len(chunk) - 1)
        out.extend(chunk)
        i += len(chunk)
    return bytes(out)


def ds_decode_blob(b64str):
    ct = _b64_decode(b64str)
    S = _chacha20(ct, cipher_len=len(ct))
    at = S.find(b"@")
    if at < 0:
        raise ValueError("no '@' separator in decrypted stream")
    orig_len = int(S[:at])
    plain = _fastlz_decompress(S[at + 1 :], maxout=orig_len + 64)
    return plain[:orig_len]


def ds_encode_blob(params):
    if isinstance(params, str):
        params = params.encode("utf-8")
    compressed = _fastlz_compress(params)
    S = str(len(params)).encode("ascii") + b"@" + compressed
    ct = _chacha20(S, cipher_len=len(S))
    return _b64_encode(ct)


def ds_build_request_body(params):
    return "isEncryptedData=%d&data=%s" % (_DS_ENC_VERSION, ds_encode_blob(params))


def _rand_uuid():
    import uuid

    return str(uuid.uuid4())


def fresh_lc():
    lc = copy.deepcopy(_LC_TEMPLATE)
    lc["devsisters_id"] = _rand_uuid()
    lc["anonymous_id"] = _rand_uuid()
    lc["fgs_id"] = _rand_uuid()
    lc["app_installed_id"] = _rand_uuid()
    lc["semi_device_id"] = _rand_uuid().replace("-", "")[:16]
    return lc


def _rand_cable(n=20):
    al = string.ascii_letters + string.digits + "-_"
    return "".join(random.choice(al) for _ in range(n))


class GameClient:
    def __init__(self, email="", password="", lc=None, mid="", session=None):
        self.email = email
        self.password = password
        self.lc = lc or fresh_lc()
        self.mid = mid or ""
        self.session = dict(session or {})
        self.http = requests.Session()

    def _gen_ms(self):
        try:
            ms_seq = int(self.session.get("member_seq") or 0)
        except (TypeError, ValueError):
            ms_seq = 0
        ms_seq &= 0xFFFFFFFF
        if ms_seq >= 0x80000000:
            ms_seq -= 0x100000000
        divisor = (ms_seq % 1000) + 3
        return (random.randint(0, 999) + 3) * divisor

    def login(self):
        lc = dict(self.lc)
        lc["devsisters_id"] = ""
        headers = {
            "X-Bundle-Id": APP_HEADERS["x-bundle-id"],
            "X-API-Key": APP_HEADERS["x-api-key"],
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": APP_HEADERS["user-agent"],
        }

        def _post(path, obj):
            data = json.dumps(obj).encode()
            req = urllib.request.Request(AUTH_HOST + "/" + path, data=data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read())

        try:
            _post("v4/checkemail", {"email": self.email, "lc": lc})
            d = _post(
                "v3/login/devsisters",
                {"email": self.email, "password": self.password, "oven_access_token": "", "lc": lc},
            )
        except urllib.error.URLError as e:
            raise PowderError("network_error", str(e))
        tok = d.get("game_access_token")
        if not tok:
            code = d.get("code")
            if code in (40101, 40102):
                raise PowderError("login_failed")
            raise PowderError("login_failed", json.dumps(d, ensure_ascii=False)[:200])
        member = d.get("member") or {}
        self.mid = member.get("mid") or self.mid
        self.session["access_token"] = tok

    def _envelope(self, pid, authed=True):
        lc = self.lc
        env = {
            "pid": pid,
            "currentLv": self.session.get("lv", 0) if authed else 0,
            "socialUidCommon": self.mid if authed else "NULL",
            "ver": lc["app_version"],
            "buildVer": lc["app_build"],
            "cc": "US",
            "ms": self._gen_ms(),
            "osType": "A",
            "osVersion": lc["os_version"],
            "timeZone": lc["timezone"],
            "timeZoneDistance": 25200,
            "marketType": "GOOGLE_PLAY",
            "carrier": "",
            "fgsId": lc.get("fgs_id", ""),
            "locale": "en-US",
            "deviceId": lc.get("semi_device_id", ""),
            "deviceName": lc["device"]["model"],
            "deviceModel": lc["device"]["model"],
            "cable": _rand_cable(),
        }
        if authed:
            env["sessionKey"] = self.session.get("session_key", "")
        return env

    def _call(self, path, params):
        body = ds_build_request_body(json.dumps(params, separators=(",", ":")))
        url = HTTP_ENDPOINT.rstrip("/") + "/" + path.lstrip("/")
        headers = {
            "Host": HTTP_ENDPOINT.split("//", 1)[-1].rstrip("/"),
            "Accept": "*/*",
            "Accept-Encoding": "gzip",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": APP_HEADERS["user-agent"],
        }
        r = self.http.post(url, data=body, headers=headers, timeout=30)
        try:
            obj = json.loads(r.text)
        except Exception:
            raise PowderError("bad_response", r.text[:200])
        data = None
        if obj.get("responseData"):
            try:
                data = json.loads(ds_decode_blob(obj["responseData"]).decode("utf-8"))
            except Exception as e:
                data = {"__decode_error__": str(e)}
        return {"code": obj.get("responseCode"), "message": obj.get("responseMessage"), "data": data}

    def init_member(self):
        p = self._envelope("member/initMember3.ds", authed=False)
        p.update(
            {
                "mid": self.mid,
                "playerId": self.mid,
                "agreementSeq": "0",
                "pushToken": "",
                "accessToken": self.session["access_token"],
                "agreement": "40082",
                "mobclixSignature": "",
                "macAddress": "02:00:00:00:00:00",
            }
        )
        res = self._call("member/initMember3.ds", p)
        if res["code"] != 200 or not res["data"]:
            raise PowderError("init_failed", json.dumps(res, ensure_ascii=False)[:300])
        d = res["data"]
        self.session["session_key"] = d.get("sessionKey")
        self.session["member_seq"] = d.get("memberSeq")
        self.session["lv"] = d.get("lv", 0)
        return d

    def buy_stuff(self, stuff_seq, price, buy_type=0):
        p = self._envelope("shop/buyStuff.ds", authed=True)
        p.update(
            {
                "stuffSeq": stuff_seq,
                "price": price,
                "buyType": buy_type,
                "memberSeq": self.session["member_seq"],
                "accessToken": self.session["access_token"],
                "loginPlatform": "email",
            }
        )
        return self._call("shop/buyStuff.ds", p)

    def break_stuff(self, item_list, powder_qty, shard_qty):
        p = self._envelope("shop/breakStuff.ds", authed=True)
        p.update(
            {
                "memberSeq": self.session["member_seq"],
                "itemList": item_list,
                "powderQty": powder_qty,
                "shardQty": shard_qty,
                "accessToken": self.session["access_token"],
            }
        )
        return self._call("shop/breakStuff.ds", p)


def export_powder_session(client: GameClient) -> dict[str, Any]:
    return {
        "email": client.email,
        "lc": client.lc,
        "mid": client.mid,
        "session": client.session,
    }


def restore_powder_client(data: dict[str, Any], password: str = "") -> GameClient:
    return GameClient(
        email=data.get("email") or "",
        password=password,
        lc=data.get("lc"),
        mid=data.get("mid") or "",
        session=data.get("session") or {},
    )


_treasures_cache: Optional[list[dict]] = None


def load_treasures() -> list[dict]:
    global _treasures_cache
    if _treasures_cache is not None:
        return _treasures_cache
    if not os.path.exists(TREASURE_JSON):
        raise PowderError("treasure_json_missing")
    with open(TREASURE_JSON, encoding="utf-8") as f:
        _treasures_cache = json.load(f)
    return _treasures_cache


def list_treasures() -> list[dict[str, Any]]:
    out = []
    for t in load_treasures():
        if not t.get("price") or t.get("powder_yield_lv1") is None:
            continue
        out.append(
            {
                "name": t.get("name"),
                "grade": t.get("grade"),
                "price": int(t["price"]),
                "powder_yield_lv1": int(t["powder_yield_lv1"]),
                "shard_yield_lv1": int(t.get("shard_yield_lv1") or 0),
                "group_seq": t.get("group_seq"),
                "image_tag": t.get("image_tag"),
            }
        )
    return out


def resolve_treasure(name: Optional[str]) -> dict[str, Any]:
    target = (name or DEFAULT_TREASURE).strip().lower()
    for t in load_treasures():
        if t.get("name", "").strip().lower() == target:
            if not t.get("price") or t.get("powder_yield_lv1") is None:
                raise PowderError("treasure_no_yield", t.get("name"))
            return t
    raise PowderError("treasure_not_found", name or DEFAULT_TREASURE)


def owned_instance(init: dict, group_seq: int) -> Optional[dict]:
    for x in init.get("inventoryItemList") or []:
        m = re.match(r"(\d+):(\d+)@(.+)", x.get("id") or "")
        if m and int(m.group(1)) == group_seq:
            return {
                "groupSeq": group_seq,
                "tag": int(m.group(2)),
                "uuid": m.group(3),
                "raw": x["id"],
            }
    return None


def estimate_job(coin: int, treasure: dict, owned: bool = False) -> dict[str, Any]:
    price = int(treasure["price"])
    yield_p = int(treasure["powder_yield_lv1"])
    coin = max(0, int(coin or 0))
    rounds_for_100k = math.ceil(POWDER_PER_TOKEN / yield_p) if yield_p > 0 else 0
    coin_needed_100k = rounds_for_100k * price
    max_buy_rounds = coin // price if price > 0 else 0
    max_rounds = max_buy_rounds + (1 if owned else 0)
    max_affordable_powder = max_rounds * yield_p
    target_powder = min(POWDER_PER_TOKEN, max_affordable_powder)
    capped = target_powder < POWDER_PER_TOKEN
    rounds_planned = min(rounds_for_100k, max_rounds) if not capped else max_rounds
    return {
        "powder_per_token": POWDER_PER_TOKEN,
        "target_powder": target_powder,
        "max_affordable_powder": max_affordable_powder,
        "rounds_planned": rounds_planned,
        "rounds_for_100k": rounds_for_100k,
        "coin_needed_100k": coin_needed_100k,
        "coin_available": coin,
        "capped": capped,
        "can_run": target_powder > 0,
        "price": price,
        "powder_yield_lv1": yield_p,
        "treasure_name": treasure.get("name"),
    }


def _friendly_buy_error(code, msg, name):
    m = str(msg or "")
    if code == 504 and "max level" in m.lower():
        return "owner_not_lv8"
    if code == 321 or "already owned" in m.lower():
        return "already_owned"
    if code == 310:
        return "price_mismatch"
    return "buy_failed"


def connect_powder_snapshot(email: str, password: str, log_cb: Optional[Callable[[str], None]] = None):
    """Login + initMember3 for coin/powder balances (HTTP path)."""

    def _log(msg: str):
        if log_cb:
            log_cb(msg)

    client = GameClient(email=email, password=password)
    _log("powder: DevPlay login …")
    client.login()
    _log("powder: initMember3 …")
    init = client.init_member()
    coin = int(init.get("coin") or 0)
    powder = int((init.get("cashInfo") or {}).get("powder") or 0)
    nickname = init.get("nickname") or init.get("nick") or "player"
    return {
        "ok": True,
        "nickname": nickname,
        "coin": coin,
        "powder": powder,
        "level": init.get("lv"),
        "powder_session": export_powder_session(client),
    }


def refresh_balances(powder_session: dict, password: str = "", log_cb=None):
    """Re-init HTTP session to refresh coin/powder."""

    def _log(msg: str):
        if log_cb:
            log_cb(msg)

    client = restore_powder_client(powder_session, password=password)
    if not client.session.get("access_token"):
        if not client.email or not password:
            raise PowderError("session_expired")
        client.login()
    _log("powder: refresh initMember3 …")
    init = client.init_member()
    return {
        "ok": True,
        "coin": int(init.get("coin") or 0),
        "powder": int((init.get("cashInfo") or {}).get("powder") or 0),
        "powder_session": export_powder_session(client),
        "init": init,
    }


def run_powder_job(
    treasure_name: str,
    email: Optional[str] = None,
    password: Optional[str] = None,
    powder_session: Optional[dict] = None,
    log_cb: Optional[Callable[[str], None]] = None,
):
    treasure = resolve_treasure(treasure_name)
    name = treasure["name"]
    group = int(treasure["group_seq"])
    buy_seq = int(treasure.get("buy_stuff_seq") or (group + 1))
    price = int(treasure["price"])
    powder_q = int(treasure["powder_yield_lv1"])
    shard_q = int(treasure.get("shard_yield_lv1") or 0)

    def _log(msg: str):
        if log_cb:
            log_cb(msg)

    if powder_session:
        client = restore_powder_client(powder_session, password=password or "")
        if not client.session.get("session_key"):
            if email and password:
                client.email = email
                client.password = password
                client.login()
            else:
                return {"ok": False, "error": "session_expired"}
    else:
        if not email or not password:
            return {"ok": False, "error": "missing_credentials"}
        client = GameClient(email=email, password=password)
        client.login()

    _log("powder: loading account …")
    init = client.init_member()
    coin_before = int(init.get("coin") or 0)
    powder_before = int((init.get("cashInfo") or {}).get("powder") or 0)
    inst = owned_instance(init, group)
    est = estimate_job(coin_before, treasure, owned=bool(inst))
    target = int(est["target_powder"])
    if target <= 0:
        return {
            "ok": False,
            "error": "insufficient_coin",
            "coin_before": coin_before,
            "powder_before": powder_before,
            "treasure": name,
            "target_powder": 0,
            "capped": True,
        }

    _log(
        "powder: %s  price=%d  yield=%d  target=%d%s"
        % (name, price, powder_q, target, " (capped)" if est["capped"] else "")
    )

    gained = 0
    coin = coin_before
    t0 = time.time()
    done = 0

    for i in range(1, MAX_LOOPS + 1):
        if not inst:
            if coin < price:
                _log("powder: เหรียญไม่พอซื้อรอบถัดไป")
                break
            rb = client.buy_stuff(buy_seq, price)
            if rb.get("code") != 200:
                err = _friendly_buy_error(rb.get("code"), rb.get("message"), name)
                _log("powder: ซื้อไม่สำเร็จ — %s" % err)
                if done == 0:
                    return {
                        "ok": False,
                        "error": err,
                        "treasure": name,
                        "powder_gained": 0,
                        "rounds": 0,
                        "powder_session": export_powder_session(client),
                    }
                break
            d = rb.get("data") or {}
            coin = int(d.get("remainderCoin", coin))
            result_id = d.get("resultItem") or ""
            m = re.match(r"(\d+):(\d+)@(.+)", result_id)
            inst = (
                {"groupSeq": int(m.group(1)), "tag": int(m.group(2)), "uuid": m.group(3)}
                if m
                else None
            )
            if not inst:
                _log("powder: ซื้อสำเร็จแต่หาไอเทมไม่เจอ")
                break

        rk = client.break_stuff([inst], powder_q, shard_q)
        if rk.get("code") != 200:
            _log("powder: ย่อยไม่สำเร็จ code=%s" % rk.get("code"))
            if done == 0:
                return {
                    "ok": False,
                    "error": "break_failed",
                    "treasure": name,
                    "powder_session": export_powder_session(client),
                }
            break

        gained += powder_q
        inst = None
        done = i
        if i % PRINT_EVERY == 0 or gained >= target:
            _log(
                "[%d] +%d powder  gained=%d/%d  coin~%s  (%.1fs/round)"
                % (i, powder_q, gained, target, coin, (time.time() - t0) / max(i, 1))
            )
        if gained >= target:
            break

    dt = time.time() - t0
    ok = gained > 0
    return {
        "ok": ok,
        "mode": "powder",
        "treasure": name,
        "target_powder": target,
        "capped": est["capped"],
        "powder_gained": gained,
        "powder_before": powder_before,
        "powder_after": powder_before + gained,
        "coin_before": coin_before,
        "coin_after": coin,
        "rounds": done,
        "elapsed_s": round(dt, 2),
        "error": None if ok else "no_rounds",
        "powder_session": export_powder_session(client),
        "estimate": est,
    }
