@echo off
chcp 65001 >nul
title Cookie Run - Heart Farm (FAST / AGGRESSIVE)
cd /d "%~dp0"

echo ============================================================
echo   Cookie Run - HEART FARM  *FAST / AGGRESSIVE*
echo ------------------------------------------------------------
echo   เวอร์ชันเร่งความเร็ว (connection pool + gRPC channel pool +
echo   concurrency สูงขึ้น). เร็วกว่าโหมดปกติ แต่...
echo.
echo   !! คำเตือน: การเขียนลงบัญชีจริงเร็วขึ้น (STREAM_CONCURRENCY)
echo      อาจโดน rate-limit หรือถูก flag บัญชีได้ -- ใช้ตามความเสี่ยง
echo      ตัวเอง ถ้าเจอ accept/sendlife error เยอะ ให้ลดค่าลง
echo.
echo   ลำดับการทำงาน: เหมือนโหมดปกติ แต่ถามค่า concurrency ตอนรัน
echo     และให้ยืนยันก่อนเริ่มถ้าตั้งค่าแรงกว่าปกติ
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
    echo [!] ไม่พบไฟล์ _descriptors.bin -- ต้องอยู่โฟลเดอร์เดียวกับ heart_farm_fast.py
    echo.
    pause
    exit /b 1
)

REM --- ติดตั้งไลบรารีที่จำเป็น (ครั้งแรกอาจใช้เวลาสักครู่) ---
echo [*] ตรวจสอบ/ติดตั้งไลบรารี...
%PY% -m pip install -r requirements.txt --quiet --disable-pip-version-check
echo.

REM --- รันสคริปต์ ---
%PY% heart_farm_fast.py

echo.
echo ============================================================
echo   จบการทำงาน -- กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง
echo ============================================================
pause >nul
