"""CKR WWDC API — FastAPI farm backend (no HTML UI)."""
from __future__ import annotations

import asyncio
import os
import re
import sys
import threading
import time
import traceback
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

ROOT = Path(__file__).resolve().parent.parent
SERVER_DIR = Path(__file__).resolve().parent
FARM_DIR = SERVER_DIR / "farm"

if str(FARM_DIR) not in sys.path:
    sys.path.insert(0, str(FARM_DIR))
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import farm_queue as fq  # noqa: E402
import topup_packages as topup_pkg  # noqa: E402
from tmn_voucher import TmnVoucherClient, extract_voucher_code  # noqa: E402


def _load_dotenv() -> None:
    """Load CKR WWDC/.env into os.environ if present (local preview)."""
    env_path = ROOT / ".env"
    if not env_path.is_file():
        return
    try:
        for line in env_path.read_text(encoding="utf-8").splitlines():
            s = line.strip()
            if not s or s.startswith("#") or "=" not in s:
                continue
            key, _, val = s.partition("=")
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val
    except OSError:
        pass


_load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
TRUEWALLET_PHONE = os.environ.get("TRUEWALLET_PHONE", "").strip()

# Sequential farm queue (Render Free = single instance)
_farm_lock = threading.Lock()
_farm_busy = False

# Public signup rate limit (in-memory; fine on Render Free single instance)
_signup_hits: dict[str, list[float]] = {}
_SIGNUP_LIMIT = 5
_SIGNUP_WINDOW_SEC = 3600

# Account peek rate limit per user (in-memory)
_peek_last_ts: dict[str, float] = {}
_PEEK_COOLDOWN_SEC = 180

# Top-up redeem rate limits (in-memory)
_topup_hits: dict[str, list[float]] = {}
_topup_ip_hits: dict[str, list[float]] = {}
_topup_voucher_fails: dict[str, list[float]] = {}
_TOPUP_LIMIT = 10
_TOPUP_IP_LIMIT = 20
_TOPUP_WINDOW_SEC = 3600
_TOPUP_VOUCHER_FAIL_LIMIT = 3
_TOPUP_VOUCHER_FAIL_WINDOW_SEC = 900

TMN_CODE_TH = {
    "CONDITION_NOT_MET": "ยอดซองไม่ตรงกับแพ็กที่เลือก",
    "VOUCHER_OUT_OF_STOCK": "ซองนี้ถูกใช้หมดแล้ว",
    "VOUCHER_NOT_FOUND": "ไม่พบซองนี้",
    "VOUCHER_EXPIRED": "ซองหมดอายุแล้ว",
    "CANNOT_GET_OWN_VOUCHER": "รับซองของตัวเองไม่ได้ — ต้องให้ลูกค้าสร้างซอง",
    "TARGET_USER_REDEEMED": "เบอร์นี้รับซองนี้ไปแล้ว",
    "INVALID_VOUCHER_CODE": "ลิงก์หรือโค้ดซองไม่ถูกต้อง",
    "INVALID_PHONE_NUMBER": "เบอร์รับเงินไม่ถูกต้อง",
    "MAINTENANCE": "ระบบซองอั่งเปาปิดปรับปรุงชั่วคราว",
    "TIMEOUT": "เชื่อมต่อ TrueMoney หมดเวลา",
    "NETWORK_ERROR": "เชื่อมต่อ TrueMoney ไม่ได้",
    "topup_rate_limited": "เติมถี่เกินไป รอสักครู่แล้วลองใหม่",
    "topup_voucher_blocked": "ซองนี้ถูกลองผิดหลายครั้ง รอสักครู่แล้วลองใหม่",
    "topup_credit_failed": "รับซองแล้วแต่เติมโทเค็นไม่สำเร็จ — ติดต่อแอดมิน",
    "voucher_already_used": "ซองนี้ถูกใช้เติมไปแล้ว",
    "invalid_package": "แพ็กที่เลือกไม่ถูกต้อง",
    "topup_not_configured": "ระบบเติมเงินยังไม่พร้อม",
}

ALLOWED_ORIGINS = [
    "https://j3xdr.github.io",
    # local previews (Live Preview / Simple Browser / python http.server)
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5179",
    "http://127.0.0.1:5179",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:8765",
    "http://127.0.0.1:8765",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]


def _require_env() -> None:
    missing = [k for k, v in {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_ANON_KEY": SUPABASE_ANON_KEY,
    }.items() if not v]
    if missing:
        print(f"[warn] missing env: {', '.join(missing)}")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _require_env()
    yield


