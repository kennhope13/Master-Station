#!/bin/bash
# ============================================================
# start-all.sh — Khởi động TRẠM TỔNG (Central Hub)
#
# Port trạm tổng (KHÔNG đụng trạm con):
#   Backend   : 6000   (trạm con: 5000)
#   Frontend  : 6173   (trạm con: 5173)
#   PostgreSQL: 6432   (trạm con: 5432)
#   go2rtc    : 2984   (trạm con: 1984)
#   AI Engine : 9100   (trạm con: 8100)
#
# Container Docker trạm tổng:
#   stationos-central-db     (trạm con: stationos-dev-db / stationmonitor-db)
#   stationos-central-go2rtc (trạm con: stationos-go2rtc)
# ============================================================

ROOT="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
RUN_DIR="$ROOT/.run"
cd "$ROOT"

mkdir -p "$RUN_DIR"

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
    local pid_file="$RUN_DIR/$name.pid"
    local pid

    [ -f "$pid_file" ] || return 0

    pid=$(cat "$pid_file" 2>/dev/null)
    if is_pid_running "$pid"; then
        echo "  Dừng tiến trình $name (PID: $pid)"
        # Kill cả process tree (dotnet run → StationOS.Api → children)
        pkill -TERM -P "$pid" 2>/dev/null || true
        kill "$pid" 2>/dev/null || true
        for _ in {1..10}; do
            is_pid_running "$pid" || break
            sleep 1
        done
        if is_pid_running "$pid"; then
            echo "  Buộc dừng tiến trình $name (PID: $pid)"
            pkill -9 -P "$pid" 2>/dev/null || true
            kill -9 "$pid" 2>/dev/null || true
        fi
    fi

    rm -f "$pid_file"
}

# Giải phóng port bằng cách kill bất kỳ process nào đang listen trên đó
kill_port_process() {
    local port="$1"
    local pids
    pids=$(lsof -ti TCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    [ -z "$pids" ] && return 0
    echo "  Port $port bị chiếm (PID: $pids) — đang dừng..."
    echo "$pids" | xargs kill 2>/dev/null || true
    sleep 2
    pids=$(lsof -ti TCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo "  Buộc dừng port $port (PID: $pids)"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

echo "=================================================="
echo "   TRẠM TỔNG (CENTRAL HUB) — KHỞI ĐỘNG"
echo "=================================================="
echo ""

# ── 1. Dừng tiến trình cũ + giải phóng port ───────────────
echo "[1/5] Dừng tiến trình cũ của trạm tổng..."
stop_managed_process "backend"
stop_managed_process "frontend"
stop_managed_process "ai_engine"
# Giải phóng port dù PID file không tồn tại hoặc không khớp
kill_port_process 6000
kill_port_process 6173
echo "✅ Đã giải phóng port và dừng tiến trình cũ."

# ── 2. Khởi động Database (chỉ container của trạm tổng) ───
echo "[2/5] Khởi động Database trạm tổng (stationos-central-db, port 6432)..."
if sudo docker inspect stationos-central-db >/dev/null 2>&1; then
    sudo docker start stationos-central-db >/dev/null 2>&1 \
        && echo "✅ Database đã khởi động lại (container cũ)" \
        || sudo docker compose -f "$ROOT/docker-compose.db.yml" up -d
else
    sudo docker compose -f "$ROOT/docker-compose.db.yml" up -d \
        && echo "✅ Database đã tạo mới (port 6432, DB: StationOS_Central)" \
        || echo "⚠️  Không thể start Docker DB — đảm bảo port 6432 có PostgreSQL."
fi

# ── 3. Khởi động go2rtc (chỉ container của trạm tổng) ─────
echo "[3/5] Khởi động go2rtc trạm tổng (stationos-central-go2rtc, port 2984)..."
if command -v docker &>/dev/null; then
    sudo docker rm -f stationos-central-go2rtc >/dev/null 2>&1 || true
    sudo docker run -d --name stationos-central-go2rtc \
        -p 2984:2984 -p 9554:9554 -p 9555:9555 \
        -v "$ROOT/go2rtc/go2rtc.yaml:/config/go2rtc.yaml" \
        alexxit/go2rtc:latest >/dev/null 2>&1 \
        && echo "✅ go2rtc đang chạy (port 2984)" \
        || echo "⚠️  Không thể start go2rtc — stream video có thể không hoạt động."
fi

# ── 4. Khởi động Backend .NET ──────────────────────────────
echo "[4/5] Khởi động Backend trạm tổng (port 6000)..."
export DOTNET_CLI_HOME=/tmp
export STATIONOS_LICENSE_DEBUG=1
export STATIONOS_VENDOR_PUBLIC_KEY="$(python3 - <<'PY'
import json
from pathlib import Path
path = Path("/home/admin-/Desktop/Master-Station/backend/StationOS.Api/appsettings.json")
data = json.loads(path.read_text())
print(data["License"]["VendorPublicKey"])
PY
)"
export STATIONOS_VENDOR_SECRET="$(python3 - <<'PY'
import json
from pathlib import Path
paths = [
    Path("/home/admin-/Desktop/Master-Station/backend/StationOS.Api/appsettings.json"),
    Path("/home/admin-/Desktop/Power-Monitor/backend/StationOS.Api/appsettings.json"),
]
for path in paths:
    if not path.exists():
        continue
    value = (json.loads(path.read_text()).get("License", {}) or {}).get("VendorSecret")
    if value:
        print(value)
        break
PY
)"

echo "  Biên dịch backend trước khi chạy để tránh dính binary cũ..."
nohup dotnet run --project "$ROOT/backend/StationOS.Api" > "$ROOT/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "$RUN_DIR/backend.pid"
echo "  Backend PID: $BACKEND_PID — đợi sẵn sàng..."

# Chờ tối đa 120s (đủ cho cả lần đầu build)
for i in {1..40}; do
    sleep 3
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:6000/health 2>/dev/null)
    if [ "$STATUS" = "200" ]; then
        echo "✅ Backend sẵn sàng (port 6000)!"
        break
    fi
    if [ $i -eq 40 ]; then
        echo "⚠️  Backend chưa phản hồi sau 120s — xem log: tail -f $ROOT/backend.log"
    fi
