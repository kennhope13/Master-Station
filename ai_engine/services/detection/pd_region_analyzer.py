"""
pd_region_analyzer.py — OpenCV overlay vùng phóng điện lên annotated frame

Nhiệm vụ:
1. Load danh sách vùng (polygon) từ Backend API (/api/v1/cameras/:id/pd-boundaries)
2. Với mỗi frame từ RtspReader: vẽ polygon theo mức dB hiện tại
   - Bình thường  → viền xanh dương mờ
   - Cảnh báo (≥warn_db) → viền cam + fill nhạt
   - Báo động (≥alarm_db) → viền đỏ + fill + flash + gửi alert
3. Trả về annotated frame cho MJPEG endpoint
"""
import cv2
import logging
import threading
import time
import requests
import numpy as np
from dataclasses import dataclass, field

from config import get_settings

logger = logging.getLogger(__name__)
cfg = get_settings()

# ── Shared annotated frame store (dùng chung với thermal) ────────────
_pd_annotated_frames: dict[str, np.ndarray] = {}


def get_annotated_frame(stream_id: str) -> np.ndarray | None:
    """Trả về frame đã annotate mới nhất của stream, hoặc None nếu chưa có."""
    return _pd_annotated_frames.get(stream_id)


@dataclass
class PdRegion:
    """Vùng đo phóng điện — tương ứng Boundary trong frontend."""
    id: str
    name: str
    vertices: list[dict]         # [{"x": 0-100, "y": 0-100}, ...]
    warning_threshold: float = 20.0
    alarm_threshold: float = 45.0
    border_thickness: int = 1
    font_size: int = 14
    name_position: str = "top"