app = FastAPI(title="CKR WWDC API", version="1.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class LoginBody(BaseModel):
    username: str = Field(min_length=2, max_length=128)
    password: str = Field(min_length=1)


class FarmRunBody(BaseModel):
    # DevPlay login id — keep as str (not EmailStr) so unusual accounts still reach the farm core
    email: str = Field(min_length=3, max_length=256)
    password: str = Field(min_length=1)
    score: int = Field(default=0, ge=0, le=2_147_483_647)
    coin: int = Field(default=0, ge=0, le=2_147_483_647)
    exp: int = Field(default=0, ge=0, le=2_147_483_647)

    @field_validator("email")
    @classmethod
    def _trim_email(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("email_required")
        return s


# Conservative soft caps (not official game limits) — reduce corrupt_pending risk
FARM_SOFT_CAP_COIN = 50_000
FARM_SOFT_CAP_EXP = 5_000
BKK = ZoneInfo("Asia/Bangkok")


class PeekBody(BaseModel):
    email: str = Field(min_length=3, max_length=256)
    password: str = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def _trim_email(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("email_required")
        return s


class TopupRedeemBody(BaseModel):
    voucher: str = Field(min_length=4, max_length=2048)
    package_tokens: int = Field(ge=1, le=10)

    @field_validator("voucher")
    @classmethod
    def _trim_voucher(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("voucher_required")
        return s


class TopupVerifyBody(BaseModel):
    voucher: str = Field(min_length=4, max_length=2048)
    package_tokens: int = Field(ge=1, le=10)

    @field_validator("voucher")
    @classmethod
    def _trim_voucher(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("voucher_required")
        return s


class AdminCreateUserBody(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6)
    initial_tokens: int = Field(default=0, ge=0, le=1_000_000)


class RegisterBody(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=6)
    confirm_password: str = Field(min_length=6)


class AdminAddTokensBody(BaseModel):
    query: str = Field(min_length=2, description="username (or legacy email)")
    amount: int = Field(ge=1, le=1_000_000)
    reason: str = "admin_credit"


class AdminSetTokensBody(BaseModel):
    user_id: str = Field(min_length=8, description="profiles.id / auth user uuid")
    token_balance: int = Field(ge=0, le=1_000_000)
    reason: str = "admin_set"


class AdminBanBody(BaseModel):
    reason: str = Field(default="", max_length=500)


class AdminSettingsBody(BaseModel):
    farm_maintenance: Optional[bool] = None
    topup_maintenance: Optional[bool] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _sb_headers(key: str, jwt: Optional[str] = None) -> dict[str, str]:
    return {
        "apikey": key,
        "Authorization": f"Bearer {jwt or key}",
        "Content-Type": "application/json",
    }


def _has_service_role() -> bool:
    key = (SUPABASE_SERVICE_ROLE_KEY or "").strip()
    if not key or key.startswith("REPLACE"):
        return False
    return len(key) > 20


def _service_headers() -> dict[str, str]:
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")
    return _sb_headers(SUPABASE_SERVICE_ROLE_KEY)


def _synthetic_email(username: str) -> str:
    """Internal Auth email — never shown as a customer-facing field."""
    raw = (username or "").strip().lower()
    safe = re.sub(r"[^a-z0-9._+-]+", "_", raw).strip("._+-")
    if not safe:
        safe = "user"
    if len(safe) > 64:
        safe = safe[:64]
    return f"{safe}@users.ckr.local"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip() or "unknown"
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def _check_signup_rate(ip: str) -> None:
    now = time.time()
    hits = [t for t in _signup_hits.get(ip, []) if now - t < _SIGNUP_WINDOW_SEC]
    if len(hits) >= _SIGNUP_LIMIT:
        raise HTTPException(status_code=429, detail="signup_rate_limited")
    hits.append(now)
    _signup_hits[ip] = hits


def _check_topup_rate(user_id: str, ip: str, voucher_code: str) -> None:
    now = time.time()
    code_key = (voucher_code or "").strip().lower()
    if code_key:
        fails = [
            t
            for t in _topup_voucher_fails.get(code_key, [])
            if now - t < _TOPUP_VOUCHER_FAIL_WINDOW_SEC
        ]
        _topup_voucher_fails[code_key] = fails
        if len(fails) >= _TOPUP_VOUCHER_FAIL_LIMIT:
            print(f"[topup] voucher blocked code={code_key[:12]}… fails={len(fails)}")
            raise HTTPException(status_code=429, detail="topup_voucher_blocked")

    hits = [t for t in _topup_hits.get(user_id, []) if now - t < _TOPUP_WINDOW_SEC]
    if len(hits) >= _TOPUP_LIMIT:
        print(f"[topup] user rate limited uid={user_id}")
        raise HTTPException(status_code=429, detail="topup_rate_limited")
    hits.append(now)
    _topup_hits[user_id] = hits

    ip_key = ip or "unknown"
    ip_hits = [t for t in _topup_ip_hits.get(ip_key, []) if now - t < _TOPUP_WINDOW_SEC]
    if len(ip_hits) >= _TOPUP_IP_LIMIT:
        print(f"[topup] ip rate limited ip={ip_key}")
        raise HTTPException(status_code=429, detail="topup_rate_limited")
    ip_hits.append(now)
    _topup_ip_hits[ip_key] = ip_hits


def _record_topup_voucher_fail(voucher_code: str) -> None:
    code_key = (voucher_code or "").strip().lower()
    if not code_key:
        return
    now = time.time()
    fails = [
        t
        for t in _topup_voucher_fails.get(code_key, [])
        if now - t < _TOPUP_VOUCHER_FAIL_WINDOW_SEC
    ]
    fails.append(now)
    _topup_voucher_fails[code_key] = fails


def _tmn_http_status(code: str) -> int:
    if code in ("TIMEOUT", "NETWORK_ERROR", "HTTP_ERROR_UNKNOWN", "INVALID_JSON_RESPONSE"):
        return 502
    if code == "MAINTENANCE":
        return 503
    if code in ("topup_rate_limited", "topup_voucher_blocked"):
        return 429
    return 400


def _tmn_public_detail(code: str) -> dict[str, str]:
    return {
        "code": code,
        "message": TMN_CODE_TH.get(code, "เติมโทเค็นไม่สำเร็จ"),
    }


def _wallet_phone() -> str:
    phone = (TRUEWALLET_PHONE or os.environ.get("TRUEWALLET_PHONE", "")).strip()
    if not phone:
        raise HTTPException(status_code=503, detail="topup_not_configured")
    return phone


async def _set_session_token(user_id: str) -> str:
    token = str(uuid.uuid4())
    if not _has_service_role():
        return token
    async with httpx.AsyncClient(timeout=20.0) as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{user_id}"},
            headers={**_service_headers(), "Prefer": "return=minimal"},
            json={"session_token": token},
        )
    return token


async def _write_audit(
    actor_id: Optional[str],
    action: str,
    target_user_id: Optional[str] = None,
    meta: Optional[dict[str, Any]] = None,
) -> None:
    if not _has_service_role():
        return
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.post(
                f"{SUPABASE_URL}/rest/v1/admin_audit_log",
                headers={**_service_headers(), "Prefer": "return=minimal"},
                json={
                    "actor_id": actor_id,
                    "action": action,
                    "target_user_id": target_user_id,
                    "meta": meta or {},
                },
            )
    except Exception as e:
        print(f"[audit] write failed: {e}")


def _as_bool_json(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return False


async def _read_app_settings(keys: list[str]) -> dict[str, Any]:
    out: dict[str, Any] = {k: False for k in keys}
    if not keys or not SUPABASE_URL:
        return out
    headers = None
    if _has_service_role():
        headers = _service_headers()
    elif SUPABASE_ANON_KEY:
        headers = _sb_headers(SUPABASE_ANON_KEY)
    if not headers:
        return out
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/app_settings",
            headers={**headers, "Accept": "application/json"},
            params={
                "key": f"in.({','.join(keys)})",
                "select": "key,value",
            },
        )
    if r.status_code != 200:
        return out
    for row in r.json() or []:
        k = row.get("key")
        if k in out:
            out[k] = _as_bool_json(row.get("value"))
    return out


async def _require_farm_open() -> None:
    flags = await _read_app_settings(["farm_maintenance"])
    if flags.get("farm_maintenance"):
        raise HTTPException(status_code=503, detail="maintenance")


async def _require_topup_open() -> None:
    flags = await _read_app_settings(["topup_maintenance"])
    if flags.get("topup_maintenance"):
        raise HTTPException(status_code=503, detail="maintenance")


def _reject_if_banned(profile: dict[str, Any]) -> None:
    if profile.get("banned_at"):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "account_banned",
                "message": "account_banned",
                "reason": profile.get("ban_reason") or "",
            },
        )


def _enforce_farm_soft_caps(coin: int, exp: int) -> None:
    if int(coin) > FARM_SOFT_CAP_COIN or int(exp) > FARM_SOFT_CAP_EXP:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "value_capped",
                "message": "value_capped",
                "max_coin": FARM_SOFT_CAP_COIN,
                "max_exp": FARM_SOFT_CAP_EXP,
            },
        )


def _bkk_day_bounds(date_str: Optional[str] = None) -> tuple[str, str, str]:
    """Return (date_label, start_utc_iso, end_utc_iso) for Asia/Bangkok calendar day."""
    if date_str:
        day = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=BKK)
    else:
        day = datetime.now(BKK).replace(hour=0, minute=0, second=0, microsecond=0)
    start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=1)
    return (
        start.strftime("%Y-%m-%d"),
        start.astimezone(timezone.utc).isoformat(),
        end.astimezone(timezone.utc).isoformat(),
    )


def _validate_public_username(username: str) -> str:
    """Normalize + reject reserved / email-like usernames for public signup."""
    username = (username or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="username_required")
    lower = username.lower()
    if "@" in username:
        raise HTTPException(status_code=400, detail="invalid_username")
    if lower.endswith("@users.ckr.local") or lower.endswith("@ckr.local"):
        raise HTTPException(status_code=400, detail="invalid_username")
    return username