done

echo ""
echo "=================================================="
echo " TRẠM TỔNG SẴN SÀNG"
echo ""
echo " Frontend  : http://localhost:6173"
echo " Backend   : http://localhost:6000/swagger"
echo " go2rtc    : http://localhost:2984"
echo " Database  : localhost:6432 (StationOS_Central)"
echo ""
echo " Đăng nhập đa trạm: multi / Demo@2024"
echo " Log backend : tail -f $ROOT/backend.log"
# echo " Log AI      : tail -f $ROOT/ai_engine.log"
echo "=================================================="
echo ""

# ── 5. Khởi động AI Engine ────────────────────────────────
# Đã tắt cho trạm tổng: không khởi động AI Engine từ script này.
# echo "[5/5] Khởi động AI Engine trạm tổng (port 9100)..."
# cd "$ROOT/ai_engine"
# if [ -d ".venv" ]; then
#     .venv/bin/pip install -r requirements.txt >/dev/null 2>&1 || true
#     nohup .venv/bin/python main.py > "$ROOT/ai_engine.log" 2>&1 &
# else
#     pip3 install -r requirements.txt >/dev/null 2>&1 || true
#     nohup python3 main.py > "$ROOT/ai_engine.log" 2>&1 &
# fi
# echo "✅ AI Engine khởi chạy (port 9100)"
#
# Chờ AI Engine (tối đa 20s) trước khi start Vite
# for i in {1..20}; do
#     curl -s http://localhost:9100/health >/dev/null 2>&1 && break
#     sleep 1
# done

# ── 6. Khởi động Frontend Vite (foreground) ───────────────
cd "$ROOT/frontend"
[ ! -d "node_modules" ] && echo "📦 Cài npm packages..." && npm install

npm run dev -- --host &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "$RUN_DIR/frontend.pid"

cleanup_frontend_pid() {
    rm -f "$RUN_DIR/frontend.pid"
}

trap cleanup_frontend_pid EXIT
echo "  Frontend PID: $FRONTEND_PID"
wait "$FRONTEND_PID"
