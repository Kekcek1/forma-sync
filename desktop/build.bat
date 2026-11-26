@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist web xcopy /E /I /Y "..\build\sync" web >nul
python -m pip install --quiet pywebview pyinstaller
python -m PyInstaller --noconfirm --clean --onefile --windowed --name Forma --add-data "web;web" app.py
echo.
echo Готово: dist\Forma.exe
pause