async def _create_normal_user(
    username: str,
    password: str,
    *,
    initial_tokens: int = 0,
    created_by: Optional[str] = None,
) -> dict[str, Any]:
    """Create Auth user + normal profile. Returns id/username/token_balance/auth_email."""
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")

    username = username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username_required")

    lower = username.lower()
    if lower.endswith("@users.ckr.local") or lower.endswith("@ckr.local"):
        raise HTTPException(status_code=400, detail="invalid_username")

    auth_email = _synthetic_email(username)

    async with httpx.AsyncClient(timeout=30.0) as client:
        exists = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_lookup_user",
            headers=_service_headers(),
            json={"p_query": username},
        )
        if exists.status_code == 200 and (exists.json() or {}).get("ok"):
            raise HTTPException(status_code=409, detail="username_taken")

        cr = await client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=_service_headers(),
            json={
                "email": auth_email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {
                    "username": username,
                    "display_name": username,
                },
            },
        )
        if cr.status_code not in (200, 201):
            raise HTTPException(status_code=400, detail=cr.text)
        created = cr.json()
        uid = created.get("id")
        if not uid:
            raise HTTPException(status_code=500, detail="create_user_no_id")

        await client.patch(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{uid}"},
            headers={**_service_headers(), "Prefer": "return=representation"},
            json={
                "email": auth_email,
                "username": username,
                "display_name": username,
                "role": "normal",
                "token_balance": initial_tokens,
            },
        )

        if initial_tokens > 0:
            await client.post(
                f"{SUPABASE_URL}/rest/v1/token_ledger",
                headers={**_service_headers(), "Prefer": "return=minimal"},
                json={
                    "user_id": uid,
                    "delta": initial_tokens,
                    "reason": "initial_grant",
                    "balance_after": initial_tokens,
                    "created_by": created_by,
                },
            )

    return {
        "id": uid,
        "username": username,
        "token_balance": initial_tokens,
        "auth_email": auth_email,
    }


async def verify_user(
    authorization: Optional[str] = Header(None),
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing_bearer_token")
    token = authorization.split(" ", 1)[1].strip()
    if not token or not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=401, detail="auth_not_configured")

    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers=_sb_headers(SUPABASE_ANON_KEY, token),
        )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="invalid_token")
        user = r.json()
        user["_access_token"] = token

        uid = user.get("id")
        if uid:
            pr = await client.get(
                f"{SUPABASE_URL}/rest/v1/profiles",
                params={"id": f"eq.{uid}", "select": "id,session_token,role"},
                headers={
                    **_sb_headers(SUPABASE_ANON_KEY, token),
                    "Accept": "application/json",
                },
            )
            if pr.status_code == 200 and pr.json():
                row = pr.json()[0]
                expected = (row.get("session_token") or "").strip()
                provided = (x_session_token or "").strip()
                if expected and provided != expected:
                    raise HTTPException(status_code=401, detail="session_replaced")
                user["_session_token"] = expected or provided
    return user


async def load_profile(user: dict[str, Any]) -> dict[str, Any]:
    uid = user["id"]
    token = user["_access_token"]
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{uid}", "select": "*"},
            headers={
                **_sb_headers(SUPABASE_ANON_KEY, token),
                "Accept": "application/json",
            },
        )
    if r.status_code != 200 or not r.json():
        raise HTTPException(status_code=403, detail="profile_missing")
    profile = r.json()[0]
    _reject_if_banned(profile)
    return profile


async def require_admin(user: dict[str, Any] = Depends(verify_user)) -> dict[str, Any]:
    profile = await load_profile(user)
    if profile.get("role") != "admin":
        raise HTTPException(status_code=403, detail="admin_only")
    user["_profile"] = profile
    return user


def _public_profile(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": profile["id"],
        "role": profile.get("role"),
        "username": profile.get("username"),
        "display_name": profile.get("display_name"),
        "token_balance": profile.get("token_balance", 0),
        "banned_at": profile.get("banned_at"),
    }


# ---------------------------------------------------------------------------
# Health + root (JSON only — UI lives on GitHub Pages)
# ---------------------------------------------------------------------------
@app.get("/")
async def root():
    return {
        "ok": True,
        "service": "ckr-wwdc-api",
        "docs": "/api/health",
        "ui": "https://j3xdr.github.io/CKR-WWDC/",
        "admin": "https://j3xdr.github.io/Login_j3xdr/",
    }


@app.get("/api/health")
async def health():
    flags = await _read_app_settings(["farm_maintenance", "topup_maintenance"])
    return {
        "ok": True,
        "service": "ckr-wwdc",
        "farm_busy": _farm_busy,
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_ANON_KEY),
        "service_role_configured": _has_service_role(),
        "topup_configured": bool(
            (TRUEWALLET_PHONE or os.environ.get("TRUEWALLET_PHONE", "")).strip()
        ),
        "farm_maintenance": bool(flags.get("farm_maintenance")),
        "topup_maintenance": bool(flags.get("topup_maintenance")),
        "soft_caps": {"coin": FARM_SOFT_CAP_COIN, "exp": FARM_SOFT_CAP_EXP},
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/me")
async def me(user: dict[str, Any] = Depends(verify_user)):
    profile = await load_profile(user)
    return {
        "ok": True,
        "user": {
            "id": user["id"],
            "username": profile.get("username"),
        },
        "profile": _public_profile(profile),
    }


# ---------------------------------------------------------------------------
# Auth: username + password → Supabase session (Pages never need email)
# ---------------------------------------------------------------------------
@app.post("/api/auth/login")
async def auth_login(body: LoginBody):
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=503, detail="auth_not_configured")

    username = body.username.strip()
    resolved: dict[str, Any] = {}
    candidates: list[str] = []

    # Prefer DB resolve when service_role is available
    if _has_service_role():
        async with httpx.AsyncClient(timeout=20.0) as client:
            looked = await client.post(
                f"{SUPABASE_URL}/rest/v1/rpc/resolve_username_email",
                headers=_service_headers(),
                json={"p_username": username},
            )
            if looked.status_code == 200:
                data = looked.json() or {}
                if data.get("ok") and data.get("email"):
                    resolved = data
                    candidates.append(str(data["email"]))

    # Fallback: username-as-email (admin) + synthetic local email (customers)
    if "@" in username:
        candidates.append(username)
    candidates.append(_synthetic_email(username))

    seen: set[str] = set()
    emails: list[str] = []
    for e in candidates:
        key = e.strip().lower()
        if key and key not in seen:
            seen.add(key)
            emails.append(e.strip())

    session: Optional[dict[str, Any]] = None
    async with httpx.AsyncClient(timeout=30.0) as client:
        for auth_email in emails:
            sign = await client.post(
                f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
                headers=_sb_headers(SUPABASE_ANON_KEY),
                json={"email": auth_email, "password": body.password},
            )
            if sign.status_code == 200:
                session = sign.json()
                break
        if not session or not session.get("access_token"):
            raise HTTPException(status_code=401, detail="invalid_credentials")

        access = session["access_token"]
        uid = (session.get("user") or {}).get("id") or resolved.get("id")
        profile_row: dict[str, Any] = {}
        if uid:
            pr = await client.get(
                f"{SUPABASE_URL}/rest/v1/profiles",
                params={"id": f"eq.{uid}", "select": "*"},
                headers={
                    **_sb_headers(SUPABASE_ANON_KEY, access),
                    "Accept": "application/json",
                },
            )
            if pr.status_code == 200 and pr.json():
                profile_row = pr.json()[0]

    if profile_row.get("banned_at"):
        raise HTTPException(status_code=403, detail="account_banned")

    profile_out = {
        "id": profile_row.get("id") or resolved.get("id") or uid,
        "role": profile_row.get("role") or resolved.get("role"),
        "username": profile_row.get("username") or resolved.get("username") or username,
        "display_name": profile_row.get("display_name") or resolved.get("display_name"),
        "token_balance": profile_row.get("token_balance", resolved.get("token_balance", 0)),
    }

    session_token = None
    if profile_out.get("id") and _has_service_role():
        session_token = await _set_session_token(str(profile_out["id"]))

    return {
        "ok": True,
        "access_token": session.get("access_token"),
        "refresh_token": session.get("refresh_token"),
        "expires_in": session.get("expires_in"),
        "token_type": session.get("token_type", "bearer"),
        "session_token": session_token,
        "user": {
            "id": profile_out["id"],
            "username": profile_out["username"],
        },
        "profile": profile_out,
    }


