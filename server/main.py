"""CKR WWDC API — FastAPI app serving static UI + authenticated farm endpoints."""
from __future__ import annotations

import asyncio
import os
import sys
import threading
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, EmailStr, Field

ROOT = Path(__file__).resolve().parent.parent
SERVER_DIR = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"
FARM_DIR = SERVER_DIR / "farm"

if str(FARM_DIR) not in sys.path:
    sys.path.insert(0, str(FARM_DIR))

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

# Sequential farm queue (Render Free = single instance, sleep OK)
_farm_lock = threading.Lock()
_farm_busy = False


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


app = FastAPI(title="CKR WWDC", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class FarmRunBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)
    score: int = Field(default=800000, ge=0, le=9_999_999)
    coin: int = Field(default=1, ge=0, le=999_999)
    exp: int = Field(default=1, ge=0, le=50_000)


class AdminCreateUserBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    username: Optional[str] = None
    display_name: Optional[str] = None
    initial_tokens: int = Field(default=0, ge=0, le=1_000_000)


class AdminAddTokensBody(BaseModel):
    query: str = Field(min_length=2, description="email or username")
    amount: int = Field(ge=1, le=1_000_000)
    reason: str = "admin_credit"


# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------
def _sb_headers(key: str, jwt: Optional[str] = None) -> dict[str, str]:
    h = {
        "apikey": key,
        "Authorization": f"Bearer {jwt or key}",
        "Content-Type": "application/json",
    }
    return h


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


def _service_headers() -> dict[str, str]:
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="service_role_not_configured")
    return _sb_headers(SUPABASE_SERVICE_ROLE_KEY)


# ---------------------------------------------------------------------------
# Health + me
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health():
    return {
        "ok": True,
        "service": "ckr-wwdc",
        "farm_busy": _farm_busy,
        "supabase_configured": bool(SUPABASE_URL and SUPABASE_ANON_KEY),
        "service_role_configured": bool(SUPABASE_SERVICE_ROLE_KEY),
        "ts": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/me")
async def me(user: dict[str, Any] = Depends(verify_user)):
    profile = await load_profile(user)
    return {
        "ok": True,
        "user": {
            "id": user["id"],
            "email": user.get("email") or profile.get("email"),
        },
        "profile": {
            "id": profile["id"],
            "role": profile.get("role"),
            "username": profile.get("username"),
            "display_name": profile.get("display_name"),
            "token_balance": profile.get("token_balance", 0),
            "email": profile.get("email"),
        },
    }


# ---------------------------------------------------------------------------
# Farm run (JWT + consume 1 token + sequential execution)
# ---------------------------------------------------------------------------
@app.post("/api/farm/run")
async def farm_run(body: FarmRunBody, user: dict[str, Any] = Depends(verify_user)):
    global _farm_busy
    profile = await load_profile(user)
    token = user["_access_token"]
    uid = user["id"]

    bal = int(profile.get("token_balance") or 0)
    if bal < 1:
        raise HTTPException(status_code=402, detail="insufficient_tokens")

    # Atomic consume via RPC
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

    # Insert run_jobs via service role if available, else skip audit row
    job_id = None
    if SUPABASE_SERVICE_ROLE_KEY:
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

    # Sequential farm
    if not _farm_lock.acquire(blocking=False):
        # Refund token if we can't start
        await _refund_token(uid, "farm_busy_refund")
        raise HTTPException(status_code=409, detail="farm_busy")

    _farm_busy = True
    logs: list[str] = []

    def log_cb(msg: str) -> None:
        logs.append(msg)

    try:
        if job_id and SUPABASE_SERVICE_ROLE_KEY:
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
        if job_id and SUPABASE_SERVICE_ROLE_KEY:
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
            "job_id": job_id,
            "result": result,
            "logs": logs[-80:],
        }
    except Exception as exc:
        if job_id and SUPABASE_SERVICE_ROLE_KEY:
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
                "logs": logs[-80:],
                "trace": traceback.format_exc()[-2000:],
            },
        )
    finally:
        _farm_busy = False
        _farm_lock.release()


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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _patch_job(job_id: str, patch: dict[str, Any]) -> None:
    async with httpx.AsyncClient(timeout=20.0) as client:
        await client.patch(
            f"{SUPABASE_URL}/rest/v1/run_jobs",
            params={"id": f"eq.{job_id}"},
            headers=_service_headers(),
            json=patch,
        )


