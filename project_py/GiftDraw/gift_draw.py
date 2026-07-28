"""
============================================================================
 Cookie Run — GIFT DRAW FARM & REPORT  (standalone, single-file edition)
============================================================================
 What this does: Logs into DevPlay, detects available Gift Draw boxes in
 the user's account, and automatically opens them for FREE (using 100 Gift
 Points per box) without spending any crystals/gems.

 Real Gift Draw Parameters (verified via Charles Proxy):
   - Endpoint : shop/buyStuff.ds
   - stuffSeq : 804 (Gift Draw Box)
   - price    : 0   (Costs 1 Gift Box / 100 Gift Points)
   - buyType  : 0
============================================================================
"""

import os
import sys
import io
import json
import time
import base64
import random
import string
import struct
import copy
import uuid
import collections
import urllib.request
import urllib.error

import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms

# ===========================  CONFIG — EDIT ME  ============================
EMAIL      = ""                           # DevPlay login email (กรอกตอนรัน)
PASSWORD   = ""                           # DevPlay login password (กรอกตอนรัน)

# Exact Gift Draw parameters (shop/buyStuff.ds)
STUFF_SEQ  = 804                          # Item ID for Gift Draw Box
PRICE      = 0                            # Costs 0 gems (uses 1 Gift Box / 100 Gift Points)
BUY_TYPE   = 0                            # Standard draw payment type

OPEN_COUNT = 10                           # Default draw count if unspecified
DELAY_SEC  = 0.5                          # Delay between draws (seconds)
DRY_RUN    = False                        # True = test login only (no draws sent)
# ===========================================================================

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ============================================================================
#  PART 1 — DS protocol codec (ChaCha20 + FastLZ + urlsafe-base64)
# ============================================================================
_DS_KEY = bytes.fromhex(
    "909d2ab5" "4ab9769c" "a6bb0b4c" "ba7da98d"
    "3f2c42d3" "944b881f" "f8587a62" "b000e97e"
)
_DS_NONCE_BASE = bytes.fromhex("a7935a5977760ed63530acd6")
_DS_ENC_VERSION = 4


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
    # urlsafe-base64 (alphabet A-Za-z0-9-_), the same codec the game uses. The
    # C-accelerated stdlib decoder is byte-for-byte identical to the previous
    # hand-rolled loop: it drops stray non-alphabet chars and we re-pad after
    # stripping the original padding.
    if isinstance(s, str):
        s = s.encode("ascii")
    s = s.rstrip(b"=")
    s += b"=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s)


def _b64_encode(data):
    # urlsafe-base64 with padding -- identical output to the old manual encoder,
    # just using the C-accelerated stdlib implementation.
    return base64.urlsafe_b64encode(data).decode("ascii")


_MAX_L2_DISTANCE = 8191


def _fastlz1_decompress(data, maxout):
    ip, n, op = 0, len(data), bytearray()
    ctrl = data[ip] & 31; ip += 1
    loop = True
    while loop:
        if ctrl >= 32:
            length = (ctrl >> 5) - 1
            ofs = (ctrl & 31) << 8
            if length == 7 - 1:
                length += data[ip]; ip += 1
            ofs += data[ip]; ip += 1
            ref = len(op) - ofs - 1
            if len(op) + length + 3 > maxout:
                raise ValueError("output overflow")
            if ref < 0:
                raise ValueError("bad reference")
            if ip < n:
                ctrl = data[ip]; ip += 1
            else:
                loop = False
            for _ in range(length + 3):
                op.append(op[ref]); ref += 1
        else:
            count = ctrl + 1
            if ip + count > n:
                raise ValueError("literal overrun")
            op.extend(data[ip:ip + count]); ip += count
            loop = ip < n
            if loop:
                ctrl = data[ip]; ip += 1
    return bytes(op)


def _fastlz2_decompress(data, maxout):
    ip, n, op = 0, len(data), bytearray()
    ip_bound = n - 2
    ctrl = data[ip] & 31; ip += 1
    while True:
        if ctrl >= 32:
            length = (ctrl >> 5) - 1
            ofs = (ctrl & 31) << 8
            ref = len(op) - ofs - 1
            if length == 7 - 1:
                while True:
                    code = data[ip]; ip += 1
                    length += code
                    if code != 255:
                        break
            code = data[ip]; ip += 1
            ref -= code
            length += 3
            if code == 255 and ofs == (31 << 8):
                ofs = data[ip] << 8; ip += 1
                ofs += data[ip]; ip += 1
                ref = len(op) - ofs - _MAX_L2_DISTANCE - 1
            if ref < 0:
                raise ValueError("bad reference")
            if len(op) + length > maxout:
                raise ValueError("output overflow")
            for _ in range(length):
                op.append(op[ref]); ref += 1
        else:
            count = ctrl + 1
            if ip + count > n:
                raise ValueError("literal overrun")
            op.extend(data[ip:ip + count]); ip += count
        if ip > ip_bound:
            break
        ctrl = data[ip]; ip += 1
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
        chunk = data[i:i + 32]
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
    plain = _fastlz_decompress(S[at + 1:], maxout=orig_len + 64)
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