@app.post("/api/auth/register")
async def auth_register(body: RegisterBody, request: Request):
    """Public self-registration — creates normal user with 0 tokens, then issues JWT."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=503, detail="auth_not_configured")
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")

    if body.password != body.confirm_password:
        raise HTTPException(status_code=400, detail="password_mismatch")

    _check_signup_rate(_client_ip(request))
    username = _validate_public_username(body.username)

    created = await _create_normal_user(username, body.password, initial_tokens=0)
    auth_email = created["auth_email"]

    async with httpx.AsyncClient(timeout=30.0) as client:
        sign = await client.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers=_sb_headers(SUPABASE_ANON_KEY),
            json={"email": auth_email, "password": body.password},
        )
        if sign.status_code != 200 or not (sign.json() or {}).get("access_token"):
            raise HTTPException(status_code=500, detail="register_session_failed")
        session = sign.json()
        access = session["access_token"]
        uid = created["id"]

        profile_row: dict[str, Any] = {}
        pr = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{uid}", "select": "*"},
            headers={
                **_sb_headers(SUPABASE_ANON_KEY, access),
                "Accept": "application/json",
            },
        )
        if pr.status_code == 200 and pr.json():
            profile_row = pr.json()[0]

    profile_out = {
        "id": profile_row.get("id") or uid,
        "role": profile_row.get("role") or "normal",
        "username": profile_row.get("username") or username,
        "display_name": profile_row.get("display_name") or username,
        "token_balance": profile_row.get("token_balance", 0),
    }

    session_token = await _set_session_token(str(profile_out["id"]))

    return {
        "ok": True,
        "access_token": session.get("access_token"),
        "refresh_token": session.get("refresh_token"),
        "expires_in": session.get("expires_in"),
        "token_type": session.get("token_type", "bearer"),
        "session_token": session_token,
        "user": {
            "id": profile_out["id"],
            "username": profile_out["username"],
        },
        "profile": profile_out,
    }


def _svc():
    """Service-role headers for queue/lock tables."""
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")
    return _service_headers()


async def _gate_for(user_id: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=20.0) as client:
        return await fq.queue_snapshot(
            client, SUPABASE_URL, _svc(), user_id, _farm_busy
        )


# ---------------------------------------------------------------------------
# Farm gate / queue
# ---------------------------------------------------------------------------
@app.get("/api/farm/gate")
async def farm_gate(user: dict[str, Any] = Depends(verify_user)):
    snap = await _gate_for(user["id"])
    flags = await _read_app_settings(["farm_maintenance"])
    return {
        "ok": True,
        **snap,
        "farm_maintenance": bool(flags.get("farm_maintenance")),
    }


@app.post("/api/farm/queue/join")
async def farm_queue_join(user: dict[str, Any] = Depends(verify_user)):
    await _require_farm_open()
    await load_profile(user)
    async with httpx.AsyncClient(timeout=20.0) as client:
        snap = await fq.join_queue(
            client, SUPABASE_URL, _svc(), user["id"], _farm_busy
        )
    return {"ok": True, **snap}


# ---------------------------------------------------------------------------
# Farm run (JWT + consume 1 token + sequential execution)
# ---------------------------------------------------------------------------
@app.post("/api/farm/run")
async def farm_run(body: FarmRunBody, user: dict[str, Any] = Depends(verify_user)):
    global _farm_busy
    await _require_farm_open()
    profile = await load_profile(user)
    token = user["_access_token"]
    uid = user["id"]
    tokens_before = int(profile.get("token_balance") or 0)

    if tokens_before < 1:
        raise HTTPException(status_code=402, detail="insufficient_tokens")

    _enforce_farm_soft_caps(body.coin, body.exp)

    # Queue / busy gate BEFORE spending a token
    gate = await _gate_for(uid)
    if _farm_busy or not gate.get("can_run"):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "farm_busy",
                "message": "farm_busy",
                "gate": gate,
            },
        )
    # If someone holds an active turn and it's not me, block
    if gate.get("active") and not gate["active"].get("is_me") and gate.get("me", {}).get("status") != "active":
        raise HTTPException(
            status_code=409,
            detail={"code": "farm_busy", "message": "farm_busy", "gate": gate},
        )

    async with httpx.AsyncClient(timeout=30.0) as client:
        cons = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/consume_token",
            headers=_sb_headers(SUPABASE_ANON_KEY, token),
            json={"p_reason": "farm_run"},
        )
    if cons.status_code != 200:
        raise HTTPException(status_code=500, detail=f"consume_failed:{cons.text}")
    cons_data = cons.json()
    if not cons_data.get("ok"):
        reason = cons_data.get("reason", "consume_failed")
        code = 402 if reason == "insufficient_tokens" else 400
        raise HTTPException(status_code=code, detail=reason)

    job_id = None
    if _has_service_role():
        async with httpx.AsyncClient(timeout=20.0) as client:
            jr = await client.post(
                f"{SUPABASE_URL}/rest/v1/run_jobs",
                headers={
                    **_service_headers(),
                    "Prefer": "return=representation",
                },
                json={
                    "user_id": uid,
                    "status": "queued",
                    "score": body.score,
                    "coin": body.coin,
                    "exp": body.exp,
                },
            )
            if jr.status_code < 300 and jr.json():
                job_id = jr.json()[0]["id"]

    if not _farm_lock.acquire(blocking=False):
        bal = await _refund_token(uid, "farm_busy_refund")
        gate2 = await _gate_for(uid)
        raise HTTPException(
            status_code=409,
            detail={
                "code": "farm_busy",
                "message": "farm_busy",
                "gate": gate2,
                "token_balance": bal if bal is not None else cons_data.get("token_balance"),
                "refunded": True,
            },
        )

    _farm_busy = True
    logs: list[str] = []

    def log_cb(msg: str) -> None:
        logs.append(msg)

    try:
        if _has_service_role():
            async with httpx.AsyncClient(timeout=20.0) as client:
                await fq.mark_queue_done(client, SUPABASE_URL, _svc(), uid)
                await fq.set_farm_lock(client, SUPABASE_URL, _svc(), uid, job_id)

        if job_id and _has_service_role():
            await _patch_job(job_id, {"status": "running", "started_at": _now()})

        result = await asyncio.to_thread(
            _run_farm_sync,
            body.email,
            body.password,
            body.score,
            body.coin,
            body.exp,
            log_cb,
        )

        ok = bool(result and result.get("ok"))
        token_balance = cons_data.get("token_balance")
        refunded = False
        err_code = None if ok else (result or {}).get("error") or "farm_error"

        if not ok:
            bal = await _refund_token(uid, "farm_fail_refund")
            refunded = True
            if bal is not None:
                token_balance = bal
            if job_id and _has_service_role():
                await _patch_job(
                    job_id,
                    {
                        "status": "failed",
                        "result": result,
                        "error": f"{err_code};refunded",
                        "finished_at": _now(),
                    },
                )
        elif job_id and _has_service_role():
            await _patch_job(
                job_id,
                {
                    "status": "succeeded",
                    "result": result,
                    "error": None,
                    "finished_at": _now(),
                },
            )

        return {
            "ok": ok,
            "token_balance": token_balance,
            "tokens_before": tokens_before,
            "tokens_after": token_balance,
            "job_id": job_id,
            "result": result,
            "refunded": refunded,
            "error": err_code,
            "logs": logs[-80:],
        }
    except Exception as exc:
        bal = await _refund_token(uid, "farm_fail_refund")
        if job_id and _has_service_role():
            await _patch_job(
                job_id,
                {
                    "status": "failed",
                    "error": f"{exc};refunded",
                    "finished_at": _now(),
                },
            )
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "detail": "farm_error",
                "error": str(exc),
                "token_balance": bal if bal is not None else cons_data.get("token_balance"),
                "tokens_before": tokens_before,
                "refunded": True,
                "logs": logs[-80:],
                "trace": traceback.format_exc()[-2000:],
            },
        )
    finally:
        _farm_busy = False
        try:
            _farm_lock.release()
        except RuntimeError:
            pass
        if _has_service_role():
            try:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    await fq.set_farm_lock(client, SUPABASE_URL, _svc(), None, None)
                    await fq.expire_stale_turns(client, SUPABASE_URL, _svc())
                    await fq.promote_next(client, SUPABASE_URL, _svc())
            except Exception:
                pass


def _run_farm_sync(email, password, score, coin, exp, log_cb):
    from partyrun_core import run_farm  # noqa: WPS433 — server-only

    return run_farm(
        email=email,
        password=password,
        score=score,
        coin=coin,
        exp=exp,
        log_cb=log_cb,
    )


def _peek_retry_after(user_id: str) -> int:
    last = _peek_last_ts.get(user_id)
    if last is None:
        return 0
    remaining = int(_PEEK_COOLDOWN_SEC - (time.time() - last))
    return max(0, remaining)


def _check_peek_rate(user_id: str) -> None:
    remaining = _peek_retry_after(user_id)
    if remaining > 0:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "peek_rate_limited",
                "message": "peek_rate_limited",
                "retry_after": remaining,
            },
        )


def _run_peek_sync(email, password, log_cb):
    from partyrun_core import peek_account  # noqa: WPS433 — server-only

    return peek_account(email=email, password=password, log_cb=log_cb)


@app.post("/api/farm/peek")
async def farm_peek(body: PeekBody, user: dict[str, Any] = Depends(verify_user)):
    """Peek game account nickname/coins/XP. Requires tokens >= 1 but does not consume."""
    global _farm_busy
    await _require_farm_open()
    profile = await load_profile(user)
    uid = user["id"]
    tokens = int(profile.get("token_balance") or 0)

    if tokens < 1:
        raise HTTPException(status_code=402, detail="insufficient_tokens_for_peek")

    _check_peek_rate(uid)

    if _farm_busy or not _farm_lock.acquire(blocking=False):
        raise HTTPException(
            status_code=409,
            detail={"code": "farm_busy", "message": "farm_busy"},
        )

    _farm_busy = True
    logs: list[str] = []

    def log_cb(msg: str) -> None:
        logs.append(msg)

    try:
        if _has_service_role():
            try:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    await fq.set_farm_lock(client, SUPABASE_URL, _svc(), uid, None)
            except Exception:
                pass

        result = await asyncio.to_thread(
            _run_peek_sync,
            body.email,
            body.password,
            log_cb,
        )
        if not result or not result.get("ok"):
            err = (result or {}).get("error") or "peek_failed"
            status = 401 if err == "login_failed" else 400
            raise HTTPException(
                status_code=status,
                detail={
                    "code": err,
                    "message": err,
                    "logs": logs[-40:],
                },
            )

        _peek_last_ts[uid] = time.time()
        return {
            "ok": True,
            "nickname": result.get("nickname"),
            "mid": result.get("mid"),
            "coin": result.get("coin"),
            "exp": result.get("exp"),
            "level": result.get("level"),
            "tier": result.get("tier"),
            "cookie": result.get("cookie"),
            "pet": result.get("pet"),
            "pic": result.get("pic"),
            "treas": result.get("treas") or [],
            "retry_after": _PEEK_COOLDOWN_SEC,
            "token_balance": tokens,
            "logs": logs[-40:],
        }
    finally:
        _farm_busy = False
        try:
            _farm_lock.release()
        except RuntimeError:
            pass
        if _has_service_role():
            try:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    await fq.set_farm_lock(client, SUPABASE_URL, _svc(), None, None)
            except Exception:
                pass


@app.get("/api/farm/history")
async def farm_history(
    limit: int = 20,
    user: dict[str, Any] = Depends(verify_user),
):
    profile = await load_profile(user)
    uid = str(profile["id"])
    lim = max(1, min(int(limit or 20), 50))
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/run_jobs",
            headers={
                **_sb_headers(SUPABASE_ANON_KEY, user["_access_token"]),
                "Accept": "application/json",
            },
            params={
                "user_id": f"eq.{uid}",
                "select": "id,status,score,coin,exp,error,created_at,finished_at",
                "order": "created_at.desc",
                "limit": str(lim),
            },
        )
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail="farm_history_failed")
    return {"ok": True, "items": r.json() or []}


async def _patch_job(job_id: str, patch: dict[str, Any]) -> None:
    async with httpx.AsyncClient(timeout=20.0) as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/run_jobs",
            params={"id": f"eq.{job_id}"},
            headers=_service_headers(),
            json=patch,
        )


async def _refund_token(user_id: str, reason: str) -> Optional[int]:
    if not _has_service_role():
        return None
    async with httpx.AsyncClient(timeout=20.0) as client:
        credit = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_credit_tokens",
            headers=_service_headers(),
            json={"p_user_id": user_id, "p_amount": 1, "p_reason": reason},
        )
    if credit.status_code != 200:
        print(f"[refund] failed uid={user_id} reason={reason} {credit.text[:120]}")
        return None
    out = credit.json() or {}
    if not out.get("ok"):
        print(f"[refund] rpc not ok uid={user_id} {out}")
        return None
    try:
        return int(out.get("token_balance"))
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Top-up (TrueMoney angpao)
# ---------------------------------------------------------------------------
@app.get("/api/topup/packages")
async def topup_packages():
    return {"ok": True, "packages": topup_pkg.package_list()}


@app.post("/api/topup/verify")
async def topup_verify(
    body: TopupVerifyBody,
    user: dict[str, Any] = Depends(verify_user),
):
    """Check voucher amount/status without redeeming."""
    await load_profile(user)
    await _require_topup_open()
    pkg = topup_pkg.get_package(int(body.package_tokens))
    if not pkg:
        raise HTTPException(status_code=400, detail="invalid_package")
    client = TmnVoucherClient()
    verified = await client.verify_voucher(
        body.voucher,
        expected_satang=int(pkg["price_satang"]),
    )
    if not verified.get("success"):
        code = str(verified.get("code") or "verify_failed")
        print(
            f"[topup] verify fail code={code} "
            f"msg={(verified.get('message') or '')[:120]}"
        )
        raise HTTPException(
            status_code=_tmn_http_status(code),
            detail=_tmn_public_detail(code),
        )
    data = verified.get("data") or {}
    voucher = data.get("voucher") or {}
    amount_satang = int(
        voucher.get("amount_satang")
        or voucher.get("remaining_amount")
        or pkg["price_satang"]
        or 0
    )
    return {
        "ok": True,
        "package_tokens": int(pkg["tokens"]),
        "expected_baht": int(pkg["price_satang"]) / 100.0,
        "amount_baht": amount_satang / 100.0 if amount_satang else int(pkg["price_satang"]) / 100.0,
        "voucher_code": data.get("voucher_code"),
    }


@app.get("/api/topup/history")
async def topup_history(user: dict[str, Any] = Depends(verify_user)):
    profile = await load_profile(user)
    uid = str(profile["id"])
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/topup_redemptions",
            headers={
                **_sb_headers(SUPABASE_ANON_KEY, user["_access_token"]),
                "Accept": "application/json",
            },
            params={
                "user_id": f"eq.{uid}",
                "select": "id,amount_satang,tokens_credited,package_tokens,credit_status,created_at",
                "order": "created_at.desc",
                "limit": "20",
            },
        )
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail="topup_history_failed")
    rows = []
    for row in r.json() or []:
        rows.append(
            {
                "id": row.get("id"),
                "amount_baht": (int(row.get("amount_satang") or 0) / 100.0),
                "tokens": row.get("tokens_credited") or row.get("package_tokens"),
                "credit_status": row.get("credit_status") or "credited",
                "created_at": row.get("created_at"),
            }
        )
    return {"ok": True, "items": rows}


@app.post("/api/topup/redeem")
async def topup_redeem(
    body: TopupRedeemBody,
    request: Request,
    user: dict[str, Any] = Depends(verify_user),
):
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")

    await _require_topup_open()
    profile = await load_profile(user)
    uid = str(profile["id"])
    voucher_code = extract_voucher_code(body.voucher) or ""
    _check_topup_rate(uid, _client_ip(request), voucher_code)

    pkg = topup_pkg.get_package(int(body.package_tokens))
    if not pkg:
        raise HTTPException(status_code=400, detail="invalid_package")

    phone = _wallet_phone()
    client = TmnVoucherClient()
    redeemed = await client.redeem_voucher(
        phone,
        body.voucher,
        expected_satang=int(pkg["price_satang"]),
    )
    if not redeemed.get("success"):
        code = str(redeemed.get("code") or "redeem_failed")
        print(
            f"[topup] redeem fail uid={uid} code={code} "
            f"msg={(redeemed.get('message') or '')[:120]}"
        )
        _record_topup_voucher_fail(voucher_code)
        raise HTTPException(
            status_code=_tmn_http_status(code),
            detail=_tmn_public_detail(code),
        )

    data = redeemed["data"]
    voucher_id = str(data.get("voucher_id") or data.get("voucher_code"))
    voucher_code = str(data.get("voucher_code") or voucher_code)
    amount_satang = int(data.get("amount_satang") or 0)
    tokens = int(pkg["tokens"])
    row: dict[str, Any] | None = None

    async with httpx.AsyncClient(timeout=30.0) as http:
        ins = await http.post(
            f"{SUPABASE_URL}/rest/v1/topup_redemptions",
            headers={
                **_service_headers(),
                "Prefer": "return=representation",
            },
            json={
                "user_id": uid,
                "voucher_id": voucher_id,
                "voucher_code": voucher_code,
                "amount_satang": amount_satang,
                "tokens_credited": tokens,
                "package_tokens": tokens,
                "raw_json": data.get("raw"),
                "credit_status": "credited",
            },
        )
        if ins.status_code in (200, 201):
            payload = ins.json()
            if isinstance(payload, list):
                row = payload[0] if payload else None
            elif isinstance(payload, dict):
                row = payload
        elif ins.status_code == 409 or "duplicate" in (ins.text or "").lower():
            raise HTTPException(status_code=409, detail="voucher_already_used")
        else:
            if "topup_redemptions_voucher_id" in (ins.text or "") or "23505" in (
                ins.text or ""
            ):
                raise HTTPException(status_code=409, detail="voucher_already_used")
            raise HTTPException(status_code=500, detail="topup_record_failed")

        credit = await http.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_credit_tokens",
            headers=_service_headers(),
            json={
                "p_user_id": uid,
                "p_amount": tokens,
                "p_reason": "topup_angpao",
            },
        )
        credit_ok = credit.status_code == 200 and (credit.json() or {}).get("ok")
        if not credit_ok:
            rid = (row or {}).get("id")
            note = (credit.text or "credit_failed")[:300]
            if rid:
                await http.patch(
                    f"{SUPABASE_URL}/rest/v1/topup_redemptions",
                    params={"id": f"eq.{rid}"},
                    headers={**_service_headers(), "Prefer": "return=minimal"},
                    json={
                        "credit_status": "needs_manual",
                        "error_note": note,
                    },
                )
            print(f"[topup] credit failed rid={rid} note={note[:120]}")
            raise HTTPException(
                status_code=500,
                detail={
                    **_tmn_public_detail("topup_credit_failed"),
                    "redemption_id": rid,
                },
            )
        out = credit.json() or {}

    return {
        "ok": True,
        "tokens_credited": tokens,
        "token_balance": out.get("token_balance"),
        "amount_baht": amount_satang / 100.0,
        "package_tokens": tokens,
        "voucher_id": voucher_id,
        "redemption_id": (row or {}).get("id"),
    }


# ---------------------------------------------------------------------------
# Admin (Login_j3xdr only — JWT admin + service_role on Render)
# ---------------------------------------------------------------------------
@app.get("/api/admin/lookup")
async def admin_lookup(q: str, admin: dict[str, Any] = Depends(require_admin)):
    headers = (
        _service_headers()
        if _has_service_role()
        else _sb_headers(SUPABASE_ANON_KEY, admin["_access_token"])
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_lookup_user",
            headers=headers,
            json={"p_query": q},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=r.text)
    data = r.json()
    if data.get("ok"):
        # Prefer username in admin UI; keep email only as internal fallback
        data.pop("email", None)
    return data


@app.get("/api/admin/audit")
async def admin_audit(
    limit: int = 50,
    admin: dict[str, Any] = Depends(require_admin),
):
    lim = max(1, min(int(limit or 50), 100))
    headers = (
        _service_headers()
        if _has_service_role()
        else _sb_headers(SUPABASE_ANON_KEY, admin["_access_token"])
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/admin_audit_log",
            headers={**headers, "Accept": "application/json"},
            params={
                "select": "id,actor_id,action,target_user_id,meta,created_at",
                "order": "created_at.desc",
                "limit": str(lim),
            },
        )
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=r.text)
    return {"ok": True, "items": r.json() or []}


@app.get("/api/admin/topups")
async def admin_topups(
    status: Optional[str] = None,
    admin: dict[str, Any] = Depends(require_admin),
):
    headers = (
        _service_headers()
        if _has_service_role()
        else _sb_headers(SUPABASE_ANON_KEY, admin["_access_token"])
    )
    params: dict[str, str] = {
        "select": "id,user_id,voucher_code,amount_satang,tokens_credited,package_tokens,credit_status,error_note,created_at",
        "order": "created_at.desc",
        "limit": "50",
    }
    if status in ("needs_manual", "credited"):
        params["credit_status"] = f"eq.{status}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/topup_redemptions",
            headers={**headers, "Accept": "application/json"},
            params=params,
        )
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=r.text)
    items = []
    for row in r.json() or []:
        items.append(
            {
                **row,
                "amount_baht": (int(row.get("amount_satang") or 0) / 100.0),
            }
        )
    return {"ok": True, "items": items}


@app.get("/api/admin/users/{user_id}/topups")
async def admin_user_topups(
    user_id: str,
    admin: dict[str, Any] = Depends(require_admin),
):
    headers = (
        _service_headers()
        if _has_service_role()
        else _sb_headers(SUPABASE_ANON_KEY, admin["_access_token"])
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.get(
            f"{SUPABASE_URL}/rest/v1/topup_redemptions",
            headers={**headers, "Accept": "application/json"},
            params={
                "user_id": f"eq.{user_id}",
                "select": "id,amount_satang,tokens_credited,package_tokens,credit_status,created_at",
                "order": "created_at.desc",
                "limit": "5",
            },
        )
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=r.text)
    items = [
        {
            **row,
            "amount_baht": (int(row.get("amount_satang") or 0) / 100.0),
        }
        for row in (r.json() or [])
    ]
    return {"ok": True, "items": items}


@app.post("/api/admin/topups/{redemption_id}/credit")
async def admin_topup_credit(
    redemption_id: str,
    admin: dict[str, Any] = Depends(require_admin),
):
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")
    async with httpx.AsyncClient(timeout=30.0) as client:
        got = await client.get(
            f"{SUPABASE_URL}/rest/v1/topup_redemptions",
            headers={**_service_headers(), "Accept": "application/json"},
            params={
                "id": f"eq.{redemption_id}",
                "select": "*",
                "limit": "1",
            },
        )
        rows = got.json() if got.status_code == 200 else []
        if not rows:
            raise HTTPException(status_code=404, detail="topup_not_found")
        row = rows[0]
        if row.get("credit_status") == "credited":
            return {"ok": True, "unchanged": True, "id": redemption_id}

        tokens = int(row.get("tokens_credited") or row.get("package_tokens") or 0)
        uid = row.get("user_id")
        credit = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_credit_tokens",
            headers=_service_headers(),
            json={
                "p_user_id": uid,
                "p_amount": tokens,
                "p_reason": "topup_angpao_manual",
            },
        )
        out = credit.json() if credit.status_code == 200 else {}
        if not out.get("ok"):
            raise HTTPException(status_code=400, detail=out.get("reason", "credit_failed"))

        await client.patch(
            f"{SUPABASE_URL}/rest/v1/topup_redemptions",
            params={"id": f"eq.{redemption_id}"},
            headers={**_service_headers(), "Prefer": "return=minimal"},
            json={"credit_status": "credited", "error_note": None},
        )
    await _write_audit(
        admin.get("id"),
        "topup_credit_retry",
        target_user_id=uid,
        meta={"redemption_id": redemption_id, "tokens": tokens},
    )
    return {
        "ok": True,
        "id": redemption_id,
        "token_balance": out.get("token_balance"),
        "tokens_credited": tokens,
    }


@app.post("/api/admin/add-tokens")
async def admin_add_tokens(
    body: AdminAddTokensBody,
    admin: dict[str, Any] = Depends(require_admin),
):
    headers = (
        _service_headers()
        if _has_service_role()
        else _sb_headers(SUPABASE_ANON_KEY, admin["_access_token"])
    )
    async with httpx.AsyncClient(timeout=30.0) as client:
        looked = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_lookup_user",
            headers=headers,
            json={"p_query": body.query},
        )
        data = looked.json() if looked.status_code == 200 else {}
        if not data.get("ok"):
            raise HTTPException(status_code=404, detail=data.get("reason", "not_found"))

        credit = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_credit_tokens",
            headers=headers,
            json={
                "p_user_id": data["id"],
                "p_amount": body.amount,
                "p_reason": body.reason,
            },
        )
    if credit.status_code != 200:
        raise HTTPException(status_code=500, detail=credit.text)
    out = credit.json()
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out.get("reason", "credit_failed"))
    await _write_audit(
        admin.get("id"),
        "add_tokens",
        target_user_id=data.get("id"),
        meta={"amount": body.amount, "reason": body.reason},
    )
    return {
        "ok": True,
        "id": out.get("id"),
        "username": data.get("username"),
        "token_balance": out.get("token_balance"),
    }


@app.post("/api/admin/create-user")
async def admin_create_user(
    body: AdminCreateUserBody,
    admin: dict[str, Any] = Depends(require_admin),
):
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="username_required")

    created = await _create_normal_user(
        username,
        body.password,
        initial_tokens=body.initial_tokens,
        created_by=admin["id"],
    )
    await _write_audit(
        admin.get("id"),
        "create_user",
        target_user_id=created["id"],
        meta={"username": created["username"], "initial_tokens": body.initial_tokens},
    )
    return {
        "ok": True,
        "id": created["id"],
        "username": created["username"],
        "token_balance": created["token_balance"],
    }


@app.get("/api/admin/users")
async def admin_users(admin: dict[str, Any] = Depends(require_admin)):
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_list_profiles",
            headers=_sb_headers(SUPABASE_ANON_KEY, admin["_access_token"]),
            json={},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=r.text)
    rows = r.json()
    safe = []
    for p in rows or []:
        safe.append(
            {
                "id": p.get("id"),
                "username": p.get("username"),
                "display_name": p.get("display_name"),
                "role": p.get("role"),
                "token_balance": p.get("token_balance", 0),
                "banned_at": p.get("banned_at"),
                "ban_reason": p.get("ban_reason"),
                "created_at": p.get("created_at"),
            }
        )
    return {"ok": True, "users": safe}


@app.get("/api/admin/settings")
async def admin_get_settings(admin: dict[str, Any] = Depends(require_admin)):
    flags = await _read_app_settings(["farm_maintenance", "topup_maintenance"])
    return {
        "ok": True,
        "farm_maintenance": bool(flags.get("farm_maintenance")),
        "topup_maintenance": bool(flags.get("topup_maintenance")),
    }


@app.post("/api/admin/settings")
async def admin_set_settings(
    body: AdminSettingsBody,
    admin: dict[str, Any] = Depends(require_admin),
):
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")
    updates: dict[str, bool] = {}
    if body.farm_maintenance is not None:
        updates["farm_maintenance"] = bool(body.farm_maintenance)
    if body.topup_maintenance is not None:
        updates["topup_maintenance"] = bool(body.topup_maintenance)
    if not updates:
        return await admin_get_settings(admin)

    async with httpx.AsyncClient(timeout=20.0) as client:
        for key, val in updates.items():
            await client.post(
                f"{SUPABASE_URL}/rest/v1/app_settings",
                headers={
                    **_service_headers(),
                    "Prefer": "resolution=merge-duplicates,return=minimal",
                },
                json={
                    "key": key,
                    "value": val,
                    "updated_at": _now(),
                    "updated_by": admin.get("id"),
                },
            )
    await _write_audit(
        admin.get("id"),
        "update_settings",
        meta=updates,
    )
    return await admin_get_settings(admin)


@app.post("/api/admin/users/{user_id}/ban")
async def admin_ban_user(
    user_id: str,
    body: AdminBanBody,
    admin: dict[str, Any] = Depends(require_admin),
):
    if user_id == admin.get("id"):
        raise HTTPException(status_code=400, detail="cannot_ban_self")
    headers = (
        _service_headers()
        if _has_service_role()
        else _sb_headers(SUPABASE_ANON_KEY, admin["_access_token"])
    )
    reason = (body.reason or "").strip()[:500]
    async with httpx.AsyncClient(timeout=20.0) as client:
        got = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers={**headers, "Accept": "application/json"},
            params={"id": f"eq.{user_id}", "select": "id,username,role,banned_at"},
        )
        rows = got.json() if got.status_code == 200 else []
        if not rows:
            raise HTTPException(status_code=404, detail="user_not_found")
        if rows[0].get("role") == "admin":
            raise HTTPException(status_code=400, detail="cannot_ban_admin")
        patched = await client.patch(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{user_id}"},
            headers={**headers, "Prefer": "return=representation"},
            json={
                "banned_at": _now(),
                "ban_reason": reason or None,
                "session_token": str(uuid.uuid4()),
            },
        )
    if patched.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=patched.text)
    await _write_audit(
        admin.get("id"),
        "ban_user",
        target_user_id=user_id,
        meta={"reason": reason, "username": rows[0].get("username")},
    )
    return {"ok": True, "id": user_id, "banned": True}


@app.post("/api/admin/users/{user_id}/unban")
async def admin_unban_user(
    user_id: str,
    admin: dict[str, Any] = Depends(require_admin),
):
    headers = (
        _service_headers()
        if _has_service_role()
        else _sb_headers(SUPABASE_ANON_KEY, admin["_access_token"])
    )
    async with httpx.AsyncClient(timeout=20.0) as client:
        patched = await client.patch(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{user_id}"},
            headers={**headers, "Prefer": "return=representation"},
            json={"banned_at": None, "ban_reason": None},
        )
    if patched.status_code not in (200, 204):
        raise HTTPException(status_code=500, detail=patched.text)
    await _write_audit(admin.get("id"), "unban_user", target_user_id=user_id)
    return {"ok": True, "id": user_id, "banned": False}


@app.get("/api/admin/stats")
async def admin_stats(
    date: Optional[str] = None,
    admin: dict[str, Any] = Depends(require_admin),
):
    try:
        label, start_iso, end_iso = _bkk_day_bounds(date)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid_date")

    headers = (
        _service_headers()
        if _has_service_role()
        else _sb_headers(SUPABASE_ANON_KEY, admin["_access_token"])
    )
    runs_by_status: dict[str, int] = {}
    tokens_credited = 0
    tokens_consumed = 0
    topups = 0
    needs_manual = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
        jobs = await client.get(
            f"{SUPABASE_URL}/rest/v1/run_jobs",
            headers={**headers, "Accept": "application/json"},
            params=[
                ("created_at", f"gte.{start_iso}"),
                ("created_at", f"lt.{end_iso}"),
                ("select", "status"),
                ("limit", "10000"),
            ],
        )
        if jobs.status_code == 200:
            for row in jobs.json() or []:
                st = row.get("status") or "unknown"
                runs_by_status[st] = runs_by_status.get(st, 0) + 1

        ledger = await client.get(
            f"{SUPABASE_URL}/rest/v1/token_ledger",
            headers={**headers, "Accept": "application/json"},
            params=[
                ("created_at", f"gte.{start_iso}"),
                ("created_at", f"lt.{end_iso}"),
                ("select", "delta"),
                ("limit", "20000"),
            ],
        )
        if ledger.status_code == 200:
            for row in ledger.json() or []:
                try:
                    d = int(row.get("delta") or 0)
                except (TypeError, ValueError):
                    d = 0
                if d > 0:
                    tokens_credited += d
                elif d < 0:
                    tokens_consumed += -d

        tops = await client.get(
            f"{SUPABASE_URL}/rest/v1/topup_redemptions",
            headers={**headers, "Accept": "application/json"},
            params=[
                ("created_at", f"gte.{start_iso}"),
                ("created_at", f"lt.{end_iso}"),
                ("select", "credit_status"),
                ("limit", "10000"),
            ],
        )
        if tops.status_code == 200:
            for row in tops.json() or []:
                topups += 1
                if row.get("credit_status") == "needs_manual":
                    needs_manual += 1

    return {
        "ok": True,
        "date": label,
        "timezone": "Asia/Bangkok",
        "runs": runs_by_status,
        "runs_total": sum(runs_by_status.values()),
        "tokens_credited": tokens_credited,
        "tokens_consumed": tokens_consumed,
        "topups": topups,
        "topups_needs_manual": needs_manual,
    }


@app.post("/api/admin/set-tokens")
async def admin_set_tokens(
    body: AdminSetTokensBody,
    admin: dict[str, Any] = Depends(require_admin),
):
    """Set absolute token_balance via delta credit (supports increase/decrease)."""
    headers = (
        _service_headers()
        if _has_service_role()
        else _sb_headers(SUPABASE_ANON_KEY, admin["_access_token"])
    )
    async with httpx.AsyncClient(timeout=30.0) as client:
        got = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers={**headers, "Accept": "application/json"},
            params={
                "id": f"eq.{body.user_id}",
                "select": "id,username,role,token_balance",
            },
        )
        if got.status_code != 200:
            raise HTTPException(status_code=500, detail=got.text)
        rows = got.json() or []
        if not rows:
            raise HTTPException(status_code=404, detail="user_not_found")
        row = rows[0]
        current = int(row.get("token_balance") or 0)
        target = int(body.token_balance)
        delta = target - current
        if delta == 0:
            return {
                "ok": True,
                "id": row.get("id"),
                "username": row.get("username"),
                "token_balance": current,
                "unchanged": True,
            }

        credit = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_credit_tokens",
            headers=headers,
            json={
                "p_user_id": body.user_id,
                "p_amount": delta,
                "p_reason": body.reason or "admin_set",
            },
        )
    if credit.status_code != 200:
        raise HTTPException(status_code=500, detail=credit.text)
    out = credit.json()
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=out.get("reason", "set_failed"))
    await _write_audit(
        admin.get("id"),
        "set_tokens",
        target_user_id=body.user_id,
        meta={"delta": delta, "token_balance": out.get("token_balance")},
    )
    return {
        "ok": True,
        "id": out.get("id"),
        "username": row.get("username"),
        "token_balance": out.get("token_balance"),
        "delta": delta,
    }


@app.delete("/api/admin/users/{user_id}")
async def admin_delete_user(
    user_id: str,
    admin: dict[str, Any] = Depends(require_admin),
):
    """Delete Auth user (profiles cascade). Requires service_role."""
    if not _has_service_role():
        raise HTTPException(status_code=503, detail="service_role_not_configured")
    if user_id == admin.get("id"):
        raise HTTPException(status_code=400, detail="cannot_delete_self")

    headers = _service_headers()
    async with httpx.AsyncClient(timeout=30.0) as client:
        got = await client.get(
            f"{SUPABASE_URL}/rest/v1/profiles",
            headers={**headers, "Accept": "application/json"},
            params={"id": f"eq.{user_id}", "select": "id,username,role"},
        )
        if got.status_code != 200:
            raise HTTPException(status_code=500, detail=got.text)
        rows = got.json() or []
        if not rows:
            raise HTTPException(status_code=404, detail="user_not_found")
        target = rows[0]
        if target.get("role") == "admin":
            raise HTTPException(status_code=400, detail="cannot_delete_admin")

        deleted = await client.delete(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers=headers,
        )
    if deleted.status_code not in (200, 204):
        raise HTTPException(
            status_code=500,
            detail=deleted.text or f"delete_failed_{deleted.status_code}",
        )
    await _write_audit(
        admin.get("id"),
        "delete_user",
        target_user_id=user_id,
        meta={"username": target.get("username")},
    )
    return {
        "ok": True,
        "id": user_id,
        "username": target.get("username"),
    }
