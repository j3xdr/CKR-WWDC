"""
============================================================================
 Cookie Run — MAGIC POWDER FARM  (standalone, single-file edition)
============================================================================
 What this does: repeatedly buys a "Lv.8 treasure" (a bonus item you unlock
 once a cookie/pet reaches level 8) with coins, then immediately extracts
 (dismantles) it for magic powder + shard, over and over. Since you have
 way more coin than powder in this game, this converts your coin pile into
 powder automatically.

 REQUIREMENT: you must already own the treasure's owning cookie/pet at
 LEVEL 8. If you don't, the game will refuse the purchase with a clear
 error message (this script will tell you exactly that).

 This is a STANDALONE, single-file version -- no other project files
 needed, just this .py + treasure.json sitting next to it. Everything
 (the network protocol codec, the login/session logic, the farm loop) is
 self-contained in this one file.

 SETUP (one time):
   1. Install Python 3.9+ (https://python.org) if you don't have it.
   2. Open a terminal in this folder and run:
        pip install -r requirements.txt
   3. Edit the CONFIG block below: put in YOUR OWN DevPlay email/password,
      pick a treasure name (or leave blank for the default), and set how
      much powder you want.
   4. Run:
        python powder_farm.py

 See README.md in this folder for more detail / troubleshooting.
============================================================================
"""

# ===========================  CONFIG — EDIT ME  ============================
EMAIL    = "your_email@example.com"     # your DevPlay/Cookie Run login email
PASSWORD = "your_password"              # your DevPlay/Cookie Run login password

TREASURE_NAME = ""            # full treasure name, e.g. "Holy Feather" -- case
                               # insensitive, must match treasure.json exactly.
                               # Leave "" to use the default: "Revival Boots"
                               # (Pirate Cookie's Lv.8 treasure).
                               # You must own that treasure's cookie/pet at Lv.8.

POWDER_TARGET  = 10000         # stop once you've gained this much powder (from 0
                                # at script start). Set to None to ignore this and
                                # just run MAX_LOOPS times instead.
MAX_LOOPS      = 999999        # safety ceiling on how many buy+extract rounds to
                                # run (only matters if POWDER_TARGET is None, or
                                # as a hard backstop either way).
PRINT_EVERY    = 5             # print a progress line every N rounds
DRY_RUN        = False         # True = just show the plan (treasure/price found)
                                # and stop -- makes no purchases, sends nothing.
# ===========================================================================

import os
import sys
import io
import json
import time
import base64
import random
import string
import struct
import re
import copy
import uuid
import contextlib
import urllib.request
import urllib.error

import requests
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
TREASURE_JSON = os.path.join(HERE, "treasure.json")


# ============================================================================
#  PART 1 — DS protocol codec (ChaCha20 + FastLZ + urlsafe-base64)
#  Every request/response body to the game server is encrypted+compressed
#  this way. This is a faithful, verified reimplementation -- you don't need
#  to understand it to use the script, it's just plumbing.
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
#  PART 2 — App/client identity (static; every real Cookie Run client sends
#  the same app-level values) + a FRESH per-run device fingerprint (random
#  IDs, like a newly-installed app would have -- so this script doesn't
#  reuse the exact same device identity every run).
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


# item ids look like "groupSeq:tag@uuid" -- compiled once, reused everywhere.
_ID_RE = re.compile(r"(\d+):(\d+)@(.+)")


def _rand_uuid():
    return str(uuid.uuid4())


def fresh_lc():
    """A fresh device identity so this script doesn't reuse one fixed
    fingerprint across every run/every friend who uses it."""
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


def _jwt_payload(tok):
    try:
        p = tok.split(".")[1]
        p += "=" * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p))
    except Exception:
        return {}


