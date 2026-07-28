@echo off
chcp 65001 >nul
title Cookie Run - Heart Farm (Safe)
cd /d "%~dp0"

echo ============================================================
echo   Cookie Run - HEART FARM  (ปั๊มหัวใจ / โหมดปลอดภัย)
echo ------------------------------------------------------------
echo   ลำดับการทำงาน:
echo     1) Login บัญชีหลัก (กรอก email/password ตอนรัน)
echo     2) ใส่ Proxy URL (กด Enter ข้ามได้ ถ้าไม่มี)
echo     3) ใส่จำนวนหัวใจที่ต้องการ (TARGET_HEARTS)
echo     4) วนสร้าง guest -^> แอดเพื่อน -^> ส่งหัวใจ -^> เก็บ -^> ลบ guest
echo        จนครบเป้าหมาย (เพื่อนจริงไม่ถูกแตะ)
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

REM --- ต้องมี _descriptors.bin อยู่โฟลเดอร์เดียวกัน ---
if not exist "_descriptors.bin" (
    echo [!] ไม่พบไฟล์ _descriptors.bin -- ต้องอยู่โฟลเดอร์เดียวกับ heart_farm.py
    echo.
    pause
    exit /b 1
)

REM --- ติดตั้งไลบรารีที่จำเป็น (ครั้งแรกอาจใช้เวลาสักครู่) ---
echo [*] ตรวจสอบ/ติดตั้งไลบรารี...
%PY% -m pip install -r requirements.txt --quiet --disable-pip-version-check
echo.

REM --- รันสคริปต์ ---
%PY% heart_farm.py

echo.
echo ============================================================
echo   จบการทำงาน -- กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง
echo ============================================================
pause >nul