@dataclass
class PdRegionAnalyzer:
    """
    Nhận frame từ RtspReader + danh sách PdRegion,
    vẽ polygon OpenCV lên frame, phát hiện vùng vượt ngưỡng.
    """
    device_id: str
    camera_ip: str
    stream_id: str

    regions: list[PdRegion] = field(default_factory=list)
    _regions_lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _last_alert: dict[str, float] = field(default_factory=dict, init=False)
    _flash_state: bool = field(default=False, init=False)
    _flash_counter: int = field(default=0, init=False)
    active_region_id: str | None = field(default=None, init=False)
    discharge_counts: dict[str, int] = field(default_factory=dict, init=False)

    # ── Public API ────────────────────────────────────────────────────

    def update_regions(self, regions: list[PdRegion]) -> None:
        """Cập nhật vùng vẽ an toàn (thread-safe)."""
        with self._regions_lock:
            self.regions = regions
        logger.info("[PdRegion] Updated %d regions for %s", len(regions), self.stream_id)

    def _detect_hotspot(self, img: np.ndarray) -> tuple[float, float, float] | None:
        """
        Nguyên lý từ test_cam153_boundaries.py:
        Detect vị trí nguồn âm (blob đỏ/cam từ acoustic overlay) trong frame.
        Trả về (cx, cy, area) chuẩn hóa [0,1], hoặc None.
        """
        import cv2
        h, w = img.shape[:2]
        scale = 640.0 / float(w)
        small_w, small_h = int(w * scale), int(h * scale)
        small = cv2.resize(img, (small_w, small_h))

        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        m_red1 = cv2.inRange(hsv, (0, 120, 150), (15, 255, 255))
        m_red2 = cv2.inRange(hsv, (165, 120, 150), (180, 255, 255))
        m_oy   = cv2.inRange(hsv, (15, 120, 150), (35, 255, 255))
        mask = m_red1 | m_red2 | m_oy

        # Loại bỏ nhiễu biên (palette và info)
        mask[:, int(small_w * 0.92):] = 0
        mask[:int(small_h * 0.05), :] = 0
        mask[int(small_h * 0.92):, :] = 0

        kernel = np.ones((3, 3), np.uint8)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours: return None
        
        candidates = []
        for c in contours:
            area = float(cv2.contourArea(c))
            if area < 10: continue
            x, y, cw, ch = cv2.boundingRect(c)
            ar = max(cw, ch) / max(1, min(cw, ch))
            if ar > 4.5: continue
            candidates.append((area, c))
            
        if not candidates: return None
        
        # Lấy đốm lớn nhất (nguyên lý file test)
        largest_area, largest_contour = max(candidates, key=lambda t: t[0])
        M = cv2.moments(largest_contour)
        if M["m00"] == 0: return None
        
        cx = M["m10"] / M["m00"]
        cy = M["m01"] / M["m00"]
        return (cx / small_w, cy / small_h, largest_area / (scale * scale))


    def _point_in_polygon(self, point, polygon_vertices):
        """Kiểm tra xem điểm (x,y) 0-1 có nằm trong polygon không."""
        x, y = point
        n = len(polygon_vertices)
        inside = False
        j = n - 1
        for i in range(n):
            xi = polygon_vertices[i]["x"] / 100.0
            yi = polygon_vertices[i]["y"] / 100.0
            xj = polygon_vertices[j]["x"] / 100.0
            yj = polygon_vertices[j]["y"] / 100.0
            if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
                inside = not inside
            j = i
        return inside

    def process_frame(self, frame: np.ndarray, current_db: float, current_hz: float = 0.0, audio_exception: bool = False) -> np.ndarray:
        """
        Vẽ tất cả vùng PD lên frame. 
        KẾT HỢP: Phản hồi thị giác ĐỎ tức thì từ file test + Bảo mật âm thanh từ Dashboard.
        """
        with self._regions_lock:
            regions_snapshot = list(self.regions)

        h, w = frame.shape[:2]
        annotated = frame.copy()

        if not regions_snapshot:
            _pd_annotated_frames[self.stream_id] = annotated
            return annotated

        # Hiệu ứng flash
        self._flash_counter = (self._flash_counter + 1) % 10
        self._flash_state = self._flash_counter < 5

        # Detect đốm chủ đạo (largest hotspot)
        det = self._detect_hotspot(frame)
        active_region_id = None
        marker_hotspot = None

        if det:
            marker_hotspot = (det[0], det[1])

        for region in regions_snapshot:
            verts = region.vertices
            if len(verts) < 3: continue

            pts_arr = np.array([[int(v["x"] / 100 * w), int(v["y"] / 100 * h)] for v in verts], dtype=np.int32)
            M = cv2.moments(pts_arr)
            cx = int(M["m10"] / M["m00"]) if M["m00"] != 0 else pts_arr[0][0]
            cy = int(M["m01"] / M["m00"]) if M["m00"] != 0 else pts_arr[0][1]

            # Kiểm tra đốm có nằm trong vùng không
            is_hotspot_in_region = det is not None and self._point_in_polygon((det[0], det[1]), verts)

            # ĐIỀU KIỆN KÉP: Phải có đốm trong vùng VÀ vượt ngưỡng dB thực tế đã cài đặt
            is_alarm = is_hotspot_in_region and (current_db >= region.alarm_threshold)
            is_warning = is_hotspot_in_region and (current_db >= region.warning_threshold)

            if is_alarm:
                level = "alarm"
                color = (0, 0, 255)  # Đỏ
                fill_alpha = 0.25 if self._flash_state else 0.05
                border_thickness = region.border_thickness + 1
                active_region_id = region.id
                self._update_ui_state(region.name, current_db, current_hz, "alarm", marker_hotspot)
                self._maybe_send_alert(region, current_db, current_hz, "alarm", annotated)
            elif is_warning:
                level = "warning"
                color = (0, 165, 255)  # Cam
                fill_alpha = 0.15
                border_thickness = region.border_thickness
                active_region_id = region.id
                self._update_ui_state(region.name, current_db, current_hz, "warning", marker_hotspot)
                self._maybe_send_alert(region, current_db, current_hz, "warning", annotated)
            else:
                level = "normal"
                color = (0, 255, 0)  # Xanh lá
                fill_alpha = 0.0
                border_thickness = region.border_thickness
                self._clear_ui_state(region.name)
                self._maybe_send_alert(region, current_db, current_hz, "normal")

            # Vẽ đa giác
            if fill_alpha > 0:
                overlay = annotated.copy()
                cv2.fillPoly(overlay, [pts_arr], color)
                cv2.addWeighted(overlay, fill_alpha, annotated, 1 - fill_alpha, 0, annotated)

            cv2.polylines(annotated, [pts_arr], isClosed=True, color=color, thickness=border_thickness, lineType=cv2.LINE_AA)

            # Vẽ nhãn
            label_pos = getattr(region, "name_position", "top")
            font_sz = getattr(region, "font_size", 14)
            scale = font_sz / 20.0
            x_bb, y_bb, w_bb, h_bb = cv2.boundingRect(pts_arr)
            text_x, text_y = cx, cy
            if label_pos == "top": text_y = y_bb - int(10 * scale)
            elif label_pos == "bottom": text_y = y_bb + h_bb + int(20 * scale)
            elif label_pos == "left": text_x = x_bb - int(10 * scale)
            elif label_pos == "right": text_x = x_bb + w_bb + int(10 * scale)

            text_val = f"{region.name}"
            _draw_text_no_bg(annotated, text_val, (text_x, text_y), color=color, font_scale=scale, center=True)

        # Vẽ Marker điểm phóng điện
        if marker_hotspot:
            hx, hy = int(marker_hotspot[0]*w), int(marker_hotspot[1]*h)
            cv2.circle(annotated, (hx, hy), 12, (255, 255, 255), 2, cv2.LINE_AA)
            cv2.drawMarker(annotated, (hx, hy), (0, 0, 255), markerType=cv2.MARKER_CROSS, markerSize=15, thickness=2)

        self.active_region_id = active_region_id
        _pd_annotated_frames[self.stream_id] = annotated
        return annotated

    def trigger_audio_alert(self, db: float, hz: float = 0.0) -> None:
        """Kích hoạt cảnh báo dựa trên âm thanh (audioexception). Logic đã được tích hợp vào process_frame."""
        pass

    def load_regions_from_backend(self) -> None:
        """Gọi Backend API để lấy danh sách vùng vẽ cho camera này."""
        try:
            # FIX: Dùng đúng endpoint Backend và truyền type=pd
            url = f"{cfg.backend_url}/api/v1/devices/{self.device_id}/boundaries?type=pd"
            resp = requests.get(url, timeout=5)
            if resp.status_code == 200:
                raw_data = resp.json()
                import json as _json
                
                regions = []
                for r in raw_data:
                    # Parse Polygon (dạng [[x,y]...] 0-1) -> vertices (dạng {x,y} 0-100)
                    try:
                        poly_arr = _json.loads(r.get("Polygon") or r.get("polygon") or "[]")
                        vertices = [{"x": p[0]*100, "y": p[1]*100} for p in poly_arr]
                    except:
                        vertices = []
                        
                    # Parse Thresholds (chứa ngưỡng và style)
                    try:
                        t = _json.loads(r.get("Thresholds") or r.get("thresholds") or "{}")
                        warn  = float(t.get("warn", 20.0))
                        alarm = float(t.get("alarm", 45.0))
                        thick = int(t.get("strokeWidth") or t.get("borderThickness", 1))
                        fsize = int(t.get("fontSize", 14))
                        pos   = str(t.get("labelPos") or t.get("namePosition", "top"))
                    except:
                        warn, alarm, thick, fsize, pos = 20.0, 45.0, 1, 14, "top"

                    regions.append(PdRegion(
                        id=str(r.get("Id") or r.get("id")),
                        name=r.get("Name") or r.get("name") or "Zone",
                        vertices=vertices,
                        warning_threshold=warn,
                        alarm_threshold=alarm,
                        border_thickness=thick,
                        font_size=fsize,
                        name_position=pos
                    ))
                    regions[-1].label_pos = pos
                
                self.update_regions(regions)
                logger.info("[PdRegion] Loaded %d regions from backend for %s", len(regions), self.device_id)
            else:
                logger.warning("[PdRegion] Backend returned %d for device %s", resp.status_code, self.device_id)
        except Exception as ex:
            logger.warning("[PdRegion] Could not load regions: %s", ex)

    # ── Alert ─────────────────────────────────────────────────────────

    def _maybe_send_alert(self, region: PdRegion, db: float, hz: float, level: str, annotated: np.ndarray | None = None) -> None:
        """
        Gửi alert CHỈ khi có sự thay đổi trạng thái:
        normal → warning, normal → alarm, hoặc warning → alarm.
        Không gửi lại khi hotspot vẫn nằm trong vùng (tránh spam liên tục).
        """
        last_state = self._last_alert.get(region.id, ("normal", 0))
        last_level, last_ts = last_state[0], last_state[1]
        now = time.time()

        # Cập nhật số lần phóng điện khi phát hiện sự kiện mới bắt đầu (normal -> warning hoặc normal -> alarm)
        if level in ("warning", "alarm") and last_level == "normal":
            self.discharge_counts[region.name] = self.discharge_counts.get(region.name, 0) + 1

        if level == "normal":
            self._last_alert[region.id] = ("normal", 0)
            return

        # Gửi khi: đổi trạng thái (normal→*, warning→alarm) HOẶC retry sau 5 phút nếu vẫn alarm/warning
        should_send = (
            (last_level == "normal")
            or (last_level == "warning" and level == "alarm")
            or (now - last_ts >= 300)  # retry mỗi 5 phút nếu vẫn đang cảnh báo
        )

        if not should_send:
            return

        xml = (
            f'<EventNotificationAlert version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">'
            f'<ipAddress>{self.camera_ip}</ipAddress>'
            f'<eventType>dischargedetection</eventType>'
            f'<eventState>active</eventState>'
            f'<channelID>1</channelID>'
            f'<affectedZone>{region.name}</affectedZone>'
            f'<regionName>{region.name}</regionName>'
            f'<severity>{level}</severity>'
            f'<dateTime>{time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}</dateTime>'
            f'<eventDescription>Phong dien tai vung "{region.name}": {db:.1f} dB, tan so {hz:.1f} Hz (level={level})</eventDescription>'
            f'<audioDecibel>{db:.1f}</audioDecibel>'
            f'<audioFrequency>{hz:.1f}</audioFrequency>'
            f'</EventNotificationAlert>'
        )
        img_bytes = None
        if annotated is not None:
            import cv2
            success, encoded_img = cv2.imencode('.jpg', annotated)
            if success:
                img_bytes = encoded_img.tobytes()

        files = {
            'event': (None, xml, 'application/xml'),
        }
        if img_bytes:
            files['image_hd'] = ('snapshot.jpg', img_bytes, 'image/jpeg')

        def send_post():
            try:
                requests.post(
                    f"{cfg.backend_url}/api/v1/camera-webhook",
                    files=files,
                    timeout=3.0,
                )
                # Chỉ cập nhật state SAU KHI gửi thành công → nếu lỗi sẽ retry lần sau
                self._last_alert[region.id] = (level, now)
                logger.info("[PdRegion] Alert sent: region=%s level=%s db=%.1f", region.name, level, db)
            except Exception as ex:
                logger.warning("[PdRegion] Alert send failed (sẽ retry): %s", ex)

        import threading
        threading.Thread(target=send_post, daemon=True).start()

    def _update_ui_state(self, region_name: str, db: float, hz: float, level: str, hotspot: tuple) -> None:
        """Cập nhật sự kiện hiển thị trên UI Frontend"""
        try:
            from api.routes import _get_or_create_state
            state = _get_or_create_state(self.device_id)
            state["active_boundary"] = region_name
            state["active_ts"] = time.time() # Lưu mốc thời gian cập nhật cuối
            state["detection"] = {"x": hotspot[0], "y": hotspot[1]}
            state["discharge_counts"] = self.discharge_counts
            
            # Tránh ghi log sự kiện liên tục mỗi frame
            key = f"{region_name}:event_log"
            now = time.time()
            if now - self._last_alert.get(key, 0) > 3.0:  # Log mỗi 3s 1 lần nếu còn nằm trong ngưỡng
                self._last_alert[key] = now
                event = {
                    "ts": time.strftime("%H:%M:%S"),
                    "boundary": region_name,
                    "db": db,
                    "hz": hz,
                    "level": level,
                    "x": round(hotspot[0], 3),
                    "y": round(hotspot[1], 3)
                }
                state["events"] = [event] + state.get("events", [])[:49] # Giữ 50 sự kiện gần nhất
        except Exception as e:
            logger.debug("UI State update error: %s", e)

    def _clear_ui_state(self, region_name: str) -> None:
        """Xoá active boundary nếu nó đã trở lại bình thường (giữ lại 2s để tránh flicker)"""
        try:
            from api.routes import _get_or_create_state
            state = _get_or_create_state(self.device_id)
            state["discharge_counts"] = self.discharge_counts
            if state.get("active_boundary") == region_name:
                # Chỉ xóa nếu đã quá 2 giây không có cập nhật mới
                if time.time() - state.get("active_ts", 0) > 2.0:
                    state["active_boundary"] = None
                    state["detection"] = None
        except Exception:
            pass


# ── Helper ────────────────────────────────────────────────────────────

def _draw_text_no_bg(
    frame: np.ndarray,
    text: str,
    pos: tuple[int, int],
    color: tuple[int, int, int] = (255, 255, 255),
    font_scale: float = 0.5,
    thickness: int = 1,
    center: bool = True
) -> None:
    """Vẽ chữ sắc nét không nền, dùng viền outline đen mỏng chống loá mắt."""
    font = cv2.FONT_HERSHEY_SIMPLEX
    if center:
        (tw, th), _ = cv2.getTextSize(text, font, font_scale, thickness)
        x = pos[0] - tw // 2
        y = pos[1] + th // 2
    else:
        x, y = pos

    # Vẽ outline viền đen xung quanh chữ trước
    cv2.putText(frame, text, (x, y), font, font_scale, (0, 0, 0), thickness + 2, cv2.LINE_AA)
    # Vẽ chữ trắng đè lên
    cv2.putText(frame, text, (x, y), font, font_scale, color, thickness, cv2.LINE_AA)
