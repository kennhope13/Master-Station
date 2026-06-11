// ============================================================
// FleetCameraMosaic.tsx — Lưới camera trực tiếp cho THỐNG KÊ HỆ THỐNG
// Hiển thị preview WebRTC từ go2rtc cho từng trạm trong fleet view
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Video } from 'lucide-react';
import { stationApi, CameraDevice, AlertItem } from '@/services/StationApiService';
import { GO2RTC_URL } from '@/utils/env';
import './AnalyticsLayout.css';

interface StationInfo {
  id: string;
  name: string;
}

interface StationCamStat {
  stationId: string;
  stationName: string;
  total: number;
  online: number;
  offline: number;
  alertCount: number;
  firstCam?: CameraDevice;
}

interface FleetCameraMosaicProps {
  stations: StationInfo[];
  alerts: AlertItem[];
}

/** Lấy baseId của camera, loại bỏ hậu tố _optical / _thermal */
const baseId = (camId: string) => camId.replace(/_(optical|thermal)$/, '').toLowerCase();

export default function FleetCameraMosaic({ stations, alerts }: FleetCameraMosaicProps) {
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [deviceStatus, setDeviceStatus] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // ── Fetch cameras ──────────────────────────────────────────
  useEffect(() => {
    if (stations.length === 0) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      const mergedStatus: Record<string, string> = {};
      const mergedCams: CameraDevice[] = [];

      try {
        const results = await Promise.all(
          stations.map(async (s) => {
            const cams = await stationApi.getCameras(s.id).catch(() => [] as CameraDevice[]);
            return { stationName: s.name, cams };
          })
        );

        results.forEach(({ stationName, cams }) => {
          cams.forEach((c) => {
            const cfg = (c as any).config || {};
            if (c.type === 'camera_dual') {
              mergedCams.push({
                ...(c as any),
                id: `${c.id}_optical`,
                name: `${c.name} (Quang học)`,
                config: { ...cfg, go2rtc_id: cfg.go2rtc_optical || cfg.go2rtc_id },
                stationName,
              } as any);
              mergedCams.push({
                ...(c as any),
                id: `${c.id}_thermal`,
                name: `${c.name} (Nhiệt)`,
                config: { ...cfg, go2rtc_id: cfg.go2rtc_thermal || cfg.go2rtc_id },
                stationName,
              } as any);
            } else if (c.type === 'camera_thermal') {
              mergedCams.push({
                ...(c as any),
                name: c.name.includes('nhiệt') || c.name.includes('Nhiệt') ? c.name : `${c.name} (Nhiệt)`,
                config: { ...cfg, go2rtc_id: cfg.go2rtc_thermal || cfg.go2rtc_id },
                stationName,
              } as any);
            } else {
              mergedCams.push({ ...(c as any), stationName } as any);
            }
            const bId = baseId(c.id);
            mergedStatus[bId] = c.status || 'unknown';
          });
        });
      } catch (err) {
        console.error('[FleetCameraMosaic] fetch failed:', err);
      }

      if (!cancelled) {
        setDeviceStatus(mergedStatus);
        setCameras(mergedCams);
        setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [stations]);

  // ── Compute stats ──────────────────────────────────────────
  const stationCameraStats = useMemo((): StationCamStat[] => {
    const grouped = new Map<string, StationCamStat>();
    const seen = new Set<string>();

    cameras.forEach((cam) => {
      const bId = baseId(cam.id);
      if (seen.has(bId)) return;
      seen.add(bId);

      const name = ((cam as any).stationName as string | undefined) || 'Không rõ';
      const key = name.toLowerCase();
      const status = deviceStatus[bId] || 'unknown';
      const entry = grouped.get(key) || {
        stationId: '', stationName: name,
        total: 0, online: 0, offline: 0, alertCount: 0,
      };

      entry.total += 1;
      if (status === 'online') entry.online += 1;
      else entry.offline += 1;

      if (!entry.firstCam) entry.firstCam = cam;

      // Map stationId from stations prop
      const match = stations.find(s => s.name.toLowerCase() === key);
      if (match) entry.stationId = match.id;

      grouped.set(key, entry);
    });

    // Add stations with no cameras
    stations.forEach((s) => {
      if (!grouped.has(s.name.toLowerCase())) {
        grouped.set(s.name.toLowerCase(), {
          stationId: s.id, stationName: s.name,
          total: 0, online: 0, offline: 0, alertCount: 0,
        });
      }
    });

    // Count alerts per station
    const result = [...grouped.values()];
    result.forEach((entry) => {
      entry.alertCount = alerts.filter((a) => a.stationId === entry.stationId && a.status !== 'closed').length;
    });

    return result.sort((a, b) => a.stationName.localeCompare(b.stationName, 'vi'));
  }, [cameras, deviceStatus, stations, alerts]);

  // ── Render ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="fcm-loading">
        <div className="fcm-loading-spinner" />
        <span>Đang tải camera...</span>
      </div>
    );
  }

  if (stationCameraStats.length === 0) {
    return (
      <div className="fcm-empty">
        <Video size={28} />
        <span>Chưa có camera nào</span>
      </div>
    );
  }

  return (
    <div className="fcm-container">
      {/* Summary bar */}
      <div className="fcm-summary">
        {(() => {
          const totalCams = stationCameraStats.reduce((acc, s) => acc + s.total, 0);
          const onlineCams = stationCameraStats.reduce((acc, s) => acc + s.online, 0);
          const health = totalCams > 0 ? Math.round((onlineCams / totalCams) * 100) : 0;
          return (
            <>
              <span className="fcm-summary-item">
                TRẠM: <b>{stations.length}</b>
              </span>
              <span className="fcm-summary-divider" />
              <span className="fcm-summary-item">
                CAMERA: <b style={{ color: 'var(--admin-success)' }}>{onlineCams} ONLINE</b> / {totalCams}
              </span>
              <span className="fcm-summary-divider" />
              <span className="fcm-summary-item">
                HEALTH: <b style={{ color: health >= 90 ? 'var(--admin-success)' : health >= 50 ? 'var(--admin-accent)' : 'var(--admin-danger)' }}>{health}%</b>
              </span>
            </>
          );
        })()}
      </div>

      {/* Mosaic grid */}
      <div className="fcm-grid">
        {stationCameraStats.map((stat) => {
          const cam = stat.firstCam;
          const health = stat.total > 0 ? Math.round((stat.online / stat.total) * 100) : 0;
          const healthColor = health >= 90 ? 'var(--admin-success)' : health >= 50 ? 'var(--admin-accent)' : 'var(--admin-danger)';

          return (
            <div key={stat.stationId || stat.stationName} className="fcm-card">
              {/* Header */}
              <div className="fcm-card-header">
                <div className="fcm-card-title-row">
                  <div
                    className="fcm-card-dot"
                    style={{
                      background: stat.online > 0 ? 'var(--admin-success)' : 'var(--admin-danger)',
                      boxShadow: stat.online > 0 ? '0 0 5px var(--admin-success)' : 'none',
                    }}
                  />
                  <b className="fcm-card-name">{stat.stationName.toUpperCase()}</b>
                </div>
                {stat.alertCount > 0 && (
                  <div className="fcm-card-alert-badge">
                    <AlertTriangle size={10} /> {stat.alertCount}
                  </div>
                )}
              </div>

              {/* Preview */}
              <div className="fcm-card-preview">
                {cam ? (
                  <iframe
                    src={`/camera-stream.html?src=${encodeURIComponent((cam as any).config?.go2rtc_id || (cam as any).config?.go2rtc_optical || '')}&mode=webrtc,mse&go2rtc=${encodeURIComponent(GO2RTC_URL)}`}
                    className="fcm-card-iframe"
                    title={cam.name}
                  />
                ) : (
                  <div className="fcm-card-no-signal">
                    <Video size={24} />
                    <span>NO SIGNAL</span>
                  </div>
                )}
                <div className="fcm-card-preview-gradient" />
                <div className="fcm-card-preview-label">
                  <span className="fcm-card-cam-name">{cam?.name || '---'}</span>
                  <span className="fcm-card-live-badge">LIVE</span>
                </div>
              </div>

              {/* Footer */}
              <div className="fcm-card-footer">
                <span className="fcm-card-footer-stat">
                  ONLINE: <b>{stat.online}</b> / {stat.total}
                </span>
                <div className="fcm-card-health">
                  <div className="fcm-card-health-bar">
                    <div
                      className="fcm-card-health-fill"
                      style={{ width: `${health}%`, background: healthColor }}
                    />
                  </div>
                  <span style={{ color: healthColor }}>{health}%</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
