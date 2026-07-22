"""TrueMoney gift voucher client (third-party; inspired by @prakrit_m/tmn-voucher)."""
from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

import httpx

BASE_API_URL = "https://gift.truemoney.com"
DEFAULT_TIMEOUT = 15.0
DEFAULT_UA = (
    "ckr-wwdc-tmn/1.0 (+https://github.com/j3xdr/CKR-WWDC; third-party)"
)

_PHONE_RE = re.compile(r"^0[6-9]\d{8}$")


def extract_voucher_code(voucher_url_or_code: str) -> Optional[str]:
    raw = (voucher_url_or_code or "").strip()
    if not raw:
        return None
    if "://" in raw or raw.lower().startswith("gift.truemoney.com"):
        url = raw if "://" in raw else "https://" + raw
        try:
            parsed = urlparse(url)
            qs = parse_qs(parsed.query)
            if "v" in qs and qs["v"]:
                code = (qs["v"][0] or "").strip()
                return code or None
            # path fallback: /campaign/?v=CODE already handled; some links use fragment
            frag = parse_qs(parsed.fragment)
            if "v" in frag and frag["v"]:
                code = (frag["v"][0] or "").strip()
                return code or None
        except Exception:
            return None
        return None
    # bare code
    code = re.sub(r"\s+", "", raw)
    return code or None


def normalize_phone(phone: str) -> Optional[str]:
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("66") and len(digits) == 11:
        digits = "0" + digits[2:]
    if _PHONE_RE.match(digits):
        return digits
    return None


def baht_to_satang(amount_baht: Any) -> int:
    try:
        return int(round(float(str(amount_baht).replace(",", "")) * 100))
    except (TypeError, ValueError):
        return 0


def _fail(code: str, message: str, data: Any = None) -> dict[str, Any]:
    out: dict[str, Any] = {"success": False, "code": code, "message": message}
    if data is not None:
        out["data"] = data
    return out


def _ok(data: Any, message: str = "") -> dict[str, Any]:
    return {"success": True, "code": "SUCCESS", "message": message, "data": data}


