"""
main.py — Entry point của AI Engine
Khởi động FastAPI + scheduler định kỳ xử lý frame từ tất cả analyzer
"""
import os
# Tắt hoàn toàn log rác, cảnh báo kết nối sai của OpenCV và FFMPEG để giữ log file cực kỳ sạch đẹp
os.environ["OPENCV_LOG_LEVEL"] = "OFF"
os.environ["OPENCV_FFMPEG_LOGLEVEL"] = "-8"

import asyncio
import logging
import signal
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from api import routes

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)
cfg = get_settings()


# ── Scheduler: xử lý định kỳ ─────────────────────────────────

async def _process_loop() -> None:
    """Gọi process() SONG SONG cho tất cả analyzer để đảm bảo tần suất ổn định."""
    while True:
        try:
            tasks = []
            for a in routes._thermal_analyzers.values(): tasks.append(a.process())
            for d in routes._line_detectors.values():  tasks.append(d.process())
            for c in routes._acoustic_analyzers.values(): tasks.append(c.process())
            
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

        except Exception as ex:
            logger.error("[Scheduler] Critical Loop Error: %s", ex)

        await asyncio.sleep(cfg.process_interval)


# ── Lifespan ─────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Quản lý vòng đời ứng dụng: khởi tạo analyzer và scheduler khi bật, dọn dẹp khi tắt."""
    logger.info("=== StationOS AI Aggregator starting ===")
    logger.info("Backend : %s", cfg.backend_url)
    logger.info("Port    : 9100")
    
    # Kích hoạt chế độ xử lý camera trực tiếp và tự động load config
    await _load_config_from_backend()
    # Immediately trigger a processing cycle so that predictions are available right after startup
    for analyzer in list(routes._thermal_analyzers.values()):
        await analyzer.process()
    for detector in list(routes._line_detectors.values()):
        await detector.process()
    for acoustic in list(routes._acoustic_analyzers.values()):
        await acoustic.process()
    task = asyncio.create_task(_process_loop())
    
    yield
    task.cancel()
    logger.info("=== AI Aggregator stopped ===")