async def _refund_token(user_id: str, reason: str) -> None:
    if not SUPABASE_SERVICE_ROLE_KEY:
        return
    async with httpx.AsyncClient(timeout=20.0) as client:
        await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_credit_tokens",
            headers=_service_headers(),
            json={"p_user_id": user_id, "p_amount": 1, "p_reason": reason},
        )


# ---------------------------------------------------------------------------
# Admin (Render backend uses service role — never expose to browser)
# ---------------------------------------------------------------------------
@app.get("/api/admin/lookup")
async def admin_lookup(q: str, _admin: dict[str, Any] = Depends(require_admin)):
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post(
            f"{SUPABASE_URL}/rest/v1/rpc/admin_lookup_user",
            headers=_service_headers() if SUPABASE_SERVICE_ROLE_KEY else _sb_headers(
                SUPABASE_ANON_KEY, _admin["_access_token"]
            ),
            json={"p_query": q},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=500, detail=r.text)
    return r.json()


@app.post("/api/admin/add-tokens")
async def admin_add_tokens(
    body: AdminAddTokensBody,
    admin: dict[str, Any] = Depends(require_admin),
):
    # Lookup then credit
    headers = (
        _service_headers()
        if SUPABASE_SERVICE_ROLE_KEY
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
    return out


@app.post("/api/admin/create-user")
async def admin_create_user(
    body: AdminCreateUserBody,
    _admin: dict[str, Any] = Depends(require_admin),
):
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise HTTPException(status_code=503, detail="service_role_not_configured")

    async with httpx.AsyncClient(timeout=30.0) as client:
        # Create auth user
        cr = await client.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=_service_headers(),
            json={
                "email": body.email,
                "password": body.password,
                "email_confirm": True,
                "user_metadata": {
                    "username": body.username,
                    "display_name": body.display_name or body.username,
                },
            },
        )
        if cr.status_code not in (200, 201):
            raise HTTPException(status_code=400, detail=cr.text)
        created = cr.json()
        uid = created.get("id")
        if not uid:
            raise HTTPException(status_code=500, detail="create_user_no_id")

        # Patch profile
        patch = {
            "email": body.email,
            "role": "normal",
            "token_balance": body.initial_tokens,
        }
        if body.username:
            patch["username"] = body.username
        if body.display_name or body.username:
            patch["display_name"] = body.display_name or body.username

        await client.patch(
            f"{SUPABASE_URL}/rest/v1/profiles",
            params={"id": f"eq.{uid}"},
            headers={**_service_headers(), "Prefer": "return=representation"},
            json=patch,
        )

        if body.initial_tokens > 0:
            await client.post(
                f"{SUPABASE_URL}/rest/v1/token_ledger",
                headers={**_service_headers(), "Prefer": "return=minimal"},
                json={
                    "user_id": uid,
                    "delta": body.initial_tokens,
                    "reason": "initial_grant",
                    "balance_after": body.initial_tokens,
                    "created_by": _admin["id"],
                },
            )

    return {
        "ok": True,
        "id": uid,
        "email": body.email,
        "username": body.username,
        "token_balance": body.initial_tokens,
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
    # Strip sensitive session fields from response
    safe = []
    for p in rows or []:
        safe.append(
            {
                "id": p.get("id"),
                "email": p.get("email"),
                "username": p.get("username"),
                "display_name": p.get("display_name"),
                "role": p.get("role"),
                "token_balance": p.get("token_balance", 0),
                "created_at": p.get("created_at"),
            }
        )
    return {"ok": True, "users": safe}


# ---------------------------------------------------------------------------
# Static frontend (single Render service)
# ---------------------------------------------------------------------------
@app.get("/")
async def index():
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        return JSONResponse({"ok": True, "hint": "static/index.html missing"})
    return FileResponse(index_path)


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# SPA-ish fallback for bare asset paths used by index.html relative links
@app.get("/{path:path}")
async def spa_fallback(path: str, request: Request):
    # Never expose farm source
    if path.startswith("server") or "partyrun_core" in path:
        raise HTTPException(status_code=404)
    candidate = STATIC_DIR / path
    if candidate.is_file() and STATIC_DIR in candidate.resolve().parents:
        return FileResponse(candidate)
    # Prefer index for unknown GET navigations
    if request.method == "GET" and not path.startswith("api/"):
        index_path = STATIC_DIR / "index.html"
        if index_path.exists():
            return FileResponse(index_path)
    raise HTTPException(status_code=404)
