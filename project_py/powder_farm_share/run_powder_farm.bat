@echo off
chcp 65001 >nul
title Cookie Run - Magic Powder Farm
cd /d "%~dp0"

echo ============================================================
echo   Cookie Run - MAGIC POWDER FARM  (แปลง coin เป็นผงเวทมนตร์)
echo ------------------------------------------------------------
echo   ลำดับการทำงาน:
echo     1) Login DevPlay (กรอก email/password ตอนรัน)
echo     2) เช็ค Coin คงเหลือในไอดี + อัตราแลกเปลี่ยน (coin/ผง)
echo     3) เลือกจำนวนรอบ  -- ระบบจำกัดไม่ให้เกิน coin ที่มี
echo     4) ยืนยันก่อนเริ่ม: แสดง coin ที่จะเสีย + ผงที่จะได้ [y/N]
echo     5) เริ่มซื้อ-ย่อยวนอัตโนมัติ + สรุปผล
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

REM --- ต้องมี treasure.json อยู่โฟลเดอร์เดียวกัน ---
if not exist "treasure.json" (
    echo [!] ไม่พบไฟล์ treasure.json -- ต้องอยู่โฟลเดอร์เดียวกับ powder_farm.py
    echo.
    pause
    exit /b 1
)

REM --- ติดตั้งไลบรารีที่จำเป็น (ครั้งแรกอาจใช้เวลาสักครู่) ---
echo [*] ตรวจสอบ/ติดตั้งไลบรารี...
%PY% -m pip install -r requirements.txt --quiet --disable-pip-version-check
echo.

REM --- รันสคริปต์ ---
%PY% powder_farm.py

echo.
echo ============================================================
echo   จบการทำงาน -- กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง
echo ============================================================
pause >nul
