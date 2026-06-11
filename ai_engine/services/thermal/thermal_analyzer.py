"""
thermal_analyzer.py — Phân tích camera nhiệt
- Đọc nhiệt độ tại các điểm đo P1-P10 qua Hikvision ISAPI
- Vẽ điểm + nhãn nhiệt độ lên frame
- Gửi cảnh báo về backend nếu vượt ngưỡng
"""
import asyncio
import time
import logging
import httpx
import cv2
import numpy as np
from dataclasses import dataclass, field

from config import get_settings
from services.streaming.rtsp_reader import RtspReader

logger = logging.getLogger(__name__)
cfg = get_settings()


@dataclass
class ThermalPoint:
    """Một điểm đo nhiệt độ trên camera."""
    id:          str           # "P1", "P2", ...
    x:           float         # tỉ lệ 0.0-1.0 theo chiều ngang frame
    y:           float         # tỉ lệ 0.0-1.0 theo chiều dọc frame
    pre_alarm:   float = 0.0   # 0.0 = Vô hiệu hóa
    alarm:       float = 0.0
    label:       str = ""      # Nhãn hiển thị (tự sinh từ id nếu bỏ trống)

    def __post_init__(self):
        if not self.label:
            self.label = self.id


@dataclass
class ThermalZone:
    """Một vùng (polygon) đo nhiệt độ trên camera."""
    id:          str
    polygon:     list[list[float]]  # Danh sách điểm [[x,y], [x,y], ...] (0.0-1.0)
    pre_alarm:   float = 0.0
    alarm:       float = 0.0
    label:       str = ""

    def __post_init__(self):
        if not self.label:
            self.label = self.id


