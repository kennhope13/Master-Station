import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Video, RefreshCw, Wifi, WifiOff, AlertTriangle, Maximize2, Minimize2, Square
} from 'lucide-react';
import { authService } from '@/services/AuthService';
import { stationApi } from '@/services/StationApiService';
import type { CameraDevice, Station } from '@/types/api.types';
import { GO2RTC_URL } from '@/utils/env';

type CamLayout = '1' | '4' | '9';

function expandCameras(cams: CameraDevice[]): CameraDevice[] {
  const out: CameraDevice[] = [];
  cams.forEach(c => {
    const cfg = (c as any).config || {};
    if (c.type === 'camera_dual') {
      out.push({ ...c, id: `${c.id}_optical`, name: `${c.name} (Quang học)`, config: { ...cfg, go2rtc_id: cfg.go2rtc_optical || cfg.go2rtc_id } } as any);
      out.push({ ...c, id: `${c.id}_thermal`, name: `${c.name} (Nhiệt)`, config: { ...cfg, go2rtc_id: cfg.go2rtc_thermal || cfg.go2rtc_id } } as any);
    } else {
      out.push({ ...c, config: cfg } as any);
    }
  });
  return out;
}

export default function LiveCameraPopup() {
  const [params] = useSearchParams();
  const stationId = params.get('stationId') ?? '';

  const [authReady, setAuthReady] = useState(() => !!authService.getToken());
  const [station, setStation] = useState<Station | null>(null);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [go2rtcBase, setGo2rtcBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [layout, setLayout] = useState<CamLayout>('4');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Set window title and ensure auth
  useEffect(() => {
    document.title = 'Trực tiếp — Trạm Tổng';
    if (!authService.getToken()) {
      authService.login('multi', 'Demo@2024')
        .then(() => setAuthReady(true))
        .catch(() => setAuthReady(true));
    }
  }, []);

  // Load station info
  useEffect(() => {
    if (!authReady || !stationId) return;
    stationApi.getStations()
      .then(list => setStation(list.find(s => s.id === stationId) ?? null))
      .catch(() => {});
  }, [authReady, stationId]);

  // Update title with station name
  useEffect(() => {
    if (station) document.title = `${station.name || station.code} — Trực tiếp`;
  }, [station]);

  // Load cameras
  useEffect(() => {
    if (!authReady || !stationId) return;
    setLoading(true);
    setCameras([]);
    setExpandedId(null);
    stationApi.getRemoteCameras(stationId)
      .then(result => {
        setGo2rtcBase(result.go2rtcBase ?? null);
        const getStreamId = (url?: string) => {
          if (!url) return null;
          try { return new URL(url).searchParams.get('src'); } catch { return null; }
        };
        const enriched = result.cameras.map(c => {
          const urls = (c.streamUrls || {}) as Record<string, string>;
          const dev = c.device as any;
          
          let existingCfg = {};
          if (dev.config) {
            try {
              existingCfg = typeof dev.config === 'string' ? JSON.parse(dev.config) : dev.config;
            } catch (e) {
              console.error('Error parsing camera config:', e);
            }
          }

          return {
            ...dev,
            config: {
              ...existingCfg,
              go2rtc_id:      (existingCfg as any).go2rtc_id      || getStreamId(urls.main_webrtc),
              go2rtc_optical: (existingCfg as any).go2rtc_optical || getStreamId(urls.optical_webrtc),
              go2rtc_thermal: (existingCfg as any).go2rtc_thermal || getStreamId(urls.thermal_webrtc),
            },
          };
        });
        setCameras(expandCameras(enriched));
      })
      .catch(() => { setCameras([]); setGo2rtcBase(null); })
      .finally(() => setLoading(false));
  }, [authReady, stationId, refreshKey]);

  const isOffline = station?.connectionStatus !== 'online';
  const cols = layout === '1' ? 1 : layout === '4' ? 2 : 3;
  const maxCams = parseInt(layout);
  const visibleCams = useMemo(() => expandedId
    ? cameras.filter(c => c.id === expandedId)
    : cameras.slice(0, maxCams),
  [cameras, expandedId, maxCams]);
  const emptyCells = expandedId ? 0 : Math.max(0, maxCams - visibleCams.length);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#070c14',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)',
      color: '#e2e8f0'
    }}>
      {/* Top bar */}
      <div style={{
        flexShrink: 0, height: 38,
        background: 'rgba(15,23,42,0.95)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        display: 'flex', alignItems: 'center',
        padding: '0 12px', gap: 10
      }}>
        {/* Status dot */}
        <span style={{
          width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
          background: isOffline ? '#6b7280' : '#10b981',
          boxShadow: isOffline ? 'none' : '0 0 6px #10b981'
        }} />

        {/* Station name */}
        <span style={{ fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.05em', whiteSpace: 'nowrap', flex: 1 }}>
          {station ? (station.code ? `[${station.code}] ${station.name}` : station.name) : stationId}
        </span>

        {/* Connection label */}
        <span style={{
          fontSize: '0.58rem', fontWeight: 800, letterSpacing: '0.08em',
          color: isOffline ? '#6b7280' : '#10b981'
        }}>
          {isOffline ? 'OFFLINE' : 'ONLINE'}
        </span>

        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

        {/* Camera count */}
        <span style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>
          {loading ? '…' : `${cameras.length} camera`}
        </span>

        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

        {/* Layout buttons */}
        {(['1', '4', '9'] as CamLayout[]).map(l => (
          <button
            key={l}
            onClick={() => { setLayout(l); setExpandedId(null); }}
            title={l === '1' ? 'Toàn màn hình' : l === '4' ? 'Lưới 2×2' : 'Lưới 3×3'}
            style={{
              width: 24, height: 24, padding: 0,
              border: '1px solid',
              borderColor: layout === l ? 'rgba(245,158,11,0.8)' : 'rgba(255,255,255,0.12)',
              background: layout === l ? 'rgba(245,158,11,0.12)' : 'transparent',
              color: layout === l ? '#f59e0b' : 'rgba(255,255,255,0.35)',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            <LayoutIcon layout={l} active={layout === l} />
          </button>
        ))}

        {/* Refresh */}
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          title="Tải lại stream"
          style={{
            width: 24, height: 24, padding: 0,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'transparent',
            color: 'rgba(255,255,255,0.35)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <RefreshCw size={11} />
        </button>
      </div>

      {/* Camera grid */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10,
            color: 'rgba(255,255,255,0.35)'
          }}>
            <RefreshCw size={20} style={{ animation: 'popup-spin 1s linear infinite' }} />
            <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>Đang tải camera...</span>
            <style>{`@keyframes popup-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {!loading && cameras.length === 0 && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12, color: 'rgba(255,255,255,0.25)'
          }}>
            {isOffline
              ? <WifiOff size={40} style={{ opacity: 0.4 }} />
              : <Video size={40} style={{ opacity: 0.4 }} />
            }
            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>
              {isOffline ? 'Trạm đang offline' : 'Trạm chưa có camera nào được cấu hình'}
            </span>
          </div>
        )}

        {!loading && cameras.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${expandedId ? 1 : cols}, 1fr)`,
            gridAutoRows: '1fr',
            gap: 2, height: '100%', padding: 2, boxSizing: 'border-box'
          }}>
            {visibleCams.map(cam => (
              <CameraCell
                key={cam.id}
                camera={cam}
                go2rtcBase={go2rtcBase ?? GO2RTC_URL}
                isExpanded={expandedId === cam.id}
                onExpand={() => setExpandedId(cam.id)}
                onCollapse={() => setExpandedId(null)}
              />
            ))}
            {emptyCells > 0 && Array.from({ length: emptyCells }).map((_, i) => (
              <div key={`ph-${i}`} style={{
                background: '#0d1117',
                border: '1px dashed rgba(255,255,255,0.05)',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Video size={20} style={{ opacity: 0.1 }} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CameraCell({ camera, go2rtcBase, isExpanded, onExpand, onCollapse }: {
  camera: CameraDevice;
  go2rtcBase: string;
  isExpanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const cfg = (camera as any).config || {};
  const go2rtcId: string | undefined = cfg.go2rtc_id;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', background: '#080d15', border: '1px solid rgba(255,255,255,0.04)', overflow: 'hidden', minHeight: 0 }}
    >
      {go2rtcId ? (
        <iframe
          key={`${camera.id}-${go2rtcId}`}
          src={`/camera-stream.html?src=${encodeURIComponent(go2rtcId)}&mode=webrtc,mse&go2rtc=${encodeURIComponent(go2rtcBase)}`}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none' }}
          allow="autoplay"
          title={camera.name}
        />
      ) : (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6, color: 'rgba(255,255,255,0.2)'
        }}>
          <Video size={22} style={{ opacity: 0.35 }} />
          <span style={{ fontSize: '0.58rem' }}>Chưa cấu hình stream</span>
        </div>
      )}

      {/* Camera name — top gradient */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        background: 'linear-gradient(rgba(0,0,0,0.7), transparent)',
        padding: '7px 8px 18px',
        pointerEvents: 'none'
      }}>
        <span style={{ fontSize: '0.58rem', fontWeight: 700, color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.9)', letterSpacing: '0.04em' }}>
          {camera.name}
        </span>
      </div>

      {/* Bottom controls — hover */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
        padding: '18px 8px 7px',
        opacity: hovered ? 1 : 0, transition: 'opacity 0.15s',
        display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-end', gap: 5
      }}>
        <button
          onClick={isExpanded ? onCollapse : onExpand}
          style={{
            background: 'rgba(0,0,0,0.65)', border: '1px solid rgba(255,255,255,0.18)',
            color: '#fff', cursor: 'pointer',
            padding: '3px 8px', fontSize: '0.58rem', fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 4
          }}
        >
          {isExpanded ? <><Minimize2 size={10} /> Thu lại</> : <><Maximize2 size={10} /> Phóng to</>}
        </button>
      </div>
    </div>
  );
}

function LayoutIcon({ layout, active }: { layout: CamLayout; active: boolean }) {
  const c = active ? '#f59e0b' : 'currentColor';
  if (layout === '1') return <Square size={10} color={c} />;
  if (layout === '4') return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="0" y="0" width="4" height="4" fill={c} opacity="0.9"/>
      <rect x="6" y="0" width="4" height="4" fill={c} opacity="0.9"/>
      <rect x="0" y="6" width="4" height="4" fill={c} opacity="0.9"/>
      <rect x="6" y="6" width="4" height="4" fill={c} opacity="0.9"/>
    </svg>
  );
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      {[0,3.5,7].map(row => [0,3.5,7].map(col => (
        <rect key={`${row}-${col}`} x={col} y={row} width="2" height="2" fill={c} opacity="0.9"/>
      )))}
    </svg>
  );
}
