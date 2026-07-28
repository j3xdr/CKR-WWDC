@echo off
cd /d "%~dp0"
where pythonw >nul 2>nul
if %errorlevel%==0 (
    start "" pythonw "gui.pyw"
) else (
    where python >nul 2>nul
    if %errorlevel%==0 (
        start "" python "gui.pyw"
    ) else (
        echo Python not found -- install from https://python.org  ^(tick "Add Python to PATH"^)
        pause
    )
)
