#!/bin/bash
# ================================================================
# build-thick-client.sh
# Build Thick Client (All-in-One) cho người dùng cuối (Windows x64) từ môi trường Linux (WSL/CI)
# Bao gồm: Backend .NET 8, PostgreSQL, go2rtc, React Frontend, Electron
# ================================================================

set -e

echo ""
echo "============================================================"
echo "  MASTER STATION - BUILD THICK CLIENT INSTALLER"
echo "============================================================"
echo ""

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "[1/5] Building Backend (.NET 8)..."
dotnet publish backend/StationOS.Api/StationOS.Api.csproj -c Release -r win-x64 --self-contained true -o backend_published/win-x64

echo "Cleaning up unnecessary backend published files..."
rm -rf backend_published/win-x64/wwwroot/media
rm -rf backend_published/win-x64/wwwroot/detections
rm -rf backend_published/win-x64/wwwroot/videos
rm -rf backend_published/win-x64/wwwroot/reports

echo ""
echo "[2/5] Preparing Portable Binaries..."
# 2.1 PostgreSQL Portable
if [ ! -d "pg_portable" ]; then
    echo "Tai PostgreSQL Portable..."
    curl -Lo pg.zip "https://get.enterprisedb.com/postgresql/postgresql-16.3-1-windows-x64-binaries.zip"
    unzip -q pg.zip
    mv pgsql pg_portable
    rm pg.zip
else
    echo "Da ton tai pg_portable."
fi

echo "Cleaning up pg_portable administrative tools and debug symbols..."
rm -rf "pg_portable/pgAdmin 4"
rm -rf pg_portable/symbols
rm -rf pg_portable/doc
rm -rf pg_portable/include
rm -rf pg_portable/StackBuilder

# 2.2 go2rtc
if [ ! -f "go2rtc/go2rtc.exe" ]; then
    echo "Tai go2rtc..."
    mkdir -p go2rtc
    curl -Lo go2rtc.zip "https://github.com/AlexxIT/go2rtc/releases/download/v1.9.2/go2rtc_win64.zip"
    unzip -q go2rtc.zip -d go2rtc
    rm go2rtc.zip
else
    echo "Da ton tai go2rtc."
fi

# 2.3 VC++ Redistributable
if [ ! -f "vc_redist.x64.exe" ]; then
    echo "Tai VC++ Redistributable..."
    curl -Lo vc_redist.x64.exe "https://aka.ms/vs/17/release/vc_redist.x64.exe"
else
    echo "Da ton tai vc_redist.x64.exe."
fi

echo ""
echo "[3/5] Building Frontend (Vite + React)..."
cd "$ROOT_DIR/frontend"
npm install
npm run build

echo ""
echo "[4/5] Packaging with Electron Builder..."
npm run electron:build:win

echo ""
echo "============================================================"
echo "  BUILD THANH CONG!"
echo ""
echo "  Installer nam o:"
echo "  frontend/dist-electron/"
echo "============================================================"