async def _load_config_from_backend() -> None:
    """
    Đọc danh sách device từ backend API → tự cấu hình analyzer.
    Gọi khi khởi động để không cần cấu hình thủ công.
    """
    import httpx
    devices = []
    max_retries = 30
    retry_delay = 2.0
    for attempt in range(1, max_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{cfg.backend_url}/api/v1/devices")
                if resp.status_code == 200:
                    devices = resp.json()
                    logger.info("[Startup] Successfully loaded devices from backend on attempt %d", attempt)
                    break
                else:
                    logger.warning("[Startup] Attempt %d: backend returned status %d", attempt, resp.status_code)
        except Exception as ex:
            logger.warning("[Startup] Attempt %d: Failed to connect to backend: %s", attempt, ex)
        
        if attempt < max_retries:
            await asyncio.sleep(retry_delay)

    if not devices:
        logger.error("[Startup] Could not fetch devices from backend after %d attempts", max_retries)
        return

    try:
        for d in devices:
            cfg_raw = d.get("config") or {}
            if isinstance(cfg_raw, str):
                import json
                cfg_raw = json.loads(cfg_raw)

            ip = cfg_raw.get("ip")
            if not ip:
                continue

            dev_type = d.get("type", "")
            
            password = cfg_raw.get("password", "")
            username = cfg_raw.get("username", "admin")
            if password == "***" or not password:
                try:
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        r_cred = await client.get(f"{cfg.backend_url}/api/v1/devices/{d['id']}/credentials")
                        if r_cred.status_code == 200:
                            cred = r_cred.json()
                            password = cred.get("password", "")
                            username = cred.get("username", username)
                except Exception as ex:
                    logger.warning("[Startup] Cannot fetch credentials for %s: %s", d["id"], ex)

            stream_id = cfg_raw.get("go2rtc_id")
            if not stream_id:
                if dev_type in ("camera_dual", "camera_thermal"):
                    stream_id = cfg_raw.get("go2rtc_thermal")
                else:
                    stream_id = cfg_raw.get("go2rtc_optical")

            if not stream_id:
                continue

            if dev_type == "camera_thermal" or dev_type == "camera_dual":
                # Camera nhiệt: khởi tạo điểm đo + vùng đo từ database
                from services.thermal.thermal_analyzer import ThermalAnalyzer, ThermalPoint, ThermalZone
                points = []
                zones = []
                try:
                    async with httpx.AsyncClient(timeout=5.0) as client:
                        # 1. Load ROI points
                        roi_resp = await client.get(f"{cfg.backend_url}/api/v1/devices/{d['id']}/roi-points")
                        if roi_resp.status_code == 200:
                            for r in roi_resp.json():
                                tx = r.get("tx")
                                ty = r.get("ty")
                                ox = r.get("ox")
                                oy = r.get("oy")
                                
                                # Fallback & Mapping logic from Optical to Thermal
                                if tx is None or ty is None:
                                    if ox is not None and oy is not None:
                                        # Map from optical to thermal
                                        focal_opt = cfg_raw.get("focal_length_optical")
                                        focal_th = cfg_raw.get("focal_length_thermal")
                                        if focal_opt is not None and focal_th is not None and float(focal_opt) == float(focal_th) and float(focal_opt) > 0:
                                            vvr_x = 0.0
                                            vvr_y = 0.0
                                            vvr_w = 1.0
                                            vvr_h = 1.0
                                        else:
                                            vvr_raw = cfg_raw.get("visible_valid_rect", {})
                                            vvr_x = float(vvr_raw.get("x", 0.20))
                                            vvr_y = float(vvr_raw.get("y", 0.084))
                                            vvr_w = float(vvr_raw.get("width", 0.63))
                                            vvr_h = float(vvr_raw.get("height", 0.841))
                                        
                                        # Inverse mapping: from full optical frame to thermal valid rect
                                        tx = (ox - vvr_x) / vvr_w
                                        ty = (oy - vvr_y) / vvr_h
                                    else:
                                        tx, ty = 0.5, 0.5
                                        
                                # Đảm bảo nằm trong dải 0.0 - 1.0
                                tx = max(0.0, min(1.0, float(tx)))
                                ty = max(0.0, min(1.0, float(ty)))

                                points.append(ThermalPoint(
                                    id=r.get("pointId") or f"P{r.get('sortOrder') or len(points)+1}",
                                    x=tx, y=ty,
                                    pre_alarm=float(r.get("preAlarmThreshold") or 0.0),
                                    alarm=float(r.get("alarmThreshold") or 0.0),
                                    label=r.get("name", ""),
                                ))

                        # 2. Load ROI boundaries (zones)
                        bound_resp = await client.get(f"{cfg.backend_url}/api/v1/devices/{d['id']}/boundaries?type=roi")
                        if bound_resp.status_code == 200:
                            for b in bound_resp.json():
                                try:
                                    import json
                                    poly = json.loads(b["polygon"])
                                    thresholds = json.loads(b.get("thresholds") or "{}")
                                    zones.append(ThermalZone(
                                        id=str(b["id"]),
                                        polygon=poly,
                                        pre_alarm=thresholds.get("warning") or thresholds.get("preAlarm") or 0.0,
                                        alarm=thresholds.get("alarm") or 0.0,
                                        label=b["name"]
                                    ))
                                except Exception as json_err:
                                    logger.warning("[Startup] Failed to parse boundary polygon/thresholds for device %s: %s", d["id"], json_err)
                    
                    logger.info("[Startup] Loaded %d points and %d zones for device %s", len(points), len(zones), d["id"])
                except Exception as ex:
                    logger.warning("[Startup] Failed to fetch ROI for device %s: %s", d["id"], ex)


                focal_opt = cfg_raw.get("focal_length_optical")
                focal_th = cfg_raw.get("focal_length_thermal")
                if focal_opt is not None and focal_th is not None and float(focal_opt) == float(focal_th) and float(focal_opt) > 0:
                    vx, vy, vw, vh = 0.0, 0.0, 1.0, 1.0
                else:
                    vvr_raw = cfg_raw.get("visible_valid_rect", {})
                    vx = float(vvr_raw.get("x", 0.20))
                    vy = float(vvr_raw.get("y", 0.084))
                    vw = float(vvr_raw.get("width", 0.63))
                    vh = float(vvr_raw.get("height", 0.841))

                analyzer = ThermalAnalyzer(
                    device_id=d["id"],
                    camera_ip=ip,
                    username=username,
                    password=password,
                    stream_id=stream_id,
                    points=points,
                    zones=zones,
                    vvr_x=vx,
                    vvr_y=vy,
                    vvr_w=vw,
                    vvr_h=vh
                )
                analyzer.start()
                routes._thermal_analyzers[stream_id] = analyzer
                logger.info("[Startup] Thermal analyzer started: %s (%d points, %d zones) with VVR mapping", stream_id, len(points), len(zones))

            elif dev_type == "camera_cctv":
                # Camera quang học: khởi tạo không có line (user thêm qua UI)
                from services.detection.line_detector import LineDetector
                detector = LineDetector(
                    device_id=d["id"],
                    camera_ip=ip,
                    stream_id=stream_id,
                    lines=[],
                )
                detector.start()
                routes._line_detectors[stream_id] = detector
                logger.info("[Startup] Line detector started: %s (no lines configured)", stream_id)

            elif dev_type == "camera_pd":
                # Camera phóng điện (Acoustic Imager) — Tối ưu hóa cực kỳ gọn gàng và chuẩn hóa
                from services.acoustic.acoustic_analyzer import AcousticAnalyzer
                
                if password and password != "***":
                    analyzer = AcousticAnalyzer(
                        device_id=d["id"],
                        camera_ip=ip,
                        username=username,
                        password=password,
                        stream_id=stream_id
                    )
                    analyzer.start()
                    routes._acoustic_analyzers[stream_id] = analyzer
                    logger.info("[Startup] Acoustic analyzer started: %s", stream_id)
                else:
                    logger.warning("[Startup] Không thể khởi động AcousticAnalyzer cho %s vì thiếu mật khẩu thực", d["id"])

    except Exception as ex:
        logger.warning("[Startup] Auto-config failed: %s — sẽ dùng config thủ công", ex)


# ── App ───────────────────────────────────────────────────────

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="StationOS AI Engine", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes.router)
app.include_router(routes.router, prefix="/api/v1")


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=9100, reload=False, log_level="info")