@dataclass
class ThermalAnalyzer:
    """Xử lý một camera nhiệt: đọc RTSP + ISAPI + annotate + gửi webhook."""
    device_id:   str
    camera_ip:   str
    username:    str
    password:    str
    stream_id:   str           # go2rtc stream ID (ví dụ: camera_152_thermal)
    points:      list[ThermalPoint] = field(default_factory=list)
    zones:       list[ThermalZone]  = field(default_factory=list)
    vvr_x:       float = 0.20
    vvr_y:       float = 0.084
    vvr_w:       float = 0.63
    vvr_h:       float = 0.841

    _reader:     RtspReader | None = field(default=None, init=False, repr=False)
    _last_alert: dict[str, float]  = field(default_factory=dict, init=False, repr=False)
    _consecutive_auth_failures: int = field(default=0, init=False, repr=False)
    _auth_cooldown_until:       float = field(default=0.0, init=False, repr=False)

    last_point_temps:           dict[str, float]  = field(default_factory=dict, init=False, repr=False)
    last_zone_results:          dict[str, dict]   = field(default_factory=dict, init=False, repr=False)
    _last_history_save:         float             = field(default=0.0, init=False, repr=False)
    _last_jetson_push:          float             = field(default=0.0, init=False, repr=False)
    _last_matrix_fetch:         float             = field(default=0.0, init=False, repr=False)
    _cached_matrix:             any               = field(default=None, init=False, repr=False)

    def start(self) -> None:
        rtsp_url = f"{cfg.go2rtc_rtsp}/{self.stream_id}"
        self._reader = RtspReader(rtsp_url, self.stream_id)
        self._reader.start()
        self._fallback_reader = None

    def stop(self) -> None:
        if self._reader:
            self._reader.stop()
        if getattr(self, '_fallback_reader', None):
            self._fallback_reader.stop()
        if hasattr(self, '_http_client'):
            try:
                import asyncio
                asyncio.create_task(self._http_client.aclose())
            except Exception: pass

    def update_config(self, points: list[ThermalPoint], zones: list[ThermalZone], force_jetson_push: bool = False) -> None:
        """Cập nhật cấu hình các điểm và vùng đo nhiệt.
        
        force_jetson_push=True: Reset bộ đếm 5 phút, gửi sang Jetson ngay lần tiếp theo.
                                Dùng khi người dùng thay đổi cấu hình điểm đo trên giao diện.
        force_jetson_push=False (mặc định): Giữ nguyên bộ đếm, KHÔNG reset.
                                Dùng khi Jetson tự ping /config/thermal để đồng bộ (tránh vòng lặp).
        """
        self.points = points
        self.zones = zones
        self._rules_synced = False
        if force_jetson_push:
            self._last_jetson_push = 0.0
        self._last_history_save = 0.0

    # ── Main process (gọi định kỳ từ scheduler) ──────────────

    async def process(self) -> None:
        """Đọc nhiệt độ tại các điểm và vùng, annotate frame, gửi alert nếu cần."""
        # 1. Đọc matrix nhiệt từ camera (cache 1.0 giây để tránh overload camera)
        now = time.time()
        should_fetch = (now - self._last_matrix_fetch >= 1.0)
        
        point_temps = self.last_point_temps
        zone_results = self.last_zone_results
        
        if should_fetch:
            matrix_data = await self._read_thermal_matrix()
            if matrix_data:
                self._cached_matrix = matrix_data
                self._last_matrix_fetch = now
                self._consecutive_failures = 0
                
                point_temps = {}
                floats, w, h = matrix_data
                
                # Trích xuất nhiệt độ cho points
                for pt in self.points:
                    px = int(pt.x * w)
                    py = int(pt.y * h)
                    px = max(0, min(px, w - 1))
                    py = max(0, min(py, h - 1))
                    idx = py * w + px
                    point_temps[pt.id] = float(floats[idx])
                
                # Trích xuất nhiệt độ cho zones (Max temp trong vùng)
                zone_results = {}
                for zn in self.zones:
                    if not zn.polygon or len(zn.polygon) < 3:
                        continue
                    
                    # Tạo mask cho polygon trên matrix nhỏ
                    poly_pts = np.array([[int(p[0]*w), int(p[1]*h)] for p in zn.polygon], np.int32)
                    mask = np.zeros((h, w), dtype=np.uint8)
                    cv2.fillPoly(mask, [poly_pts], 255)
                    
                    # Lọc các giá trị nhiệt độ trong vùng
                    masked_floats = floats.reshape((h, w))[mask == 255]
                    if masked_floats.size > 0:
                        max_val = float(np.max(masked_floats))
                        
                        full_matrix = floats.reshape((h, w))
                        full_matrix_masked = np.where(mask == 255, full_matrix, -1000.0)
                        max_idx = np.argmax(full_matrix_masked)
                        max_y, max_x = divmod(max_idx, w)
                        
                        zone_results[zn.id] = {
                            "max": max_val,
                            "x": float(max_x / w),
                            "y": float(max_y / h)
                        }
                
                self.last_point_temps = point_temps
                self.last_zone_results = zone_results
                
                # Gửi nhiệt độ thực tế về backend
                await self._ingest_measurements(point_temps, zone_results)
            else:
                # 2. Fallback sang đọc rulesTemperatureInfo nếu matrix không hoạt động
                if not getattr(self, '_rules_synced', False):
                    synced = await self._sync_camera_rules()
                    if synced:
                        self._rules_synced = True
                
                new_point_temps = {}
                new_zone_results = {}
                temps_fetched = await self._read_rules_temperatures(new_point_temps, new_zone_results)
                if temps_fetched:
                    point_temps = new_point_temps
                    zone_results = new_zone_results
                    self.last_point_temps = point_temps
                    self.last_zone_results = zone_results
                    
                    self._consecutive_failures = 0
                    self._last_matrix_fetch = now
                    
                    # Gửi nhiệt độ thực tế về backend
                    await self._ingest_measurements(point_temps, zone_results)
                else:
                    self._consecutive_failures = getattr(self, '_consecutive_failures', 0) + 1
                    # Cooldown 4 giây (tổng cộng 5 giây) để camera hồi phục
                    self._last_matrix_fetch = now + 4.0

        # 4.3 Đẩy dữ liệu sang Jetson đối tác mỗi 5 phút
        now = time.time()
        if now - self._last_jetson_push >= 300.0:
            self._last_jetson_push = now 
            try:
                from datetime import datetime
                import requests
                # Hợp nhất cả điểm đo (points) và vùng đo (zones) sử dụng tên nhãn hiển thị (label)
                jetson_points = [{"id": pt.label or pt.id, "temperature": point_temps.get(pt.id)} for pt in self.points if point_temps.get(pt.id) is not None]
                jetson_points += [{"id": zn.label or zn.id, "temperature": zone_results[zn.id]["max"]} for zn in self.zones if zn.id in zone_results]
                
                if jetson_points:
                    payload = {
                        "camera_ip": self.camera_ip,
                        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                        "points": jetson_points
                    }
                    logger.info("[ThermalAnalyzer] Pushing %d points/zones to Jetson (%s): %s", len(jetson_points), self.camera_ip, payload)
                    try:
                        if not hasattr(self, '_http_client'):
                            self._http_client = httpx.AsyncClient(timeout=5.0)
                        r1 = await self._http_client.post("http://192.168.10.104:8080/api/thermal-data", json=payload)
                        logger.info("[ThermalAnalyzer] Push to /api/thermal-data status: %d", r1.status_code)
                    except Exception as e:
                        logger.error("[ThermalAnalyzer] Failed to push to /api/thermal-data: %s", e)
                        
                # 4.4 Gửi cấu hình tọa độ điểm/vùng sang Jetson (KHÔNG chứa temperature)
                config_points = [{"id": pt.label or pt.id, "x": pt.x, "y": pt.y, "pre_alarm": pt.pre_alarm, "alarm": pt.alarm, "label": pt.label or pt.id} for pt in self.points]
                config_zones = [{"id": zn.label or zn.id, "polygon": zn.polygon, "pre_alarm": zn.pre_alarm, "alarm": zn.alarm, "label": zn.label or zn.id} for zn in self.zones]
                config_payload = {
                    "stream_id": self.stream_id,
                    "device_id": self.device_id,
                    "camera_ip": self.camera_ip,
                    "username": self.username,
                    "password": self.password,
                    "points": config_points,
                    "zones": config_zones
                }
                try:
                    logger.info("[ThermalAnalyzer] Pushing config to Jetson: %s", config_payload)
                    if not hasattr(self, '_http_client'):
                        self._http_client = httpx.AsyncClient(timeout=5.0)
                    r2 = await self._http_client.post("http://192.168.10.104:8080/config/thermal", json=config_payload)
                    logger.info("[ThermalAnalyzer] Push to /config/thermal status: %d", r2.status_code)
                except Exception as e:
                    logger.error("[ThermalAnalyzer] Failed to push to /config/thermal: %s", e)
            except Exception as ex:
                logger.error("[ThermalAnalyzer] Critical push error: %s", ex)


        # 4.5 Pipeline dự báo AI cục bộ (mỗi 5 phút để đồng bộ với Jetson)
        if now - self._last_history_save >= 300.0:
            try:
                from services.thermal.thermal_forecaster import process_thermal_payload
                from datetime import datetime
                p_payload = [{"id": pt.label or pt.id, "temperature": point_temps.get(pt.id)} for pt in self.points if point_temps.get(pt.id) is not None]
                p_payload += [{"id": zn.label or zn.id, "temperature": zone_results[zn.id]["max"]} for zn in self.zones if zn.id in zone_results]
                if p_payload:
                    logger.info("[ThermalAnalyzer] Sending %d points to forecaster", len(p_payload))
                    process_thermal_payload({"timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "points": p_payload}, camera_id=self.stream_id)
                    self._last_history_save = now
                else:
                    logger.debug("[ThermalAnalyzer] No points available for forecaster")
            except Exception as e:
                logger.error("[ThermalAnalyzer] Forecaster call failed: %s", e)


        # 5. Serve MJPEG
        frame = self._reader.latest_frame if self._reader else None
        use_optical_mapping = False
        if frame is None:
            if not getattr(self, '_fallback_reader', None):
                if "120" in self.stream_id or "120" in self.camera_ip:
                    fallback_id = self.stream_id.replace("_thermal", "_optical")
                elif "hanoi" in self.stream_id:
                    fallback_id = self.stream_id.replace("_thermal", "_optical")
                else:
                    fallback_id = self.stream_id.replace("_thermal", "_normal")
                
                rtsp_url = f"{cfg.go2rtc_rtsp}/{fallback_id}"
                logger.info("[ThermalAnalyzer] Thermal stream %s offline. Starting fallback reader for optical stream %s → %s", self.stream_id, fallback_id, rtsp_url)
                self._fallback_reader = RtspReader(rtsp_url, fallback_id)
                self._fallback_reader.start()
            
            frame = self._fallback_reader.latest_frame if self._fallback_reader else None
            if frame is not None:
                use_optical_mapping = True
                
        if frame is not None:
            _annotated_frames[self.stream_id] = self._annotate(frame, point_temps, zone_results, use_optical_mapping=use_optical_mapping)

        # 6. Check alert
        await self._check_and_alert(point_temps, zone_results)

    async def _sync_camera_rules(self) -> bool:
        if not self.points and not self.zones:
            return False
        
        import xml.etree.ElementTree as ET
        
        # Build XML
        root = ET.Element("ThermometryScene", version="2.0", xmlns="http://www.isapi.org/ver20/XMLSchema")
        ET.SubElement(root, "id").text = "1"
        norm = ET.SubElement(root, "normalizedScreenSize")
        ET.SubElement(norm, "normalizedScreenWidth").text = "1000"
        ET.SubElement(norm, "normalizedScreenHeight").text = "1000"
        
        region_list = ET.SubElement(root, "ThermometryRegionList")
        rule_idx = 1
        
        for pt in self.points:
            reg = ET.SubElement(region_list, "ThermometryRegion")
            ET.SubElement(reg, "id").text = str(rule_idx)
            ET.SubElement(reg, "enabled").text = "true"
            ET.SubElement(reg, "name").text = pt.id
            ET.SubElement(reg, "emissivity").text = "0.96"
            ET.SubElement(reg, "distance").text = "400"
            ET.SubElement(reg, "reflectiveEnable").text = "false"
            ET.SubElement(reg, "reflectiveTemperature").text = "20.0"
            ET.SubElement(reg, "type").text = "point"
            
            pt_node = ET.SubElement(reg, "Point")
            coords = ET.SubElement(pt_node, "CalibratingCoordinates")
            ET.SubElement(coords, "positionX").text = str(int(pt.x * 1000))
            ET.SubElement(coords, "positionY").text = str(1000 - int(pt.y * 1000))
            
            ET.SubElement(reg, "distanceUnit").text = "centimeter"
            ET.SubElement(reg, "emissivityMode").text = "customsettings"
            rule_idx += 1
            
        for zn in self.zones:
            reg = ET.SubElement(region_list, "ThermometryRegion")
            ET.SubElement(reg, "id").text = str(rule_idx)
            ET.SubElement(reg, "enabled").text = "true"
            ET.SubElement(reg, "name").text = zn.label or zn.id
            ET.SubElement(reg, "emissivity").text = "0.96"
            ET.SubElement(reg, "distance").text = "400"
            ET.SubElement(reg, "reflectiveEnable").text = "false"
            ET.SubElement(reg, "reflectiveTemperature").text = "20.0"
            ET.SubElement(reg, "type").text = "region"
            
            zn_node = ET.SubElement(reg, "Region")
            coords_list = ET.SubElement(zn_node, "RegionCoordinatesList")
            for p in zn.polygon:
                coord = ET.SubElement(coords_list, "RegionCoordinates")
                ET.SubElement(coord, "positionX").text = str(int(p[0] * 1000))
                ET.SubElement(coord, "positionY").text = str(1000 - int(p[1] * 1000))
                
            ET.SubElement(reg, "distanceUnit").text = "centimeter"
            ET.SubElement(reg, "emissivityMode").text = "customsettings"
            rule_idx += 1
            
        for i in range(rule_idx, 22):
            reg = ET.SubElement(region_list, "ThermometryRegion")
            ET.SubElement(reg, "id").text = str(i)
            ET.SubElement(reg, "enabled").text = "false"
            ET.SubElement(reg, "name").text = f"ID:{i}"
            ET.SubElement(reg, "emissivity").text = "0.96"
            ET.SubElement(reg, "distance").text = "400"
            ET.SubElement(reg, "reflectiveEnable").text = "false"
            ET.SubElement(reg, "reflectiveTemperature").text = "20.0"
            ET.SubElement(reg, "type").text = "point"
            
            pt_node = ET.SubElement(reg, "Point")
            coords = ET.SubElement(pt_node, "CalibratingCoordinates")
            ET.SubElement(coords, "positionX").text = "0"
            ET.SubElement(coords, "positionY").text = "0"
            
            ET.SubElement(reg, "distanceUnit").text = "centimeter"
            ET.SubElement(reg, "emissivityMode").text = "customsettings"
            
        ET.register_namespace('', 'http://www.isapi.org/ver20/XMLSchema')
        xml_data = ET.tostring(root, encoding='utf-8')
        
        url = f"http://{self.camera_ip}/ISAPI/Thermal/channels/2/thermometry/rules"
        try:
            if not hasattr(self, '_http_client'):
                self._http_client = httpx.AsyncClient(timeout=5.0)
            client = self._http_client
            resp = await client.put(url, auth=httpx.DigestAuth(self.username, self.password), content=xml_data, headers={'Content-Type': 'application/xml'})
            if resp.status_code == 200:
                logger.info("[ThermalAnalyzer] Successfully synced rules for %s", self.camera_ip)
                return True
            else:
                logger.warning("[ThermalAnalyzer] Failed to sync rules for %s: status %d", self.camera_ip, resp.status_code)
        except Exception as e:
            logger.error("[ThermalAnalyzer] Error syncing rules for %s: %s", self.camera_ip, e)
        return False

    async def _read_rules_temperatures(self, point_temps: dict[str, float], zone_results: dict[str, dict]) -> bool:
        url = f"http://{self.camera_ip}/ISAPI/Thermal/channels/2/thermometry/1/rulesTemperatureInfo?format=json"
        try:
            if not hasattr(self, '_http_client'):
                self._http_client = httpx.AsyncClient(timeout=5.0)
            client = self._http_client
            resp = await client.get(url, auth=httpx.DigestAuth(self.username, self.password))
            if resp.status_code == 200:
                data = resp.json()
                info_list = data.get("ThermometryRulesTemperatureInfoList", {}).get("ThermometryRulesTemperatureInfo", [])
                
                temp_map = {}
                for info in info_list:
                    r_id = info.get("id")
                    if r_id is not None:
                        temp_map[int(r_id)] = info
                
                rule_idx = 1
                for pt in self.points:
                    info = temp_map.get(rule_idx)
                    if info:
                        point_temps[pt.id] = float(info.get("maxTemperature", 0.0))
                    rule_idx += 1
                    
                for zn in self.zones:
                    info = temp_map.get(rule_idx)
                    if info:
                        max_pt = info.get("MaxTemperaturePoint", {})
                        px = float(max_pt.get("positionX", 0.5))
                        py = float(max_pt.get("positionY", 0.5))
                        zone_results[zn.id] = {
                            "max": float(info.get("maxTemperature", 0.0)),
                            "x": px,
                            "y": py
                        }
                    rule_idx += 1
                return True
        except Exception as e:
            logger.error("[ThermalAnalyzer] Error reading rules temperatures for %s: %s", self.camera_ip, e)
        return False

    async def _ingest_measurements(self, point_temps: dict[str, float], zone_results: dict[str, dict]) -> None:
        """Gửi các giá trị nhiệt độ tức thời về backend."""
        payload = []
        for pt in self.points:
            temp = point_temps.get(pt.id)
            if temp is None: continue
            payload.append({"deviceId": self.device_id, "pointId": pt.id, "value": temp, "unit": "°C", "tx": pt.x, "ty": pt.y})
        for zn in self.zones:
            res = zone_results.get(zn.id)
            if not res: continue
            payload.append({"deviceId": self.device_id, "pointId": zn.id, "value": res["max"], "unit": "°C", "tx": res["x"], "ty": res["y"], "isZone": True})
        if not payload: return
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                await client.post(f"{cfg.backend_url}/api/v1/measurements/ingest", json=payload)
        except Exception: pass

    async def _read_thermal_matrix(self) -> tuple[np.ndarray, int, int] | None:
        if not self.points and not self.zones: return None
        now = time.time()
        if now < self._auth_cooldown_until: return None
        if not hasattr(self, '_http_client'):
            self._http_client = httpx.AsyncClient(timeout=5.0)
        client = self._http_client
        for ch in [2, 1]:
            url = f"http://{self.camera_ip}/ISAPI/Thermal/channels/{ch}/thermometry/jpegPicWithAppendData?format=json"
            try:
                resp = await client.get(url, auth=httpx.DigestAuth(self.username, self.password))
                if resp.status_code == 401:
                    self._consecutive_auth_failures += 1
                    if self._consecutive_auth_failures >= 3: self._auth_cooldown_until = now + 300
                    break
                if resp.status_code == 200:
                    self._consecutive_auth_failures = 0
                    content = resp.content
                    boundary = b'--boundary'
                    ct = resp.headers.get("content-type", "")
                    if "boundary=" in ct: boundary = f"--{ct.split('boundary=')[-1].strip()}".encode('ascii')
                    parts = content.split(boundary)
                    w, h, data_len = 256, 192, 196608
                    for part in parts:
                        if b'application/json' in part:
                            h_end = part.find(b'\r\n\r\n')
                            if h_end != -1:
                                import json
                                info = json.loads(part[h_end+4:].decode('utf-8', errors='ignore').strip()).get("JpegPictureWithAppendData", {})
                                w, h = info.get("jpegPicWidth", 256), info.get("jpegPicHeight", 192)
                                data_len = info.get("p2pDataLen") or (w * h * 4)
                    for part in parts:
                        if b'application/octet-stream' in part:
                            h_end = part.find(b'\r\n\r\n')
                            if h_end != -1:
                                matrix_bytes = part[h_end+4:][:data_len]
                                if len(matrix_bytes) >= w * h * 4:
                                    return np.frombuffer(matrix_bytes, dtype=np.float32), w, h
                    break
            except Exception: pass
        return None

    def _annotate(self, frame: np.ndarray, point_temps: dict[str, float], zone_results: dict[str, dict], use_optical_mapping: bool = False) -> np.ndarray:
        out = frame.copy()
        h, w = out.shape[:2]
        font = cv2.FONT_HERSHEY_SIMPLEX
        
        def map_coords(x, y):
            if use_optical_mapping:
                ox = x * self.vvr_w + self.vvr_x
                oy = y * self.vvr_h + self.vvr_y
                return ox, oy
            return x, y

        for zn in self.zones:
            res = zone_results.get(zn.id)
            if not res: continue
            temp = res["max"]
            color = (0, 0, 255) if (zn.alarm > 0 and temp >= zn.alarm) else (0, 165, 255) if (zn.pre_alarm > 0 and temp >= zn.pre_alarm) else (0, 255, 0)
            
            mapped_poly = []
            for p in zn.polygon:
                mx, my = map_coords(p[0], p[1])
                mapped_poly.append([int(mx * w), int(my * h)])
            
            cv2.polylines(out, [np.array(mapped_poly, np.int32)], True, color, 1)
            
            rx, ry = map_coords(res["x"], res["y"])
            cv2.drawMarker(out, (int(rx * w), int(ry * h)), color, cv2.MARKER_CROSS, 10, 1)
            
            if mapped_poly:
                cv2.putText(out, f"{zn.label}: {temp:.1f}C", (mapped_poly[0][0], mapped_poly[0][1] - 5), font, 0.45, color, 1, cv2.LINE_AA)
                
        for pt in self.points:
            temp = point_temps.get(pt.id)
            if temp is None: continue
            color = (0, 0, 255) if (pt.alarm > 0 and temp >= pt.alarm) else (0, 165, 255) if (pt.pre_alarm > 0 and temp >= pt.pre_alarm) else (0, 255, 0)
            
            mx, my = map_coords(pt.x, pt.y)
            cx, cy = int(mx * w), int(my * h)
            
            cv2.drawMarker(out, (cx, cy), color, cv2.MARKER_CROSS, 12, 2)
            cv2.putText(out, pt.label, (cx + 15, cy - 4), font, 0.45, color, 1, cv2.LINE_AA)
            cv2.putText(out, f"{temp:.1f}C", (cx + 15, cy + 12), font, 0.5, color, 1, cv2.LINE_AA)
            
        return out

    async def _check_and_alert(self, point_temps: dict[str, float], zone_results: dict[str, dict]) -> None:
        now = time.time()
        for pt in self.points:
            temp = point_temps.get(pt.id)
            if temp is None or temp > 500.0: continue
            level = "alarm" if (pt.alarm > 0 and temp >= pt.alarm) else "pre_alarm" if (pt.pre_alarm > 0 and temp >= pt.pre_alarm) else None
            if level:
                key = f"{pt.id}:{level}"
                if now - self._last_alert.get(key, 0) >= cfg.alert_cooldown:
                    self._last_alert[key] = now
                    logger.warning("[ThermalAlert] %s trigger for %s: %.1f", level, pt.label, temp)
                    await self._send_webhook(pt.label, self.camera_ip, temp, level)
        for zn in self.zones:
            res = zone_results.get(zn.id)
            if not res or res["max"] > 500.0: continue
            temp = res["max"]
            level = "alarm" if (zn.alarm > 0 and temp >= zn.alarm) else "pre_alarm" if (zn.pre_alarm > 0 and temp >= zn.pre_alarm) else None
            if level:
                key = f"{zn.id}:{level}"
                if now - self._last_alert.get(key, 0) >= cfg.alert_cooldown:
                    self._last_alert[key] = now
                    logger.warning("[ThermalAlert] %s trigger for zone %s: %.1f", level, zn.label, temp)
                    await self._send_webhook(zn.label, self.camera_ip, temp, level)

    async def _send_webhook(self, label: str, ip: str, temp: float, level: str) -> None:
        event_type = "temperaturealarm" if level == "alarm" else "thermalexception"
        xml = f'<EventNotificationAlert version="2.0"><ipAddress>{ip}</ipAddress><eventType>{event_type}</eventType><eventState>active</eventState><channelID>2</channelID><dateTime>{_now_iso()}</dateTime><maxTemp>{temp:.2f}</maxTemp><eventDescription>Vùng/Điểm {label}: {temp:.1f}°C</eventDescription></EventNotificationAlert>'
        files = {"event": (None, xml, "application/xml")}
        frame = get_annotated_frame(self.stream_id)
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                if frame is not None:
                    _, buf = cv2.imencode(".jpg", frame); files["snapshot"] = ("snapshot.jpg", buf.tobytes(), "image/jpeg")
                    await client.post(f"{cfg.backend_url}/api/v1/camera-webhook", files=files)
                else:
                    await client.post(f"{cfg.backend_url}/api/v1/camera-webhook", content=xml, headers={"Content-Type": "application/xml"})
        except Exception: pass

_annotated_frames: dict[str, np.ndarray] = {}
def get_annotated_frame(stream_id: str) -> np.ndarray | None: return _annotated_frames.get(stream_id)
def _now_iso() -> str: from datetime import datetime, timezone; return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
