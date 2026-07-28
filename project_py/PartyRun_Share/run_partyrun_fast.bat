@echo off
chcp 65001 >nul
title Cookie Run - Party Run Farm (FAST / AGGRESSIVE)
cd /d "%~dp0"

echo ============================================================
echo   Cookie Run - PARTY RUN FARM  *FAST / AGGRESSIVE*
echo ------------------------------------------------------------
echo   เวอร์ชันเร่งความเร็ว: ลดเวลาหน่วงต่อรอบ (playtime, claim poll,
echo   cooldown) ให้รอบจบไวขึ้น
echo.
echo   !! คำเตือน: PLAYTIME_SECONDS ต่ำเกินไป = เซิร์ฟเวอร์ปฏิเสธ
echo      "INVALID PLAY". ค่าปลอดภัยคือ 12 -- ลดทีละนิดแล้วสังเกต
echo      ถ้าเจอ INVALID PLAY / REWARD EXCEPTION ให้เพิ่มค่ากลับ
echo.
echo   ลำดับการทำงาน: เหมือนโหมดปกติ แต่ถามค่า pacing ตอนรัน
echo     และให้ยืนยันก่อนเริ่ม
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
%PY% partyrun_fast.py

echo.
echo ============================================================
echo   จบการทำงาน -- กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง
echo ============================================================
pause >nul
