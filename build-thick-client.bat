@echo off
REM ================================================================
REM build-thick-client.bat
REM Build Thick Client (All-in-One) cho người dùng cuối (Windows)
REM Bao gồm: Backend .NET 8, PostgreSQL, go2rtc, React Frontend, Electron
REM ================================================================

echo.
echo ============================================================
echo   MASTER STATION - BUILD THICK CLIENT INSTALLER
echo ============================================================
echo.

set ROOT_DIR=%~dp0
cd /d "%ROOT_DIR%"

echo [1/5] Building Backend (.NET 8)...
dotnet publish backend/StationOS.Api/StationOS.Api.csproj -c Release -r win-x64 --self-contained true -o backend_published/win-x64
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Build backend that bai!
    pause & exit /b 1
)

echo Cleaning up unnecessary backend published files...
if exist "backend_published\win-x64\wwwroot\media" rd /s /q "backend_published\win-x64\wwwroot\media"
if exist "backend_published\win-x64\wwwroot\detections" rd /s /q "backend_published\win-x64\wwwroot\detections"
if exist "backend_published\win-x64\wwwroot\videos" rd /s /q "backend_published\win-x64\wwwroot\videos"
if exist "backend_published\win-x64\wwwroot\reports" rd /s /q "backend_published\win-x64\wwwroot\reports"

echo.
echo [2/5] Preparing Portable Binaries...
REM 2.1 PostgreSQL Portable
if not exist "pg_portable" (
    echo Tai PostgreSQL Portable...
    curl -Lo pg.zip "https://get.enterprisedb.com/postgresql/postgresql-16.3-1-windows-x64-binaries.zip"
    powershell -Command "Expand-Archive -Path pg.zip -DestinationPath ."
    move pgsql pg_portable
    del pg.zip
) else (
    echo Da ton tai pg_portable.
)

echo Cleaning up pg_portable administrative tools and debug symbols...
if exist "pg_portable\pgAdmin 4" rd /s /q "pg_portable\pgAdmin 4"
if exist "pg_portable\symbols" rd /s /q "pg_portable\symbols"
if exist "pg_portable\doc" rd /s /q "pg_portable\doc"
if exist "pg_portable\include" rd /s /q "pg_portable\include"
if exist "pg_portable\StackBuilder" rd /s /q "pg_portable\StackBuilder"

REM 2.2 go2rtc
if not exist "go2rtc\go2rtc.exe" (
    echo Tai go2rtc...
    mkdir go2rtc
    curl -Lo go2rtc.zip "https://github.com/AlexxIT/go2rtc/releases/download/v1.9.2/go2rtc_win64.zip"
    powershell -Command "Expand-Archive -Path go2rtc.zip -DestinationPath go2rtc"
    del go2rtc.zip
) else (
    echo Da ton tai go2rtc.
)

REM 2.3 VC++ Redistributable (danh cho pg_portable va cac module c++)
if not exist "vc_redist.x64.exe" (
    echo Tai VC++ Redistributable...
    curl -Lo vc_redist.x64.exe "https://aka.ms/vs/17/release/vc_redist.x64.exe"
) else (
    echo Da ton tai vc_redist.x64.exe.
)

echo.
echo [3/5] Building Frontend (Vite + React)...
cd /d "%ROOT_DIR%\frontend"
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm install that bai!
    pause & exit /b 1
)
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] build frontend that bai!
    pause & exit /b 1
)

echo.
echo [4/5] Packaging with Electron Builder...
call npm run electron:build:win
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Build electron that bai!
    pause & exit /b 1
)

echo.
echo ============================================================
echo   BUILD THANH CONG!
echo.
echo   Installer nam o:
echo   frontend\dist-electron\
echo ============================================================
pause
