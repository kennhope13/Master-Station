#!/bin/bash
# ============================================================
# stop-all.sh — Dừng TRẠM TỔNG (Central Hub)
# Chỉ dừng đúng port/container của trạm tổng
# KHÔNG đụng đến trạm con
# ============================================================

echo "=================================================="
echo "   TRẠM TỔNG — DỪNG HỆ THỐNG"
echo "=================================================="
echo ""

# ── 1. Dừng go2rtc trạm tổng (chỉ container stationos-central-go2rtc) ──
echo "[1/4] Dừng go2rtc trạm tổng..."
sudo docker rm -f stationos-central-go2rtc >/dev/null 2>&1 && echo "  ✅ Đã dừng stationos-central-go2rtc" || true

# ── 2. Kill process theo port — KHÔNG pkill theo tên ──────
# pkill theo tên sẽ kill cả trạm con vì cùng tên process
echo "[2/4] Dừng Backend, AI Engine, Frontend (theo port)..."
for port in 6000 6173 9100 9105 2984 9554 9555; do
    PIDS=$(lsof -t -i:$port 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "  Kill port $port (PID: $PIDS)"
        echo "$PIDS" | xargs kill -9 >/dev/null 2>&1 || true
    fi
done

# ── 3. Giữ nguyên Database ────────────────────────────────
echo "[3/4] Database PostgreSQL giữ nguyên (bảo lưu dữ liệu)."
echo "      Để dừng hẳn: sudo docker compose -f docker-compose.db.yml down"

echo ""
echo "=================================================="
echo " Đã dừng: Backend (6000) · Frontend (6173) · go2rtc (2984) · AI (9100)"
echo " Trạm con KHÔNG bị ảnh hưởng."
echo "=================================================="
