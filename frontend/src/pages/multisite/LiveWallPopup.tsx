import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Video, RefreshCw, Monitor, X } from 'lucide-react';
import { authService } from '@/services/AuthService';

interface CellAssignment {
  stationId: string;
  stationName: string;
  provinceName?: string;
  cameraId: string;
  cameraName: string;
  go2rtcId: string;
  go2rtcBase: string;
}

interface WallPreset {
  id: string;
  name: string;
  layout: { cols: number; rows: number };
  cells: Record<number, CellAssignment>;
}

const STORAGE_KEY = 'ms_wall_presets_v1';

function loadPreset(id: string): WallPreset | null {
  try {
    const list: WallPreset[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return list.find(p => p.id === id) ?? null;
  } catch { return null; }
}

export default function LiveWallPopup() {
  const [params] = useSearchParams();
  const presetId = params.get('presetId') ?? '';

  const [authReady, setAuthReady] = useState(() => !!authService.getToken());
  const [preset, setPreset]       = useState<WallPreset | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [barVisible, setBarVisible] = useState(false);

  useEffect(() => {
    document.title = 'Trực tiếp — Wall';
    if (!authService.getToken()) {
      authService.login('multi', 'Demo@2024')
        .then(() => setAuthReady(true))
        .catch(() => setAuthReady(true));
    }
  }, []);

  useEffect(() => {
    if (!authReady || !presetId) return;
    const p = loadPreset(presetId);
    setPreset(p);
    if (p) document.title = `${p.name} — Trực tiếp`;
  }, [authReady, presetId]);

  if (!authReady || !preset) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#070c14', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--admin-font-mono)' }}>
        <Monitor size={32} style={{ opacity: 0.2 }} />
        <span style={{ fontSize: '0.75rem' }}>{!authReady ? 'Đang kết nối...' : 'Không tìm thấy cấu hình'}</span>
      </div>
    );
  }

  const { layout, cells } = preset;
  const maxCells = layout.cols * layout.rows;

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#070c14', display: 'flex', flexDirection: 'column', fontFamily: 'var(--admin-font-mono)', color: '#e2e8f0' }}>
      {/* Hover zone — reveals top bar when mouse enters top 6px */}
      <div
        onMouseEnter={() => setBarVisible(true)}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 6, zIndex: 20 }}
      />

      {/* Top bar — hidden by default, slides in on hover */}
      <div
        onMouseLeave={() => setBarVisible(false)}
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          height: 34, background: 'rgba(15,23,42,0.97)', borderBottom: '1px solid rgba(255,255,255,0.07)',
          display: 'flex', alignItems: 'center', padding: '0 12px', gap: 10,
          transform: barVisible ? 'translateY(0)' : 'translateY(-100%)',
          transition: 'transform 0.18s ease',
        }}
      >
        <Monitor size={11} style={{ color: '#f59e0b' }} />
        <span style={{ fontSize: '0.68rem', fontWeight: 900, letterSpacing: '0.05em', flex: 1 }}>{preset.name}</span>
        <span style={{ fontSize: '0.56rem', color: 'rgba(255,255,255,0.3)' }}>{layout.cols}×{layout.rows}</span>
        <button
          onClick={() => setRefreshKey(k => k + 1)}
          title="Tải lại stream"
          style={{ width: 24, height: 24, padding: 0, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <RefreshCw size={10} />
        </button>
        <button
          onClick={() => window.close()}
          title="Đóng"
          style={{ width: 24, height: 24, padding: 0, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: 'rgba(255,255,255,0.35)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef4444'; (e.currentTarget as HTMLElement).style.borderColor = '#ef4444'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = 'rgba(255,255,255,0.35)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.1)'; }}
        >
          <X size={10} />
        </button>
      </div>

      {/* Camera grid — full height, no offset */}
      <div style={{ flex: 1, overflow: 'hidden', padding: 2, boxSizing: 'border-box', display: 'grid', gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridAutoRows: '1fr', gap: 2 }}>
        {Array.from({ length: maxCells }, (_, i) => {
          const cell = cells[i];
          return (
            <div key={`${i}-${refreshKey}`} style={{ position: 'relative', background: '#080d15', border: '1px solid rgba(255,255,255,0.05)', overflow: 'hidden', minHeight: 0 }}>
              {cell ? (
                <>
                  {cell.go2rtcId ? (
                    <iframe
                      src={`/camera-stream.html?src=${encodeURIComponent(cell.go2rtcId)}&mode=webrtc,mse&go2rtc=${encodeURIComponent(cell.go2rtcBase)}`}
                      style={{ width: '100%', height: '100%', border: 'none', display: 'block', pointerEvents: 'none' }}
                      allow="autoplay"
                      title={cell.cameraName}
                    />
                  ) : (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.1)' }}>
                      <Video size={20} style={{ opacity: 0.3 }} />
                    </div>
                  )}
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, background: 'linear-gradient(rgba(0,0,0,0.75),transparent)', padding: '5px 7px 16px', pointerEvents: 'none' }}>
                    {cell.provinceName && (
                      <div style={{ fontSize: '0.4rem', fontWeight: 700, color: 'rgba(245,158,11,0.6)', letterSpacing: '0.05em', marginBottom: 1 }}>{cell.provinceName}</div>
                    )}
                    <div style={{ fontSize: '0.46rem', fontWeight: 900, color: '#f59e0b', letterSpacing: '0.04em' }}>{cell.stationName}</div>
                    <div style={{ fontSize: '0.54rem', fontWeight: 700, color: '#fff' }}>{cell.cameraName}</div>
                  </div>
                </>
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.06)' }}>
                  <Video size={16} style={{ opacity: 0.3 }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