# ============================================================================
#  PART 2 — Client identity & DevPlay login
# ============================================================================
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


def _rand_uuid():
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
    return "".join(random.choices(al, k=n))


class GameClient:
    def __init__(self, email, password):
        self.email = email
        self.password = password
        self.lc = fresh_lc()
        self.mid = ""
        self.session = {}
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
        lc = dict(self.lc); lc["devsisters_id"] = ""
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
            d = _post("v3/login/devsisters",
                      {"email": self.email, "password": self.password, "oven_access_token": "", "lc": lc})
        except urllib.error.URLError as e:
            raise RuntimeError("เชื่อมต่อเซิร์ฟเวอร์ DevPlay ไม่ได้: %s" % e)
        tok = d.get("game_access_token")
        if not tok:
            code = d.get("code")
            msg = {
                40101: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
                40102: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
                40401: "ไม่พบบัญชีนี้ในระบบ DevPlay",
                42901: "พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่",
            }.get(code, "เซิร์ฟเวอร์ปฏิเสธการเข้าสู่ระบบ (code %s)" % code)
            raise RuntimeError("เข้าสู่ระบบไม่สำเร็จ: %s" % msg)
        member = d.get("member") or {}
        self.mid = member.get("mid") or self.mid
        self.session["access_token"] = tok
        print("[+] Login OK | mid = %s" % self.mid)

    def _envelope(self, pid, authed=True):
        lc = self.lc
        env = {
            "pid": pid,
            "currentLv": self.session.get("lv", 0) if authed else 0,
            "socialUidCommon": self.mid if authed else "NULL",
            "ver": lc["app_version"], "buildVer": lc["app_build"], "cc": "TH",
            "ms": self._gen_ms(), "osType": "A", "osVersion": lc["os_version"],
            "timeZone": lc["timezone"], "timeZoneDistance": 25200,
            "marketType": "GOOGLE_PLAY", "carrier": "", "fgsId": lc.get("fgs_id", ""),
            "locale": "en-US", "deviceId": lc.get("semi_device_id", ""),
            "deviceName": lc["device"]["model"], "deviceModel": lc["device"]["model"],
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
            "Accept": "*/*", "Accept-Encoding": "gzip",
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": APP_HEADERS["user-agent"],
        }
        r = self.http.post(url, data=body, headers=headers, timeout=30)
        try:
            obj = json.loads(r.text)
        except Exception:
            raise RuntimeError("เซิร์ฟเวอร์ตอบกลับแบบไม่รู้จัก (%d): %r" % (r.status_code, r.text[:200]))
        data = None
        if obj.get("responseData"):
            try:
                data = json.loads(ds_decode_blob(obj["responseData"]).decode("utf-8"))
            except Exception as e:
                data = {"__decode_error__": str(e)}
        return {"code": obj.get("responseCode"), "message": obj.get("responseMessage"), "data": data}

    def init_member(self):
        p = self._envelope("member/initMember3.ds", authed=False)
        p.update({
            "mid": self.mid, "playerId": self.mid, "agreementSeq": "0", "pushToken": "",
            "accessToken": self.session["access_token"], "agreement": "40082",
            "mobclixSignature": "", "macAddress": "02:00:00:00:00:00",
        })
        res = self._call("member/initMember3.ds", p)
        if res["code"] != 200 or not res["data"]:
            raise RuntimeError("เข้าเกมไม่สำเร็จ (initMember3): %s" % json.dumps(res, ensure_ascii=False)[:300])
        d = res["data"]
        self.session["session_key"] = d.get("sessionKey")
        self.session["member_seq"] = d.get("memberSeq")
        self.session["lv"] = d.get("lv", 0)
        
        cash_info = d.get("cashInfo") or {}
        point_result = cash_info.get("pointResult") or {}
        gift_count = point_result.get("giftCount", 0)
        self.session["gift_count"] = gift_count

        print("[+] Game loaded | memberSeq = %s | Lv.%s | 🎁 Gift Box Count = %d" % (
            self.session["member_seq"], self.session["lv"], gift_count))
        return d

    def buy_stuff(self, stuff_seq=STUFF_SEQ, price=PRICE, buy_type=BUY_TYPE):
        p = self._envelope("shop/buyStuff.ds", authed=True)
        p.update({
            "stuffSeq": stuff_seq,
            "price": price,
            "buyType": buy_type,
            "memberSeq": self.session["member_seq"],
            "accessToken": self.session["access_token"],
            "loginPlatform": "email",
        })
        return self._call("shop/buyStuff.ds", p)


