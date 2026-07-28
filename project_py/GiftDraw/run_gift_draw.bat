@echo off
chcp 65001 >nul
title Cookie Run - Gift Draw Opener
cd /d "%~dp0"

echo ============================================================
echo   Cookie Run - GIFT DRAW  (เปิดกล่องขวัญฟรี 0 เพชร)
echo ------------------------------------------------------------
echo   ลำดับการทำงาน:
echo     1) Login DevPlay (กรอก email/password ตอนรัน)
echo     2) โหลดข้อมูลไอดี + เช็คจำนวนกล่อง Gift Draw ที่มี
echo     3) เลือกจำนวนกล่องที่จะเปิด (Enter = เปิดทั้งหมด)
echo     4) เปิดกล่องทีละใบ + สรุปของที่ได้
echo ============================================================
echo.

REM --- หา Python (python หรือ py) ---
set "PY=python"
where python >nul 2>nul || set "PY=py"
where %PY% >nul 2>nul || (
    echo [!] ไม่พบ Python -- ติดตั้งจาก https://python.org
    echo     ตอนติดตั้งอย่าลืมติ๊ก "Add Python to PATH"
    echo.
    pause
    exit /b 1
)

REM --- ติดตั้งไลบรารีที่จำเป็น (ครั้งแรกอาจใช้เวลาสักครู่) ---
echo [*] ตรวจสอบ/ติดตั้งไลบรารี...
%PY% -m pip install -r requirements.txt --quiet --disable-pip-version-check
echo.

REM --- รันสคริปต์ ---
%PY% gift_draw.py

echo.
echo ============================================================
echo   จบการทำงาน -- กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง
echo ============================================================
pause >nul
