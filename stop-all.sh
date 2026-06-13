#!/bin/bash
# ============================================================
# stop-all.sh — Dừng TRẠM TỔNG (Central Hub)
# Chỉ dừng đúng port/container của trạm tổng
# KHÔNG đụng đến trạm con
# ============================================================

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RUN_DIR="$ROOT/.run"

is_pid_running() {
    local pid="$1"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

pid_matches_project() {
    local pid="$1"
    local expected="$2"
    local args
    args=$(ps -p "$pid" -o args= 2>/dev/null || true)
    [[ -n "$args" && "$args" == *"$ROOT"* && "$args" == *"$expected"* ]]
}

stop_managed_process() {
    local name="$1"
    local expected="$2"
    local pid_file="$RUN_DIR/$name.pid"
    local pid

    [ -f "$pid_file" ] || return 0

    pid=$(cat "$pid_file" 2>/dev/null)
    if is_pid_running "$pid" && pid_matches_project "$pid" "$expected"; then
        echo "  Dừng $name (PID: $pid)"
        kill "$pid" 2>/dev/null || true
        for _ in {1..10}; do
            is_pid_running "$pid" || break
            sleep 1
        done
        if is_pid_running "$pid"; then
            echo "  Buộc dừng $name (PID: $pid)"
            kill -9 "$pid" 2>/dev/null || true
        fi
    fi

    rm -f "$pid_file"
}

echo "=================================================="
echo "   TRẠM TỔNG — DỪNG HỆ THỐNG"
echo "=================================================="
echo ""

# ── 1. Dừng go2rtc trạm tổng (chỉ container stationos-central-go2rtc) ──
echo "[1/4] Dừng go2rtc trạm tổng..."
sudo docker rm -f stationos-central-go2rtc >/dev/null 2>&1 && echo "  ✅ Đã dừng stationos-central-go2rtc" || true

# ── 2. Chỉ dừng tiến trình đã được script này ghi nhận ────
echo "[2/4] Dừng Backend, AI Engine, Frontend do trạm tổng khởi tạo..."
stop_managed_process "backend" "dotnet run --project $ROOT/backend/StationOS.Api"
stop_managed_process "frontend" "npm run dev -- --host"
stop_managed_process "ai_engine" "main.py"

# ── 3. Giữ nguyên Database ────────────────────────────────
echo "[3/4] Database PostgreSQL giữ nguyên (bảo lưu dữ liệu)."
echo "      Để dừng hẳn: sudo docker compose -f docker-compose.db.yml down"

echo ""
echo "=================================================="
echo " Đã dừng: Backend (6000) · Frontend (6173) · go2rtc (2984) · AI (9100)"
echo " Trạm con KHÔNG bị ảnh hưởng."
echo "=================================================="