# ============================================================================
#  PART 3 — Reward & Delta Parser
# ============================================================================
def extract_state(data):
    """Extract account state balance dictionary."""
    if not isinstance(data, dict):
        return {"coin": 0, "gem": 0, "life": 0, "key": 0, "gift_count": 0}
    cash_info = data.get("cashInfo") or {}
    point_result = cash_info.get("pointResult") or {}
    return {
        "coin": data.get("remainderCoin", cash_info.get("coin", 0)),
        "gem": data.get("remainderGem", cash_info.get("gem", 0)),
        "life": data.get("lifeCount", cash_info.get("life", 0)),
        "key": data.get("keyCount", cash_info.get("key", 0)),
        "gift_count": point_result.get("giftCount", data.get("giftCount", 0)),
    }


def parse_round_reward(data, prev_state):
    """Calculate exact reward items and currency deltas received in THIS round."""
    deltas = collections.defaultdict(int)
    if not isinstance(data, dict):
        return deltas, prev_state

    curr_state = extract_state(data)

    coin_diff = curr_state["coin"] - prev_state["coin"]
    gem_diff = curr_state["gem"] - prev_state["gem"]
    life_diff = curr_state["life"] - prev_state["life"]
    key_diff = curr_state["key"] - prev_state["key"]

    if coin_diff > 0:
        deltas["💰 Coin (เหรียญ)"] = coin_diff
    if life_diff > 0:
        deltas["❤️ Life (หัวใจ)"] = life_diff
    if key_diff > 0:
        deltas["🔑 Key (กุญแจ)"] = key_diff
    if gem_diff > 0:
        deltas["💎 Gem (คริสตัล)"] = gem_diff

    # Item rewards
    for list_key in ("rewardList", "itemList", "gotItems", "gachaResultList", "rewards"):
        items = data.get(list_key)
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    name = item.get("name") or item.get("id") or item.get("type") or "Item"
                    qty = item.get("qty") or item.get("count") or item.get("amount") or 1
                    deltas[f"🎁 {name}"] += int(qty)
                elif isinstance(item, str):
                    deltas[f"🎁 {item}"] += 1

    if "resultItem" in data and isinstance(data["resultItem"], str) and data["resultItem"]:
        deltas[f"🎁 {data['resultItem']}"] += 1

    return dict(deltas), curr_state


def format_reward_str(deltas_dict):
    if not deltas_dict:
        return "สุ่มสำเร็จ (เปิดกล่องขวัญฟรี 0 เพชร)"
    parts = []
    for item, qty in deltas_dict.items():
        parts.append(f"{item}: +{qty:,}")
    return " | ".join(parts)


