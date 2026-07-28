@echo off
chcp 65001 >nul
title Cookie Run - Party Run Farm (Safe)
cd /d "%~dp0"

echo ============================================================
echo   Cookie Run - PARTY RUN FARM  (โหมดปลอดภัย)
echo ------------------------------------------------------------
echo   ลำดับการทำงาน:
echo     1) Login DevPlay (กรอก email/password ตอนรัน)
echo     2) เลือก preset (Max Profit / Safe / Custom: Score,Coin,EXP)
echo     3) ใส่จำนวนรอบที่จะรัน
echo     4) ต่อรอบ: เคลียร์ reward ค้าง -^> matchmake -^> เล่น+ส่งผล
echo        -^> เคลม reward
echo.
echo   * บัญชีต้องผูก DevPlay (email/password) และมีตั๋ว Party Run
echo   * เพดานที่ทดสอบแล้ว: Coin ^<= 449,000 / EXP ^<= 52,000
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
%PY% partyrun_single_file.py

echo.
echo ============================================================
echo   จบการทำงาน -- กดปุ่มใดก็ได้เพื่อปิดหน้าต่าง
echo ============================================================
pause >nul