# ============================================================================
#  PART 3 — minimal DS client: login, session, and the two calls we need
#  (buyStuff, breakStuff). No files are ever written to disk by this client.
# ============================================================================
class GameClient:
    def __init__(self, email, password):
        self.email = email
        self.password = password
        self.lc = fresh_lc()
        self.mid = ""
        self.session = {}
        self.http = requests.Session()

    def _gen_ms(self):
        """`ms` is NOT a timestamp -- it's a memberSeq-derived pseudo-random
        value the real client sends; a wrong value causes a 504 error."""
        try:
            ms_seq = int(self.session.get("member_seq") or 0)
        except (TypeError, ValueError):
            ms_seq = 0
        ms_seq &= 0xFFFFFFFF
        if ms_seq >= 0x80000000:
            ms_seq -= 0x100000000
        divisor = (ms_seq % 1000) + 3
        return (random.randint(0, 999) + 3) * divisor

    # -- login ---------------------------------------------------------
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
            raise RuntimeError("เข้าสู่ระบบไม่สำเร็จ: %s\n%s" % (msg, json.dumps(d, ensure_ascii=False)[:300]))
        member = d.get("member") or {}
        self.mid = member.get("mid") or self.mid
        self.session["access_token"] = tok
        print("[+] login OK  mid=%s  (token exp in %ds)" % (
            self.mid, int(_jwt_payload(tok).get("exp", 0) - time.time())))

    # -- envelope + low-level call --------------------------------------
    def _envelope(self, pid, authed=True):
        lc = self.lc
        env = {
            "pid": pid,
            "currentLv": self.session.get("lv", 0) if authed else 0,
            "socialUidCommon": self.mid if authed else "NULL",
            "ver": lc["app_version"], "buildVer": lc["app_build"], "cc": "US",
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
        print("[+] account loaded  memberSeq=%s  lv=%s" % (self.session["member_seq"], self.session["lv"]))
        return d

    def buy_stuff(self, stuff_seq, price, buy_type=0):
        p = self._envelope("shop/buyStuff.ds", authed=True)
        p.update({
            "stuffSeq": stuff_seq, "price": price, "buyType": buy_type,
            "memberSeq": self.session["member_seq"], "accessToken": self.session["access_token"],
            "loginPlatform": "email",
        })
        return self._call("shop/buyStuff.ds", p)

    def break_stuff(self, item_list, powder_qty, shard_qty):
        p = self._envelope("shop/breakStuff.ds", authed=True)
        p.update({
            "memberSeq": self.session["member_seq"], "itemList": item_list,
            "powderQty": powder_qty, "shardQty": shard_qty,
            "accessToken": self.session["access_token"],
        })
        return self._call("shop/breakStuff.ds", p)


# ============================================================================
#  PART 4 — treasure lookup (data/treasure.json, sitting next to this file)
# ============================================================================
DEFAULT_TREASURE = "Revival Boots"


def load_treasures():
    if not os.path.exists(TREASURE_JSON):
        raise SystemExit("!! treasure.json not found next to powder_farm.py -- "
                          "make sure you copied BOTH files together.")
    return json.load(open(TREASURE_JSON, encoding="utf-8"))


def resolve_treasure(name):
    """Case-insensitive exact match against treasure.json's "name" field.
    Empty/None -> DEFAULT_TREASURE (Revival Boots)."""
    target = (name or DEFAULT_TREASURE).strip().lower()
    for t in load_treasures():
        if t.get("name", "").strip().lower() == target:
            if not t.get("price") or t.get("powder_yield_lv1") is None:
                raise SystemExit("!! %r has no price/yield data in treasure.json -- pick a different one." % t["name"])
            return t
    raise SystemExit(
        "!! ไม่พบ treasure ชื่อ %r ใน treasure.json\n"
        "   ต้องพิมพ์ full name ให้ตรงเป๊ะ (ตัวพิมพ์เล็ก/ใหญ่ไม่เป็นไร) เช่น "
        "\"Holy Feather\", \"Revival Boots\" -- เปิด treasure.json ดูชื่อทั้งหมดได้" % name)


def owned_instance(init, group_seq):
    """Do we already hold this treasure? id format is "groupSeq:tag@uuid"."""
    for x in init.get("inventoryItemList", []):
        m = _ID_RE.match(x["id"])
        if m and int(m.group(1)) == group_seq:
            return {"groupSeq": group_seq, "tag": int(m.group(2)), "uuid": m.group(3), "raw": x["id"]}
    return None


def _friendly_buy_error(code, msg, name):
    m = str(msg or "")
    if code == 504 and "max level" in m.lower():
        return ("ต้องมีคุกกี้/เพ็ทเจ้าของสมบัติ \"%s\" ที่เลเวลสูงสุด (Lv.8) ก่อนถึงจะซื้อสมบัตินี้ได้ "
                "ลองเลือก treasure อื่นที่คุณมีคุกกี้/เพ็ท Lv.8 อยู่แล้ว" % name)
    if code == 321 or "already owned" in m.lower():
        return "มีสมบัติชิ้นนี้อยู่แล้ว (ระบบจะย่อยให้อัตโนมัติในรอบถัดไป) -- ลองรันใหม่อีกครั้ง"
    if code == 310:
        return "ราคาที่ส่งไปไม่ตรงกับที่เซิร์ฟเวอร์คาดไว้ (treasure.json อาจไม่อัปเดตตามเกมเวอร์ชันล่าสุด)"
    return "เซิร์ฟเวอร์ปฏิเสธการซื้อ (code %s) %s" % (code, m)


# ============================================================================
#  PART 5 — the farm loop
# ============================================================================
def main():
    print("==========================================================================")
    print("           Cookie Run — MAGIC POWDER FARM (Interactive Mode)              ")
    print("==========================================================================")
    print(" /*** คำเตือนสำคัญ ***/")
    print(" /*** ไอดีต้องเคยมีสมบัติรองเท้าโจรสลัด (Revival Boots / สมบัติคุกกี้รสโจรสลัด Lv.8)")
    print(" /*** และย่อยทิ้งแล้ว ถึงจะใช้งานสคริปต์นี้ได้!")
    print("==========================================================================\n")

    global EMAIL, PASSWORD

    # 1. DevPlay Login Prompts
    email_input = input("Enter DevPlay Email [%s]: " % (EMAIL if EMAIL != "your_email@example.com" else "")).strip()
    if email_input:
        EMAIL = email_input
    elif EMAIL in ("", "your_email@example.com"):
        EMAIL = input("DevPlay Email (Required): ").strip()

    pass_input = input("Enter DevPlay Password: ").strip()
    if pass_input:
        PASSWORD = pass_input
    elif PASSWORD in ("", "your_password"):
        PASSWORD = input("DevPlay Password (Required): ").strip()

    if not EMAIL or not PASSWORD:
        raise SystemExit("!! Error: DevPlay email and password are required.")

    # 2. Treasure Resolution
    treasure = resolve_treasure(TREASURE_NAME)
    name = treasure["name"]
    group = treasure["group_seq"]
    buy_seq = treasure.get("buy_stuff_seq") or (group + 1)
    price = treasure["price"]
    powder_q = treasure["powder_yield_lv1"]
    shard_q = treasure.get("shard_yield_lv1") or 0

    # 3. Authenticate & Check Balance
    print("\n[+] Logging in to DevPlay account...")
    c = GameClient(EMAIL, PASSWORD)
    c.login()
    init = c.init_member()
    coin = init.get("coin", 0)
    powder0 = (init.get("cashInfo") or {}).get("powder") or 0

    max_affordable_runs = coin // price if price > 0 else 0
    max_affordable_powder = max_affordable_runs * powder_q

    print("\n==========================================================================")
    print(" [ ACCOUNT BALANCE INFO ]")
    print("  - สมบัติที่ใช้: %s (ราคา %d coin/รอบ)" % (name, price))
    print("  - อัตราแลกเปลี่ยน: 1 ครั้ง = %d ผงเวทมนตร์ = %d coins" % (powder_q, price))
    print("  - เงินในบัญชีปัจจุบัน: %s coins" % f"{coin:,}")
    print("  - จำนวนผงเดิมในบัญชี: %s" % f"{powder0:,}")
    print("  - คุณสามารถรันได้สูงสุด: %d ครั้ง (%s ผงเวทมนตร์)" % (max_affordable_runs, f"{max_affordable_powder:,}"))
    print("==========================================================================\n")

    if max_affordable_runs <= 0:
        raise SystemExit("!! เงินในบัญชีไม่พอสำหรับรัน 1 ครั้ง (ต้องการอย่างน้อย %d coins)" % price)

    # 4. Prompt for Run Count with Validation Loop
    target_runs = 0
    while True:
        try:
            user_input = input("กรุณาใส่จำนวนครั้งที่ต้องการรัน [1-%d ครั้ง]: " % max_affordable_runs).strip()
            if not user_input.isdigit():
                print("!! กรุณากรอกเฉพาะตัวเลขเท่านั้น\n")
                continue
            
            val = int(user_input)
            if val <= 0:
                print("!! กรุณาใส่จำนวนครั้งมากกว่า 0\n")
                continue
            if val > max_affordable_runs:
                needed_coin = val * price
                print("!! เงินในบัญชีไม่พอสำหรับ %d ครั้ง (ต้องใช้ %s coins แต่มี %s coins)" 
                      % (val, f"{needed_coin:,}", f"{coin:,}"))
                print("!! กรุณาใส่จำนวนครั้งใหม่ให้ไม่เกิน %d ครั้ง\n" % max_affordable_runs)
                continue
            
            target_runs = val
            break
        except KeyboardInterrupt:
            raise SystemExit("\nยกเลิกโดยผู้ใช้")

    expected_cost = target_runs * price
    expected_powder = target_runs * powder_q

    print("\n[+] สรุปแผนการรัน:")
    print("  - จำนวนที่ต้องการรัน: %d ครั้ง" % target_runs)
    print("  - จะได้รับผงเวทมนตร์เพิ่ม: +%s ผง" % f"{expected_powder:,}")
    print("  - ค่าใช้จ่ายเหรียญรวม: -%s coins" % f"{expected_cost:,}")
    print("  - เหรียญคงเหลือโดยประมาณ: %s coins" % f"{(coin - expected_cost):,}")
    print("==========================================================================\n")

    # Final confirmation before spending any coins. Nothing is bought/extracted
    # until the user explicitly agrees to the cost/powder shown above.
    confirm = input("ยืนยันเริ่มรัน %d รอบ (เสีย %s coin, ได้ +%s ผง)? [y/N]: "
                    % (target_runs, f"{expected_cost:,}", f"{expected_powder:,}")).strip().lower()
    if confirm not in ("y", "yes"):
        raise SystemExit("ยกเลิกการรัน -- ยังไม่มีการซื้อ/ย่อยใดๆ เกิดขึ้น (ไม่เสีย coin)")

    inst = owned_instance(init, group)

    def quiet(fn, *a, **k):
        with contextlib.redirect_stdout(io.StringIO()):
            return fn(*a, **k)

    t0 = time.time()
    gained = 0
    done = 0

    for i in range(1, target_runs + 1):
        if not inst:
            rb = quiet(c.buy_stuff, buy_seq, price)
            if rb.get("code") != 200:
                print("\n[%d/%d] ซื้อไม่สำเร็จ: %s" % (i, target_runs, _friendly_buy_error(rb.get("code"), rb.get("message"), name)))
                break
            d = rb.get("data") or {}
            coin = d.get("remainderCoin", coin)
            result_id = d.get("resultItem") or ""
            m = _ID_RE.match(result_id)
            inst = {"groupSeq": int(m.group(1)), "tag": int(m.group(2)), "uuid": m.group(3)} if m else None
            if not inst:
                print("\n[%d/%d] ซื้อสำเร็จแต่หาไอเทมไม่เจอ กรุณาลองใหม่" % (i, target_runs))
                break

        rk = quiet(c.break_stuff, [inst], powder_q, shard_q)
        if rk.get("code") != 200:
            print("\n[%d/%d] ย่อยไม่สำเร็จ: เซิร์ฟเวอร์ปฏิเสธ (code %s) %s" % (i, target_runs, rk.get("code"), rk.get("message")))
            break
        gained += powder_q
        inst = None
        done = i
        if i % PRINT_EVERY == 0 or i == target_runs:
            print("[%d/%d] +%d powder  gained=%s/%s  coin~%s  (%.2fs/round)"
                  % (i, target_runs, powder_q, f"{gained:,}", f"{expected_powder:,}", f"{coin:,}", (time.time() - t0) / i))

    dt = time.time() - t0
    print("\nDONE: ทำงานเสร็จสิ้น %d/%d รอบ ในเวลา %.1fs (เฉลี่ย %.2fs/รอบ)" % (done, target_runs, dt, dt / max(done, 1)))
    print("  - ได้รับผงเพิ่มทั้งหมด: +%s powder (ผงรวมในบัญชี: %s -> %s)" % (f"{gained:,}", f"{powder0:,}", f"{(powder0 + gained):,}"))
    print("  - เหรียญคงเหลือล่าสุด: %s coins" % f"{coin:,}")


if __name__ == "__main__":
    try:
        main()
    except SystemExit as e:
        print(e)
    except KeyboardInterrupt:
        print("\nหยุดโดยผู้ใช้ (Ctrl+C)")
    except Exception as e:
        print("\n!! เกิดข้อผิดพลาด: %s" % e)