# ============================================================================
#  PART 4 — Main Loop & Summary
# ============================================================================
def main():
    global EMAIL, PASSWORD
    print("============================================================================")
    print("                COOKIE RUN — GIFT DRAW AUTOMATION TOOL")
    print("============================================================================")

    if not EMAIL or EMAIL == "your_email@example.com":
        EMAIL = input("📧 กรอก DevPlay Email: ").strip()
    if not PASSWORD or PASSWORD == "your_password":
        PASSWORD = input("🔑 กรอก DevPlay Password: ").strip()

    if not EMAIL or not PASSWORD:
        raise SystemExit("!! กรุณาระบุ EMAIL และ PASSWORD ให้ถูกต้อง")

    print(f" Target Endpoint : shop/buyStuff.ds")
    print(f" Stuff Seq       : {STUFF_SEQ} (Gift Draw Box)")
    print(f" Price           : {PRICE} Gems (ใช้ 1 กล่องขวัญ / 100 Gift Points)")
    print(f" Delay per Round  : {DELAY_SEC} วินาที")
    print("----------------------------------------------------------------------------")

    if DRY_RUN:
        print("[!] DRY_RUN = True -> สคริปต์จะไม่ยิงสุ่มกล่องจริง หยุดการทำงานไว้ตรงนี้")
        return

    c = GameClient(EMAIL, PASSWORD)
    print("[1/2] กำลังเข้าสู่ระบบ DevPlay...")
    c.login()

    print("[2/2] กำลังโหลดข้อมูลเกม (initMember3)...")
    init_data = c.init_member()

    current_state = extract_state(init_data)
    available_boxes = current_state.get("gift_count", 0)

    print("----------------------------------------------------------------------------")
    if available_boxes > 0:
        print(f" 🎁 พบสิทธิ์สุ่ม Gift Draw คงเหลือในไอดีทั้งหมด : {available_boxes} กล่อง")
        prompt_msg = f" ❓ ต้องการเปิดกี่กล่อง? [กด Enter เพื่อเปิดทั้งหมด {available_boxes} กล่อง]: "
    else:
        print(" ⚠️  ไม่พบสิทธิ์สุ่มคงเหลือในไอดี (หรือใช้การเปิดแบบระบุจำนวน)")
        prompt_msg = " ❓ ต้องการเปิดกี่กล่อง? [กด Enter เพื่อใช้ค่าเริ่มต้น 10 กล่อง]: "

    try:
        user_input = input(prompt_msg).strip()
        if not user_input:
            target_count = available_boxes if available_boxes > 0 else 10
        else:
            target_count = int(user_input)
    except (ValueError, KeyboardInterrupt):
        target_count = available_boxes if available_boxes > 0 else 10

    if target_count <= 0:
        print(" [!] ยกเลิกการเปิดกล่อง (จำนวนกล่องที่เลือกเป็น 0)")
        return

    print(f"\n 🚀 ตกลง! เริ่มทำการเปิดกล่องจำนวน {target_count} รอบ...")

    print("\n----------------------------------------------------------------------------")
    print("                    เริ่มทำการสุ่มเปิดกล่อง GIFT DRAW (ฟรี 0 เพชร)")
    print("----------------------------------------------------------------------------")

    successful_draws = 0
    failed_draws = 0
    start_time = time.time()
    total_gains = collections.defaultdict(int)

    for i in range(1, target_count + 1):
        res = c.buy_stuff(stuff_seq=STUFF_SEQ, price=PRICE, buy_type=BUY_TYPE)
        code = res.get("code")
        msg = res.get("message", "")
        data = res.get("data")

        if code == 200:
            successful_draws += 1
            round_deltas, current_state = parse_round_reward(data, current_state)
            for k, v in round_deltas.items():
                total_gains[k] += v

            reward_text = format_reward_str(round_deltas)
            print(f"  [{i:02d}/{target_count}] ✅ สุ่มสำเร็จ! ➔ {reward_text}")
        else:
            failed_draws += 1
            print(f"  [{i:02d}/{target_count}] ❌ สุ่มไม่สำเร็จ (Code: {code}): {msg}")

        if i < target_count and DELAY_SEC > 0:
            time.sleep(DELAY_SEC)

    elapsed_time = time.time() - start_time

    # ============================================================================
    #  SUMMARY REPORT
    # ============================================================================
    print("\n============================================================================")
    print("                       สรุปผลการสุ่มรวม (SUMMARY REPORT)")
    print("============================================================================")
    print(f" ⏱️  เวลาที่ใช้ไปทั้งหมด : {elapsed_time:.2f} วินาที (เฉลี่ย {elapsed_time / max(target_count, 1):.2f} วินาที/รอบ)")
    print(f" 🎯  เปิดสำเร็จ         : {successful_draws}/{target_count} รอบ")
    if failed_draws > 0:
        print(f" ⚠️  เปิดไม่สำเร็จ       : {failed_draws} รอบ")
    print("----------------------------------------------------------------------------")
    print(" 🎁  สรุปรางวัลสุทธิทั้งหมดที่เปิดได้เพิ่มจริง (NET GAINS):")

    if total_gains:
        for item, qty in sorted(total_gains.items(), key=lambda x: x[1], reverse=True):
            print(f"     • {item:<25} : +{qty:,}")
    else:
        print("     • อัปเดตสถานะไอดีเรียบร้อย (ไม่เสียเพชร)")

    print("\n 📌  สถานะยอดคงเหลือล่าสุดในคลัง:")
    print(f"     • 💰 Coin คงเหลือ    : {current_state.get('coin', 0):,} เหรียญ")
    print(f"     • 💎 Gem คงเหลือ     : {current_state.get('gem', 0):,} เม็ด (ไม่ลด)")
    print(f"     • ❤️ Life คงเหลือ    : {current_state.get('life', 0):,} ดวง")
    print(f"     • 🔑 Key คงเหลือ     : {current_state.get('key', 0):,} ดอก")
    print(f"     • 🎁 Gift Box คงเหลือ: {current_state.get('gift_count', 0):,} กล่อง")
    print("============================================================================")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        print(e)
    except KeyboardInterrupt:
        print("\n[!] หยุดการทำงานโดยผู้ใช้ (Ctrl+C)")
    except Exception as e:
        print(f"\n[!] เกิดข้อผิดพลาด: {e}")