def _parse_tmn(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return _fail("INVALID_RESPONSE", "response ไม่ใช่ object")
    status = payload.get("status") or {}
    code = str(status.get("code") or "UNKNOWN")
    message = str(status.get("message") or "")
    data = payload.get("data")
    if code != "SUCCESS":
        return _fail(code, message or code, data)
    return _ok(data, message)


def _has_maintenance(ma: Any) -> bool:
    if not isinstance(ma, dict):
        return False
    for k in ("title_th", "title_en", "message_th", "message_en"):
        v = ma.get(k)
        if v is not None and str(v).strip() != "":
            return True
    return False


def _maintenance_message(ma: Any) -> str:
    if not isinstance(ma, dict):
        return "ระบบซองอั่งเปาปิดปรับปรุงชั่วคราว"
    for k in ("title_th", "message_th", "title_en", "message_en"):
        v = ma.get(k)
        if v is not None and str(v).strip() != "":
            return str(v)
    return "ระบบซองอั่งเปาปิดปรับปรุงชั่วคราว"


def voucher_remaining_satang(voucher: dict[str, Any]) -> int:
    total = baht_to_satang(voucher.get("amount_baht"))
    redeemed = baht_to_satang(voucher.get("redeemed_amount_baht"))
    return max(total - redeemed, 0)


def matches_expected_amount(voucher: dict[str, Any], expected_satang: int) -> bool:
    """Require exact package amount; reject ambiguous random leftovers."""
    if expected_satang < 100:
        return False
    member = int(voucher.get("member") or 0)
    vtype = str(voucher.get("type") or "")
    available = int(voucher.get("available") or 0)
    status = str(voucher.get("status") or "")
    if status not in ("active", ""):
        # some responses omit or use active only when redeemable
        if status in ("redeemed", "expired"):
            return False

    if member <= 1:
        return baht_to_satang(voucher.get("amount_baht")) == expected_satang

    if available < 1:
        return False

    if vtype == "F":
        # equal share
        total = baht_to_satang(voucher.get("amount_baht"))
        per = total // member if member else 0
        return per == expected_satang

    if vtype == "R":
        # only accept when exactly one ticket left and remaining == expected
        return available == 1 and voucher_remaining_satang(voucher) == expected_satang

    return False


class TmnVoucherClient:
    def __init__(
        self,
        *,
        base_api_url: str = BASE_API_URL,
        timeout: float = DEFAULT_TIMEOUT,
        user_agent: str = DEFAULT_UA,
    ):
        self.base_api_url = base_api_url.rstrip("/")
        self.timeout = timeout
        self.headers = {
            "User-Agent": user_agent,
            "Accept": "application/json",
        }

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
    ) -> dict[str, Any]:
        url = f"{self.base_api_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.request(
                    method,
                    url,
                    headers=self.headers
                    if json_body is None
                    else {**self.headers, "Content-Type": "application/json"},
                    json=json_body,
                )
        except httpx.TimeoutException:
            return _fail("TIMEOUT", "เชื่อมต่อ TrueMoney หมดเวลา")
        except httpx.HTTPError as e:
            return _fail("NETWORK_ERROR", f"เชื่อมต่อ TrueMoney ไม่ได้: {e}")

        try:
            payload = r.json()
        except Exception:
            return _fail(
                "INVALID_JSON_RESPONSE",
                f"TrueMoney ตอบกลับไม่ใช่ JSON (HTTP {r.status_code})",
            )

        if not r.is_success and not isinstance(payload, dict):
            return _fail("HTTP_ERROR_UNKNOWN", f"HTTP {r.status_code}")

        return _parse_tmn(payload)

    async def check_server_status(self) -> dict[str, Any]:
        raw = await self._request("GET", "/campaign/vouchers/configuration")
        if not raw.get("success"):
            # configuration endpoint sometimes returns SUCCESS with ma block
            if raw.get("code") == "MAINTENANCE":
                return raw
            # try inspect data even on failure
            data = raw.get("data")
            if isinstance(data, dict) and _has_maintenance(data.get("ma")):
                return _fail("MAINTENANCE", _maintenance_message(data.get("ma")))
            return raw

        data = raw.get("data")
        if isinstance(data, dict) and _has_maintenance(data.get("ma")):
            return _fail("MAINTENANCE", _maintenance_message(data.get("ma")))
        return _ok(data, raw.get("message") or "")

    async def verify_voucher(
        self,
        voucher_url_or_code: str,
        *,
        expected_satang: Optional[int] = None,
    ) -> dict[str, Any]:
        code = extract_voucher_code(voucher_url_or_code)
        if not code:
            return _fail("INVALID_VOUCHER_CODE", "ลิงก์หรือโค้ดซองไม่ถูกต้อง")

        parsed = await self._request("GET", f"/campaign/vouchers/{code}/verify")
        if not parsed.get("success"):
            return parsed

        data = parsed.get("data")
        if not isinstance(data, dict) or "voucher" not in data:
            return _fail("INVALID_RESPONSE", "ไม่พบข้อมูลซองจาก TrueMoney")

        voucher = data.get("voucher") or {}
        if expected_satang is not None and not matches_expected_amount(
            voucher, expected_satang
        ):
            return _fail(
                "CONDITION_NOT_MET",
                "ยอดซองไม่ตรงกับแพ็กที่เลือก",
                data,
            )

        return _ok(
            {
                "voucher_code": code,
                "voucher": voucher,
                "owner_profile": data.get("owner_profile"),
                "tickets": data.get("tickets") or [],
                "raw": data,
            },
            parsed.get("message") or "",
        )

    async def redeem_voucher(
        self,
        phone_number: str,
        voucher_url_or_code: str,
        *,
        expected_satang: Optional[int] = None,
    ) -> dict[str, Any]:
        phone = normalize_phone(phone_number)
        if not phone:
            return _fail("INVALID_PHONE_NUMBER", "เบอร์รับเงินไม่ถูกต้อง")

        code = extract_voucher_code(voucher_url_or_code)
        if not code:
            return _fail("INVALID_VOUCHER_CODE", "ลิงก์หรือโค้ดซองไม่ถูกต้อง")

        status = await self.check_server_status()
        if not status.get("success"):
            return status

        if expected_satang is not None:
            verified = await self.verify_voucher(code, expected_satang=expected_satang)
            if not verified.get("success"):
                return verified

        parsed = await self._request(
            "POST",
            f"/campaign/vouchers/{code}/redeem",
            json_body={"mobile": phone, "voucher_hash": code},
        )
        if not parsed.get("success"):
            return parsed

        data = parsed.get("data")
        if not isinstance(data, dict) or not data.get("my_ticket"):
            return _fail("INVALID_RESPONSE", "ไม่พบข้อมูลการรับซองจาก TrueMoney")

        ticket = data["my_ticket"]
        amount = baht_to_satang(ticket.get("amount_baht"))
        if expected_satang is not None and amount != expected_satang:
            # Money may already be in wallet — surface clearly
            return _fail(
                "AMOUNT_MISMATCH_AFTER_REDEEM",
                "รับซองแล้วแต่ยอดไม่ตรงแพ็ก — ติดต่อแอดมิน",
                data,
            )

        voucher = data.get("voucher") or {}
        return _ok(
            {
                "voucher_code": code,
                "voucher_id": str(voucher.get("voucher_id") or code),
                "amount_satang": amount,
                "amount_baht": amount / 100.0,
                "raw": data,
            },
            parsed.get("message") or "",
        )
