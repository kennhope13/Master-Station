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
cd "$ROOT"

echo "=================================================="
echo "   TRẠM TỔNG (CENTRAL HUB) — KHỞI ĐỘNG"
echo "=================================================="
echo ""

# ── 1. Kill process đang giữ port của TRẠM TỔNG ──────────
# Chỉ kill theo port cụ thể — KHÔNG pkill theo tên process
# để tránh kill nhầm tiến trình của trạm con
echo "[1/5] Giải phóng port trạm tổng (6000, 6173, 9100, 2984)..."
for port in 6000 6173 9100 9105 2984 9554 9555; do
    PIDS=$(lsof -t -i:$port 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "  Kill process giữ port $port (PID: $PIDS)"
        echo "$PIDS" | xargs kill -9 >/dev/null 2>&1 || true
    fi
done
echo "✅ Giải phóng port hoàn tất."

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
nohup dotnet run --project "$ROOT/backend/StationOS.Api" > "$ROOT/backend.log" 2>&1 &
BACKEND_PID=$!
echo "  Backend PID: $BACKEND_PID — đợi sẵn sàng..."

for i in {1..20}; do
    sleep 3
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:6000/health 2>/dev/null)
    if [ "$STATUS" = "200" ]; then
        echo "✅ Backend sẵn sàng (port 6000)!"
        break
    fi
    if [ $i -eq 20 ]; then
        echo "⚠️  Backend chưa phản hồi sau 60s — xem log: tail -f $ROOT/backend.log"
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
npm run dev -- --host
