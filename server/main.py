"""CKR WWDC API — FastAPI farm backend (no HTML UI)."""
from __future__ import annotations

import asyncio
import os
import re
import sys
import threading
import time
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

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

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Sequential farm queue (Render Free = single instance)
_farm_lock = threading.Lock()
_farm_busy = False

# Public signup rate limit (in-memory; fine on Render Free single instance)
_signup_hits: dict[str, list[float]] = {}
_SIGNUP_LIMIT = 5
_SIGNUP_WINDOW_SEC = 3600

ALLOWED_ORIGINS = [
    "https://j3xdr.github.io",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
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


async def verify_user(authorization: Optional[str] = Header(None)) -> dict[str, Any]:
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
    return r.json()[0]


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
    return {
        "ok": True,
        "service": "ckr-wwdc",
        "farm_busy": _farm_busy,
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_ANON_KEY),
        "service_role_configured": _has_service_role(),
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

    profile_out = {
        "id": profile_row.get("id") or resolved.get("id") or uid,
        "role": profile_row.get("role") or resolved.get("role"),
        "username": profile_row.get("username") or resolved.get("username") or username,
        "display_name": profile_row.get("display_name") or resolved.get("display_name"),
        "token_balance": profile_row.get("token_balance", resolved.get("token_balance", 0)),
    }

    return {
        "ok": True,
        "access_token": session.get("access_token"),
        "refresh_token": session.get("refresh_token"),
        "expires_in": session.get("expires_in"),
        "token_type": session.get("token_type", "bearer"),
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

    return {
        "ok": True,
        "access_token": session.get("access_token"),
        "refresh_token": session.get("refresh_token"),
        "expires_in": session.get("expires_in"),
        "token_type": session.get("token_type", "bearer"),
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
    return {"ok": True, **snap}


@app.post("/api/farm/queue/join")
async def farm_queue_join(user: dict[str, Any] = Depends(verify_user)):
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
    profile = await load_profile(user)
    token = user["_access_token"]
    uid = user["id"]
    tokens_before = int(profile.get("token_balance") or 0)

    if tokens_before < 1:
        raise HTTPException(status_code=402, detail="insufficient_tokens")

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
        await _refund_token(uid, "farm_busy_refund")
        gate2 = await _gate_for(uid)
        raise HTTPException(
            status_code=409,
            detail={"code": "farm_busy", "message": "farm_busy", "gate": gate2},
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
        if job_id and _has_service_role():
            await _patch_job(
                job_id,
                {
                    "status": "succeeded" if ok else "failed",
                    "result": result,
                    "error": None if ok else (result or {}).get("error"),
                    "finished_at": _now(),
                },
            )

        return {
            "ok": ok,
            "token_balance": cons_data.get("token_balance"),
            "tokens_before": tokens_before,
            "tokens_after": cons_data.get("token_balance"),
            "job_id": job_id,
            "result": result,
            "logs": logs[-80:],
        }
    except Exception as exc:
        if job_id and _has_service_role():
            await _patch_job(
                job_id,
                {
                    "status": "failed",
                    "error": str(exc),
                    "finished_at": _now(),
                },
            )
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "detail": "farm_error",
                "error": str(exc),
                "token_balance": cons_data.get("token_balance"),
                "tokens_before": tokens_before,
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


async def _patch_job(job_id: str, patch: dict[str, Any]) -> None:
    async with httpx.AsyncClient(timeout=20.0) as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/run_jobs",
            params={"id": f"eq.{job_id}"},
            headers=_service_headers(),
            json=patch,
        )


async def _refund_token(user_id: str, reason: str) -> None:
    if not _has_service_role():
        return
    async with httpx.AsyncClient(timeout=20.0) as client:
        await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_credit_tokens",
            headers=_service_headers(),
            json={"p_user_id": user_id, "p_amount": 1, "p_reason": reason},
        )


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
                "created_at": p.get("created_at"),
            }
        )
    return {"ok": True, "users": safe}
