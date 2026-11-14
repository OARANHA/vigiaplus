@echo off
setlocal
cd /d "%~dp0"
set "VIGIA_MODE=owner"
if /I "%~1"=="demo" set "VIGIA_MODE=demo"
echo.
echo Vigiaplus - iniciando na porta 3199 (127.0.0.1)
echo Banco local isolado. Nenhuma conexao Neon ou producao.
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-vigiaplus-local.ps1" -Mode "%VIGIA_MODE%" -Port 3199
if errorlevel 1 (
 echo.
 echo Inicializacao interrompida. Confira os erros acima.
 pause
)
endlocal
